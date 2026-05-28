package com.shieldbinary.jvm.passes;

import com.shieldbinary.jvm.PipelineContext;
import org.objectweb.asm.*;

import java.util.Map;

public class StringEncryptionPass implements IProtectionPass {
    static final String DECRYPTOR_CLASS = "__Sb";
    static final String DECRYPT_DESC = "(Ljava/lang/String;I)Ljava/lang/String;";

    @Override
    public String getName() { return "string_encryption"; }

    @Override
    public void run(PipelineContext ctx) throws Exception {
        Map<String, byte[]> classes = ctx.getClasses();
        for (Map.Entry<String, byte[]> entry : classes.entrySet()) {
            if (entry.getKey().startsWith("__")) continue;
            ClassReader cr = new ClassReader(entry.getValue());
            ClassWriter cw = new ClassWriter(ClassWriter.COMPUTE_MAXS) {
                @Override
                protected String getCommonSuperclass(String t1, String t2) {
                    return "java/lang/Object";
                }
            };
            cr.accept(new StringEncryptClassVisitor(cw, ctx), 0);
            entry.setValue(cw.toByteArray());
        }
        ctx.getInjectedClasses().put(DECRYPTOR_CLASS + ".class", buildDecryptorClass());
    }

    private static class StringEncryptClassVisitor extends ClassVisitor {
        private final PipelineContext ctx;

        StringEncryptClassVisitor(ClassVisitor cv, PipelineContext ctx) {
            super(Opcodes.ASM9, cv);
            this.ctx = ctx;
        }

        @Override
        public MethodVisitor visitMethod(int access, String name, String desc,
                                         String sig, String[] ex) {
            MethodVisitor mv = super.visitMethod(access, name, desc, sig, ex);
            return new MethodVisitor(Opcodes.ASM9, mv) {
                @Override
                public void visitLdcInsn(Object cst) {
                    if (cst instanceof String s && !s.isEmpty()) {
                        int key = ctx.getRandom().nextInt(254) + 1; // 1–254
                        String enc = xorString(s, key);
                        mv.visitLdcInsn(enc);
                        mv.visitIntInsn(Opcodes.SIPUSH, key);
                        mv.visitMethodInsn(Opcodes.INVOKESTATIC, DECRYPTOR_CLASS, "dec",
                                DECRYPT_DESC, false);
                    } else {
                        super.visitLdcInsn(cst);
                    }
                }
            };
        }
    }

    static String xorString(String s, int key) {
        char[] chars = s.toCharArray();
        for (int i = 0; i < chars.length; i++) chars[i] = (char) (chars[i] ^ key);
        return new String(chars);
    }

    // Generate the __Sb helper class containing the string decryptor.
    static byte[] buildDecryptorClass() {
        ClassWriter cw = new ClassWriter(ClassWriter.COMPUTE_FRAMES) {
            @Override
            protected String getCommonSuperclass(String t1, String t2) {
                return "java/lang/Object";
            }
        };
        cw.visit(Opcodes.V17,
                Opcodes.ACC_PUBLIC | Opcodes.ACC_FINAL | Opcodes.ACC_SYNTHETIC,
                DECRYPTOR_CLASS, null, "java/lang/Object", null);

        // static String dec(String enc, int key)
        MethodVisitor mv = cw.visitMethod(
                Opcodes.ACC_PUBLIC | Opcodes.ACC_STATIC | Opcodes.ACC_SYNTHETIC,
                "dec", DECRYPT_DESC, null, null);
        mv.visitCode();

        // char[] buf = enc.toCharArray()
        mv.visitVarInsn(Opcodes.ALOAD, 0);
        mv.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String",
                "toCharArray", "()[C", false);
        mv.visitVarInsn(Opcodes.ASTORE, 2);

        // for (int i = 0; i < buf.length; i++) buf[i] = (char)(buf[i] ^ key)
        mv.visitInsn(Opcodes.ICONST_0);
        mv.visitVarInsn(Opcodes.ISTORE, 3);

        Label loopStart = new Label();
        Label loopEnd   = new Label();

        mv.visitLabel(loopStart);
        mv.visitVarInsn(Opcodes.ILOAD, 3);
        mv.visitVarInsn(Opcodes.ALOAD, 2);
        mv.visitInsn(Opcodes.ARRAYLENGTH);
        mv.visitJumpInsn(Opcodes.IF_ICMPGE, loopEnd);

        // buf[i] = (char)(buf[i] ^ key)
        mv.visitVarInsn(Opcodes.ALOAD, 2);   // buf  (store target)
        mv.visitVarInsn(Opcodes.ILOAD, 3);   // i    (store index)
        mv.visitVarInsn(Opcodes.ALOAD, 2);   // buf  (load source)
        mv.visitVarInsn(Opcodes.ILOAD, 3);   // i    (load index)
        mv.visitInsn(Opcodes.CALOAD);         // buf[i]
        mv.visitVarInsn(Opcodes.ILOAD, 1);   // key
        mv.visitInsn(Opcodes.IXOR);
        mv.visitInsn(Opcodes.I2C);
        mv.visitInsn(Opcodes.CASTORE);

        mv.visitIincInsn(3, 1);
        mv.visitJumpInsn(Opcodes.GOTO, loopStart);
        mv.visitLabel(loopEnd);

        // return new String(buf)
        mv.visitTypeInsn(Opcodes.NEW, "java/lang/String");
        mv.visitInsn(Opcodes.DUP);
        mv.visitVarInsn(Opcodes.ALOAD, 2);
        mv.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/lang/String",
                "<init>", "([C)V", false);
        mv.visitInsn(Opcodes.ARETURN);

        mv.visitMaxs(0, 0); // COMPUTE_FRAMES handles this
        mv.visitEnd();
        cw.visitEnd();
        return cw.toByteArray();
    }
}
