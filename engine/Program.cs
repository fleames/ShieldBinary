using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text.Json;
using dnlib.DotNet;
using dnlib.DotNet.Emit;
using dnlib.DotNet.Writer;
using ShieldBinary.Engine.Passes;

namespace ShieldBinary.Engine;

public static class Program
{
    private const string TelemetryPrefix = "[engine-telemetry]";
    public static int Main(string[] args)
    {
        if (args.Length < 3)
        {
            Console.Error.WriteLine("Usage: shieldbinary-engine <input-path> <output-path> <tier> [options-json]");
            return 1;
        }

        var inputPath = args[0];
        var outputPath = args[1];
        var tier = args[2].ToLowerInvariant();
        var optionsJson = args.Length > 3 ? args[3] : "{}";

        if (!File.Exists(inputPath))
        {
            Console.Error.WriteLine($"Input file not found: {inputPath}");
            return 1;
        }

        try
        {
            if (!IsDotNetAssembly(inputPath))
            {
                Console.Error.WriteLine("Error: This file is not a .NET assembly. This engine only processes .NET assemblies. For native PE binaries, use the ShieldBinary API which routes to the native packer.");
                return 1;
            }
            var options = JsonSerializer.Deserialize<EngineOptions>(optionsJson) ?? new EngineOptions();
            var onlyPasses = Environment.GetEnvironmentVariable("SHIELD_ENGINE_PASSES"); // e.g. "symbol_stripping,name_obfuscation"
            var lowEntropy = string.Equals(Environment.GetEnvironmentVariable("SHIELD_ENGINE_LOW_ENTROPY"), "1", StringComparison.OrdinalIgnoreCase);
            var requestedPolymorphic = options.PolymorphicMode ||
                string.Equals(Environment.GetEnvironmentVariable("SHIELD_ENGINE_POLYMORPHIC"), "1", StringComparison.OrdinalIgnoreCase);
            var polymorphicMode = requestedPolymorphic && !lowEntropy;
            var renameMode = ResolveRenameMode(options.RenameMode, Environment.GetEnvironmentVariable("SHIELD_ENGINE_RENAME_MODE"));
            var allowUnsafeRename = options.AllowUnsafeRename ||
                string.Equals(Environment.GetEnvironmentVariable("SHIELD_ENGINE_RENAME_UNSAFE"), "1", StringComparison.OrdinalIgnoreCase);
            var enableResourceEncryption = options.EncryptResources ||
                string.Equals(Environment.GetEnvironmentVariable("SHIELD_ENGINE_RESOURCE_ENCRYPT"), "1", StringComparison.OrdinalIgnoreCase);
            var enableReferenceProxy = options.ReferenceProxy ||
                string.Equals(Environment.GetEnvironmentVariable("SHIELD_ENGINE_REFERENCE_PROXY"), "1", StringComparison.OrdinalIgnoreCase);
            var enableIlMutation = options.IlMutation ||
                string.Equals(Environment.GetEnvironmentVariable("SHIELD_ENGINE_IL_MUTATION"), "1", StringComparison.OrdinalIgnoreCase);
            var enableDelegateProxy = options.DelegateProxy ||
                string.Equals(Environment.GetEnvironmentVariable("SHIELD_ENGINE_DELEGATE_PROXY"), "1", StringComparison.OrdinalIgnoreCase);
            var enableReflectionDispatch = options.ReflectionDispatch ||
                string.Equals(Environment.GetEnvironmentVariable("SHIELD_ENGINE_REFLECTION_DISPATCH"), "1", StringComparison.OrdinalIgnoreCase);
            var enableTypeScramble = options.TypeScramble ||
                string.Equals(Environment.GetEnvironmentVariable("SHIELD_ENGINE_TYPE_SCRAMBLE"), "1", StringComparison.OrdinalIgnoreCase);
            var enableAssemblyEmbed = options.AssemblyEmbed ||
                string.Equals(Environment.GetEnvironmentVariable("SHIELD_ENGINE_ASSEMBLY_EMBED"), "1", StringComparison.OrdinalIgnoreCase);
            var enableAntiDecompiler = options.AntiDecompiler ||
                string.Equals(Environment.GetEnvironmentVariable("SHIELD_ENGINE_ANTI_DECOMPILER"), "1", StringComparison.OrdinalIgnoreCase);
            var enableInvalidMetadata = options.InvalidMetadata ||
                string.Equals(Environment.GetEnvironmentVariable("SHIELD_ENGINE_INVALID_METADATA"), "1", StringComparison.OrdinalIgnoreCase);
            var enableMethodBodyEncryption = options.MethodBodyEncryption ||
                string.Equals(Environment.GetEnvironmentVariable("SHIELD_ENGINE_METHOD_BODY_ENCRYPT"), "1", StringComparison.OrdinalIgnoreCase);
            var enableDynamicMethodGen = options.DynamicMethodGen ||
                string.Equals(Environment.GetEnvironmentVariable("SHIELD_ENGINE_DYNAMIC_METHOD_GEN"), "1", StringComparison.OrdinalIgnoreCase);
            var enableAntiDecompilerAggressive = options.AntiDecompilerAggressive ||
                string.Equals(Environment.GetEnvironmentVariable("SHIELD_ENGINE_ANTI_DECOMPILER_AGGRESSIVE"), "1", StringComparison.OrdinalIgnoreCase);
            var enableRuntimeRasp = options.RuntimeRasp ||
                string.Equals(Environment.GetEnvironmentVariable("SHIELD_ENGINE_RASP"), "1", StringComparison.OrdinalIgnoreCase);
            var enableLocalVarPromotion = options.LocalVariablePromotion ||
                string.Equals(Environment.GetEnvironmentVariable("SHIELD_ENGINE_LOCAL_VAR_PROMOTION"), "1", StringComparison.OrdinalIgnoreCase);
            var ctx = new PipelineContext(
                inputPath,
                outputPath,
                tier,
                options,
                lowEntropy,
                polymorphicMode,
                renameMode,
                allowUnsafeRename,
                enableResourceEncryption,
                enableReferenceProxy,
                enableIlMutation,
                enableDelegateProxy,
                enableReflectionDispatch,
                enableTypeScramble,
                enableAssemblyEmbed,
                enableAntiDecompiler,
                enableInvalidMetadata,
                enableMethodBodyEncryption,
                enableDynamicMethodGen,
                enableAntiDecompilerAggressive,
                enableRuntimeRasp,
                enableLocalVarPromotion) { OnlyPasses = onlyPasses };
            RunPipeline(ctx);
            return 0;
        }
        catch (Exception ex)
        {
            var verbose = string.Equals(Environment.GetEnvironmentVariable("SHIELD_ENGINE_VERBOSE"), "1", StringComparison.OrdinalIgnoreCase);
            var msg = ex.Message;
            if (msg.Contains("data directory RVA is 0") || msg.Contains("BadImageFormatException"))
            {
                Console.Error.WriteLine("Error: This file is not a .NET assembly. Only .NET assemblies are supported.");
            }
            else
            {
                Console.Error.WriteLine($"Error: {msg}");
                if (verbose && ex.StackTrace != null)
                {
                    Console.Error.WriteLine("--- Stack trace ---");
                    Console.Error.WriteLine(ex.StackTrace);
                    if (ex.InnerException != null)
                        Console.Error.WriteLine($"Inner: {ex.InnerException.Message}\n{ex.InnerException.StackTrace}");
                }
            }
            return 1;
        }
    }

    private static bool IsDotNetAssembly(string path)
    {
        try
        {
            using var fs = File.OpenRead(path);
            using var br = new BinaryReader(fs);
            if (br.ReadUInt16() != 0x5A4D) return false; // MZ
            fs.Position = 0x3C;
            var peOffset = br.ReadInt32();
            fs.Position = peOffset;
            if (br.ReadUInt32() != 0x4550) return false; // PE
            fs.Position = peOffset + 24; // COFF header size
            var magic = br.ReadUInt16();
            var dataDirStart = magic == 0x20B ? 112u : 96u; // PE32+ vs PE32
            fs.Position = peOffset + 24 + dataDirStart + (14 * 8); // CLR = DataDirectory[14]
            var clrRva = br.ReadUInt32();
            return clrRva != 0;
        }
        catch
        {
            return false;
        }
    }

    private static void RunPipeline(PipelineContext ctx)
    {
        var verbose = string.Equals(Environment.GetEnvironmentVariable("SHIELD_ENGINE_VERBOSE"), "1", StringComparison.OrdinalIgnoreCase);
        if (verbose) Console.Error.WriteLine($"[engine] Loading {ctx.InputPath}");
        if (ctx.LowEntropy && verbose) Console.Error.WriteLine("[engine] SHIELD_ENGINE_LOW_ENTROPY=1: using deterministic encoding to reduce output entropy");
        if (ctx.PolymorphicMode && verbose) Console.Error.WriteLine("[engine] SHIELD_ENGINE_POLYMORPHIC=1: enabling high-variance mutation templates");
        var polymorphicRequested = ctx.Options.PolymorphicMode ||
            string.Equals(Environment.GetEnvironmentVariable("SHIELD_ENGINE_POLYMORPHIC"), "1", StringComparison.OrdinalIgnoreCase);
        if (polymorphicRequested && ctx.LowEntropy && verbose) Console.Error.WriteLine("[engine] polymorphic_mode requested but disabled because low entropy mode is active");

        using var module = ModuleDefMD.Load(ctx.InputPath);
        var typeCount = module.GetAllTypes().Count();
        if (verbose) Console.Error.WriteLine($"[engine] Loaded, {typeCount} types, tier={ctx.Tier}");

        var allPasses = GetPassesForTier(ctx.Tier);
        var safeMode = string.Equals(Environment.GetEnvironmentVariable("SHIELD_ENGINE_SAFE"), "1", StringComparison.OrdinalIgnoreCase);
        if (safeMode)
        {
            allPasses = allPasses.Where(p => p.Name != "name_obfuscation" && p.Name != "string_encryption").ToArray();
            if (verbose) Console.Error.WriteLine("[engine] SHIELD_ENGINE_SAFE=1: skipping name_obfuscation and string_encryption");
        }
        var safePro = string.Equals(Environment.GetEnvironmentVariable("SHIELD_ENGINE_SAFE_PRO"), "1", StringComparison.OrdinalIgnoreCase);
        if (safePro && ctx.Tier == "pro")
        {
            allPasses = allPasses.Where(p =>
                p.Name != "constant_encoding" && p.Name != "opaque_predicates" && p.Name != "dead_code_insertion").ToArray();
            if (verbose) Console.Error.WriteLine("[engine] SHIELD_ENGINE_SAFE_PRO=1: Pro tier using minimal pass set");
        }
        var noVirtualization = string.Equals(Environment.GetEnvironmentVariable("SHIELD_ENGINE_VIRTUALIZATION"), "0", StringComparison.OrdinalIgnoreCase);
        if (noVirtualization && (ctx.Tier == "basic" || ctx.Tier == "enterprise"))
        {
            allPasses = allPasses.Where(p => p.Name != "virtualization").ToArray();
            if (verbose) Console.Error.WriteLine("[engine] SHIELD_ENGINE_VIRTUALIZATION=0: skipping virtualization");
        }
        var passNames = ctx.OnlyPasses?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToHashSet();
        var passes = passNames != null && passNames.Count > 0
            ? allPasses.Where(p => passNames.Contains(p.Name)).ToArray()
            : allPasses;
        if (verbose && passNames != null && passNames.Count > 0)
            Console.Error.WriteLine($"[engine] Running only: {string.Join(", ", passes.Select(p => p.Name))}");

        foreach (var pass in passes)
        {
            var beforeSize = EstimateModuleILSize(module);
            var sw = Stopwatch.StartNew();
            try
            {
                if (verbose) Console.Error.WriteLine($"[engine] Running pass: {pass.Name}");
                pass.Run(ctx, module);
                sw.Stop();
                var afterSize = EstimateModuleILSize(module);
                EmitTelemetry(new
                {
                    type = "pass_metric",
                    pass = pass.Name,
                    duration_ms = sw.ElapsedMilliseconds,
                    success = true,
                    size_before = beforeSize,
                    size_after = afterSize,
                    size_delta = afterSize - beforeSize,
                });
                if (verbose) Console.Error.WriteLine($"[engine] Done: {pass.Name}");
            }
            catch (Exception ex)
            {
                sw.Stop();
                EmitTelemetry(new
                {
                    type = "pass_metric",
                    pass = pass.Name,
                    duration_ms = sw.ElapsedMilliseconds,
                    success = false,
                    error = ex.Message,
                    size_before = beforeSize,
                    size_after = EstimateModuleILSize(module),
                    size_delta = EstimateModuleILSize(module) - beforeSize,
                });
                throw new InvalidOperationException($"{pass.Name}: {ex.Message}", ex);
            }
        }

        // Fix "target instruction too far away for short branch" after obfuscation expands code
        foreach (var type in module.GetAllTypes())
        {
            foreach (var method in type.Methods)
            {
                var body = method.Body;
                if (body?.Instructions == null) continue;
                body.OptimizeMacros();
                body.OptimizeBranches(); // Expand short branches to long when target is too far
                body.SimplifyBranches();
            }
        }

        var writerOptions = new ModuleWriterOptions(module);
        writerOptions.MetadataOptions.Flags |= MetadataFlags.KeepOldMaxStack;
        module.Write(ctx.OutputPath, writerOptions);
        var outSize = new FileInfo(ctx.OutputPath).Length;
        EmitTelemetry(new
        {
            type = "pipeline_summary",
            output_path = ctx.OutputPath,
            output_size = outSize,
            pass_count = passes.Length,
            tier = ctx.Tier,
        });
    }

    private static long EstimateModuleILSize(ModuleDef module)
    {
        long total = 0;
        foreach (var type in module.GetAllTypes())
        {
            foreach (var method in type.Methods)
            {
                if (!method.HasBody || method.Body?.Instructions == null) continue;
                total += method.Body.Instructions.Count;
            }
        }
        return total;
    }

    private static void EmitTelemetry(object payload)
    {
        try
        {
            var json = JsonSerializer.Serialize(payload);
            Console.Error.WriteLine($"{TelemetryPrefix}{json}");
        }
        catch
        {
            // swallow telemetry errors to avoid affecting protection flow
        }
    }

    private static IProtectionPass[] GetPassesForTier(string tier) => tier switch
    {
        "minimal" => new IProtectionPass[]
        {
            new SymbolStrippingPass(),
            new MetadataCleanupPass(),
        },
        "basic" => new IProtectionPass[]
        {
            new SymbolStrippingPass(),
            new StringEncryptionPass(),
            new VirtualizationPass(),
            new MetadataCleanupPass(),
        },
        "pro" => new IProtectionPass[]
        {
            new SymbolStrippingPass(),
            new AntiILDASMPass(),
            new StringEncryptionPass(),
            new ResourceEncryptionPass(),
            new ReferenceProxyPass(),
            new DelegateProxyPass(),
            new ReflectionDispatchPass(),
            new TypeScramblePass(),
            new AssemblyEmbedPass(),
            new AntiDecompilerPass(),
            new InvalidMetadataPass(),
            new MethodBodyEncryptionPass(),
            new DynamicMethodGenerationPass(),
            new RuntimeSelfProtectionPass(),
            new LocalVariablePromotionPass(),
            new ConstantEncodingPass(),
            new IlMutationPass(),
            new OpaquePredicatesPass(),
            new MetadataCleanupPass(),
            // Set SHIELD_ENGINE_SAFE_PRO=1 to skip constant_encoding, opaque_predicates if app crashes
        },
        "enterprise" => new IProtectionPass[]
        {
            new SymbolStrippingPass(),
            new AntiILDASMPass(),
            new NameObfuscationPass(),
            new StringEncryptionPass(),
            new ResourceEncryptionPass(),
            new ReferenceProxyPass(),
            new DelegateProxyPass(),
            new ReflectionDispatchPass(),
            new TypeScramblePass(),
            new AssemblyEmbedPass(),
            new AntiDecompilerPass(),
            new InvalidMetadataPass(),
            new MethodBodyEncryptionPass(),
            new DynamicMethodGenerationPass(),
            new RuntimeSelfProtectionPass(),
            new LocalVariablePromotionPass(),
            new ConstantEncodingPass(),
            new IlMutationPass(),
            new OpaquePredicatesPass(),
            new AntiDebugPass(),
            new AntiTamperPass(),
            new ControlFlowFlatteningPass(),
            new DeadCodeInsertionPass(),
            new VirtualizationPass(),
            new MetadataCleanupPass(),
        },
        _ => throw new ArgumentException($"Unknown tier: {tier}. Use: minimal, basic, pro, enterprise"),
    };

    private static RenameMode ResolveRenameMode(string? optionValue, string? envValue)
    {
        var raw = string.IsNullOrWhiteSpace(envValue) ? optionValue : envValue;
        if (string.IsNullOrWhiteSpace(raw))
            return RenameMode.Random;
        return raw.Trim().ToLowerInvariant() switch
        {
            "random" => RenameMode.Random,
            "sequential" => RenameMode.Sequential,
            "unicode" => RenameMode.Unicode,
            "unprintable" => RenameMode.Unprintable,
            _ => RenameMode.Random,
        };
    }
}

public record EngineOptions
{
    public bool Deterministic { get; init; }
    public string[]? Protections { get; init; }
    public bool PolymorphicMode { get; init; } // High-variance transform templates for each build
    public string? RenameMode { get; init; } // random | sequential | unicode | unprintable
    public bool AllowUnsafeRename { get; init; } // required for unprintable mode
    public bool EncryptResources { get; init; } // false by default, opt-in via options/env
    public bool ReferenceProxy { get; init; } // false by default, opt-in via options/env
    public bool IlMutation { get; init; } // false by default, opt-in via options/env
    public bool DelegateProxy { get; init; } // false by default, opt-in via options/env
    public bool ReflectionDispatch { get; init; } // false by default, opt-in via options/env
    public bool TypeScramble { get; init; } // false by default, opt-in via options/env
    public bool AssemblyEmbed { get; init; } // false by default, opt-in via options/env
    public bool AntiDecompiler { get; init; } // false by default, opt-in via options/env
    public bool InvalidMetadata { get; init; } // false by default, opt-in via options/env
    public bool MethodBodyEncryption { get; init; } // false by default, opt-in via options/env
    public bool DynamicMethodGen { get; init; } // false by default, opt-in via options/env
    public bool AntiDecompilerAggressive { get; init; } // false by default, opt-in via options/env
    public bool RuntimeRasp { get; init; } // false by default, opt-in via options/env (enterprise default behavior in pass)
    public bool LocalVariablePromotion { get; init; } // false by default, opt-in via options/env
}

public class PipelineContext
{
    public string InputPath { get; }
    public string OutputPath { get; }
    public string Tier { get; }
    public EngineOptions Options { get; }
    public Random Random { get; }
    public string? OnlyPasses { get; init; } // Comma-separated pass names for debugging (null = run all)
    public bool LowEntropy { get; }    // When true: deterministic per-string/per-constant derivation to reduce output entropy
    public bool PolymorphicMode { get; } // Enables extra randomization and template diversity
    public RenameMode RenameMode { get; }
    public bool AllowUnsafeRename { get; }
    public bool EnableResourceEncryption { get; }
    public bool EnableReferenceProxy { get; }
    public bool EnableIlMutation { get; }
    public bool EnableDelegateProxy { get; }
    public bool EnableReflectionDispatch { get; }
    public bool EnableTypeScramble { get; }
    public bool EnableAssemblyEmbed { get; }
    public bool EnableAntiDecompiler { get; }
    public bool EnableInvalidMetadata { get; }
    public bool EnableMethodBodyEncryption { get; }
    public bool EnableDynamicMethodGen { get; }
    public bool EnableAntiDecompilerAggressive { get; }
    public bool EnableRuntimeRasp { get; }
    public bool EnableLocalVarPromotion { get; }

    public PipelineContext(
        string inputPath,
        string outputPath,
        string tier,
        EngineOptions options,
        bool lowEntropy = false,
        bool polymorphicMode = false,
        RenameMode renameMode = RenameMode.Random,
        bool allowUnsafeRename = false,
        bool enableResourceEncryption = false,
        bool enableReferenceProxy = false,
        bool enableIlMutation = false,
        bool enableDelegateProxy = false,
        bool enableReflectionDispatch = false,
        bool enableTypeScramble = false,
        bool enableAssemblyEmbed = false,
        bool enableAntiDecompiler = false,
        bool enableInvalidMetadata = false,
        bool enableMethodBodyEncryption = false,
        bool enableDynamicMethodGen = false,
        bool enableAntiDecompilerAggressive = false,
        bool enableRuntimeRasp = false,
        bool enableLocalVarPromotion = false)
    {
        InputPath = inputPath;
        OutputPath = outputPath;
        Tier = tier;
        Options = options;
        LowEntropy = lowEntropy;
        PolymorphicMode = polymorphicMode && !lowEntropy;
        RenameMode = renameMode;
        AllowUnsafeRename = allowUnsafeRename;
        EnableResourceEncryption = enableResourceEncryption;
        EnableReferenceProxy = enableReferenceProxy;
        EnableIlMutation = enableIlMutation;
        EnableDelegateProxy = enableDelegateProxy;
        EnableReflectionDispatch = enableReflectionDispatch;
        EnableTypeScramble = enableTypeScramble;
        EnableAssemblyEmbed = enableAssemblyEmbed;
        EnableAntiDecompiler = enableAntiDecompiler;
        EnableInvalidMetadata = enableInvalidMetadata;
        EnableMethodBodyEncryption = enableMethodBodyEncryption;
        EnableDynamicMethodGen = enableDynamicMethodGen;
        EnableAntiDecompilerAggressive = enableAntiDecompilerAggressive;
        EnableRuntimeRasp = enableRuntimeRasp;
        EnableLocalVarPromotion = enableLocalVarPromotion;
        Random = options.Deterministic || lowEntropy
            ? new Random(42)
            : new Random(unchecked((int)((uint)Guid.NewGuid().GetHashCode() ^ (uint)Environment.TickCount64 ^ (uint)Environment.ProcessId))); // Multiple entropy sources so each run differs when LowEntropy=false
    }
}

public enum RenameMode
{
    Random,
    Sequential,
    Unicode,
    Unprintable,
}
