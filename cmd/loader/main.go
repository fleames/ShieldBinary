//go:build windows

package main

import (
	"bytes"
	"compress/gzip"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"debug/pe"
	"encoding/binary"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"
)

const (
	magicV3     = "SBP3"
	magicV2     = "SBP2"
	magicLegacy = "SBPK"
	magicLen    = 4
	keyLenV2    = 32
	nonceV3Len  = 12
	ivLenV2     = 16
	keyLenV1    = 1
	lengthLen   = 8
	flagsLen    = 1
	footerV2Len = keyLenV2 + lengthLen + flagsLen
	footerV1Len = magicLen + keyLenV1 + lengthLen
)

func main() {
	// Anti-debug: exit if a debugger is attached (local or remote)
	if isDebuggerPresent() || isRemoteDebuggerPresent() {
		os.Exit(0xDEAD)
	}
	self, err := os.Executable()
	if err != nil {
		os.Exit(1)
	}
	data, err := os.ReadFile(self)
	if err != nil {
		os.Exit(1)
	}

	// Try embedded payload first (SBP3/SBP2 in last PE section - no overlay)
	if payload, magic, ok := readEmbeddedPayload(data); ok {
		runPayloadByVersion(self, payload, magic)
		return
	}

	// Fallback: overlay format (SBP2 or SBPK at end of file)
	size := int64(len(data))
	f := bytes.NewReader(data)

	// Try SBP3/SBP2 overlay: last 41 bytes = key(32) + payloadLen(8) + flags(1)
	if size >= footerV2Len {
		footer := make([]byte, footerV2Len)
		if _, err := f.ReadAt(footer, size-footerV2Len); err != nil {
			os.Exit(1)
		}
		payloadLen := int64(binary.LittleEndian.Uint64(footer[keyLenV2:]))
		if payloadLen >= nonceV3Len && size >= footerV2Len+payloadLen+magicLen {
			magicBuf := make([]byte, magicLen)
			payloadStart := size - footerV2Len - payloadLen
			if _, err := f.ReadAt(magicBuf, payloadStart-magicLen); err != nil {
				os.Exit(1)
			}
			magic := string(magicBuf)
			if magic == magicV3 || magic == magicV2 {
				payload := make([]byte, payloadLen)
				f.ReadAt(payload, payloadStart)
				runPayloadByVersion(self, payload, magic)
				return
			}
		}
	}

	// Fallback: SBPK legacy overlay
	if size >= footerV1Len {
		tail := make([]byte, footerV1Len)
		if _, err := f.ReadAt(tail, size-footerV1Len); err != nil {
			os.Exit(1)
		}
		if string(tail[:magicLen]) == magicLegacy {
			runLegacyFromBytes(data, size, tail, self)
			return
		}
	}
	os.Exit(1)
}

// readEmbeddedPayload reads SBP3/SBP2 payload from the last PE section (no overlay).
func readEmbeddedPayload(data []byte) ([]byte, string, bool) {
	peFile, err := pe.NewFile(bytes.NewReader(data))
	if err != nil {
		return nil, "", false
	}
	defer peFile.Close()
	if len(peFile.Sections) == 0 {
		return nil, "", false
	}
	last := peFile.Sections[len(peFile.Sections)-1]
	if last.Offset == 0 || last.Size < footerV2Len+magicLen+nonceV3Len {
		return nil, "", false
	}
	secEnd := int64(last.Offset) + int64(last.Size)
	if secEnd > int64(len(data)) {
		return nil, "", false
	}
	footer := data[secEnd-footerV2Len : secEnd]
	payloadLen := int64(binary.LittleEndian.Uint64(footer[keyLenV2:]))
	blockSize := magicLen + payloadLen + footerV2Len
	if payloadLen < nonceV3Len || blockSize > int64(last.Size) {
		return nil, "", false
	}
	block := data[secEnd-int64(blockSize) : secEnd]
	magic := string(block[:magicLen])
	if magic != magicV3 && magic != magicV2 {
		return nil, "", false
	}
	return block, magic, true
}

func runPayloadByVersion(exePath string, payload []byte, magic string) {
	switch magic {
	case magicV3:
		runV3FromBytes(exePath, payload)
	case magicV2:
		runV2FromBytes(exePath, payload)
	default:
		os.Exit(1)
	}
}

func runV3FromBytes(exePath string, payload []byte) {
	if len(payload) < magicLen+nonceV3Len+footerV2Len {
		os.Exit(1)
	}
	keySeed := payload[len(payload)-footerV2Len : len(payload)-footerV2Len+keyLenV2]
	nonce := payload[magicLen : magicLen+nonceV3Len]
	ciphertext := payload[magicLen+nonceV3Len : len(payload)-footerV2Len]
	key := deriveKey(keySeed, nonce)

	block, err := aes.NewCipher(key)
	if err != nil {
		os.Exit(1)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		os.Exit(1)
	}
	decompressedBytes, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		// Fail closed when integrity/authentication verification fails.
		os.Exit(1)
	}

	gr, err := gzip.NewReader(bytes.NewReader(decompressedBytes))
	if err != nil {
		os.Exit(1)
	}
	defer gr.Close()
	decompressed, err := io.ReadAll(gr)
	if err != nil {
		os.Exit(1)
	}
	runPayload(exePath, decompressed)
}

func runV2FromBytes(exePath string, payload []byte) {
	if len(payload) < magicLen+ivLenV2+footerV2Len {
		os.Exit(1)
	}
	keySeed := payload[len(payload)-footerV2Len : len(payload)-footerV2Len+keyLenV2]
	nonce := payload[magicLen : magicLen+ivLenV2]
	ciphertext := payload[magicLen+ivLenV2 : len(payload)-footerV2Len]

	// Legacy read path kept for compatibility with SBP2 artifacts.
	key := deriveKey(keySeed, nonce)

	block, err := aes.NewCipher(key)
	if err != nil {
		os.Exit(1)
	}
	stream := cipher.NewCTR(block, nonce)
	decrypted := make([]byte, len(ciphertext))
	stream.XORKeyStream(decrypted, ciphertext)

	gr, err := gzip.NewReader(bytes.NewReader(decrypted))
	if err != nil {
		os.Exit(1)
	}
	defer gr.Close()
	decompressed, err := io.ReadAll(gr)
	if err != nil {
		os.Exit(1)
	}
	runPayload(exePath, decompressed)
}

func runLegacyFromBytes(data []byte, size int64, tail []byte, exePath string) {
	key := tail[magicLen]
	payloadLen := int64(bytesToUint64(tail[magicLen+keyLenV1:]))
	if payloadLen <= 0 || payloadLen > size-int64(len(tail)) {
		os.Exit(1)
	}
	payloadStart := size - int64(len(tail)) - payloadLen
	payload := make([]byte, payloadLen)
	copy(payload, data[payloadStart:payloadStart+payloadLen])
	for i := range payload {
		payload[i] ^= key ^ byte(i%256)
	}
	runPayload(exePath, payload)
}

func runPayload(exePath string, payload []byte) {
	ext := ".exe"
	if filepath.Ext(exePath) == ".dll" {
		ext = ".dll"
	}
	// Run from loader's directory so .NET host finds its .dll, deps, etc. in same folder
	loaderDir := filepath.Dir(exePath)
	tmpPath, err := createSecureTempExecutable(loaderDir, ext, payload)
	if err != nil {
		os.Exit(1)
	}
	defer secureDeleteTempFile(tmpPath)

	cmd := exec.Command(tmpPath)
	cmd.Dir = loaderDir // so .NET host finds .dll, runtimeconfig.json, deps.json
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	err = cmd.Run()
	if cmd.ProcessState != nil {
		os.Exit(cmd.ProcessState.ExitCode())
	}
	if err != nil {
		os.Exit(1)
	}
}

func createSecureTempExecutable(dir, ext string, payload []byte) (string, error) {
	f, err := os.CreateTemp(dir, "sb-*"+ext)
	if err != nil {
		return "", err
	}
	name := f.Name()
	if _, err := f.Write(payload); err != nil {
		f.Close()
		_ = os.Remove(name)
		return "", err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(name)
		return "", err
	}
	return name, nil
}

func secureDeleteTempFile(path string) {
	if path == "" {
		return
	}
	// Best-effort cleanup to reduce plaintext artifact lifetime.
	if st, err := os.Stat(path); err == nil && st.Size() > 0 {
		if f, openErr := os.OpenFile(path, os.O_WRONLY, 0); openErr == nil {
			buf := make([]byte, 4096)
			_, _ = rand.Read(buf)
			remaining := st.Size()
			for remaining > 0 {
				n := int64(len(buf))
				if remaining < n {
					n = remaining
				}
				_, _ = f.Write(buf[:n])
				remaining -= n
			}
			_ = f.Sync()
			_ = f.Close()
		}
	}
	_ = os.Remove(path)
}

func deriveKey(seed, nonce []byte) []byte {
	h := sha256.New()
	h.Write(seed)
	h.Write(nonce)
	return h.Sum(nil)
}

func isDebuggerPresent() bool {
	k32 := syscall.NewLazyDLL("kernel32.dll")
	proc := k32.NewProc("IsDebuggerPresent")
	r, _, _ := proc.Call()
	return r != 0
}

func isRemoteDebuggerPresent() bool {
	k32 := syscall.NewLazyDLL("kernel32.dll")
	proc := k32.NewProc("CheckRemoteDebuggerPresent")
	var present uint32
	// (HANDLE)-1 = current process pseudo-handle
	r, _, _ := proc.Call(uintptr(^uintptr(0)), uintptr(unsafe.Pointer(&present)))
	if r == 0 {
		return false
	}
	return present != 0
}

func bytesToUint64(b []byte) uint64 {
	var v uint64
	for i := 0; i < 8 && i < len(b); i++ {
		v |= uint64(b[i]) << (i * 8)
	}
	return v
}
