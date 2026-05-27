using dnlib.DotNet;
using dnlib.DotNet.Emit;

namespace ShieldBinary.Engine.Passes;

public sealed class ControlFlowFlatteningPass : IProtectionPass
{
    public string Name => "control_flow_flattening";

    public void Run(PipelineContext ctx, ModuleDef module)
    {
        foreach (var type in module.GetAllTypes())
        {
            foreach (var method in type.Methods)
            {
                if (!method.HasBody || method.Body.Instructions.Count < 5)
                    continue;
                if (method.IsConstructor || method.IsStaticConstructor)
                    continue;
                if (CilBodyExtensions.HasExceptionHandlers(method.Body))
                    continue; // Flattening breaks exception handler boundaries
                if (HasConditionalBranches(method.Body))
                    continue; // Flattening drops Beq/Bne_Un - would corrupt logic
                try
                {
                    FlattenMethod(ctx, method);
                }
                catch
                {
                    // Skip methods that fail
                }
            }
        }
    }

    private static bool HasConditionalBranches(CilBody body)
    {
        foreach (var ins in body.Instructions)
        {
            var op = ins.OpCode;
            if (op == OpCodes.Beq || op == OpCodes.Beq_S || op == OpCodes.Bne_Un || op == OpCodes.Bne_Un_S ||
                op == OpCodes.Bge || op == OpCodes.Bge_S || op == OpCodes.Bge_Un || op == OpCodes.Bge_Un_S ||
                op == OpCodes.Blt || op == OpCodes.Blt_S || op == OpCodes.Blt_Un || op == OpCodes.Blt_Un_S ||
                op == OpCodes.Bgt || op == OpCodes.Bgt_S || op == OpCodes.Bgt_Un || op == OpCodes.Bgt_Un_S ||
                op == OpCodes.Ble || op == OpCodes.Ble_S || op == OpCodes.Ble_Un || op == OpCodes.Ble_Un_S ||
                op == OpCodes.Brtrue || op == OpCodes.Brtrue_S || op == OpCodes.Brfalse || op == OpCodes.Brfalse_S ||
                op == OpCodes.Switch)
                return true;
        }
        return false;
    }

    private static void FlattenMethod(PipelineContext ctx, MethodDef method)
    {
        var body = method.Body;
        var instructions = body.Instructions.ToList();
        if (instructions.Count < 3)
            return;

        var (blocks, instrToBlock) = SplitIntoBlocks(instructions);
        if (blocks.Count < 2)
            return;

        var stateVar = new Local(method.Module.CorLibTypes.Int32);
        body.Variables.Add(stateVar);

        var dispatcher = Instruction.Create(OpCodes.Nop);
        var switchIns = Instruction.Create(OpCodes.Switch, Array.Empty<Instruction>());

        var targets = new List<Instruction>();
        var newIns = new List<Instruction>();

        if (ctx.PolymorphicMode)
        {
            var mask = ctx.Random.Next(1, int.MaxValue);
            newIns.Add(Instruction.Create(OpCodes.Ldc_I4, mask));
            newIns.Add(Instruction.Create(OpCodes.Ldc_I4, mask));
            newIns.Add(Instruction.Create(OpCodes.Xor));
            newIns.Add(Instruction.Create(OpCodes.Stloc, stateVar));
        }
        newIns.Add(Instruction.Create(OpCodes.Br, dispatcher));

        for (var i = 0; i < blocks.Count; i++)
        {
            var block = blocks[i];
            targets.Add(block[0]);

            // Determine what state to set at end of this block.
            // If the last instruction is an unconditional Br with a known target block, use that.
            var lastIns = block[block.Count - 1];
            var isTerminalBr = (lastIns.OpCode == OpCodes.Br || lastIns.OpCode == OpCodes.Br_S)
                               && lastIns.Operand is Instruction brTarget
                               && instrToBlock.TryGetValue(brTarget, out _);
            var nextState = i + 1;
            if (isTerminalBr && instrToBlock.TryGetValue((Instruction)lastIns.Operand, out var brIdx))
                nextState = brIdx;

            foreach (var ins in block)
            {
                // Drop unconditional branches — the state machine replaces them.
                if (ins.OpCode == OpCodes.Br || ins.OpCode == OpCodes.Br_S)
                    continue;
                newIns.Add(ins);
            }

            // Non-final blocks: set next state and loop back to dispatcher.
            if (i < blocks.Count - 1)
            {
                newIns.Add(Instruction.Create(OpCodes.Ldc_I4, nextState));
                newIns.Add(Instruction.Create(OpCodes.Stloc, stateVar));
                newIns.Add(Instruction.Create(OpCodes.Br, dispatcher));
            }
        }

        newIns.Add(Instruction.Create(OpCodes.Ret));
        newIns.Insert(0, dispatcher);
        newIns.Insert(1, Instruction.Create(OpCodes.Ldloc, stateVar));
        newIns.Insert(2, switchIns);
        switchIns.Operand = targets.ToArray();

        body.Instructions.Clear();
        foreach (var ins in newIns)
            body.Instructions.Add(ins);
    }

    private static (List<List<Instruction>> blocks, Dictionary<Instruction, int> instrToBlock) SplitIntoBlocks(List<Instruction> instructions)
    {
        var blocks = new List<List<Instruction>>();
        var instrToBlock = new Dictionary<Instruction, int>(ReferenceEqualityComparer.Instance);
        var current = new List<Instruction>();
        foreach (var ins in instructions)
        {
            if (ins.OpCode == OpCodes.Nop && current.Count == 0)
                continue;
            current.Add(ins);
            if (ins.OpCode == OpCodes.Br || ins.OpCode == OpCodes.Br_S ||
                ins.OpCode == OpCodes.Ret || ins.OpCode == OpCodes.Throw)
            {
                blocks.Add(current);
                current = new List<Instruction>();
            }
        }
        if (current.Count > 0)
            blocks.Add(current);
        // Map every first instruction in each block to that block's index.
        for (var i = 0; i < blocks.Count; i++)
            instrToBlock[blocks[i][0]] = i;
        return (blocks, instrToBlock);
    }
}
