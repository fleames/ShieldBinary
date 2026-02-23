package peutil

import (
	"encoding/binary"
	"io"
	"os"
)

// PE magic constants
const (
	mzSignature  = 0x5A4D
	peSignature  = 0x4550
	pe32Magic    = 0x10B  // 32-bit
	pe32PlusMagic = 0x20B // 64-bit
	dataDirCLR   = 14    // CLR header index in data directories
)

// IsDotNet reads the file at path and returns true if it's a .NET assembly
// (has a non-zero CLR data directory RVA). Returns false for native PE or non-PE files.
func IsDotNet(path string) (bool, error) {
	f, err := os.Open(path)
	if err != nil {
		return false, err
	}
	defer f.Close()
	return isDotNetReader(f)
}

// IsDotNetReader reads from seekable reader and returns true if it's a .NET assembly.
func IsDotNetReader(r io.ReadSeeker) (bool, error) {
	return isDotNetReader(r)
}

func isDotNetReader(r io.ReadSeeker) (bool, error) {
	var buf [8]byte

	// MZ signature
	if _, err := r.Read(buf[:2]); err != nil {
		return false, err
	}
	if binary.LittleEndian.Uint16(buf[:2]) != mzSignature {
		return false, nil
	}

	// PE header offset at 0x3C
	if _, err := r.Seek(0x3C, io.SeekStart); err != nil {
		return false, err
	}
	if _, err := r.Read(buf[:4]); err != nil {
		return false, err
	}
	peOffset := int64(binary.LittleEndian.Uint32(buf[:4]))

	// PE signature
	if _, err := r.Seek(peOffset, io.SeekStart); err != nil {
		return false, err
	}
	if _, err := r.Read(buf[:4]); err != nil {
		return false, err
	}
	if binary.LittleEndian.Uint32(buf[:4]) != peSignature {
		return false, nil
	}

	// COFF header: Machine (2) + NumberOfSections (2) + TimeDateStamp (4) + rest
	// Optional header starts at peOffset + 24
	// Magic at start of optional header (2 bytes)
	optHeaderStart := peOffset + 24
	if _, err := r.Seek(optHeaderStart, io.SeekStart); err != nil {
		return false, err
	}
	if _, err := r.Read(buf[:2]); err != nil {
		return false, err
	}
	magic := binary.LittleEndian.Uint16(buf[:2])

	// Data directory start: 96 for PE32, 112 for PE32+
	dataDirStart := uint64(96)
	if magic == pe32PlusMagic {
		dataDirStart = 112
	}
	// NumberOfRvaAndSizes must include CLR (entry 14); native PEs often have fewer
	numRvaOffset := optHeaderStart + int64(dataDirStart) - 4
	if _, err := r.Seek(numRvaOffset, io.SeekStart); err != nil {
		return false, err
	}
	if _, err := r.Read(buf[:4]); err != nil {
		return false, err
	}
	if binary.LittleEndian.Uint32(buf[:4]) <= dataDirCLR {
		return false, nil
	}
	// CLR is DataDirectory[14], each entry is 8 bytes (RVA + Size)
	clrDirOffset := optHeaderStart + int64(dataDirStart) + int64(dataDirCLR*8)
	if _, err := r.Seek(clrDirOffset, io.SeekStart); err != nil {
		return false, err
	}
	if _, err := r.Read(buf[:4]); err != nil {
		return false, err
	}
	clrRva := binary.LittleEndian.Uint32(buf[:4])
	return clrRva != 0, nil
}

// IsValidPE returns true if the file appears to be a valid PE (MZ + PE signature).
func IsValidPE(path string) (bool, error) {
	f, err := os.Open(path)
	if err != nil {
		return false, err
	}
	defer f.Close()

	var buf [4]byte
	if _, err := f.Read(buf[:2]); err != nil {
		return false, err
	}
	if binary.LittleEndian.Uint16(buf[:2]) != mzSignature {
		return false, nil
	}
	if _, err := f.Seek(0x3C, io.SeekStart); err != nil {
		return false, err
	}
	if _, err := f.Read(buf[:4]); err != nil {
		return false, err
	}
	peOffset := int64(binary.LittleEndian.Uint32(buf[:4]))
	if _, err := f.Seek(peOffset, io.SeekStart); err != nil {
		return false, err
	}
	if _, err := f.Read(buf[:4]); err != nil {
		return false, err
	}
	return binary.LittleEndian.Uint32(buf[:4]) == peSignature, nil
}
