package com.shieldbinary.jvm;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Random;

public class PipelineContext {
    private final String inputPath;
    private final String outputPath;
    private final String tier;
    private final EngineOptions options;
    private final boolean verbose;
    private final Random random;

    private Map<String, byte[]> classes = new LinkedHashMap<>();
    private Map<String, byte[]> resources = new LinkedHashMap<>();
    private String manifestContent;
    private Map<String, String> classMapping;
    private final Map<String, byte[]> injectedClasses = new LinkedHashMap<>();

    public PipelineContext(String inputPath, String outputPath, String tier,
                           EngineOptions options, boolean verbose) {
        this.inputPath = inputPath;
        this.outputPath = outputPath;
        this.tier = tier;
        this.options = options;
        this.verbose = verbose;
        this.random = options.deterministic ? new Random(42) : new Random();
    }

    public String getInputPath()  { return inputPath; }
    public String getOutputPath() { return outputPath; }
    public String getTier()       { return tier; }
    public EngineOptions getOptions() { return options; }
    public boolean isVerbose()    { return verbose; }
    public Random getRandom()     { return random; }

    public Map<String, byte[]> getClasses()            { return classes; }
    public void setClasses(Map<String, byte[]> c)      { this.classes = c; }

    public Map<String, byte[]> getResources()          { return resources; }
    public void setResources(Map<String, byte[]> r)    { this.resources = r; }

    public String getManifestContent()                 { return manifestContent; }
    public void setManifestContent(String m)           { this.manifestContent = m; }

    public Map<String, String> getClassMapping()       { return classMapping; }
    public void setClassMapping(Map<String, String> m) { this.classMapping = m; }

    public Map<String, byte[]> getInjectedClasses()   { return injectedClasses; }

    public void log(String msg) {
        if (verbose) System.err.println("[jvm-engine] " + msg);
    }
}
