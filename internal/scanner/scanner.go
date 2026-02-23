// Package scanner provides in-house executable scanning for BinaryProtect.
// It detects PE type (.NET vs native), architecture, and BinaryProtect protection markers.
package scanner

import (
	"bytes"
	"debug/pe"
	"encoding/binary"
	"io"
	"os"
	"path/filepath"

	"github.com/shieldbinary/backend/internal/peutil"
)

// BinaryProtect format constants (must match loader/nativepacker)
const (
	magicV2     = "SBP2"
	magicLegacy = "SBPK"
	magicLen    = 4
	keyLenV2    = 32
	footerV2Len = keyLenV2 + 8 + 1 // key + length + flags
	footerV1Len = magicLen + 1 + 8 // magic + key + length
	flagEntXOR  = 1
)

// Result holds the scan result for a single executable.
type Result struct {
	Path              string `json:"path"`
	Size              int64  `json:"size"`
	ValidPE           bool   `json:"valid_pe"`
	IsDotNet          bool   `json:"is_dotnet"`
	Machine           string `json:"machine,omitempty"`
	Protected         bool   `json:"protected"`
	ProtectionFormat  string `json:"protection_format,omitempty"` // "sbp2_section", "sbp2_overlay", "sbpk"
	ProtectionTier    string `json:"protection_tier,omitempty"`  // "basic", "enterprise" (from flags)
	PayloadSize       int64  `json:"payload_size,omitempty"`
	Embedding         string `json:"embedding,omitempty"` // "section", "overlay"
	Error             string `json:"error,omitempty"`
}

// ScanFile scans a single file and returns the result.
func ScanFile(path string) (*Result, error) {
	r := &Result{Path: path}
	fi, err := os.Stat(path)
	if err != nil {
		r.Error = err.Error()
		return r, err
	}
	r.Size = fi.Size()

	data, err := os.ReadFile(path)
	if err != nil {
		r.Error = err.Error()
		return r, err
	}

	scanBytes(r, data)
	return r, nil
}

// ScanBytes scans in-memory PE data. filename is used for the Path field in the result.
func ScanBytes(filename string, data []byte) *Result {
	r := &Result{Path: filename, Size: int64(len(data))}
	scanBytes(r, data)
	return r
}

// ScanReader scans from a seekable reader; path is used for reporting only.
func ScanReader(path string, r io.ReadSeeker) (*Result, error) {
	res := &Result{Path: path}
	_, err := r.Seek(0, io.SeekStart)
	if err != nil {
		res.Error = err.Error()
		return res, err
	}
	size, err := r.Seek(0, io.SeekEnd)
	if err != nil {
		res.Error = err.Error()
		return res, err
	}
	res.Size = size
	_, _ = r.Seek(0, io.SeekStart)
	data, err := io.ReadAll(r)
	if err != nil {
		res.Error = err.Error()
		return res, err
	}
	scanBytes(res, data)
	return res, nil
}

func scanBytes(r *Result, data []byte) {
	if len(data) < 64 {
		r.Error = "file too small"
		return
	}

	// Basic PE validation (MZ + PE signature)
	if binary.LittleEndian.Uint16(data[:2]) != 0x5A4D {
		r.Error = "not a PE file (missing MZ)"
		return
	}
	peOff := int64(binary.LittleEndian.Uint32(data[0x3C:]))
	if int(peOff)+4 > len(data) || binary.LittleEndian.Uint32(data[peOff:]) != 0x4550 {
		r.Error = "invalid PE signature"
		return
	}
	r.ValidPE = true

	// .NET detection
	isDotNet, _ := peutil.IsDotNetReader(bytes.NewReader(data))
	r.IsDotNet = isDotNet

	// Machine type from COFF header (offset 4 from PE)
	if int(peOff)+6 <= len(data) {
		machine := binary.LittleEndian.Uint16(data[peOff+4:])
		r.Machine = machineString(machine)
	}

	// BinaryProtect detection
	detectBinaryProtect(r, data)
}

func machineString(m uint16) string {
	switch m {
	case 0x14c:
		return "x86"
	case 0x8664:
		return "x64"
	case 0x1c4:
		return "ARM"
	case 0xaa64:
		return "ARM64"
	default:
		return ""
	}
}

func detectBinaryProtect(r *Result, data []byte) {
	// 1. SBP2 embedded in last PE section
	if payload, ok := detectSBP2Section(data); ok {
		r.Protected = true
		r.ProtectionFormat = "sbp2_section"
		r.Embedding = "section"
		r.PayloadSize = int64(len(payload))
		r.ProtectionTier = sbp2Tier(payload)
		return
	}

	// 2. SBP2 overlay (end of file): [magic][nonce+encrypted][footer]
	size := int64(len(data))
	if size >= footerV2Len {
		footer := data[size-footerV2Len:]
		payloadLen := int64(binary.LittleEndian.Uint64(footer[keyLenV2:]))
		if payloadLen >= 16 && size >= footerV2Len+payloadLen+magicLen {
			magicStart := size - footerV2Len - payloadLen - magicLen
			if magicStart >= 0 && int(magicStart)+magicLen <= len(data) && string(data[magicStart:magicStart+magicLen]) == magicV2 {
				r.Protected = true
				r.ProtectionFormat = "sbp2_overlay"
				r.Embedding = "overlay"
				r.PayloadSize = payloadLen + magicLen // full block = magic + nonce + encrypted
				r.ProtectionTier = sbp2TierFromFooter(footer)
				return
			}
		}
	}

	// 3. SBPK legacy overlay
	if size >= footerV1Len {
		tail := data[size-footerV1Len:]
		if string(tail[:magicLen]) == magicLegacy {
			r.Protected = true
			r.ProtectionFormat = "sbpk"
			r.Embedding = "overlay"
			r.PayloadSize = int64(bytesToUint64(tail[magicLen+1:]))
			r.ProtectionTier = "legacy"
			return
		}
	}
}

func detectSBP2Section(data []byte) ([]byte, bool) {
	peFile, err := pe.NewFile(bytes.NewReader(data))
	if err != nil {
		return nil, false
	}
	defer peFile.Close()
	if len(peFile.Sections) == 0 {
		return nil, false
	}
	last := peFile.Sections[len(peFile.Sections)-1]
	secEnd := int64(last.Offset) + int64(last.Size)
	if secEnd < footerV2Len+magicLen+16 || secEnd > int64(len(data)) {
		return nil, false
	}
	footer := data[secEnd-footerV2Len : secEnd]
	payloadLen := int64(binary.LittleEndian.Uint64(footer[keyLenV2:]))
	blockSize := magicLen + payloadLen + footerV2Len
	if payloadLen < 16 || blockSize > int64(last.Size) {
		return nil, false
	}
	block := data[secEnd-int64(blockSize) : secEnd]
	if string(block[:magicLen]) != magicV2 {
		return nil, false
	}
	return block, true
}

func sbp2Tier(payload []byte) string {
	// Section payload includes footer at end
	if len(payload) <= keyLenV2+8+1 {
		return "basic"
	}
	flags := payload[len(payload)-1]
	return tierFromFlags(flags)
}

func sbp2TierFromFooter(footer []byte) string {
	if len(footer) < keyLenV2+8+1 {
		return "basic"
	}
	return tierFromFlags(footer[keyLenV2+8])
}

func tierFromFlags(flags byte) string {
	if flags&flagEntXOR != 0 {
		return "enterprise"
	}
	return "basic"
}

func bytesToUint64(b []byte) uint64 {
	var v uint64
	for i := 0; i < 8 && i < len(b); i++ {
		v |= uint64(b[i]) << (i * 8)
	}
	return v
}

// ScanDir scans all .exe and .dll files in a directory (non-recursive).
func ScanDir(dir string) ([]*Result, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var results []*Result
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		ext := filepath.Ext(e.Name())
		if ext != ".exe" && ext != ".dll" {
			continue
		}
		path := filepath.Join(dir, e.Name())
		r, err := ScanFile(path)
		if err != nil {
			r = &Result{Path: path, Error: err.Error()}
		}
		results = append(results, r)
	}
	return results, nil
}
