package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/shieldbinary/backend/internal/config"
	"github.com/shieldbinary/backend/internal/nativepacker"
	"github.com/shieldbinary/backend/internal/peutil"
	"github.com/shieldbinary/backend/internal/queue"
	"github.com/shieldbinary/backend/internal/storage"
	"go.uber.org/zap"
)

type Worker struct {
	cfg     *config.Config
	logger  *zap.Logger
	queue   *queue.Queue
	storage storage.Storage
}

func New(cfg *config.Config, logger *zap.Logger) (*Worker, error) {
	q, err := queue.New(cfg.RedisAddr, cfg.RedisPassword, cfg.RedisDB)
	if err != nil {
		return nil, err
	}
	store, err := storage.NewFromConfig(cfg)
	if err != nil {
		q.Close()
		return nil, err
	}
	return &Worker{cfg: cfg, logger: logger, queue: q, storage: store}, nil
}

func (w *Worker) Close() error {
	return w.queue.Close()
}

func (w *Worker) Run(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
			job, err := w.queue.Dequeue(ctx)
			if err != nil {
				w.logger.Error("dequeue failed", zap.Error(err))
				continue
			}
			w.processJob(ctx, job)
		}
	}
}

func (w *Worker) processJob(ctx context.Context, job *queue.JobPayload) {
	w.logger.Info("processing job",
		zap.String("job_id", job.ID),
		zap.String("tier", job.Tier),
		zap.String("binary_type", job.BinaryType),
	)
	// #region agent log
	debugLog("baseline", "H4", "internal/worker/worker.go:70", "worker processing job", map[string]interface{}{
		"jobId":      job.ID,
		"tier":       job.Tier,
		"binaryType": job.BinaryType,
		"inputKey":   job.InputKey,
	})
	// #endregion

	workDir, err := os.MkdirTemp("", "shieldbinary-"+job.ID+"-*")
	if err != nil {
		w.failJob(ctx, job.ID, err)
		return
	}
	defer os.RemoveAll(workDir)

	// Download input from storage
	inputPath := filepath.Join(workDir, "input")
	inputExt := filepath.Ext(strings.TrimPrefix(job.InputKey, "inputs/"))
	if inputExt == "" {
		inputExt = ".dll"
	}
	inputPath += inputExt

	rc, err := w.storage.Download(ctx, job.InputKey)
	if err != nil {
		w.logger.Error("download failed", zap.Error(err))
		w.failJob(ctx, job.ID, "Download failed: "+err.Error())
		return
	}
	f, err := os.Create(inputPath)
	if err != nil {
		rc.Close()
		w.failJob(ctx, job.ID, err)
		return
	}
	_, err = io.Copy(f, rc)
	f.Close()
	rc.Close()
	if err != nil {
		w.failJob(ctx, job.ID, err)
		return
	}

	_ = w.queue.SetStatus(ctx, job.ID, "processing", 20)

	outputPath := filepath.Join(workDir, "output"+inputExt)

	// Detect .NET vs native PE and route to appropriate engine
	isDotNet, err := peutil.IsDotNet(inputPath)
	if err != nil {
		// #region agent log
		debugLog("baseline", "H4", "internal/worker/worker.go:119", "dotnet detection failed", map[string]interface{}{
			"jobId": job.ID,
			"error": err.Error(),
		})
		// #endregion
		w.failJob(ctx, job.ID, "Failed to detect binary type: "+err.Error())
		return
	}
	// #region agent log
	debugLog("baseline", "H4", "internal/worker/worker.go:126", "dotnet detection result", map[string]interface{}{
		"jobId":    job.ID,
		"isDotNet": isDotNet,
	})
	// #endregion

	detectedType := "native"
	if isDotNet {
		// Run .NET engine
		if err := w.runDotNetEngine(ctx, job.ID, workDir, inputPath, outputPath, job.Tier, job.LowEntropy, job.Polymorphic, job.Protections); err != nil {
			// Engine may reject mixed/edge-case PEs; fall back to native packer
			if strings.Contains(err.Error(), "not a .NET assembly") && runtime.GOOS == "windows" {
				if valid, ve := peutil.IsValidPE(inputPath); ve == nil && valid {
					w.logger.Info("engine rejected file as non-.NET, falling back to native packer", zap.String("job_id", job.ID))
					if err := w.runNativePacker(ctx, job.ID, inputPath, outputPath, job.Tier); err != nil {
						w.failJob(ctx, job.ID, err.Error())
						return
					}
					detectedType = "native"
				} else {
					w.failJob(ctx, job.ID, err.Error())
					return
				}
			} else {
				w.failJob(ctx, job.ID, err.Error())
				return
			}
		} else {
			detectedType = "dotnet"
		}
	} else {
		if runtime.GOOS != "windows" {
			w.failJob(ctx, job.ID, "Native PE packing is only supported on Windows. Use a Windows worker for native binaries.")
			return
		}
		// Validate it's a PE before packing
		valid, err := peutil.IsValidPE(inputPath)
		if err != nil || !valid {
			w.failJob(ctx, job.ID, "Not a valid PE file. Only .NET assemblies and native Windows PE (exe/dll) are supported.")
			return
		}
		// Run native packer
		if err := w.runNativePacker(ctx, job.ID, inputPath, outputPath, job.Tier); err != nil {
			w.failJob(ctx, job.ID, err.Error())
			return
		}
	}

	_ = w.queue.SetStatus(ctx, job.ID, "uploading", 80)

	// Upload output to storage
	outputKey := "outputs/" + job.UserID + "/" + job.ID + inputExt
	of, err := os.Open(outputPath)
	if err != nil {
		w.failJob(ctx, job.ID, "Engine did not produce output: "+err.Error())
		return
	}
	finfo, _ := of.Stat()
	if err := w.storage.Upload(ctx, outputKey, of, finfo.Size()); err != nil {
		of.Close()
		w.failJob(ctx, job.ID, "Upload failed: "+err.Error())
		return
	}
	of.Close()

	if err := w.queue.SetOutputKey(ctx, job.ID, outputKey); err != nil {
		w.logger.Error("set output key failed", zap.Error(err))
	}
	_ = w.queue.SetBinaryType(ctx, job.ID, detectedType)
	_ = w.queue.SetStatus(ctx, job.ID, "completed", 100)
	w.logger.Info("job completed", zap.String("job_id", job.ID))
}

func (w *Worker) runDotNetEngine(ctx context.Context, jobID, workDir, inputPath, outputPath, tier string, lowEntropy bool, polymorphic bool, protections []string) error {
	enginePath := w.cfg.EnginePath
	var useDotnet bool
	if enginePath == "" {
		for _, p := range []string{
			"bin/engine/shieldbinary-engine.exe",
			"bin/engine/shieldbinary-engine",
			"engine/bin/Debug/net8.0/win-x64/shieldbinary-engine.exe",
			"engine/bin/Debug/net8.0/shieldbinary-engine.dll",
			"engine/bin/Debug/net8.0/shieldbinary-engine.exe",
		} {
			if _, err := os.Stat(p); err == nil {
				enginePath = p
				useDotnet = strings.HasSuffix(strings.ToLower(p), ".dll")
				break
			}
		}
		if enginePath == "" {
			return fmt.Errorf("protection engine not found. Run: dotnet publish engine/ShieldBinary.Engine.csproj -c Release -r win-x64 --self-contained -o bin/engine")
		}
	} else {
		useDotnet = strings.HasSuffix(strings.ToLower(enginePath), ".dll")
	}
	if abs, err := filepath.Abs(enginePath); err == nil {
		enginePath = abs
	}
	var cmd *exec.Cmd
	if useDotnet {
		cmd = exec.CommandContext(ctx, "dotnet", enginePath, inputPath, outputPath, tier)
	} else {
		cmd = exec.CommandContext(ctx, enginePath, inputPath, outputPath, tier)
	}
	cmd.Dir = workDir
	envAdd := []string{}
	if w.cfg.EngineSafePro {
		envAdd = append(envAdd, "SHIELD_ENGINE_SAFE_PRO=1")
	}
	if !w.cfg.EngineVirtualization {
		envAdd = append(envAdd, "SHIELD_ENGINE_VIRTUALIZATION=0")
	}
	if w.cfg.EngineLowEntropy || lowEntropy {
		envAdd = append(envAdd, "SHIELD_ENGINE_LOW_ENTROPY=1")
	}
	if polymorphic {
		envAdd = append(envAdd, "SHIELD_ENGINE_POLYMORPHIC=1")
	}
	envAdd = append(envAdd, protectionEnvVars(protections)...)
	if len(envAdd) > 0 {
		cmd.Env = append(append([]string{}, os.Environ()...), envAdd...)
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		w.logger.Error("engine failed", zap.Error(err), zap.String("output", string(out)))
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf("%s", msg)
	}
	return nil
}

func protectionEnvVars(protections []string) []string {
	if len(protections) == 0 {
		return nil
	}
	set := map[string]bool{}
	for _, p := range protections {
		k := strings.ToLower(strings.TrimSpace(p))
		if k != "" {
			set[k] = true
		}
	}
	var env []string
	if set["resource_encryption"] {
		env = append(env, "SHIELD_ENGINE_RESOURCE_ENCRYPT=1")
	}
	if set["reference_proxy"] {
		env = append(env, "SHIELD_ENGINE_REFERENCE_PROXY=1")
	}
	if set["delegate_proxy"] {
		env = append(env, "SHIELD_ENGINE_DELEGATE_PROXY=1")
	}
	if set["reflection_dispatch"] {
		env = append(env, "SHIELD_ENGINE_REFLECTION_DISPATCH=1")
	}
	if set["il_mutation"] {
		env = append(env, "SHIELD_ENGINE_IL_MUTATION=1")
	}
	if set["type_scramble"] {
		env = append(env, "SHIELD_ENGINE_TYPE_SCRAMBLE=1")
	}
	if set["assembly_embed"] {
		env = append(env, "SHIELD_ENGINE_ASSEMBLY_EMBED=1")
	}
	if set["anti_decompiler"] || set["anti_decompiler_aggressive"] {
		env = append(env, "SHIELD_ENGINE_ANTI_DECOMPILER=1")
	}
	if set["anti_decompiler_aggressive"] {
		env = append(env, "SHIELD_ENGINE_ANTI_DECOMPILER_AGGRESSIVE=1")
	}
	if set["invalid_metadata"] {
		env = append(env, "SHIELD_ENGINE_INVALID_METADATA=1")
	}
	if set["method_body_encryption"] {
		env = append(env, "SHIELD_ENGINE_METHOD_BODY_ENCRYPT=1")
	}
	if set["dynamic_method_generation"] {
		env = append(env, "SHIELD_ENGINE_DYNAMIC_METHOD_GEN=1")
	}
	if set["runtime_rasp"] {
		env = append(env, "SHIELD_ENGINE_RASP=1")
	}
	if set["local_var_promotion"] {
		env = append(env, "SHIELD_ENGINE_LOCAL_VAR_PROMOTION=1")
	}
	if set["rename_mode_sequential"] {
		env = append(env, "SHIELD_ENGINE_RENAME_MODE=sequential")
	}
	if set["rename_mode_unicode"] {
		env = append(env, "SHIELD_ENGINE_RENAME_MODE=unicode")
	}
	if set["rename_mode_unprintable"] {
		env = append(env, "SHIELD_ENGINE_RENAME_MODE=unprintable", "SHIELD_ENGINE_RENAME_UNSAFE=1")
	}
	if set["rename_mode_random"] {
		env = append(env, "SHIELD_ENGINE_RENAME_MODE=random")
	}
	if set["polymorphic_mode"] {
		env = append(env, "SHIELD_ENGINE_POLYMORPHIC=1")
	}
	return env
}

func (w *Worker) runNativePacker(ctx context.Context, jobID, inputPath, outputPath, tier string) error {
	loaderPath := w.cfg.NativeLoaderPath
	if loaderPath == "" {
		for _, p := range []string{
			"bin/loader.exe",
			"loader.exe",
			"cmd/loader/loader.exe",
		} {
			if _, err := os.Stat(p); err == nil {
				loaderPath = p
				break
			}
		}
	}
	if loaderPath == "" {
		// Try same dir as worker executable
		execPath, _ := os.Executable()
		execDir := filepath.Dir(execPath)
		candidate := filepath.Join(execDir, "loader.exe")
		if _, err := os.Stat(candidate); err == nil {
			loaderPath = candidate
		}
	}
	if loaderPath == "" {
		return fmt.Errorf("native loader not found. Build it with: go build -ldflags \"-s -w\" -o bin/loader.exe ./cmd/loader")
	}
	if abs, err := filepath.Abs(loaderPath); err == nil {
		loaderPath = abs
	}
	if err := nativepacker.Pack(inputPath, outputPath, loaderPath, tier); err != nil {
		w.logger.Error("native packer failed", zap.Error(err))
		return fmt.Errorf("native pack failed: %w", err)
	}
	return nil
}

func (w *Worker) failJob(ctx context.Context, jobID string, errMsg interface{}) {
	_ = w.queue.SetStatus(ctx, jobID, "failed", 0)
	msg := fmt.Sprint(errMsg)
	_ = w.queue.SetJobError(ctx, jobID, msg)
	w.logger.Error("job failed", zap.String("job_id", jobID), zap.String("error", msg))
}

func debugLog(runID, hypothesisID, location, message string, data map[string]interface{}) {
	f, err := os.OpenFile("c:\\Users\\Ryzen3D\\BinaryProtect\\.cursor\\debug.log", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	_ = json.NewEncoder(f).Encode(map[string]interface{}{
		"id":           fmt.Sprintf("log_%d_workerproc", time.Now().UnixNano()),
		"timestamp":    time.Now().UnixMilli(),
		"runId":        runID,
		"hypothesisId": hypothesisID,
		"location":     location,
		"message":      message,
		"data":         data,
	})
}
