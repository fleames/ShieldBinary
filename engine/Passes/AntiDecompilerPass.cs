using dnlib.DotNet;
using dnlib.DotNet.Emit;
using ShieldBinary.Engine;

namespace ShieldBinary.Engine.Passes;

/// <summary>
/// Inserts uncommon but valid IL patterns to reduce decompiler readability.
/// Kept conservative and opt-in for compatibility.
/// </summary>
public sealed class AntiDecompilerPass : IProtectionPass
{
    public string Name => "anti_decompiler";

    public void Run(PipelineContext ctx, ModuleDef module)
    {
        if (!ctx.EnableAntiDecompiler)
            return;

        foreach (var type in module.GetAllTypes())
        {
            foreach (var method in type.Methods)
            {
                if (!method.HasBody || method.Body.Instructions.Count < 4)
                    continue;
                if (method.IsConstructor || method.IsStaticConstructor)
                    continue;
                if (method.Body.HasExceptionHandlers)
                    continue;
                if (ctx.Random.Next(100) > 40)
                    continue;
                InjectOpaqueJunk(method.Body);
                if (ctx.EnableAntiDecompilerAggressive && method.Body.Instructions.Count > 8 && ctx.Random.Next(100) <= 30)
                    InjectSwitchNoise(method.Body, ctx);
            }
        }
    }

    private static void InjectOpaqueJunk(CilBody body)
    {
        var firstReal = body.Instructions[0];
        var lReal = Instruction.Create(OpCodes.Nop);
        var lDead = Instruction.Create(OpCodes.Nop);

        // Pattern:
        // ldc.i4.0
        // brtrue.s lDead
        // br.s lReal
        // lDead: ldnull; pop; br.s lReal
        // lReal: <original first instruction...>
        body.Instructions.Insert(0, Instruction.Create(OpCodes.Ldc_I4_0));
        body.Instructions.Insert(1, Instruction.Create(OpCodes.Brtrue_S, lDead));
        body.Instructions.Insert(2, Instruction.Create(OpCodes.Br_S, lReal));
        body.Instructions.Insert(3, lDead);
        body.Instructions.Insert(4, Instruction.Create(OpCodes.Ldnull));
        body.Instructions.Insert(5, Instruction.Create(OpCodes.Pop));
        body.Instructions.Insert(6, Instruction.Create(OpCodes.Br_S, lReal));
        body.Instructions.Insert(7, lReal);
        body.Instructions.Insert(8, firstReal);
        body.Instructions.RemoveAt(9);
    }

    private static void InjectSwitchNoise(CilBody body, PipelineContext ctx)
    {
        var lCase0 = Instruction.Create(OpCodes.Nop);
        var lCase1 = Instruction.Create(OpCodes.Nop);
        var lEnd = Instruction.Create(OpCodes.Nop);
        var seed = ctx.LowEntropy ? 0 : ctx.Random.Next(0, 2);

        // Adds an opaque switch sequence with dead branches that return to normal flow.
        body.Instructions.Insert(0, Instruction.Create(OpCodes.Ldc_I4, seed));
        body.Instructions.Insert(1, Instruction.Create(OpCodes.Switch, new[] { lCase0, lCase1 }));
        body.Instructions.Insert(2, Instruction.Create(OpCodes.Br_S, lEnd));
        body.Instructions.Insert(3, lCase0);
        body.Instructions.Insert(4, Instruction.Create(OpCodes.Ldc_I4_0));
        body.Instructions.Insert(5, Instruction.Create(OpCodes.Pop));
        body.Instructions.Insert(6, Instruction.Create(OpCodes.Br_S, lEnd));
        body.Instructions.Insert(7, lCase1);
        body.Instructions.Insert(8, Instruction.Create(OpCodes.Ldnull));
        body.Instructions.Insert(9, Instruction.Create(OpCodes.Pop));
        body.Instructions.Insert(10, Instruction.Create(OpCodes.Br_S, lEnd));
        body.Instructions.Insert(11, lEnd);
    }
}
