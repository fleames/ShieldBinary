package com.shieldbinary.jvm.passes;

import com.shieldbinary.jvm.PipelineContext;
import org.objectweb.asm.*;
import org.objectweb.asm.tree.*;

import java.util.Map;
import java.util.Random;

public class ControlFlowObfuscationPass implements IProtectionPass {
    @Override
    public String getName() { return "control_flow_obfuscation"; }

    @Override
    public void run(PipelineContext ctx) {
        Random rnd = ctx.getRandom();
        Map<String, byte[]> classes = ctx.getClasses();

        for (Map.Entry<String, byte[]> entry : classes.entrySet()) {
            if (entry.getKey().startsWith("__")) continue;

            ClassNode cn = new ClassNode();
            new ClassReader(entry.getValue()).accept(cn, 0);

            boolean modified = false;
            for (MethodNode mn : cn.methods) {
                if ((mn.access & Opcodes.ACC_ABSTRACT) != 0) continue;
                if ((mn.access & Opcodes.ACC_NATIVE) != 0) continue;
                if (mn.instructions.size() < 3) continue;

                // Find first real (executable) instruction to insert before
                AbstractInsnNode insertBefore = findFirstReal(mn.instructions);
                if (insertBefore == null) continue;

                InsnList pred = buildOpaquePredicate(rnd);
                mn.instructions.insertBefore(insertBefore, pred);
                mn.maxStack = Math.max(mn.maxStack, 2);
                modified = true;
            }

            if (modified) {
                ClassWriter cw = new ClassWriter(ClassWriter.COMPUTE_MAXS) {
                    @Override
                    protected String getCommonSuperclass(String t1, String t2) {
                        return "java/lang/Object";
                    }
                };
                cn.accept(cw);
                entry.setValue(cw.toByteArray());
            }
        }
    }

    private static AbstractInsnNode findFirstReal(InsnList insns) {
        AbstractInsnNode node = insns.getFirst();
        while (node != null) {
            int type = node.getType();
            if (type != AbstractInsnNode.LABEL
                    && type != AbstractInsnNode.LINE
                    && type != AbstractInsnNode.FRAME) {
                return node;
            }
            node = node.getNext();
        }
        return null;
    }

    // Opaque predicate: always-true branch + dead block, 3 variants for variety
    private static InsnList buildOpaquePredicate(Random rnd) {
        InsnList list = new InsnList();
        LabelNode realStart = new LabelNode();

        switch (rnd.nextInt(3)) {
            case 0 -> {
                // 0 == 0 → always equal
                list.add(new InsnNode(Opcodes.ICONST_0));
                list.add(new InsnNode(Opcodes.ICONST_0));
                list.add(new JumpInsnNode(Opcodes.IF_ICMPEQ, realStart));
            }
            case 1 -> {
                // null == null → always equal (IFNULL on a null ref)
                list.add(new InsnNode(Opcodes.ACONST_NULL));
                list.add(new JumpInsnNode(Opcodes.IFNULL, realStart));
            }
            default -> {
                // -1 < 0 → always true (IFLT)
                list.add(new InsnNode(Opcodes.ICONST_M1));
                list.add(new JumpInsnNode(Opcodes.IFLT, realStart));
            }
        }

        // Dead block — never reached, confuses decompiler CFG reconstruction
        list.add(new InsnNode(Opcodes.ACONST_NULL));
        list.add(new InsnNode(Opcodes.ATHROW));
        list.add(realStart);
        return list;
    }
}
