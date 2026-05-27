package worker

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/shieldbinary/backend/internal/config"
	"github.com/shieldbinary/backend/internal/nativepacker"
	"github.com/shieldbinary/backend/internal/peutil"
	"github.com/shieldbinary/backend/internal/queue"
	"github.com/shieldbinary/backend/internal/storage"
	"github.com/shieldbinary/backend/internal/threatintel"
	"go.uber.org/zap"
)

type Worker struct {
	cfg           *config.Config
	logger        *zap.Logger
	queue         *queue.Queue
	storage       storage.Storage
	intelStore    *threatintel.Store
	intelClient   threatintel.Client
	intelAnalyzer *threatintel.Analyzer
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
	var intelStore *threatintel.Store
	var intelClient threatintel.Client
	var intelAnalyzer *threatintel.Analyzer
	if cfg.EnableThreatIntel {
		if tiStore, err := threatintel.NewStore(cfg.DatabasePath); err == nil {
			intelStore = tiStore
			intelAnalyzer = threatintel.NewAnalyzer(tiStore)
			if strings.EqualFold(cfg.ThreatIntelProvider, "virustotal") {
				intelClient = threatintel.NewVirusTotalClient(cfg)
			}
		} else {
			logger.Warn("threat intel disabled in worker: store init failed", zap.Error(err))
		}
	}
	return &Worker{
		cfg:           cfg,
		logger:        logger,
		queue:         q,
		storage:       store,
		intelStore:    intelStore,
		intelClient:   intelClient,
		intelAnalyzer: intelAnalyzer,
	}, nil
}

func (w *Worker) Close() error {
	if w.intelStore != nil {
		_ = w.intelStore.Close()
	}
	return w.queue.Close()
}

func (w *Worker) Run(ctx context.Context) error {
	if w.cfg.EnableThreatIntel {
		go w.runThreatIntelPoller(ctx)
	}
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
		w.failJob(ctx, job.ID, "Failed to detect binary type: "+err.Error())
		return
	}

	detectedType := "native"
	var obs *engineObservability
	if isDotNet {
		// Run .NET engine
		o, err := w.runDotNetEngine(ctx, job.ID, workDir, inputPath, outputPath, job.Tier, job.LowEntropy, job.Polymorphic, job.Protections)
		obs = o
		if err != nil {
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

	if obs != nil {
		if len(obs.PassMetrics) > 0 {
			_ = w.queue.SetPassMetrics(ctx, job.ID, obs.PassMetrics)
		}
	}
	sizeImpact := estimateSizeImpact(inputPath, outputPath, obs)
	if sizeImpact != nil {
		_ = w.queue.SetSizeImpact(ctx, job.ID, sizeImpact)
	}
	compat := w.runCompatibilityCheck(ctx, outputPath, detectedType)
	_ = w.queue.SetCompatibilityReport(ctx, job.ID, compat)
	if compat != nil && (compat.Status == "incompatible" || compat.Status == "warning") {
		_ = w.queue.SetRetrySuggestions(ctx, job.ID, buildRetrySuggestions(job, compat.Notes))
	}
	score := buildStrengthScore(job, compat, nil)
	if obs != nil {
		score = buildStrengthScore(job, compat, obs.PassMetrics)
	}
	_ = w.queue.SetStrengthScore(ctx, job.ID, score)

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

func (w *Worker) runDotNetEngine(ctx context.Context, jobID, workDir, inputPath, outputPath, tier string, lowEntropy bool, polymorphic bool, protections []string) (*engineObservability, error) {
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
			return nil, fmt.Errorf("protection engine not found. Run: dotnet publish engine/ShieldBinary.Engine.csproj -c Release -r win-x64 --self-contained -o bin/engine")
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
	var inputBytes int64
	if st, statErr := os.Stat(inputPath); statErr == nil {
		inputBytes = st.Size()
	}
	obs := parseEngineTelemetry(string(out), inputBytes)
	if obs != nil && obs.SizeImpact != nil && obs.SizeImpact.OutputBytes == 0 {
		if st, statErr := os.Stat(outputPath); statErr == nil {
			obs.SizeImpact.OutputBytes = st.Size()
		}
	}
	if err != nil {
		w.logger.Error("engine failed", zap.Error(err), zap.String("output", string(out)))
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			msg = err.Error()
		}
		return obs, fmt.Errorf("%s", msg)
	}
	return obs, nil
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
	if job, err := w.queue.GetJob(ctx, jobID); err == nil && job != nil {
		_ = w.queue.SetRetrySuggestions(ctx, jobID, buildRetrySuggestions(job, msg))
	}
	w.logger.Error("job failed", zap.String("job_id", jobID), zap.String("error", msg))
}

func estimateSizeImpact(inputPath, outputPath string, obs *engineObservability) *queue.SizeImpact {
	var sizeImpact *queue.SizeImpact
	if obs != nil && obs.SizeImpact != nil {
		sizeImpact = obs.SizeImpact
	} else {
		sizeImpact = &queue.SizeImpact{}
	}
	if sizeImpact.InputBytes == 0 {
		if st, err := os.Stat(inputPath); err == nil {
			sizeImpact.InputBytes = st.Size()
		}
	}
	if sizeImpact.OutputBytes == 0 {
		if st, err := os.Stat(outputPath); err == nil {
			sizeImpact.OutputBytes = st.Size()
		}
	}
	if sizeImpact.InputBytes == 0 && sizeImpact.OutputBytes == 0 && len(sizeImpact.PassDeltas) == 0 {
		return nil
	}
	return sizeImpact
}
