using dnlib.DotNet;
using dnlib.DotNet.Emit;
using ShieldBinary.Engine;

namespace ShieldBinary.Engine.Passes;

/// <summary>
/// Conservative IL mutation using equivalent substitutions.
/// Current strategy rewrites integer constants: ldc.i4 X -> ldc.i4 (X^K); ldc.i4 K; xor
/// </summary>
public sealed class IlMutationPass : IProtectionPass
{
    public string Name => "il_mutation";

    public void Run(PipelineContext ctx, ModuleDef module)
    {
        if (!ctx.EnableIlMutation)
            return;

        foreach (var type in module.GetAllTypes())
        {
            foreach (var method in type.Methods)
            {
                if (!method.HasBody || method.Body.Instructions.Count == 0)
                    continue;
                if (method.IsConstructor || method.IsStaticConstructor)
                    continue;

                MutateMethod(ctx, method.Body);
            }
        }
    }

    private static void MutateMethod(PipelineContext ctx, CilBody body)
    {
        var mutateChance = ctx.PolymorphicMode ? 80 : 35;
        for (var i = 0; i < body.Instructions.Count; i++)
        {
            var ins = body.Instructions[i];
            if (!TryGetLdcI4Value(ins, out var value))
                continue;
            if (Math.Abs(value) <= 1)
                continue; // keep tiny constants stable for compatibility/readability
            if (ctx.Random.Next(100) >= mutateChance)
                continue;

            var key = SelectKey(ctx, value);
            var masked = value ^ key;

            ins.OpCode = OpCodes.Ldc_I4;
            ins.Operand = masked;
            body.Instructions.Insert(i + 1, Instruction.Create(OpCodes.Ldc_I4, key));
            body.Instructions.Insert(i + 2, Instruction.Create(OpCodes.Xor));
            i += 2;
        }
    }

    private static int SelectKey(PipelineContext ctx, int value)
    {
        if (ctx.LowEntropy)
        {
            var k = (Math.Abs(value) % 251) + 3;
            return k;
        }
        return ctx.Random.Next(3, 255);
    }

    private static bool TryGetLdcI4Value(Instruction ins, out int value)
    {
        switch (ins.OpCode.Code)
        {
            case Code.Ldc_I4_M1: value = -1; return true;
            case Code.Ldc_I4_0: value = 0; return true;
            case Code.Ldc_I4_1: value = 1; return true;
            case Code.Ldc_I4_2: value = 2; return true;
            case Code.Ldc_I4_3: value = 3; return true;
            case Code.Ldc_I4_4: value = 4; return true;
            case Code.Ldc_I4_5: value = 5; return true;
            case Code.Ldc_I4_6: value = 6; return true;
            case Code.Ldc_I4_7: value = 7; return true;
            case Code.Ldc_I4_8: value = 8; return true;
            case Code.Ldc_I4_S:
                value = ins.Operand is sbyte sb ? sb : 0;
                return true;
            case Code.Ldc_I4:
                value = ins.Operand is int iv ? iv : 0;
                return true;
            default:
                value = 0;
                return false;
        }
    }
}
