// shieldbinary-scanner: in-house executable scanner
// Scans .exe/.dll for PE type, architecture, and BinaryProtect protection markers.
//
// Usage:
//   shieldbinary-scanner <file.exe>
//   shieldbinary-scanner <directory>
//   shieldbinary-scanner -json <file.exe>
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/shieldbinary/backend/internal/scanner"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, "Usage: %s <file.exe|directory> [-json]\n", filepath.Base(os.Args[0]))
		fmt.Fprintf(os.Stderr, "  Scans executables for PE type (.NET/native), architecture, and BinaryProtect protection.\n")
		os.Exit(1)
	}
	path := os.Args[1]
	jsonOut := false
	for _, a := range os.Args[2:] {
		if a == "-json" || a == "--json" {
			jsonOut = true
			break
		}
	}

	results, err := scanPath(path)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	if jsonOut {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(results); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}
		return
	}

	for _, r := range results {
		printResult(r)
	}
}

func scanPath(path string) ([]*scanner.Result, error) {
	fi, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if fi.IsDir() {
		return scanner.ScanDir(path)
	}
	r, err := scanner.ScanFile(path)
	if err != nil {
		return nil, err
	}
	return []*scanner.Result{r}, nil
}

func printResult(r *scanner.Result) {
	fmt.Println(r.Path)
	if r.Error != "" {
		fmt.Printf("  Error: %s\n", r.Error)
		return
	}
	fmt.Printf("  Size: %d bytes\n", r.Size)
	fmt.Printf("  Valid PE: %v\n", r.ValidPE)
	if r.ValidPE {
		fmt.Printf("  .NET: %v\n", r.IsDotNet)
		if r.Machine != "" {
			fmt.Printf("  Machine: %s\n", r.Machine)
		}
	}
	if r.Protected {
		fmt.Printf("  Protected: yes (%s, %s)\n", r.ProtectionFormat, r.ProtectionTier)
		fmt.Printf("  Embedding: %s\n", r.Embedding)
		if r.PayloadSize > 0 {
			fmt.Printf("  Payload size: %d bytes\n", r.PayloadSize)
		}
	} else if r.ValidPE {
		fmt.Printf("  Protected: no\n")
	}
	fmt.Println()
}
