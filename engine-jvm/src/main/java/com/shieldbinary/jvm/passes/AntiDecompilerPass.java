package com.shieldbinary.jvm.passes;

import com.shieldbinary.jvm.PipelineContext;
import org.objectweb.asm.*;

import java.util.Map;

public class AntiDecompilerPass implements IProtectionPass {
    @Override
    public String getName() { return "anti_decompiler"; }

    @Override
    public void run(PipelineContext ctx) {
        Map<String, byte[]> classes = ctx.getClasses();
        for (Map.Entry<String, byte[]> entry : classes.entrySet()) {
            if (entry.getKey().startsWith("__")) continue;
            ClassReader cr = new ClassReader(entry.getValue());
            ClassWriter cw = new ClassWriter(0) {
                @Override
                protected String getCommonSuperclass(String t1, String t2) {
                    return "java/lang/Object";
                }
            };
            cr.accept(new AntiDecompilerClassVisitor(cw), 0);
            entry.setValue(cw.toByteArray());
        }
    }

    private static class AntiDecompilerClassVisitor extends ClassVisitor {
        AntiDecompilerClassVisitor(ClassVisitor cv) {
            super(Opcodes.ASM9, cv);
        }

        @Override
        public MethodVisitor visitMethod(int access, String name, String descriptor,
                                         String signature, String[] exceptions) {
            // Mark non-special synthetic methods — many decompilers render these as
            // anonymous lambdas or skip them, obscuring class structure
            if (!name.equals("<init>") && !name.equals("<clinit>") && !name.equals("main")) {
                access |= Opcodes.ACC_SYNTHETIC;
            }
            return super.visitMethod(access, name, descriptor, signature, exceptions);
        }
    }
}
