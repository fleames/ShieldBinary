using dnlib.DotNet;
using dnlib.DotNet.Emit;

namespace ShieldBinary.Engine.Passes;

public sealed class ConstantEncodingPass : IProtectionPass
{
    public string Name => "constant_encoding";

    public void Run(PipelineContext ctx, ModuleDef module)
    {
        var entryPoint = module.EntryPoint;
        foreach (var type in module.GetAllTypes())
        {
            foreach (var method in type.Methods)
            {
                if (!method.HasBody)
                    continue;
                if (method == entryPoint || method.IsConstructor || method.IsStaticConstructor)
                    continue; // Startup-critical: avoid encoding errors here
                EncodeConstants(method.Body, ctx);
            }
        }
    }

    private static void EncodeConstants(CilBody body, PipelineContext ctx)
    {
        var protectedSet = CilBodyExtensions.GetProtectedInstructions(body);
        for (var i = 0; i < body.Instructions.Count; i++)
        {
            var ins = body.Instructions[i];
            if (!ins.IsLdcI4() || protectedSet.Contains(ins))
                continue;
            var val = ins.GetLdcI4Value();
            if (val == 0 || val == 1)
                continue;

            var choice = ctx.LowEntropy ? (Math.Abs(val) % 7) : ctx.Random.Next(7);
            if (choice == 0)
            {
                var (a, b) = AffineEncode(val, ctx);
                body.Instructions[i] = Instruction.Create(OpCodes.Ldc_I4, a);
                body.Instructions.Insert(i + 1, Instruction.Create(OpCodes.Ldc_I4, b));
                body.Instructions.Insert(i + 2, Instruction.Create(OpCodes.Add));
                i += 2;
            }
            else if (choice == 1 && val != 0)
            {
                var a = ctx.LowEntropy ? (2 + Math.Abs(val) % 48) : ctx.Random.Next(2, 50);
                var b = val ^ a;
                body.Instructions[i] = Instruction.Create(OpCodes.Ldc_I4, a);
                body.Instructions.Insert(i + 1, Instruction.Create(OpCodes.Ldc_I4, b));
                body.Instructions.Insert(i + 2, Instruction.Create(OpCodes.Xor));
                i += 2;
            }
            else if (choice == 2 && val != int.MinValue)
            {
                var a = ctx.LowEntropy ? (1 + Math.Abs(val) % 19) : ctx.Random.Next(1, 20);
                var b = val - a;
                body.Instructions[i] = Instruction.Create(OpCodes.Ldc_I4, b);
                body.Instructions.Insert(i + 1, Instruction.Create(OpCodes.Ldc_I4, a));
                body.Instructions.Insert(i + 2, Instruction.Create(OpCodes.Add));
                i += 2;
            }
            else if (choice == 3 && val != int.MinValue)
            {
                var a = ctx.LowEntropy ? (1 + Math.Abs(val) % 49) : ctx.Random.Next(1, 50);
                var b = val + a;
                body.Instructions[i] = Instruction.Create(OpCodes.Ldc_I4, b);
                body.Instructions.Insert(i + 1, Instruction.Create(OpCodes.Ldc_I4, a));
                body.Instructions.Insert(i + 2, Instruction.Create(OpCodes.Sub));
                i += 2;
            }
            else if (choice == 4 && val != 0 && Math.Abs(val) < 1000000)
            {
                var a = DivSafe(ctx, val);
                if (a != 0) { var b = val / a; body.Instructions[i] = Instruction.Create(OpCodes.Ldc_I4, a); body.Instructions.Insert(i + 1, Instruction.Create(OpCodes.Ldc_I4, b)); body.Instructions.Insert(i + 2, Instruction.Create(OpCodes.Mul)); i += 2; }
                else { var (aa, bb) = AffineEncode(val, ctx); body.Instructions[i] = Instruction.Create(OpCodes.Ldc_I4, aa); body.Instructions.Insert(i + 1, Instruction.Create(OpCodes.Ldc_I4, bb)); body.Instructions.Insert(i + 2, Instruction.Create(OpCodes.Add)); i += 2; }
            }
            else if (choice == 5)
            {
                var k = ctx.LowEntropy ? (1 + Math.Abs(val) % 254) : ctx.Random.Next(1, 255);
                var d = ctx.LowEntropy ? (1 + Math.Abs(val) % 99) : ctx.Random.Next(1, 100);
                var encoded = (val ^ k) + d;
                body.Instructions[i] = Instruction.Create(OpCodes.Ldc_I4, encoded);
                body.Instructions.Insert(i + 1, Instruction.Create(OpCodes.Ldc_I4, d));
                body.Instructions.Insert(i + 2, Instruction.Create(OpCodes.Sub));
                body.Instructions.Insert(i + 3, Instruction.Create(OpCodes.Ldc_I4, k));
                body.Instructions.Insert(i + 4, Instruction.Create(OpCodes.Xor));
                i += 4;
            }
            else
            {
                var (a, b) = AffineEncode(val, ctx);
                body.Instructions[i] = Instruction.Create(OpCodes.Ldc_I4, a);
                body.Instructions.Insert(i + 1, Instruction.Create(OpCodes.Ldc_I4, b));
                body.Instructions.Insert(i + 2, Instruction.Create(OpCodes.Add));
                i += 2;
            }
        }
    }

    private static (int a, int b) AffineEncode(int val, PipelineContext ctx)
    {
        var a = ctx.LowEntropy ? (2 + Math.Abs(val) % 98) : ctx.Random.Next(2, 100);
        var b = val - a;
        return (a, b);
    }

    private static int DivSafe(PipelineContext ctx, int val)
    {
        if (val == 0) return 0;
        var abs = Math.Abs(val);
        var candidates = new List<int>();
        for (var d = 2; d <= Math.Min(100, abs); d++)
            if (val % d == 0) candidates.Add(d);
        return candidates.Count > 0 ? candidates[ctx.LowEntropy ? (int)((uint)Math.Abs(val) % (uint)candidates.Count) : ctx.Random.Next(candidates.Count)] : 0;
    }
}
