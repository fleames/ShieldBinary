package com.shieldbinary.jvm;

import com.google.gson.Gson;
import com.shieldbinary.jvm.passes.*;

import java.io.File;
import java.io.FileInputStream;
import java.util.ArrayList;
import java.util.List;

public class Main {
    static final String TELEMETRY_PREFIX = "[engine-telemetry]";
    private static final Gson GSON = new Gson();

    public static void main(String[] args) {
        System.exit(run(args));
    }

    static int run(String[] args) {
        if (args.length < 3) {
            System.err.println("Usage: shieldbinary-jvm-engine <input.jar> <output.jar> <tier> [options-json]");
            System.err.println("Tiers: minimal | basic | pro | enterprise");
            return 1;
        }

        String inputPath  = args[0];
        String outputPath = args[1];
        String tier       = args[2].toLowerCase();

        if (!new File(inputPath).exists()) {
            System.err.println("Input file not found: " + inputPath);
            return 1;
        }
        if (!isJar(inputPath)) {
            System.err.println("Error: Not a valid JAR file. Only .jar files are supported.");
            return 1;
        }

        String optionsJson = args.length > 3 ? args[3] : "{}";
        try {
            EngineOptions options = GSON.fromJson(optionsJson, EngineOptions.class);
            if (options == null) options = new EngineOptions();
            boolean verbose = "1".equals(System.getenv("SHIELD_JVM_VERBOSE"));

            PipelineContext ctx = new PipelineContext(inputPath, outputPath, tier, options, verbose);
            List<IProtectionPass> passes = getPassesForTier(tier);

            long t0 = System.currentTimeMillis();
            new JarProcessor().process(ctx, passes);
            long elapsed = System.currentTimeMillis() - t0;

            long outSize = new File(outputPath).length();
            emitTelemetry("{\"type\":\"pipeline_summary\",\"tier\":\"" + tier
                    + "\",\"pass_count\":" + passes.size()
                    + ",\"duration_ms\":" + elapsed
                    + ",\"output_size\":" + outSize + "}");
            return 0;
        } catch (Exception ex) {
            System.err.println("Error: " + ex.getMessage());
            if ("1".equals(System.getenv("SHIELD_JVM_VERBOSE"))) {
                ex.printStackTrace(System.err);
            }
            return 1;
        }
    }

    static boolean isJar(String path) {
        try (FileInputStream fis = new FileInputStream(path)) {
            byte[] magic = new byte[4];
            return fis.read(magic) == 4
                    && magic[0] == 0x50 && magic[1] == 0x4B
                    && magic[2] == 0x03 && magic[3] == 0x04;
        } catch (Exception e) {
            return false;
        }
    }

    static List<IProtectionPass> getPassesForTier(String tier) {
        List<IProtectionPass> passes = new ArrayList<>();
        passes.add(new DebugInfoStripPass());
        switch (tier) {
            case "basic" -> passes.add(new StringEncryptionPass());
            case "pro" -> {
                passes.add(new StringEncryptionPass());
                passes.add(new ControlFlowObfuscationPass());
                passes.add(new AntiDecompilerPass());
            }
            case "enterprise" -> {
                passes.add(new StringEncryptionPass());
                passes.add(new NameObfuscationPass());
                passes.add(new ControlFlowObfuscationPass());
                passes.add(new AntiDecompilerPass());
            }
            default -> { /* minimal: debug strip only */ }
        }
        return passes;
    }

    static void emitTelemetry(String json) {
        System.err.println(TELEMETRY_PREFIX + json);
    }
}
