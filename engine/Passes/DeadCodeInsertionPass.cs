using dnlib.DotNet;
using dnlib.DotNet.Emit;

namespace ShieldBinary.Engine.Passes;

public sealed class DeadCodeInsertionPass : IProtectionPass
{
    public string Name => "dead_code_insertion";

    public void Run(PipelineContext ctx, ModuleDef module)
    {
        foreach (var type in module.GetAllTypes())
        {
            foreach (var method in type.Methods)
            {
                if (!method.HasBody || method.Body.Instructions.Count < 2)
                    continue;
                if (CilBodyExtensions.HasExceptionHandlers(method.Body))
                    continue;
                InsertDeadCode(method.Body, ctx);
            }
        }
    }

    private static void InsertDeadCode(CilBody body, PipelineContext ctx)
    {
        var count = ctx.Random.Next(1, 4);
        for (var n = 0; n < count; n++)
        {
            var pos = ctx.Random.Next(1, Math.Max(1, body.Instructions.Count - 1));
            var junk = GetJunkInstructions(ctx);
            foreach (var ins in junk.AsEnumerable().Reverse())
            {
                body.Instructions.Insert(pos, ins);
            }
        }
    }

    private static List<Instruction> GetJunkInstructions(PipelineContext ctx)
    {
        var choice = ctx.Random.Next(3);
        return choice switch
        {
            0 => new List<Instruction>
            {
                Instruction.Create(OpCodes.Ldc_I4_0),
                Instruction.Create(OpCodes.Pop),
            },
            1 => new List<Instruction>
            {
                Instruction.Create(OpCodes.Nop),
                Instruction.Create(OpCodes.Nop),
            },
            _ => new List<Instruction>
            {
                Instruction.Create(OpCodes.Ldc_I4, ctx.Random.Next(100)),
                Instruction.Create(OpCodes.Pop),
            },
        };
    }
}
