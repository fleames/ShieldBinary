package nativepacker

import (
	"bytes"
	"compress/gzip"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"debug/pe"
	"encoding/binary"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

const (
	magicV3   = "SBP3" // v3: AES-GCM + gzip (authenticated encryption)
	magicV2   = "SBP2" // v2: AES-CTR + gzip (legacy read compatibility in loader)
	magicLen  = 4
	keyLen    = 32
	nonceLen  = 12 // GCM standard nonce size
	lengthLen = 8
	flagsLen  = 1
	footerLen = keyLen + lengthLen + flagsLen
	flagNoop  = 0
)

// Pack creates a protected native PE: compresses, encrypts with AES-256-GCM,
// and prepends a loader stub. The output runs the original binary at runtime.
// Tier affects protection level: basic=AEAD+gzip, pro/enterprise=+padding.
func Pack(inputPath, outputPath, loaderPath, tier string) error {
	loader, err := os.ReadFile(loaderPath)
	if err != nil {
		return fmt.Errorf("read loader: %w", err)
	}
	input, err := os.ReadFile(inputPath)
	if err != nil {
		return fmt.Errorf("read input: %w", err)
	}
	if len(input) == 0 {
		return fmt.Errorf("input file is empty")
	}

	// Pro/Enterprise: sanitize PE metadata (zero timestamps) before packing
	if tier == "pro" || tier == "enterprise" {
		input = sanitizePE(input)
	}

	// Compress
	var cbuf bytes.Buffer
	gz := gzip.NewWriter(&cbuf)
	if _, err := gz.Write(input); err != nil {
		return fmt.Errorf("gzip: %w", err)
	}
	if err := gz.Close(); err != nil {
		return fmt.Errorf("gzip close: %w", err)
	}
	compressed := cbuf.Bytes()

	// Pro/Enterprise: add random padding to obscure size
	if tier == "pro" || tier == "enterprise" {
		padLen := 256 + (len(compressed) % 512)
		if padLen > 0 {
			pad := make([]byte, padLen)
			rand.Read(pad)
			compressed = append(compressed, pad...)
		}
	}

	// Encrypt with AEAD (AES-256-GCM) so tampering is detected before execution.
	keySeed := make([]byte, keyLen)
	if _, err := rand.Read(keySeed); err != nil {
		return fmt.Errorf("rand key: %w", err)
	}
	nonce := make([]byte, nonceLen)
	if _, err := rand.Read(nonce); err != nil {
		return fmt.Errorf("rand nonce: %w", err)
	}
	key := deriveKey(keySeed, nonce)

	block, err := aes.NewCipher(key)
	if err != nil {
		return fmt.Errorf("aes: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return fmt.Errorf("gcm: %w", err)
	}
	encrypted := gcm.Seal(nil, nonce, compressed, nil)

	// Footer: store keySeed (not derived key) so loader can derive same key
	var flags byte = flagNoop
	footer := make([]byte, footerLen)
	copy(footer, keySeed)
	binary.LittleEndian.PutUint64(footer[keyLen:], uint64(nonceLen+len(encrypted)))
	footer[keyLen+lengthLen] = flags

	// Embed payload in last PE section (avoids "strange overlay" heuristic)
	payload := make([]byte, 0, magicLen+nonceLen+len(encrypted)+footerLen)
	payload = append(payload, magicV3...)
	payload = append(payload, nonce...)
	payload = append(payload, encrypted...)
	payload = append(payload, footer...)

	outBuf, err := embedPayloadInPE(loader, payload)
	if err != nil {
		// Fallback: overlay format (section embed can fail on some loader PEs)
		var buf bytes.Buffer
		buf.Write(loader)
		buf.Write(payload)
		outBuf = buf.Bytes()
	}

	outDir := filepath.Dir(outputPath)
	if outDir != "" {
		if err := os.MkdirAll(outDir, 0755); err != nil {
			return fmt.Errorf("create output dir: %w", err)
		}
	}
	return os.WriteFile(outputPath, outBuf, 0755)
}

func deriveKey(seed, nonce []byte) []byte {
	h := sha256.New()
	h.Write(seed)
	h.Write(nonce)
	return h.Sum(nil)
}

// unpackPayloadV3 decrypts/decompresses an SBP3 payload block.
// It is used by tests to verify integrity and compatibility behavior.
func unpackPayloadV3(payload []byte) ([]byte, error) {
	if len(payload) < magicLen+nonceLen+footerLen {
		return nil, fmt.Errorf("payload too short")
	}
	if string(payload[:magicLen]) != magicV3 {
		return nil, fmt.Errorf("invalid magic")
	}
	nonce := payload[magicLen : magicLen+nonceLen]
	ciphertext := payload[magicLen+nonceLen : len(payload)-footerLen]
	keySeed := payload[len(payload)-footerLen : len(payload)-footerLen+keyLen]
	key := deriveKey(keySeed, nonce)

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	decompressedBytes, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, fmt.Errorf("auth failed: %w", err)
	}
	gr, err := gzip.NewReader(bytes.NewReader(decompressedBytes))
	if err != nil {
		return nil, err
	}
	defer gr.Close()
	out, err := io.ReadAll(gr)
	if err != nil {
		return nil, err
	}
	return out, nil
}

// PackLegacy creates a protected native PE using XOR (v1 format) for loaders that don't support SBP2.
func PackLegacy(inputPath, outputPath, loaderPath string) error {
	loader, err := os.ReadFile(loaderPath)
	if err != nil {
		return fmt.Errorf("read loader: %w", err)
	}
	input, err := os.ReadFile(inputPath)
	if err != nil {
		return fmt.Errorf("read input: %w", err)
	}
	if len(input) == 0 {
		return fmt.Errorf("input file is empty")
	}

	key := make([]byte, 1)
	if _, err := rand.Read(key); err != nil {
		key[0] = 0x5B
	}
	encrypted := make([]byte, len(input))
	for i := range input {
		encrypted[i] = input[i] ^ key[0] ^ byte(i%256)
	}

	// Legacy footer: magic SBPK + key(1) + length(8)
	var footer bytes.Buffer
	footer.WriteString("SBPK")
	footer.Write(key)
	binary.Write(&footer, binary.LittleEndian, uint64(len(encrypted)))

	f, err := os.Create(outputPath)
	if err != nil {
		return fmt.Errorf("create output: %w", err)
	}
	defer f.Close()
	io.Copy(f, bytes.NewReader(loader))
	f.Write(encrypted)
	f.Write(footer.Bytes())
	return nil
}

// embedPayloadInPE extends the last PE section to contain the payload (no overlay).
func embedPayloadInPE(loader, payload []byte) ([]byte, error) {
	peFile, err := pe.NewFile(bytes.NewReader(loader))
	if err != nil {
		return nil, err
	}
	defer peFile.Close()

	if len(peFile.Sections) == 0 {
		return nil, fmt.Errorf("loader has no sections")
	}

	last := peFile.Sections[len(peFile.Sections)-1]
	peOff := int(binary.LittleEndian.Uint32(loader[0x3C:]))
	sizeOfOpt := binary.LittleEndian.Uint16(loader[peOff+20:])
	sectionTable := peOff + 24 + int(sizeOfOpt)
	lastSecIdx := len(peFile.Sections) - 1
	lastSecOffset := sectionTable + lastSecIdx*40

	fileAlign := uint32(512)
	secAlign := uint32(4096)
	if oh, ok := peFile.OptionalHeader.(*pe.OptionalHeader64); ok {
		fileAlign = oh.FileAlignment
		secAlign = oh.SectionAlignment
	} else if oh, ok := peFile.OptionalHeader.(*pe.OptionalHeader32); ok {
		fileAlign = oh.FileAlignment
		secAlign = oh.SectionAlignment
	}
	if fileAlign == 0 {
		fileAlign = 512
	}
	if secAlign == 0 {
		secAlign = 4096
	}

	extSize := uint32(len(payload))
	alignedExtSize := (extSize + fileAlign - 1) / fileAlign * fileAlign

	newSizeOfRawData := last.Size + alignedExtSize
	newVirtualSize := last.VirtualSize + extSize
	newVirtualSizeAligned := (newVirtualSize + secAlign - 1) / secAlign * secAlign
	newSizeOfImage := last.VirtualAddress + newVirtualSizeAligned

	out := make([]byte, len(loader), len(loader)+int(alignedExtSize))
	copy(out, loader)

	// Patch last section: VirtualSize (off 8), SizeOfRawData (off 16)
	binary.LittleEndian.PutUint32(out[lastSecOffset+8:], newVirtualSize)
	binary.LittleEndian.PutUint32(out[lastSecOffset+16:], newSizeOfRawData)

	// Patch SizeOfImage in optional header (offset 56 for both PE32 and PE32+)
	optOff := peOff + 24
	binary.LittleEndian.PutUint32(out[optOff+56:], newSizeOfImage)

	// Append [padding][payload] so payload is contiguous at end; loader reads last blockSize bytes.
	// Footer must be last 41 bytes; padding goes before entire payload.
	padLen := int(alignedExtSize) - len(payload)
	if padLen > 0 {
		out = append(out, make([]byte, padLen)...)
	}
	out = append(out, payload...)
	return out, nil
}

// sanitizePE zeros PE metadata that may leak build info (COFF TimeDateStamp, etc.)
func sanitizePE(data []byte) []byte {
	if len(data) < 0x80 {
		return data
	}
	// MZ
	if data[0] != 'M' || data[1] != 'Z' {
		return data
	}
	peOff := int(binary.LittleEndian.Uint32(data[0x3C:]))
	if peOff+24+4 >= len(data) {
		return data
	}
	// PE signature
	if data[peOff] != 'P' || data[peOff+1] != 'E' {
		return data
	}
	// COFF TimeDateStamp at peOffset + 8 (4 bytes)
	stampOff := peOff + 8
	if stampOff+4 <= len(data) {
		copy(data[stampOff:stampOff+4], []byte{0, 0, 0, 0})
	}
	return data
}
