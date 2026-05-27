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
/// Enterprise tier only. Embeds VmRuntime.dll as a manifest resource and injects
/// an AssemblyResolve hook so the protected binary is self-contained.
/// </summary>
public sealed class VirtualizationPass : IProtectionPass
{
    public string Name => "virtualization";

    public void Run(PipelineContext ctx, ModuleDef module)
    {
        var entryPoint = module.EntryPoint;
        var (vmRunRef, vmPath) = ResolveVmRun(module);
        if (vmRunRef == null)
            return;

        var virtualizedCount = 0;

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
                    var (opcodeEncodeMap, opcodeDecodeMap) = BuildOpcodeMaps(ctx.Random, ctx.LowEntropy);
                    var compiler = new ILToVmCompiler(method, opcodeEncodeMap);
                    if (!compiler.TryCompile(out var bytecode, out var tokenTable))
                        continue;

                    var tokens = TokenTableToIntArray(tokenTable);
                    if (tokens == null)
                        continue;

                    var dispatchSchedule = BuildDispatchSchedule(bytecode.Length, ctx.Tier, ctx.Random, ctx.LowEntropy);
                    var dataType = InjectVmData(module, bytecode, tokens, opcodeDecodeMap, dispatchSchedule, ctx.Random, ctx.LowEntropy);
                    ReplaceWithVmStub(module, method, dataType, vmRunRef);
                    virtualizedCount++;
                }
                catch
                {
                    // Skip methods that fail
                }
            }
        }

        if (virtualizedCount > 0)
        {
            try { EmbedVmRuntime(module, vmPath!); } catch { }
            try { InjectAssemblyResolveHook(module); } catch { }
        }
    }

    private static (IMethod? vmRunRef, string? vmPath) ResolveVmRun(ModuleDef module)
    {
        try
        {
            var engineDir = string.IsNullOrEmpty(AppContext.BaseDirectory) ? "." : AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var vmPath = Path.Combine(engineDir, "ShieldBinary.VmRuntime.dll");
            if (!File.Exists(vmPath))
            {
                vmPath = Path.Combine(Path.GetDirectoryName(module.Location) ?? ".", "ShieldBinary.VmRuntime.dll");
            }
            if (!File.Exists(vmPath))
                return (null, null);

            var asm = Assembly.LoadFrom(vmPath);
            var vmType = asm.GetType("ShieldBinary.VmRuntime.VmRunner");
            var runMethod = vmType?.GetMethod(
                "Run",
                BindingFlags.Public | BindingFlags.Static,
                null,
                new[]
                {
                    typeof(byte[]),
                    typeof(int[]),
                    typeof(byte[]),
                    typeof(byte[]),
                    typeof(object[]),
                    typeof(object[]),
                    typeof(int),
                    typeof(Module),
                },
                null);
            if (runMethod == null)
                return (null, null);

            return (module.Import(runMethod), vmPath);
        }
        catch
        {
            return (null, null);
        }
    }

    private static void EmbedVmRuntime(ModuleDef module, string vmPath)
    {
        var bytes = File.ReadAllBytes(vmPath);
        module.Resources.Add(new EmbeddedResource("ShieldBinary.VmRuntime.dll", bytes, dnlib.DotNet.ManifestResourceAttributes.Private));
    }

    private static void InjectAssemblyResolveHook(ModuleDef module)
    {
        var assemblyTypeRef = module.Import(typeof(Assembly));
        var resolveEventArgsTypeRef = module.Import(typeof(ResolveEventArgs));
        var memStreamTypeRef = module.Import(typeof(System.IO.MemoryStream));
        var streamTypeRef = module.Import(typeof(System.IO.Stream));

        var resolverSig = MethodSig.CreateStatic(
            new ClassSig(assemblyTypeRef),
            module.CorLibTypes.Object,
            new ClassSig(resolveEventArgsTypeRef)
        );

        var resolverMethod = new MethodDefUser(
            "__VmR",
            resolverSig,
            dnlib.DotNet.MethodImplAttributes.IL,
            dnlib.DotNet.MethodAttributes.Private | dnlib.DotNet.MethodAttributes.Static | dnlib.DotNet.MethodAttributes.HideBySig
        );
        module.GlobalType.Methods.Add(resolverMethod);

        var resolverBody = new CilBody();
        resolverMethod.Body = resolverBody;

        var streamLocal = new Local(new ClassSig(streamTypeRef));
        var msLocal = new Local(new ClassSig(memStreamTypeRef));
        resolverBody.Variables.Add(streamLocal);
        resolverBody.Variables.Add(msLocal);

        var getNameMethod = module.Import(typeof(ResolveEventArgs).GetProperty("Name")!.GetGetMethod()!);
        var startsWithMethod = module.Import(typeof(string).GetMethod("StartsWith", new[] { typeof(string) })!);
        var getExecAsmMethod = module.Import(typeof(Assembly).GetMethod("GetExecutingAssembly", BindingFlags.Public | BindingFlags.Static, null, Type.EmptyTypes, null)!);
        var getManifestMethod = module.Import(typeof(Assembly).GetMethod("GetManifestResourceStream", new[] { typeof(string) })!);
        var loadAsmMethod = module.Import(typeof(Assembly).GetMethod("Load", new[] { typeof(byte[]) })!);
        var memStreamCtorMethod = module.Import(typeof(System.IO.MemoryStream).GetConstructor(Type.EmptyTypes)!);
        var copyToMethod = module.Import(typeof(System.IO.Stream).GetMethod("CopyTo", new[] { typeof(System.IO.Stream) })!);
        var toArrayMethod = module.Import(typeof(System.IO.MemoryStream).GetMethod("ToArray")!);

        var retNullIns = Instruction.Create(OpCodes.Ldnull);
        var retIns = Instruction.Create(OpCodes.Ret);

        var ins = resolverBody.Instructions;
        // Check if args.Name starts with "ShieldBinary.VmRuntime"
        ins.Add(Instruction.Create(OpCodes.Ldarg_1));
        ins.Add(Instruction.Create(OpCodes.Callvirt, getNameMethod));
        ins.Add(Instruction.Create(OpCodes.Ldstr, "ShieldBinary.VmRuntime"));
        ins.Add(Instruction.Create(OpCodes.Callvirt, startsWithMethod));
        ins.Add(Instruction.Create(OpCodes.Brfalse_S, retNullIns));
        // Load the embedded DLL from manifest resources
        ins.Add(Instruction.Create(OpCodes.Call, getExecAsmMethod));
        ins.Add(Instruction.Create(OpCodes.Ldstr, "ShieldBinary.VmRuntime.dll"));
        ins.Add(Instruction.Create(OpCodes.Callvirt, getManifestMethod));
        ins.Add(Instruction.Create(OpCodes.Stloc, streamLocal));
        ins.Add(Instruction.Create(OpCodes.Ldloc, streamLocal));
        ins.Add(Instruction.Create(OpCodes.Brfalse_S, retNullIns));
        // Copy to MemoryStream and load as Assembly
        ins.Add(Instruction.Create(OpCodes.Newobj, memStreamCtorMethod));
        ins.Add(Instruction.Create(OpCodes.Stloc, msLocal));
        ins.Add(Instruction.Create(OpCodes.Ldloc, streamLocal));
        ins.Add(Instruction.Create(OpCodes.Ldloc, msLocal));
        ins.Add(Instruction.Create(OpCodes.Callvirt, copyToMethod));
        ins.Add(Instruction.Create(OpCodes.Ldloc, msLocal));
        ins.Add(Instruction.Create(OpCodes.Callvirt, toArrayMethod));
        ins.Add(Instruction.Create(OpCodes.Call, loadAsmMethod));
        ins.Add(Instruction.Create(OpCodes.Ret));
        ins.Add(retNullIns);
        ins.Add(retIns);

        // Register the resolver in the global type's .cctor
        var getCurrentDomainMethod = module.Import(typeof(AppDomain).GetProperty("CurrentDomain")!.GetGetMethod()!);
        var addResolveMethod = module.Import(typeof(AppDomain).GetEvent("AssemblyResolve")!.GetAddMethod()!);
        var resolveHandlerCtor = module.Import(typeof(ResolveEventHandler).GetConstructor(new[] { typeof(object), typeof(IntPtr) })!);

        var globalCctor = module.GlobalType.Methods.FirstOrDefault(m => m.IsStaticConstructor);
        if (globalCctor == null)
        {
            globalCctor = new MethodDefUser(
                ".cctor",
                MethodSig.CreateStatic(module.CorLibTypes.Void),
                dnlib.DotNet.MethodImplAttributes.IL,
                dnlib.DotNet.MethodAttributes.Private | dnlib.DotNet.MethodAttributes.Static |
                dnlib.DotNet.MethodAttributes.SpecialName | dnlib.DotNet.MethodAttributes.RTSpecialName
            );
            module.GlobalType.Methods.Add(globalCctor);
            globalCctor.Body = new CilBody();
            globalCctor.Body.Instructions.Add(Instruction.Create(OpCodes.Ret));
        }

        var hookIns = new List<Instruction>
        {
            Instruction.Create(OpCodes.Call, getCurrentDomainMethod),
            Instruction.Create(OpCodes.Ldnull),
            Instruction.Create(OpCodes.Ldftn, resolverMethod),
            Instruction.Create(OpCodes.Newobj, resolveHandlerCtor),
            Instruction.Create(OpCodes.Callvirt, addResolveMethod),
        };

        for (var i = hookIns.Count - 1; i >= 0; i--)
            globalCctor.Body.Instructions.Insert(0, hookIns[i]);
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

    private static TypeDef InjectVmData(ModuleDef module, byte[] bytecode, int[] tokens, byte[] opcodeDecodeMap, byte[] dispatchSchedule, Random rng, bool lowEntropy)
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
        var opField = new FieldDefUser("O", new FieldSig(byteArraySig), dnlib.DotNet.FieldAttributes.Private | dnlib.DotNet.FieldAttributes.Static);
        var scheduleField = new FieldDefUser("S", new FieldSig(byteArraySig), dnlib.DotNet.FieldAttributes.Private | dnlib.DotNet.FieldAttributes.Static);
        dataType.Fields.Add(bcField);
        dataType.Fields.Add(tokField);
        dataType.Fields.Add(opField);
        dataType.Fields.Add(scheduleField);

        var cctor = new MethodDefUser(".cctor", MethodSig.CreateStatic(module.CorLibTypes.Void), dnlib.DotNet.MethodImplAttributes.IL, dnlib.DotNet.MethodAttributes.Private | dnlib.DotNet.MethodAttributes.Static | dnlib.DotNet.MethodAttributes.SpecialName | dnlib.DotNet.MethodAttributes.RTSpecialName);
        dataType.Methods.Add(cctor);
        var cctorBody = new CilBody();
        cctor.Body = cctorBody;

        EmitByteArrayInit(cctorBody, module, bcField, bytecode);
        EmitIntArrayInit(cctorBody, module, tokField, tokens);
        EmitByteArrayInit(cctorBody, module, opField, opcodeDecodeMap);
        EmitByteArrayInit(cctorBody, module, scheduleField, dispatchSchedule);
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
        var opField = dataType.Fields.First(f => f.Name == "O");
        var scheduleField = dataType.Fields.First(f => f.Name == "S");

        var getExecutingAssembly = typeof(Assembly).GetMethod("GetExecutingAssembly", BindingFlags.Public | BindingFlags.Static, [])!;
        var getManifestModule = typeof(Assembly).GetMethod("get_ManifestModule", BindingFlags.Public | BindingFlags.Instance, [])!;

        var il = new List<Instruction>();
        il.Add(Instruction.Create(OpCodes.Ldsfld, bcField));
        il.Add(Instruction.Create(OpCodes.Ldsfld, tokField));
        il.Add(Instruction.Create(OpCodes.Ldsfld, opField));
        il.Add(Instruction.Create(OpCodes.Ldsfld, scheduleField));

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

    private static (byte[] encodeMap, byte[] decodeMap) BuildOpcodeMaps(Random rng, bool lowEntropy)
    {
        var encode = new byte[256];
        var decode = new byte[256];
        for (var i = 0; i < 256; i++)
        {
            encode[i] = (byte)i;
            decode[i] = (byte)i;
        }
        if (lowEntropy)
            return (encode, decode);

        var canonicalOpcodes = Enum.GetValues(typeof(VmOpcode)).Cast<VmOpcode>().Select(v => (byte)v).Distinct().ToList();
        var shuffled = canonicalOpcodes.ToList();
        for (var i = shuffled.Count - 1; i > 0; i--)
        {
            var j = rng.Next(i + 1);
            (shuffled[i], shuffled[j]) = (shuffled[j], shuffled[i]);
        }

        for (var i = 0; i < canonicalOpcodes.Count; i++)
        {
            var canonical = canonicalOpcodes[i];
            var encoded = shuffled[i];
            encode[canonical] = encoded;
            decode[encoded] = canonical;
        }
        return (encode, decode);
    }

    private static byte[] BuildDispatchSchedule(int bytecodeLength, string tier, Random rng, bool lowEntropy)
    {
        if (lowEntropy)
            return new byte[] { 0 };
        var segments = Math.Max(2, Math.Min(64, bytecodeLength / 24));
        var schedule = new byte[segments];
        var enterprise = string.Equals(tier, "enterprise", StringComparison.OrdinalIgnoreCase);
        var hasIndirect = false;
        var hasNestedIndirect = false;
        for (var i = 0; i < segments; i++)
        {
            // 0 = switch dispatch, 1 = indirect dispatch, 2 = nested-indirect dispatch, 3 = handler-table dispatch
            if (enterprise)
            {
                var roll = rng.Next(100);
                schedule[i] = roll < 22 ? (byte)0 : roll < 55 ? (byte)1 : roll < 80 ? (byte)2 : (byte)3;
            }
            else
            {
                var roll = rng.Next(100);
                schedule[i] = roll < 50 ? (byte)0 : roll < 90 ? (byte)1 : (byte)3;
            }
            if (schedule[i] == 1) hasIndirect = true;
            if (schedule[i] == 2) hasNestedIndirect = true;
        }
        if (!hasIndirect)
            schedule[rng.Next(segments)] = 1;
        if (enterprise && !hasNestedIndirect)
            schedule[rng.Next(segments)] = 2;
        return schedule;
    }
}
