using dnlib.DotNet;
using dnlib.DotNet.Emit;

namespace ShieldBinary.Engine.Passes;

/// <summary>Inserts opaque predicates (always-true conditionals with unreachable fake branch) to confuse decompilers.</summary>
public sealed class OpaquePredicatesPass : IProtectionPass
{
    public string Name => "opaque_predicates";

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
                if (method == module.EntryPoint)
                    continue;
                if (CilBodyExtensions.HasExceptionHandlers(method.Body))
                    continue;
                try
                {
                    InsertPredicates(method.Body, ctx);
                }
                catch
                {
                    // Skip on failure
                }
            }
        }
    }

    private static void InsertPredicates(CilBody body, PipelineContext ctx)
    {
        var count = ctx.PolymorphicMode ? ctx.Random.Next(2, 5) : ctx.Random.Next(1, 3);
        var protectedSet = CilBodyExtensions.GetProtectedInstructions(body);

        for (var n = 0; n < count; n++)
        {
            // Find safe insert position (not at branch targets)
            var maxIdx = Math.Max(1, body.Instructions.Count - 2);
            var idx = ctx.Random.Next(1, maxIdx);
            if (protectedSet.Contains(body.Instructions[idx]))
                continue;

            var odd = 3 + ctx.Random.Next(10) * 2;
            var realNext = body.Instructions[idx];

            var dummyBlock = new List<Instruction>
            {
                Instruction.Create(OpCodes.Ldc_I4, ctx.Random.Next(100)),
                Instruction.Create(OpCodes.Pop),
                Instruction.Create(OpCodes.Br, realNext),
            };

            var predicate = BuildPredicate(ctx, odd, dummyBlock[0]);

            foreach (var ins in predicate.AsEnumerable().Reverse())
                body.Instructions.Insert(idx, ins);
            foreach (var ins in dummyBlock.AsEnumerable().Reverse())
                body.Instructions.Insert(idx + predicate.Count, ins);
        }
    }

    private static List<Instruction> BuildPredicate(PipelineContext ctx, int odd, Instruction dummyTarget)
    {
        var mode = ctx.PolymorphicMode ? ctx.Random.Next(3) : ctx.Random.Next(2);
        if (mode == 0)
        {
            // Formally valid identity: x xor x == 0
            var x = ctx.Random.Next(7, 511);
            return new List<Instruction>
            {
                Instruction.Create(OpCodes.Ldc_I4, x),
                Instruction.Create(OpCodes.Ldc_I4, x),
                Instruction.Create(OpCodes.Xor),
                Instruction.Create(OpCodes.Ldc_I4_0),
                Instruction.Create(OpCodes.Ceq),
                Instruction.Create(OpCodes.Brfalse, dummyTarget),
            };
        }
        if (mode == 1)
        {
            // Formally valid identity over integers: ((x * x) - (x * x)) == 0
            var x = ctx.Random.Next(9, 997);
            return new List<Instruction>
            {
                Instruction.Create(OpCodes.Ldc_I4, x),
                Instruction.Create(OpCodes.Dup),
                Instruction.Create(OpCodes.Mul),
                Instruction.Create(OpCodes.Ldc_I4, x),
                Instruction.Create(OpCodes.Ldc_I4, x),
                Instruction.Create(OpCodes.Mul),
                Instruction.Create(OpCodes.Sub),
                Instruction.Create(OpCodes.Ldc_I4_0),
                Instruction.Create(OpCodes.Ceq),
                Instruction.Create(OpCodes.Brfalse, dummyTarget),
            };
        }

        // Formally valid parity invariant: odd^2 mod 2 != 0
        return new List<Instruction>
        {
            Instruction.Create(OpCodes.Ldc_I4, odd),
            Instruction.Create(OpCodes.Dup),
            Instruction.Create(OpCodes.Mul),
            Instruction.Create(OpCodes.Ldc_I4, 2),
            Instruction.Create(OpCodes.Rem),
            Instruction.Create(OpCodes.Ldc_I4_0),
            Instruction.Create(OpCodes.Ceq),
            Instruction.Create(OpCodes.Brfalse, dummyTarget),
        };
    }
}
