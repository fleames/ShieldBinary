package worker

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"

	"github.com/shieldbinary/backend/internal/peutil"
)

func TestWorker_DetectsNativePE(t *testing.T) {
	dir := t.TempDir()
	pe := makeMinimalNativePE(t, dir)
	ok, err := peutil.IsDotNet(pe)
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("minimal PE should not be detected as .NET")
	}
	valid, err := peutil.IsValidPE(pe)
	if err != nil {
		t.Fatal(err)
	}
	if !valid {
		t.Fatal("minimal PE should be valid")
	}
}

func makeMinimalNativePE(t *testing.T, dir string) string {
	dos := make([]byte, 64)
	dos[0], dos[1] = 0x4D, 0x5A
	dos[0x3C], dos[0x3D], dos[0x3E], dos[0x3F] = 0x40, 0, 0, 0

	pe := []byte{0x50, 0x45, 0, 0}
	coff := make([]byte, 20)
	coff[16], coff[17] = 0xF0, 0

	opt := make([]byte, 240)
	opt[0], opt[1] = 0x0B, 0x20
	binary.LittleEndian.PutUint32(opt[108:112], 16) // NumberOfRvaAndSizes
	// CLR entry at 224 stays 0

	data := append(dos, pe...)
	data = append(data, coff...)
	data = append(data, opt...)
	p := filepath.Join(dir, "native.exe")
	if err := os.WriteFile(p, data, 0644); err != nil {
		t.Fatal(err)
	}
	return p
}
