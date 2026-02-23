using System.Reflection;
using dnlib.DotNet;
using dnlib.DotNet.Emit;
using ShieldBinary.Engine.VM;

namespace ShieldBinary.Engine.Passes;

internal static class VirtualizationPassHelpers
{
    public static Instruction CreateLdarg(MethodDef method, int argIndex)
    {
        var hasThis = !method.IsStatic;
        if (argIndex == 0 && hasThis)
            return Instruction.Create(OpCodes.Ldarg_0);
        if (argIndex == 1 && hasThis)
            return Instruction.Create(OpCodes.Ldarg_1);
        if (argIndex == 2 && hasThis)
            return Instruction.Create(OpCodes.Ldarg_2);
        if (argIndex == 3 && hasThis)
            return Instruction.Create(OpCodes.Ldarg_3);
        var param = method.Parameters[hasThis ? argIndex - 1 : argIndex];
        return Instruction.Create(argIndex <= 255 ? OpCodes.Ldarg_S : OpCodes.Ldarg, param);
    }
}

/// <summary>
/// Virtualizes method IL to custom VM bytecode (Themida/VMProtect-style).
/// Enterprise tier only. Requires ShieldBinary.VmRuntime.dll deployed with the protected app.
/// </summary>
public sealed class VirtualizationPass : IProtectionPass
{
    public string Name => "virtualization";

    public void Run(PipelineContext ctx, ModuleDef module)
    {
        var entryPoint = module.EntryPoint;
        var vmRunRef = ResolveVmRun(module);
        if (vmRunRef == null)
            return; // VmRuntime not found - skip virtualization

        foreach (var type in module.GetAllTypes())
        {
            foreach (var method in type.Methods)
            {
                if (!method.HasBody || method.Body.Instructions.Count < 4)
                    continue;
                if (method.IsConstructor || method.IsStaticConstructor)
                    continue;
                if (method == entryPoint)
                    continue;
                if (CilBodyExtensions.HasExceptionHandlers(method.Body))
                    continue;
                if (method.DeclaringType?.IsInterface == true)
                    continue;
                if (method.IsAbstract || method.IsPinvokeImpl)
                    continue;

                // Skip ~50% of methods to reduce size impact; virtualize critical ones
                if (ctx.Random.Next(100) > 60)
                    continue;

                try
                {
                    var compiler = new ILToVmCompiler(method);
                    if (!compiler.TryCompile(out var bytecode, out var tokenTable))
                        continue;

                    var tokens = TokenTableToIntArray(tokenTable);
                    if (tokens == null)
                        continue;

                    var dataType = InjectVmData(module, bytecode, tokens, ctx.Random, ctx.LowEntropy);
                    ReplaceWithVmStub(module, method, dataType, vmRunRef);
                }
                catch
                {
                    // Skip methods that fail
                }
            }
        }
    }

    private static IMethod? ResolveVmRun(ModuleDef module)
    {
        try
        {
            // Use BaseDirectory (Assembly.Location is empty for single-file published apps)
            var engineDir = string.IsNullOrEmpty(AppContext.BaseDirectory) ? "." : AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var vmPath = Path.Combine(engineDir, "ShieldBinary.VmRuntime.dll");
            if (!File.Exists(vmPath))
            {
                // Try same directory as input
                vmPath = Path.Combine(Path.GetDirectoryName(module.Location) ?? ".", "ShieldBinary.VmRuntime.dll");
            }
            if (!File.Exists(vmPath))
                return null;

            var asm = Assembly.LoadFrom(vmPath);
            var vmType = asm.GetType("ShieldBinary.VmRuntime.VmRunner");
            var runMethod = vmType?.GetMethod("Run", BindingFlags.Public | BindingFlags.Static);
            if (runMethod == null)
                return null;

            return module.Import(runMethod);
        }
        catch
        {
            return null;
        }
    }

    private static int[]? TokenTableToIntArray(object[] tokenTable)
    {
        var result = new int[tokenTable.Length];
        for (var i = 0; i < tokenTable.Length; i++)
        {
            var o = tokenTable[i];
            if (o is IMethod m)
                result[i] = (int)m.MDToken.Raw;
            else if (o is IField f)
                result[i] = (int)f.MDToken.Raw;
            else if (o is ITypeDefOrRef t)
                result[i] = (int)t.MDToken.Raw;
            else
                return null;
        }
        return result;
    }

    private static TypeDef InjectVmData(ModuleDef module, byte[] bytecode, int[] tokens, Random rng, bool lowEntropy)
    {
        int hash = 0;
        if (lowEntropy) { foreach (var b in bytecode) hash = hash * 31 + b; hash &= 0xFFFFFF; }
        var name = lowEntropy ? "V" + hash.ToString("X6") : "V" + rng.Next(0x100000, 0xFFFFFF).ToString("X6");
        var dataType = new TypeDefUser("", name, module.CorLibTypes.Object.TypeDefOrRef);
        dataType.Attributes = dnlib.DotNet.TypeAttributes.NotPublic | dnlib.DotNet.TypeAttributes.Sealed | dnlib.DotNet.TypeAttributes.Abstract;
        module.Types.Add(dataType);

        var byteArraySig = new SZArraySig(module.CorLibTypes.Byte);
        var intArraySig = new SZArraySig(module.CorLibTypes.Int32);

        var bcField = new FieldDefUser("B", new FieldSig(byteArraySig), dnlib.DotNet.FieldAttributes.Private | dnlib.DotNet.FieldAttributes.Static);
        var tokField = new FieldDefUser("T", new FieldSig(intArraySig), dnlib.DotNet.FieldAttributes.Private | dnlib.DotNet.FieldAttributes.Static);
        dataType.Fields.Add(bcField);
        dataType.Fields.Add(tokField);

        // Static cctor to initialize fields
        var cctor = new MethodDefUser(".cctor", MethodSig.CreateStatic(module.CorLibTypes.Void), dnlib.DotNet.MethodImplAttributes.IL, dnlib.DotNet.MethodAttributes.Private | dnlib.DotNet.MethodAttributes.Static | dnlib.DotNet.MethodAttributes.SpecialName | dnlib.DotNet.MethodAttributes.RTSpecialName);
        dataType.Methods.Add(cctor);
        var cctorBody = new CilBody();
        cctor.Body = cctorBody;

        // Emit: B = bytecode, T = tokens
        EmitByteArrayInit(cctorBody, module, bcField, bytecode);
        EmitIntArrayInit(cctorBody, module, tokField, tokens);
        cctorBody.Instructions.Add(Instruction.Create(OpCodes.Ret));

        return dataType;
    }

    private static void EmitByteArrayInit(CilBody body, ModuleDef module, FieldDef field, byte[] data)
    {
        body.Instructions.Add(Instruction.Create(OpCodes.Ldc_I4, data.Length));
        body.Instructions.Add(Instruction.Create(OpCodes.Newarr, module.CorLibTypes.Byte.TypeDefOrRef));
        body.Instructions.Add(Instruction.Create(OpCodes.Stsfld, field));

        for (var i = 0; i < data.Length; i++)
        {
            body.Instructions.Add(Instruction.Create(OpCodes.Ldsfld, field));
            body.Instructions.Add(Instruction.Create(OpCodes.Ldc_I4, i));
            body.Instructions.Add(Instruction.Create(OpCodes.Ldc_I4, (int)(sbyte)data[i]));
            body.Instructions.Add(Instruction.Create(OpCodes.Stelem_I1));
        }
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

    private static void ReplaceWithVmStub(ModuleDef module, MethodDef method, TypeDef dataType, IMethod vmRunRef)
    {
        var body = method.Body!;
        var sig = method.MethodSig;
        var paramCount = sig.Params.Count;
        var hasThis = !method.IsStatic;
        var argCount = paramCount + (hasThis ? 1 : 0);
        var localCount = body.Variables.Count;
        var maxStack = Math.Max((int)body.MaxStack, 8);

        var bcField = dataType.Fields.First(f => f.Name == "B");
        var tokField = dataType.Fields.First(f => f.Name == "T");

        var getExecutingAssembly = typeof(Assembly).GetMethod("GetExecutingAssembly", BindingFlags.Public | BindingFlags.Static, [])!;
        var getManifestModule = typeof(Assembly).GetMethod("get_ManifestModule", BindingFlags.Public | BindingFlags.Instance, [])!;

        var il = new List<Instruction>();
        il.Add(Instruction.Create(OpCodes.Ldsfld, bcField));
        il.Add(Instruction.Create(OpCodes.Ldsfld, tokField));

        il.Add(Instruction.Create(OpCodes.Ldc_I4, argCount));
        il.Add(Instruction.Create(OpCodes.Newarr, module.CorLibTypes.Object.TypeDefOrRef));
        if (hasThis)
        {
            il.Add(Instruction.Create(OpCodes.Dup));
            il.Add(Instruction.Create(OpCodes.Ldc_I4, 0));
            il.Add(Instruction.Create(OpCodes.Ldarg_0));
            if (method.DeclaringType?.IsValueType == true)
                il.Add(Instruction.Create(OpCodes.Box, method.DeclaringType));
            il.Add(Instruction.Create(OpCodes.Stelem_Ref));
        }
        for (var i = 0; i < paramCount; i++)
        {
            il.Add(Instruction.Create(OpCodes.Dup));
            il.Add(Instruction.Create(OpCodes.Ldc_I4, (hasThis ? 1 : 0) + i));
            il.Add(VirtualizationPassHelpers.CreateLdarg(method, (hasThis ? 1 : 0) + i));
            var paramType = sig.Params[i];
            if (paramType.IsValueType || paramType.IsPrimitive)
                il.Add(Instruction.Create(OpCodes.Box, paramType.ToTypeDefOrRef()));
            il.Add(Instruction.Create(OpCodes.Stelem_Ref));
        }

        il.Add(Instruction.Create(OpCodes.Ldc_I4, localCount));
        il.Add(Instruction.Create(OpCodes.Newarr, module.CorLibTypes.Object.TypeDefOrRef));
        il.Add(Instruction.Create(OpCodes.Ldc_I4, maxStack));
        il.Add(Instruction.Create(OpCodes.Call, module.Import(getExecutingAssembly)));
        il.Add(Instruction.Create(OpCodes.Callvirt, module.Import(getManifestModule)));
        il.Add(Instruction.Create(OpCodes.Call, vmRunRef));

        var returnType = sig.RetType;
        if (returnType.ElementType != ElementType.Void)
        {
            if (returnType.IsValueType || returnType.IsPrimitive)
                il.Add(Instruction.Create(OpCodes.Unbox_Any, returnType.ToTypeDefOrRef()));
        }
        il.Add(Instruction.Create(OpCodes.Ret));

        body.Instructions.Clear();
        body.ExceptionHandlers?.Clear();
        body.Variables.Clear();
        foreach (var i in il)
            body.Instructions.Add(i);
    }
}
