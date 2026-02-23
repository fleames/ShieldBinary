package peutil

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
)

func TestIsValidPE_NonExistent(t *testing.T) {
	ok, err := IsValidPE("nonexistent.dat")
	if err == nil || ok {
		t.Fatal("expected error or false for non-existent file")
	}
}

func TestIsValidPE_TooShort(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "short.dat")
	if err := os.WriteFile(p, []byte{0x4D, 0x5A}, 0644); err != nil {
		t.Fatal(err)
	}
	ok, err := IsValidPE(p)
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("expected false for non-PE file")
	}
}

func TestIsValidPE_InvalidMZ(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "bad.bin")
	os.WriteFile(p, make([]byte, 100), 0644)
	ok, err := IsValidPE(p)
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("expected false for invalid MZ")
	}
}

func TestIsDotNet_NonExistent(t *testing.T) {
	_, err := IsDotNet("nonexistent.exe")
	if err == nil {
		t.Fatal("expected error for non-existent file")
	}
}

func TestIsDotNet_EmptyFile(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "empty.exe")
	os.WriteFile(p, nil, 0644)
	ok, err := IsDotNet(p)
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("expected false for empty file")
	}
}

// Minimal valid PE without CLR - should not be .NET
func TestIsDotNet_MinimalPE(t *testing.T) {
	// Create a minimal PE (DOS stub + PE header) - no optional header with CLR
	// This is tricky; we use the engine's output or a known native PE if available
	dir := t.TempDir()
	p := filepath.Join(dir, "native.exe")
	// Minimal invalid PE that won't crash our reader
	dos := make([]byte, 64)
	dos[0] = 0x4D
	dos[1] = 0x5A
	// e_lfanew at 0x3C
	dos[0x3C] = 0x40
	dos[0x3D] = 0
	dos[0x3E] = 0
	dos[0x3F] = 0
	// PE\0\0 at 0x40
	pe := []byte{0x50, 0x45, 0, 0}
	// COFF header (20 bytes)
	coff := make([]byte, 20)
	coff[16] = 0xF0 // SizeOfOptionalHeader
	coff[17] = 0
	// Optional header - magic 0x20B (PE32+), then padding to data dirs
	// We need at least 112 bytes for PE32+ to reach data dir
	opt := make([]byte, 224) // 112 + 16*8 = 240, but 224 covers 14 entries
	opt[0] = 0x0B
	opt[1] = 0x20 // PE32+
	// NumberOfRvaAndSizes at offset 108 for PE32+ - set to 16
	binary.LittleEndian.PutUint32(opt[108:112], 16)
	// Data dir 14 (CLR) at 112+112=224 - set RVA to 0
	// Actually offset 112 + 14*8 = 224. Our opt is 224 bytes, so we need opt[223] for last byte of entry 14
	// Entry 14 starts at 112 + 14*8 = 224. We have opt[0:224], so we need index 222,223 for RVA (4 bytes)
	// Wait, opt is 224 bytes. Offset 224 is past the end. Let me extend.
	opt = make([]byte, 240)
	opt[0] = 0x0B
	opt[1] = 0x20
	binary.LittleEndian.PutUint32(opt[108:112], 16)
	// CLR RVA at 112+14*8 = 224, we need 4 bytes. opt[224:228] - but we only have 240, so 224-227 works
	// Actually the Optional header: PE32+ data dir starts at offset 112. Entry 14 is at 112+14*8=224.
	// So opt[224:232] is the CLR entry. We'll set to 0.
	data := append(dos, pe...)
	data = append(data, coff...)
	data = append(data, opt...)
	if err := os.WriteFile(p, data, 0644); err != nil {
		t.Fatal(err)
	}
	ok, err := IsDotNet(p)
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("expected false (native PE), got true")
	}
	valid, err := IsValidPE(p)
	if err != nil {
		t.Fatal(err)
	}
	if !valid {
		t.Fatal("expected valid PE")
	}
}
