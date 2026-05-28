package com.shieldbinary.jvm.passes;

import com.shieldbinary.jvm.NameGenerator;
import com.shieldbinary.jvm.PipelineContext;
import org.objectweb.asm.*;
import org.objectweb.asm.commons.ClassRemapper;
import org.objectweb.asm.commons.SimpleRemapper;

import java.util.*;

public class NameObfuscationPass implements IProtectionPass {
    @Override
    public String getName() { return "name_obfuscation"; }

    @Override
    public void run(PipelineContext ctx) {
        Map<String, byte[]> classes = ctx.getClasses();

        // Phase 1: determine which classes to skip
        String mainInternal = extractMainClass(ctx.getManifestContent()); // "com/example/Main"
        Set<String> skip = new HashSet<>();
        if (mainInternal != null) skip.add(mainInternal);

        for (Map.Entry<String, byte[]> e : classes.entrySet()) {
            String internalName = e.getKey().replace(".class", "");
            if (internalName.startsWith("__")) {
                skip.add(internalName);
                continue;
            }
            int access = new ClassReader(e.getValue()).getAccess();
            // Don't rename annotation types — their names are referenced by string at runtime
            if ((access & Opcodes.ACC_ANNOTATION) != 0) skip.add(internalName);
        }

        // Phase 2: build class → new-name mapping
        NameGenerator gen = new NameGenerator();
        Map<String, String> classMap = new LinkedHashMap<>();
        for (String entryKey : classes.keySet()) {
            String internalName = entryKey.replace(".class", "");
            if (!skip.contains(internalName)) {
                classMap.put(internalName, gen.next());
            }
        }
        ctx.setClassMapping(classMap);

        // Phase 3: apply mapping with ClassRemapper (handles descriptors, signatures, frames)
        SimpleRemapper remapper = new SimpleRemapper(classMap);
        Map<String, byte[]> newClasses = new LinkedHashMap<>();

        for (Map.Entry<String, byte[]> e : classes.entrySet()) {
            String internalName = e.getKey().replace(".class", "");
            ClassReader cr = new ClassReader(e.getValue());
            ClassWriter cw = new ClassWriter(ClassWriter.COMPUTE_MAXS) {
                protected String getCommonSuperclass(String t1, String t2) {
                    return "java/lang/Object";
                }
            };
            cr.accept(new ClassRemapper(cw, remapper), ClassReader.EXPAND_FRAMES);

            String newInternal = classMap.getOrDefault(internalName, internalName);
            newClasses.put(newInternal + ".class", cw.toByteArray());
        }

        ctx.setClasses(newClasses);
    }

    private String extractMainClass(String manifest) {
        if (manifest == null) return null;
        for (String line : manifest.split("\\r?\\n")) {
            if (line.startsWith("Main-Class:")) {
                return line.substring("Main-Class:".length()).trim().replace('.', '/');
            }
        }
        return null;
    }
}
