package integration

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/shieldbinary/backend/internal/nativepacker"
)

// TestDotNetProtection_ExecutableRuns verifies a .NET executable still runs correctly after protection.
// Requires: dotnet SDK, built engine (bin/engine/ or engine/bin/Debug/).
func TestDotNetProtection_ExecutableRuns(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()

	// 1. Build the test fixture (framework-dependent = managed assembly with CLR header)
	fixtureDir, _ := filepath.Abs(filepath.Join("..", "..", "testdata", "dotnet-fixture"))
	fixturePath := filepath.Join(dir, "TestApp.dll")
	buildCmd := exec.CommandContext(ctx, "dotnet", "publish", fixtureDir,
		"-c", "Release", "-o", dir)
	if out, err := buildCmd.CombinedOutput(); err != nil {
		t.Skipf("dotnet publish fixture failed (missing dotnet?): %v\n%s", err, out)
	}

	// Verify fixture runs before protection (use dotnet to run the managed assembly)
	runAndVerify := func(assemblyPath string) {
		cmd := exec.CommandContext(ctx, "dotnet", assemblyPath)
		var stdout, stderr bytes.Buffer
		cmd.Stdout = &stdout
		cmd.Stderr = &stderr
		_ = cmd.Run()
		out := stdout.String() + stderr.String()
		if !strings.Contains(out, "SHIELD_OK") {
			t.Fatalf("expected SHIELD_OK in output, got: %q", out)
		}
		if cmd.ProcessState != nil && cmd.ProcessState.ExitCode() != 42 {
			t.Fatalf("expected exit code 42, got %d", cmd.ProcessState.ExitCode())
		}
	}

	runAndVerify(fixturePath)

	// 2. Find engine
	enginePath, useDotnet := findEngine()
	if enginePath == "" {
		t.Skip("engine not found, run: dotnet publish engine/ -c Release -r win-x64 -o bin/engine")
	}

	// 3. Protect
	protectedPath := filepath.Join(dir, "protected.dll")
	var protectCmd *exec.Cmd
	if useDotnet {
		protectCmd = exec.CommandContext(ctx, "dotnet", enginePath, fixturePath, protectedPath, "basic")
	} else {
		protectCmd = exec.CommandContext(ctx, enginePath, fixturePath, protectedPath, "basic")
	}
	protectCmd.Dir = dir
	if out, err := protectCmd.CombinedOutput(); err != nil {
		t.Fatalf("engine failed: %v\n%s", err, out)
	}

	if _, err := os.Stat(protectedPath); err != nil {
		t.Fatalf("protected output not created: %v", err)
	}

	// Copy runtime config so dotnet runs as framework-dependent (not self-contained)
	runtimeConfig := filepath.Join(dir, "TestApp.runtimeconfig.json")
	if data, err := os.ReadFile(runtimeConfig); err == nil {
		_ = os.WriteFile(filepath.Join(dir, "protected.runtimeconfig.json"), data, 0644)
	}

	// 4. Run protected executable and verify
	runAndVerify(protectedPath)
}

// TestDotNetProtection_MinimalTier verifies Minimal tier (symbol stripping + metadata only) produces a working executable.
func TestDotNetProtection_MinimalTier(t *testing.T) {
	testDotNetTier(t, "minimal")
}

// TestDotNetProtection_ProTier verifies Pro tier protection produces a working executable.
func TestDotNetProtection_ProTier(t *testing.T) {
	testDotNetTier(t, "pro")
}

// TestDotNetProtection_EnterpriseTier verifies Enterprise tier protection produces a working executable.
func TestDotNetProtection_EnterpriseTier(t *testing.T) {
	testDotNetTier(t, "enterprise")
}

// TestDotNetProtection_AdvancedOptInPasses verifies newly added opt-in passes keep a basic app runnable.
func TestDotNetProtection_AdvancedOptInPasses(t *testing.T) {
	tests := []struct {
		name     string
		tier     string
		envKey   string
		envValue string
		onlyPass string
	}{
		{
			name:     "reference_proxy",
			tier:     "pro",
			envKey:   "SHIELD_ENGINE_REFERENCE_PROXY",
			envValue: "1",
			onlyPass: "symbol_stripping,reference_proxy,metadata_cleanup",
		},
		{
			name:     "delegate_proxy",
			tier:     "pro",
			envKey:   "SHIELD_ENGINE_DELEGATE_PROXY",
			envValue: "1",
			onlyPass: "symbol_stripping,delegate_proxy,metadata_cleanup",
		},
		{
			name:     "reflection_dispatch",
			tier:     "pro",
			envKey:   "SHIELD_ENGINE_REFLECTION_DISPATCH",
			envValue: "1",
			onlyPass: "symbol_stripping,reflection_dispatch,metadata_cleanup",
		},
		{
			name:     "il_mutation",
			tier:     "pro",
			envKey:   "SHIELD_ENGINE_IL_MUTATION",
			envValue: "1",
			onlyPass: "symbol_stripping,il_mutation,metadata_cleanup",
		},
		{
			name:     "constant_encoding",
			tier:     "pro",
			envKey:   "SHIELD_ENGINE_PASSES",
			envValue: "symbol_stripping,constant_encoding,metadata_cleanup",
			onlyPass: "symbol_stripping,constant_encoding,metadata_cleanup",
		},
		{
			name:     "resource_encryption",
			tier:     "pro",
			envKey:   "SHIELD_ENGINE_RESOURCE_ENCRYPT",
			envValue: "1",
			onlyPass: "symbol_stripping,resource_encryption,metadata_cleanup",
		},
		{
			name:     "name_obfuscation_sequential",
			tier:     "enterprise",
			envKey:   "SHIELD_ENGINE_RENAME_MODE",
			envValue: "sequential",
			onlyPass: "symbol_stripping,name_obfuscation,metadata_cleanup",
		},
		{
			name:     "type_scramble",
			tier:     "pro",
			envKey:   "SHIELD_ENGINE_TYPE_SCRAMBLE",
			envValue: "1",
			onlyPass: "symbol_stripping,type_scramble,metadata_cleanup",
		},
		{
			name:     "assembly_embed",
			tier:     "pro",
			envKey:   "SHIELD_ENGINE_ASSEMBLY_EMBED",
			envValue: "1",
			onlyPass: "symbol_stripping,assembly_embed,metadata_cleanup",
		},
		{
			name:     "anti_decompiler",
			tier:     "pro",
			envKey:   "SHIELD_ENGINE_ANTI_DECOMPILER",
			envValue: "1",
			onlyPass: "symbol_stripping,anti_decompiler,metadata_cleanup",
		},
		{
			name:     "anti_decompiler_aggressive",
			tier:     "pro",
			envKey:   "SHIELD_ENGINE_ANTI_DECOMPILER_AGGRESSIVE",
			envValue: "1",
			onlyPass: "symbol_stripping,anti_decompiler,metadata_cleanup",
		},
		{
			name:     "invalid_metadata",
			tier:     "pro",
			envKey:   "SHIELD_ENGINE_INVALID_METADATA",
			envValue: "1",
			onlyPass: "symbol_stripping,invalid_metadata,metadata_cleanup",
		},
		{
			name:     "method_body_encryption",
			tier:     "pro",
			envKey:   "SHIELD_ENGINE_METHOD_BODY_ENCRYPT",
			envValue: "1",
			onlyPass: "symbol_stripping,method_body_encryption,metadata_cleanup",
		},
		{
			name:     "dynamic_method_generation",
			tier:     "pro",
			envKey:   "SHIELD_ENGINE_DYNAMIC_METHOD_GEN",
			envValue: "1",
			onlyPass: "symbol_stripping,dynamic_method_generation,metadata_cleanup",
		},
		{
			name:     "polymorphic_mode",
			tier:     "pro",
			envKey:   "SHIELD_ENGINE_POLYMORPHIC",
			envValue: "1",
			onlyPass: "symbol_stripping,il_mutation,opaque_predicates,metadata_cleanup",
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			testDotNetTierWithEnv(t, tc.tier, map[string]string{
				tc.envKey:              tc.envValue,
				"SHIELD_ENGINE_PASSES": tc.onlyPass,
			})
		})
	}
}

func testDotNetTier(t *testing.T, tier string) {
	testDotNetTierWithEnv(t, tier, nil)
}

func testDotNetTierWithEnv(t *testing.T, tier string, env map[string]string) {
	ctx := context.Background()
	dir := t.TempDir()

	fixtureDir, _ := filepath.Abs(filepath.Join("..", "..", "testdata", "dotnet-fixture"))
	fixturePath := filepath.Join(dir, "TestApp.dll")
	buildCmd := exec.CommandContext(ctx, "dotnet", "publish", fixtureDir,
		"-c", "Release", "-o", dir)
	if out, err := buildCmd.CombinedOutput(); err != nil {
		t.Skipf("dotnet publish fixture failed: %v\n%s", err, out)
	}

	runAndVerify := func(assemblyPath string) {
		cmd := exec.CommandContext(ctx, "dotnet", assemblyPath)
		var stdout, stderr bytes.Buffer
		cmd.Stdout = &stdout
		cmd.Stderr = &stderr
		_ = cmd.Run()
		out := stdout.String() + stderr.String()
		if !strings.Contains(out, "SHIELD_OK") {
			t.Fatalf("expected SHIELD_OK in output, got: %q", out)
		}
		if cmd.ProcessState != nil && cmd.ProcessState.ExitCode() != 42 {
			t.Fatalf("expected exit code 42, got %d", cmd.ProcessState.ExitCode())
		}
	}

	enginePath, useDotnet := findEngine()
	if enginePath == "" {
		t.Skip("engine not found")
	}

	protectedPath := filepath.Join(dir, "protected.dll")
	var protectCmd *exec.Cmd
	if useDotnet {
		protectCmd = exec.CommandContext(ctx, "dotnet", enginePath, fixturePath, protectedPath, tier)
	} else {
		protectCmd = exec.CommandContext(ctx, enginePath, fixturePath, protectedPath, tier)
	}
	protectCmd.Dir = dir
	if len(env) > 0 {
		protectCmd.Env = append([]string{}, os.Environ()...)
		for k, v := range env {
			protectCmd.Env = append(protectCmd.Env, k+"="+v)
		}
	}
	if out, err := protectCmd.CombinedOutput(); err != nil {
		t.Fatalf("engine failed for tier %s: %v\n%s", tier, err, out)
	}

	// Copy runtime config so dotnet runs as framework-dependent
	runtimeConfig := filepath.Join(dir, "TestApp.runtimeconfig.json")
	if data, err := os.ReadFile(runtimeConfig); err == nil {
		_ = os.WriteFile(filepath.Join(dir, "protected.runtimeconfig.json"), data, 0644)
	}

	runAndVerify(protectedPath)
}

func findEngine() (path string, useDotnet bool) {
	repoRoot, _ := filepath.Abs(filepath.Join("..", ".."))
	tryPaths := []string{
		"bin/engine/shieldbinary-engine.exe",
		"bin/engine/shieldbinary-engine",
		"engine/bin/Debug/net8.0/win-x64/shieldbinary-engine.exe",
		"engine/bin/Debug/net8.0/shieldbinary-engine.dll",
		"engine/bin/Release/net8.0/win-x64/shieldbinary-engine.exe",
		"engine/bin/Release/net8.0/linux-x64/shieldbinary-engine",
	}
	for _, p := range tryPaths {
		full := filepath.Join(repoRoot, p)
		if _, err := os.Stat(full); err == nil {
			abs, _ := filepath.Abs(full)
			useDotnet = strings.HasSuffix(strings.ToLower(p), ".dll")
			return abs, useDotnet
		}
	}
	return "", false
}

// TestNativeProtection_ExecutableRuns verifies a native PE still runs correctly after packing.
// Windows only. Requires: built loader (bin/loader.exe), Go to build the fixture.
func TestNativeProtection_ExecutableRuns(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("native pack execution test is Windows-only")
	}

	ctx := context.Background()
	dir := t.TempDir()

	// 1. Build the test fixture (minimal Go exe)
	fixtureDir, _ := filepath.Abs(filepath.Join("..", "..", "testdata", "native-fixture"))
	fixturePath := filepath.Join(dir, "TestApp.exe")
	buildCmd := exec.CommandContext(ctx, "go", "build", "-o", fixturePath, fixtureDir)
	if out, err := buildCmd.CombinedOutput(); err != nil {
		t.Skipf("go build fixture failed: %v\n%s", err, out)
	}

	// Verify fixture runs before protection
	runAndVerify := func(exePath string) {
		cmd := exec.CommandContext(ctx, exePath)
		var stdout, stderr bytes.Buffer
		cmd.Stdout = &stdout
		cmd.Stderr = &stderr
		_ = cmd.Run()
		out := stdout.String() + stderr.String()
		if !strings.Contains(out, "SHIELD_OK") {
			t.Fatalf("expected SHIELD_OK in output, got: %q", out)
		}
		if cmd.ProcessState != nil && cmd.ProcessState.ExitCode() != 42 {
			t.Fatalf("expected exit code 42, got %d", cmd.ProcessState.ExitCode())
		}
	}

	runAndVerify(fixturePath)

	// 2. Find loader
	loaderPath := findLoader()
	if loaderPath == "" {
		t.Skip("loader not found, run: go build -ldflags \"-s -w\" -o bin/loader.exe ./cmd/loader")
	}

	// 3. Pack
	protectedPath := filepath.Join(dir, "protected.exe")
	if err := runNativePack(fixturePath, protectedPath, loaderPath, "basic"); err != nil {
		t.Fatalf("native pack failed: %v", err)
	}

	if _, err := os.Stat(protectedPath); err != nil {
		t.Fatalf("protected output not created: %v", err)
	}

	// 4. Run packed executable and verify
	runAndVerify(protectedPath)
}

func findLoader() string {
	repoRoot, _ := filepath.Abs(filepath.Join("..", ".."))
	tryPaths := []string{
		"bin/loader.exe",
		"loader.exe",
		"cmd/loader/loader.exe",
	}
	for _, p := range tryPaths {
		full := filepath.Join(repoRoot, p)
		if _, err := os.Stat(full); err == nil {
			abs, _ := filepath.Abs(full)
			return abs
		}
	}
	execPath, _ := os.Executable()
	candidate := filepath.Join(filepath.Dir(execPath), "loader.exe")
	if _, err := os.Stat(candidate); err == nil {
		return candidate
	}
	return ""
}

func runNativePack(input, output, loader, tier string) error {
	return nativepacker.Pack(input, output, loader, tier)
}

// TestDotNetPublishProfiles_Smoke verifies packaging profile scripts produce expected outputs.
// Disabled by default because publish profiles are expensive. Enable with SHIELD_RUN_PUBLISH_PROFILE_TESTS=1.
func TestDotNetPublishProfiles_Smoke(t *testing.T) {
	if os.Getenv("SHIELD_RUN_PUBLISH_PROFILE_TESTS") != "1" {
		t.Skip("set SHIELD_RUN_PUBLISH_PROFILE_TESTS=1 to run publish profile smoke tests")
	}
	ctx := context.Background()
	repoRoot, _ := filepath.Abs(filepath.Join("..", ".."))
	project := filepath.Join(repoRoot, "testdata", "dotnet-fixture", "TestApp.csproj")
	if _, err := os.Stat(project); err != nil {
		t.Skipf("fixture project missing: %v", err)
	}
	if _, err := exec.LookPath("dotnet"); err != nil {
		t.Skip("dotnet not found")
	}

	outDir := filepath.Join(t.TempDir(), "publish-profiles")
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		script := filepath.Join(repoRoot, "scripts", "publish-dotnet-profiles.ps1")
		cmd = exec.CommandContext(ctx, "powershell",
			"-NoProfile",
			"-ExecutionPolicy", "Bypass",
			"-File", script,
			"-Project", project,
			"-Runtime", "win-x64",
			"-OutputDir", outDir,
		)
	} else {
		script := filepath.Join(repoRoot, "scripts", "publish-dotnet-profiles.sh")
		cmd = exec.CommandContext(ctx, "bash", script, project, "linux-x64", "Release", outDir)
	}
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("publish profiles failed: %v\n%s", err, out)
	}

	expected := []string{
		"baseline",
		"r2r",
		"singlefile",
		"trimmed",
		"singlefile-r2r-trimmed",
	}
	for _, p := range expected {
		path := filepath.Join(outDir, p)
		st, err := os.Stat(path)
		if err != nil || !st.IsDir() {
			t.Fatalf("expected output profile dir missing: %s", path)
		}
	}
	// nativeaot is best-effort and may be skipped depending on app/toolchain.
}
