package nativepacker

import (
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
)

func extractSBP3Payload(t *testing.T, packed []byte) []byte {
	t.Helper()
	if len(packed) < magicLen+nonceLen+footerLen {
		t.Fatal("packed output too short")
	}
	footerStart := len(packed) - footerLen
	payloadLen := int(binary.LittleEndian.Uint64(packed[footerStart+keyLen : footerStart+keyLen+lengthLen]))
	blockLen := magicLen + payloadLen + footerLen
	if blockLen > len(packed) {
		t.Fatal("invalid SBP3 block length")
	}
	start := len(packed) - blockLen
	if start < 0 {
		t.Fatal("invalid SBP3 start")
	}
	block := packed[start:]
	if !bytes.Equal(block[:magicLen], []byte(magicV3)) {
		t.Fatalf("expected SBP3 magic at block start, got %q", string(block[:magicLen]))
	}
	return block
}

func TestPack_EmptyInput(t *testing.T) {
	dir := t.TempDir()
	loader := filepath.Join(dir, "loader.exe")
	os.WriteFile(loader, []byte("fake loader"), 0755)
	err := Pack(filepath.Join(dir, "empty.exe"), filepath.Join(dir, "out.exe"), loader, "basic")
	if err == nil {
		t.Fatal("expected error for empty input")
	}
}

func TestPack_InputNotFound(t *testing.T) {
	dir := t.TempDir()
	loader := filepath.Join(dir, "loader.exe")
	os.WriteFile(loader, []byte("fake"), 0755)
	err := Pack(filepath.Join(dir, "missing.exe"), filepath.Join(dir, "out.exe"), loader, "basic")
	if err == nil {
		t.Fatal("expected error for missing input")
	}
}

func TestPack_LoaderNotFound(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "input.exe")
	os.WriteFile(input, []byte("MZ fake pe"), 0644)
	err := Pack(input, filepath.Join(dir, "out.exe"), filepath.Join(dir, "missing.exe"), "basic")
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
	// Check SBP3 magic
	if len(got) < len(loaderContent)+4 {
		t.Fatal("output too short for magic")
	}
	magic := string(got[len(loaderContent) : len(loaderContent)+4])
	if magic != "SBP3" {
		t.Fatalf("expected SBP3 magic, got %q", magic)
	}
}

func TestPack_SBP3AuthenticatesAndDecrypts(t *testing.T) {
	dir := t.TempDir()
	loader := filepath.Join(dir, "loader.exe")
	loaderContent := []byte("MZ test loader")
	if err := os.WriteFile(loader, loaderContent, 0755); err != nil {
		t.Fatal(err)
	}
	input := filepath.Join(dir, "input.exe")
	plain := []byte("MZ this is a native payload for authentication test")
	if err := os.WriteFile(input, plain, 0644); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(dir, "out.exe")
	if err := Pack(input, output, loader, "basic"); err != nil {
		t.Fatal(err)
	}
	outBytes, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	payload := extractSBP3Payload(t, outBytes)
	decoded, err := unpackPayloadV3(payload)
	if err != nil {
		t.Fatalf("expected valid SBP3 payload, got error: %v", err)
	}
	if !bytes.Equal(decoded, plain) {
		t.Fatal("decoded payload mismatch")
	}
}

func TestPack_SBP3TamperFailsAuth(t *testing.T) {
	dir := t.TempDir()
	loader := filepath.Join(dir, "loader.exe")
	loaderContent := []byte("MZ test loader")
	if err := os.WriteFile(loader, loaderContent, 0755); err != nil {
		t.Fatal(err)
	}
	input := filepath.Join(dir, "input.exe")
	plain := []byte("MZ payload to tamper")
	if err := os.WriteFile(input, plain, 0644); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(dir, "out.exe")
	if err := Pack(input, output, loader, "basic"); err != nil {
		t.Fatal(err)
	}
	outBytes, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	payload := append([]byte(nil), extractSBP3Payload(t, outBytes)...)
	if len(payload) < magicLen+nonceLen+footerLen+8 {
		t.Fatal("payload unexpectedly short")
	}
	payload[magicLen+nonceLen+3] ^= 0xFF
	if _, err := unpackPayloadV3(payload); err == nil {
		t.Fatal("expected auth failure for tampered payload")
	}
}

func TestPackLegacy_HeaderCompatibility(t *testing.T) {
	const legacyFooterLen = 4 + 1 + 8 // SBPK + key + length
	dir := t.TempDir()
	loader := filepath.Join(dir, "loader.exe")
	loaderContent := []byte("MZ legacy loader")
	if err := os.WriteFile(loader, loaderContent, 0755); err != nil {
		t.Fatal(err)
	}
	input := filepath.Join(dir, "input.exe")
	if err := os.WriteFile(input, []byte("MZ legacy payload"), 0644); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(dir, "legacy.exe")
	if err := PackLegacy(input, output, loader); err != nil {
		t.Fatal(err)
	}
	outBytes, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	if len(outBytes) < len(loaderContent)+legacyFooterLen {
		t.Fatal("legacy output too short")
	}
	tail := outBytes[len(outBytes)-legacyFooterLen:]
	if string(tail[:4]) != "SBPK" {
		t.Fatalf("expected SBPK tail magic, got %q", string(tail[:4]))
	}
	payloadLen := binary.LittleEndian.Uint64(tail[5:])
	if payloadLen == 0 {
		t.Fatal("expected non-zero legacy payload length")
	}
}
