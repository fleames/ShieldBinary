package com.shieldbinary.jvm.passes;

import com.shieldbinary.jvm.PipelineContext;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassWriter;

import java.util.Map;

public class DebugInfoStripPass implements IProtectionPass {
    @Override
    public String getName() { return "debug_info_strip"; }

    @Override
    public void run(PipelineContext ctx) {
        Map<String, byte[]> classes = ctx.getClasses();
        for (Map.Entry<String, byte[]> entry : classes.entrySet()) {
            ClassReader cr = new ClassReader(entry.getValue());
            ClassWriter cw = new ClassWriter(0);
            // SKIP_DEBUG drops LineNumberTable, LocalVariableTable, SourceFile, SourceDebugExtension
            cr.accept(cw, ClassReader.SKIP_DEBUG);
            entry.setValue(cw.toByteArray());
        }
    }
}
