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
                InsertDeadCode(method, ctx);
            }
        }
    }

    private static void InsertDeadCode(MethodDef method, PipelineContext ctx)
    {
        var body = method.Body!;
        var count = ctx.PolymorphicMode ? ctx.Random.Next(2, 7) : ctx.Random.Next(1, 4);
        for (var n = 0; n < count; n++)
        {
            var pos = ctx.Random.Next(1, Math.Max(1, body.Instructions.Count - 1));
            var junk = GetJunkInstructions(ctx, method);
            foreach (var ins in junk.AsEnumerable().Reverse())
            {
                body.Instructions.Insert(pos, ins);
            }
        }
    }

    private static List<Instruction> GetJunkInstructions(PipelineContext ctx, MethodDef method)
    {
        var typedLocal = method.Body!.Variables.FirstOrDefault(v =>
            v.Type.ElementType is ElementType.I4 or ElementType.R8 or ElementType.String);
        var choice = ctx.Random.Next(ctx.PolymorphicMode ? 6 : 4);
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
            2 when ctx.PolymorphicMode => new List<Instruction>
            {
                Instruction.Create(OpCodes.Ldc_I4, ctx.Random.Next(17, 200)),
                Instruction.Create(OpCodes.Ldc_I4, ctx.Random.Next(1, 17)),
                Instruction.Create(OpCodes.Xor),
                Instruction.Create(OpCodes.Pop),
            },
            3 when ctx.PolymorphicMode => new List<Instruction>
            {
                Instruction.Create(OpCodes.Ldc_I4, ctx.Random.Next(9, 99)),
                Instruction.Create(OpCodes.Ldc_I4_1),
                Instruction.Create(OpCodes.Add),
                Instruction.Create(OpCodes.Pop),
                Instruction.Create(OpCodes.Nop),
            },
            4 when typedLocal != null && typedLocal.Type.ElementType == ElementType.I4 => new List<Instruction>
            {
                Instruction.Create(OpCodes.Ldc_I4, ctx.Random.Next(1, 500)),
                Instruction.Create(OpCodes.Stloc, typedLocal),
                Instruction.Create(OpCodes.Ldloc, typedLocal),
                Instruction.Create(OpCodes.Pop),
            },
            5 when typedLocal != null && typedLocal.Type.ElementType == ElementType.String => new List<Instruction>
            {
                Instruction.Create(OpCodes.Ldstr, "x" + ctx.Random.Next(1000, 9999)),
                Instruction.Create(OpCodes.Stloc, typedLocal),
                Instruction.Create(OpCodes.Ldloc, typedLocal),
                Instruction.Create(OpCodes.Pop),
            },
            _ => new List<Instruction>
            {
                Instruction.Create(OpCodes.Ldc_I4, ctx.Random.Next(100)),
                Instruction.Create(OpCodes.Pop),
            },
        };
    }
}
