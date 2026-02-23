using System.Reflection;
using System.Security.Cryptography;
using dnlib.DotNet;
using dnlib.DotNet.Emit;

namespace ShieldBinary.Engine.Passes;

public sealed class RuntimeSelfProtectionPass : IProtectionPass
{
    public string Name => "runtime_rasp";

    public void Run(PipelineContext ctx, ModuleDef module)
    {
        // Enterprise default; Pro/others require explicit opt-in.
        if (!ctx.EnableRuntimeRasp && !string.Equals(ctx.Tier, "enterprise", StringComparison.OrdinalIgnoreCase))
            return;

        var guardMethod = ResolveGuardMethod(module);
        if (guardMethod == null)
            return;

        var targets = SelectTargetMethods(module, ctx);
        if (targets.Count == 0)
            return;

        var hashes = targets.Select(ComputeOpcodeHash).ToArray();
        var tokens = targets.Select(m => (int)m.MDToken.Raw).ToArray();
        var dataType = InjectRaspData(module, tokens, hashes, ctx.Random, ctx.LowEntropy);
        InjectStartupCall(module, dataType, guardMethod);
    }

    private static IMethod? ResolveGuardMethod(ModuleDef module)
    {
        try
        {
            var engineDir = string.IsNullOrEmpty(AppContext.BaseDirectory) ? "." : AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var vmPath = Path.Combine(engineDir, "ShieldBinary.VmRuntime.dll");
            if (!File.Exists(vmPath))
                vmPath = Path.Combine(Path.GetDirectoryName(module.Location) ?? ".", "ShieldBinary.VmRuntime.dll");
            if (!File.Exists(vmPath))
                return null;

            var asm = Assembly.LoadFrom(vmPath);
            var raspType = asm.GetType("ShieldBinary.VmRuntime.RuntimeSelfProtection");
            var guard = raspType?.GetMethod(
                "Guard",
                BindingFlags.Public | BindingFlags.Static,
                null,
                new[] { typeof(int[]), typeof(string[]) },
                null);
            if (guard == null)
                return null;
            return module.Import(guard);
        }
        catch
        {
            return null;
        }
    }

    private static List<MethodDef> SelectTargetMethods(ModuleDef module, PipelineContext ctx)
    {
        var candidates = new List<MethodDef>();
        foreach (var t in module.GetAllTypes())
        {
            foreach (var m in t.Methods)
            {
                if (!m.HasBody || m.Body.Instructions.Count == 0)
                    continue;
                if (m.IsConstructor || m.IsStaticConstructor || m.IsAbstract || m.IsPinvokeImpl)
                    continue;
                if (m.DeclaringType?.IsGlobalModuleType == true)
                    continue;
                candidates.Add(m);
            }
        }
        if (candidates.Count == 0)
            return candidates;

        // Keep entrypoint out of checksum set because we inject startup call into it afterwards.
        candidates = candidates.Where(m => m != module.EntryPoint).ToList();
        if (candidates.Count == 0)
            return candidates;

        if (!ctx.LowEntropy)
        {
            for (var i = candidates.Count - 1; i > 0; i--)
            {
                var j = ctx.Random.Next(i + 1);
                (candidates[i], candidates[j]) = (candidates[j], candidates[i]);
            }
        }
        return candidates.Take(Math.Min(6, candidates.Count)).ToList();
    }

    private static string ComputeOpcodeHash(MethodDef method)
    {
        var bytes = new List<byte>(method.Body!.Instructions.Count * 2);
        foreach (var ins in method.Body!.Instructions)
        {
            var v = unchecked((ushort)ins.OpCode.Value);
            bytes.Add((byte)v);
            bytes.Add((byte)(v >> 8));
        }
        using var sha = SHA256.Create();
        var h = sha.ComputeHash(bytes.ToArray());
        return BitConverter.ToString(h).Replace("-", string.Empty);
    }

    private static TypeDef InjectRaspData(ModuleDef module, int[] tokens, string[] hashes, Random rng, bool lowEntropy)
    {
        int hash = 0;
        if (lowEntropy) { foreach (var t in tokens) hash = hash * 31 + t; hash &= 0xFFFFFF; }
        var name = lowEntropy ? "R" + hash.ToString("X6") : "R" + rng.Next(0x100000, 0xFFFFFF).ToString("X6");
        var dataType = new TypeDefUser("", name, module.CorLibTypes.Object.TypeDefOrRef);
        dataType.Attributes = dnlib.DotNet.TypeAttributes.NotPublic | dnlib.DotNet.TypeAttributes.Sealed | dnlib.DotNet.TypeAttributes.Abstract;
        module.Types.Add(dataType);

        var intArraySig = new SZArraySig(module.CorLibTypes.Int32);
        var strArraySig = new SZArraySig(module.CorLibTypes.String);
        var tField = new FieldDefUser("T", new FieldSig(intArraySig), dnlib.DotNet.FieldAttributes.Private | dnlib.DotNet.FieldAttributes.Static);
        var hField = new FieldDefUser("H", new FieldSig(strArraySig), dnlib.DotNet.FieldAttributes.Private | dnlib.DotNet.FieldAttributes.Static);
        dataType.Fields.Add(tField);
        dataType.Fields.Add(hField);

        var cctor = new MethodDefUser(".cctor", MethodSig.CreateStatic(module.CorLibTypes.Void), dnlib.DotNet.MethodImplAttributes.IL, dnlib.DotNet.MethodAttributes.Private | dnlib.DotNet.MethodAttributes.Static | dnlib.DotNet.MethodAttributes.SpecialName | dnlib.DotNet.MethodAttributes.RTSpecialName);
        dataType.Methods.Add(cctor);
        var body = new CilBody();
        cctor.Body = body;
        EmitIntArrayInit(body, module, tField, tokens);
        EmitStringArrayInit(body, module, hField, hashes);
        body.Instructions.Add(Instruction.Create(OpCodes.Ret));
        return dataType;
    }

    private static void InjectStartupCall(ModuleDef module, TypeDef dataType, IMethod guard)
    {
        var target = module.EntryPoint;
        if (target == null || !target.HasBody)
            return;
        var tField = dataType.Fields.First(f => f.Name == "T");
        var hField = dataType.Fields.First(f => f.Name == "H");
        target.Body!.Instructions.Insert(0, Instruction.Create(OpCodes.Ldsfld, tField));
        target.Body!.Instructions.Insert(1, Instruction.Create(OpCodes.Ldsfld, hField));
        target.Body!.Instructions.Insert(2, Instruction.Create(OpCodes.Call, guard));
    }

    private static void EmitIntArrayInit(CilBody body, ModuleDef module, FieldDef field, int[] data)
    {
        body.Instructions.Add(Instruction.Create(OpCodes.Ldc_I4, data.Length));
        body.Instructions.Add(Instruction.Create(OpCodes.Newarr, module.CorLibTypes.Int32.TypeDefOrRef));
        body.Instructions.Add(Instruction.Create(OpCodes.Stsfld, field));
        for (var i = 0; i < data.Length; i++)
        {
            body.Instructions.Add(Instruction.Create(OpCodes.Ldsfld, field));
            body.Instructions.Add(Instruction.Create(OpCodes.Ldc_I4, i));
            body.Instructions.Add(Instruction.Create(OpCodes.Ldc_I4, data[i]));
            body.Instructions.Add(Instruction.Create(OpCodes.Stelem_I4));
        }
    }

    private static void EmitStringArrayInit(CilBody body, ModuleDef module, FieldDef field, string[] data)
    {
        body.Instructions.Add(Instruction.Create(OpCodes.Ldc_I4, data.Length));
        body.Instructions.Add(Instruction.Create(OpCodes.Newarr, module.CorLibTypes.String.TypeDefOrRef));
        body.Instructions.Add(Instruction.Create(OpCodes.Stsfld, field));
        for (var i = 0; i < data.Length; i++)
        {
            body.Instructions.Add(Instruction.Create(OpCodes.Ldsfld, field));
            body.Instructions.Add(Instruction.Create(OpCodes.Ldc_I4, i));
            body.Instructions.Add(Instruction.Create(OpCodes.Ldstr, data[i]));
            body.Instructions.Add(Instruction.Create(OpCodes.Stelem_Ref));
        }
    }
}
