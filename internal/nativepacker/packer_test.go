package nativepacker

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPack_EmptyInput(t *testing.T) {
	dir := t.TempDir()
	loader := filepath.Join(dir, "loader.exe")
	os.WriteFile(loader, []byte("fake loader"), 0755)
	err := Pack(filepath.Join(dir, "empty.exe"), filepath.Join(dir, "out.exe"), loader)
	if err == nil {
		t.Fatal("expected error for empty input")
	}
}

func TestPack_InputNotFound(t *testing.T) {
	dir := t.TempDir()
	loader := filepath.Join(dir, "loader.exe")
	os.WriteFile(loader, []byte("fake"), 0755)
	err := Pack(filepath.Join(dir, "missing.exe"), filepath.Join(dir, "out.exe"), loader)
	if err == nil {
		t.Fatal("expected error for missing input")
	}
}

func TestPack_LoaderNotFound(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "input.exe")
	os.WriteFile(input, []byte("MZ fake pe"), 0644)
	err := Pack(input, filepath.Join(dir, "out.exe"), filepath.Join(dir, "missing.exe"))
	if err == nil {
		t.Fatal("expected error for missing loader")
	}
}

func TestPack_Success(t *testing.T) {
	dir := t.TempDir()
	loader := filepath.Join(dir, "loader.exe")
	loaderContent := []byte("MZ loader stub here - must be valid PE for real use")
	os.WriteFile(loader, loaderContent, 0755)

	input := filepath.Join(dir, "input.exe")
	inputContent := []byte("test payload content for packing")
	os.WriteFile(input, inputContent, 0644)

	output := filepath.Join(dir, "out.exe")
	err := Pack(input, output, loader, "basic")
	if err != nil {
		t.Fatal(err)
	}

	got, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) <= len(loaderContent) {
		t.Fatal("output should be larger than loader")
	}
	// Check SBP2 magic
	if len(got) < len(loaderContent)+4 {
		t.Fatal("output too short for magic")
	}
	magic := string(got[len(loaderContent) : len(loaderContent)+4])
	if magic != "SBP2" {
		t.Fatalf("expected SBP2 magic, got %q", magic)
	}
}
