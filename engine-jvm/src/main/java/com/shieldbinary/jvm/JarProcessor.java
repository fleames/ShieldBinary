package com.shieldbinary.jvm;

import com.shieldbinary.jvm.passes.IProtectionPass;

import java.io.*;
import java.util.*;
import java.util.jar.*;

public class JarProcessor {

    public void process(PipelineContext ctx, List<IProtectionPass> passes) throws Exception {
        load(ctx);
        for (IProtectionPass pass : passes) {
            long t0 = System.currentTimeMillis();
            ctx.log("Running pass: " + pass.getName());
            try {
                pass.run(ctx);
                long ms = System.currentTimeMillis() - t0;
                Main.emitTelemetry("{\"type\":\"pass_metric\",\"pass\":\"" + pass.getName()
                        + "\",\"duration_ms\":" + ms + ",\"success\":true}");
            } catch (Exception ex) {
                long ms = System.currentTimeMillis() - t0;
                Main.emitTelemetry("{\"type\":\"pass_metric\",\"pass\":\"" + pass.getName()
                        + "\",\"duration_ms\":" + ms + ",\"success\":false"
                        + ",\"error\":\"" + ex.getMessage().replace("\"", "'") + "\"}");
                throw new RuntimeException(pass.getName() + ": " + ex.getMessage(), ex);
            }
            ctx.log("Done: " + pass.getName());
        }
        write(ctx);
    }

    private void load(PipelineContext ctx) throws IOException {
        Map<String, byte[]> classes   = new LinkedHashMap<>();
        Map<String, byte[]> resources = new LinkedHashMap<>();
        String manifest = null;

        try (JarInputStream jin = new JarInputStream(new FileInputStream(ctx.getInputPath()))) {
            // Manifest is available via JarInputStream.getManifest()
            Manifest mf = jin.getManifest();
            if (mf != null) {
                StringWriter sw = new StringWriter();
                sw.write("Manifest-Version: 1.0\n");
                for (Map.Entry<Object, Object> e : mf.getMainAttributes().entrySet()) {
                    sw.write(e.getKey() + ": " + e.getValue() + "\n");
                }
                manifest = sw.toString();
            }

            JarEntry entry;
            while ((entry = jin.getNextJarEntry()) != null) {
                String name = entry.getName();
                byte[] bytes = jin.readAllBytes();
                if (name.equals("META-INF/MANIFEST.MF")) {
                    // already captured above, skip
                } else if (name.endsWith(".class") && !name.startsWith("META-INF/")) {
                    classes.put(name, bytes);
                } else {
                    resources.put(name, bytes);
                }
            }
        }

        ctx.setClasses(classes);
        ctx.setResources(resources);
        ctx.setManifestContent(manifest);
        ctx.log("Loaded " + classes.size() + " classes, " + resources.size() + " resources");
    }

    private void write(PipelineContext ctx) throws IOException {
        Manifest manifest = buildManifest(ctx);
        try (JarOutputStream out = new JarOutputStream(
                new FileOutputStream(ctx.getOutputPath()), manifest)) {

            for (Map.Entry<String, byte[]> e : ctx.getClasses().entrySet()) {
                out.putNextEntry(new JarEntry(e.getKey()));
                out.write(e.getValue());
                out.closeEntry();
            }
            for (Map.Entry<String, byte[]> e : ctx.getInjectedClasses().entrySet()) {
                out.putNextEntry(new JarEntry(e.getKey()));
                out.write(e.getValue());
                out.closeEntry();
            }
            for (Map.Entry<String, byte[]> e : ctx.getResources().entrySet()) {
                if (e.getKey().equals("META-INF/MANIFEST.MF")) continue;
                out.putNextEntry(new JarEntry(e.getKey()));
                out.write(e.getValue());
                out.closeEntry();
            }
        }
    }

    private Manifest buildManifest(PipelineContext ctx) {
        Manifest mf = new Manifest();
        mf.getMainAttributes().put(Attributes.Name.MANIFEST_VERSION, "1.0");

        String raw = ctx.getManifestContent();
        if (raw == null) return mf;

        for (String line : raw.split("\\r?\\n")) {
            line = line.trim();
            if (line.isEmpty() || line.startsWith("Manifest-Version")) continue;
            int colon = line.indexOf(':');
            if (colon < 0) continue;
            String key = line.substring(0, colon).trim();
            String val = line.substring(colon + 1).trim();
            if (key.equals("Main-Class")) {
                // Apply class rename mapping if NameObfuscationPass ran
                if (ctx.getClassMapping() != null) {
                    String internalMain = val.replace('.', '/');
                    String mapped = ctx.getClassMapping().getOrDefault(internalMain, internalMain);
                    val = mapped.replace('/', '.');
                }
                mf.getMainAttributes().put(Attributes.Name.MAIN_CLASS, val);
            } else {
                try {
                    mf.getMainAttributes().put(new Attributes.Name(key), val);
                } catch (IllegalArgumentException ignored) {}
            }
        }
        return mf;
    }
}
