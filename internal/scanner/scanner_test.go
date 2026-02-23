package scanner

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestScanFile_NonPE(t *testing.T) {
	tmp := t.TempDir()
	f := filepath.Join(tmp, "notpe.txt")
	if err := os.WriteFile(f, []byte("hello world"), 0644); err != nil {
		t.Fatal(err)
	}
	r, err := ScanFile(f)
	if err != nil {
		t.Fatal(err)
	}
	if r.ValidPE {
		t.Error("expected invalid PE for text file")
	}
	if r.Error != "not a PE file (missing MZ)" && r.Error != "file too small" {
		t.Errorf("unexpected error: %q", r.Error)
	}
}

func TestScanReader(t *testing.T) {
	// Too short to be a valid PE
	data := make([]byte, 10)
	r, err := ScanReader("test.exe", bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if r.ValidPE {
		t.Error("expected invalid PE for short data")
	}
}

func TestMachineString(t *testing.T) {
	if s := machineString(0x14c); s != "x86" {
		t.Errorf("x86: got %q", s)
	}
	if s := machineString(0x8664); s != "x64" {
		t.Errorf("x64: got %q", s)
	}
}

func TestScanFile_RealPE(t *testing.T) {
	// Use the protect binary or any Go-built exe as a test subject
	candidates := []string{
		"bin/protect.exe",
		"bin/loader.exe",
		"bin/scanner.exe",
		"cmd/protect/protect.go",
	}
	var path string
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			ext := filepath.Ext(c)
			if ext == ".exe" {
				path = c
				break
			}
		}
	}
	if path == "" {
		t.Skip("no .exe found to scan")
	}
	r, err := ScanFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !r.ValidPE {
		t.Errorf("expected valid PE for %s: %s", path, r.Error)
	}
	t.Logf("Scan result: %+v", r)
}

func TestScanDir(t *testing.T) {
	tmp := t.TempDir()
	os.WriteFile(filepath.Join(tmp, "a.exe"), []byte("MZ\x90\x00"), 0644)
	os.WriteFile(filepath.Join(tmp, "b.txt"), []byte("ignore"), 0644)
	results, err := ScanDir(tmp)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 {
		t.Errorf("expected 1 result (only .exe), got %d", len(results))
	}
}

// TestScanReader_RealFile ensures ScanReader works with an actual file handle.
func TestScanReader_RealFile(t *testing.T) {
	candidates := []string{"bin/protect.exe", "bin/loader.exe"}
	var path string
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			path = c
			break
		}
	}
	if path == "" {
		t.Skip("no exe to test")
	}
	f, err := os.Open(path)
	if err != nil {
		t.Skip(err)
	}
	defer f.Close()
	r, err := ScanReader(path, f)
	if err != nil {
		t.Fatal(err)
	}
	if !r.ValidPE {
		t.Errorf("expected valid PE: %s", r.Error)
	}
}
