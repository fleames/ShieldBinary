// shieldbinary-protect: CLI to protect a single .exe/.dll (works for both .NET and native PE)
// Usage: shieldbinary-protect <input> <output> [tier]
// Tier defaults to "basic". Build engine and loader first:
//   dotnet publish engine/ShieldBinary.Engine.csproj -c Release -r win-x64 --self-contained -o bin/engine
//   go build -ldflags "-s -w" -o bin/loader.exe ./cmd/loader

package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/shieldbinary/backend/internal/config"
	"github.com/shieldbinary/backend/internal/nativepacker"
	"github.com/shieldbinary/backend/internal/peutil"
)

func main() {
	if len(os.Args) < 3 {
		fmt.Fprintf(os.Stderr, "Usage: %s <input.exe|input.dll> <output.exe|output.dll> [tier]\n", filepath.Base(os.Args[0]))
		fmt.Fprintf(os.Stderr, "Tier: minimal, basic, pro, enterprise (default: basic)\n")
		fmt.Fprintf(os.Stderr, "\nDebug: set SHIELD_ENGINE_VERBOSE=1 for pass-by-pass logging\n")
		fmt.Fprintf(os.Stderr, "       set SHIELD_ENGINE_PASSES=name_obfuscation to run only that pass\n")
		fmt.Fprintf(os.Stderr, "       set SHIELD_ENGINE_VIRTUALIZATION=0 to disable VM virtualization (Enterprise)\n")
		os.Exit(1)
	}
	inputPath := os.Args[1]
	outputPath := os.Args[2]
	tier := "basic"
	for i := 3; i < len(os.Args); i++ {
		switch os.Args[i] {
		case "-v", "--verbose":
			os.Setenv("SHIELD_ENGINE_VERBOSE", "1")
		default:
			tier = strings.ToLower(os.Args[i])
		}
	}

	if _, err := os.Stat(inputPath); err != nil {
		fmt.Fprintf(os.Stderr, "Error: input file not found: %s\n", inputPath)
		os.Exit(1)
	}

	cfg, _ := config.Load()
	if cfg == nil {
		cfg = &config.Config{}
	}

	ctx := context.Background()
	isDotNet, err := peutil.IsDotNet(inputPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	if isDotNet {
		if err := runEngine(ctx, cfg, inputPath, outputPath, tier); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}
		fmt.Println("Protected (.NET)")
	} else {
		if runtime.GOOS != "windows" {
			fmt.Fprintf(os.Stderr, "Error: Native PE packing is only supported on Windows.\n")
			os.Exit(1)
		}
		valid, err := peutil.IsValidPE(inputPath)
		if err != nil || !valid {
			fmt.Fprintf(os.Stderr, "Error: Not a valid PE file.\n")
			os.Exit(1)
		}
		if err := runPacker(cfg, inputPath, outputPath, tier); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}
		fmt.Println("Protected (native pack)")
	}
}

func runEngine(ctx context.Context, cfg *config.Config, input, output, tier string) error {
	enginePath := cfg.EnginePath
	var useDotnet bool
	if enginePath == "" {
		for _, p := range []string{
			"bin/engine/shieldbinary-engine.exe",
			"bin/engine/shieldbinary-engine",
			"engine/bin/Debug/net8.0/win-x64/shieldbinary-engine.exe",
			"engine/bin/Debug/net8.0/shieldbinary-engine.dll",
			"engine/bin/Release/net8.0/win-x64/shieldbinary-engine.exe",
		} {
			if _, err := os.Stat(p); err == nil {
				enginePath = p
				useDotnet = strings.HasSuffix(strings.ToLower(p), ".dll")
				break
			}
		}
		if enginePath == "" {
			return fmt.Errorf("engine not found. Run: dotnet publish engine/ShieldBinary.Engine.csproj -c Release -r win-x64 --self-contained -o bin/engine")
		}
	} else {
		useDotnet = strings.HasSuffix(strings.ToLower(enginePath), ".dll")
	}
	if abs, err := filepath.Abs(enginePath); err == nil {
		enginePath = abs
	}
	workDir := filepath.Dir(input)
	var cmd *exec.Cmd
	if useDotnet {
		cmd = exec.CommandContext(ctx, "dotnet", enginePath, input, output, tier)
	} else {
		cmd = exec.CommandContext(ctx, enginePath, input, output, tier)
	}
	cmd.Dir = workDir
	var envAdd []string
	if cfg.EngineSafePro {
		envAdd = append(envAdd, "SHIELD_ENGINE_SAFE_PRO=1")
	}
	if !cfg.EngineVirtualization {
		envAdd = append(envAdd, "SHIELD_ENGINE_VIRTUALIZATION=0")
	}
	if cfg.EngineLowEntropy {
		envAdd = append(envAdd, "SHIELD_ENGINE_LOW_ENTROPY=1")
	}
	if len(envAdd) > 0 {
		cmd.Env = append(append([]string{}, os.Environ()...), envAdd...)
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf("%s", msg)
	}
	return nil
}

func runPacker(cfg *config.Config, input, output, tier string) error {
	loaderPath := cfg.NativeLoaderPath
	if loaderPath == "" {
		for _, p := range []string{
			"bin/loader.exe",
			"loader.exe",
		} {
			if _, err := os.Stat(p); err == nil {
				loaderPath = p
				break
			}
		}
		if loaderPath == "" {
			execPath, _ := os.Executable()
			candidate := filepath.Join(filepath.Dir(execPath), "loader.exe")
			if _, err := os.Stat(candidate); err == nil {
				loaderPath = candidate
			}
		}
	}
	if loaderPath == "" {
		return fmt.Errorf("loader not found. Run: go build -ldflags \"-s -w\" -o bin/loader.exe ./cmd/loader")
	}
	if abs, err := filepath.Abs(loaderPath); err == nil {
		loaderPath = abs
	}
	return nativepacker.Pack(input, output, loaderPath, tier)
}
