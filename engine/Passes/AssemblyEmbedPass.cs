using System.IO;
using System.Reflection;
using dnlib.DotNet;
using dnlib.DotNet.Emit;
using ShieldBinary.Engine;

namespace ShieldBinary.Engine.Passes;

/// <summary>
/// Embeds local dependency assemblies as encrypted resources and injects an AssemblyResolve loader.
/// Conservative: only embeds existing "<ref>.dll" files next to input assembly.
/// </summary>
public sealed class AssemblyEmbedPass : IProtectionPass
{
    private static readonly byte[] Magic = { (byte)'S', (byte)'B', (byte)'A', (byte)'1' };

    public string Name => "assembly_embed";

    public void Run(PipelineContext ctx, ModuleDef module)
    {
        if (!ctx.EnableAssemblyEmbed)
            return;

        var baseDir = Path.GetDirectoryName(ctx.InputPath);
        if (string.IsNullOrEmpty(baseDir) || !Directory.Exists(baseDir))
            return;

        var embeddedNames = EmbedDependencies(ctx, module, baseDir);
        if (embeddedNames.Count == 0)
            return;

        var resolverInit = InjectResolver(module);
        EnsureModuleCtorCalls(module, resolverInit);
    }

    private static List<string> EmbedDependencies(PipelineContext ctx, ModuleDef module, string baseDir)
    {
        var embedded = new List<string>();
        var existing = new HashSet<string>(module.Resources.Select(r => (r.Name ?? string.Empty).ToString()), StringComparer.OrdinalIgnoreCase);
        foreach (var aref in module.GetAssemblyRefs())
        {
            var asmName = aref.Name?.ToString();
            if (string.IsNullOrWhiteSpace(asmName))
                continue;
            var path = Path.Combine(baseDir, asmName + ".dll");
            if (!File.Exists(path))
                continue;

            var resName = "sbe." + asmName;
            if (existing.Contains(resName))
                continue;

            var data = File.ReadAllBytes(path);
            if (data.Length == 0)
                continue;
            var key = ctx.LowEntropy
                ? (byte)((Math.Abs(asmName.GetHashCode()) % 251) + 1)
                : (byte)ctx.Random.Next(1, 256);
            var enc = Encrypt(data, key);
            module.Resources.Add(new EmbeddedResource(resName, enc, dnlib.DotNet.ManifestResourceAttributes.Private));
            embedded.Add(resName);
        }
        return embedded;
    }

    private static byte[] Encrypt(byte[] data, byte key)
    {
        var enc = new byte[Magic.Length + 1 + data.Length];
        Buffer.BlockCopy(Magic, 0, enc, 0, Magic.Length);
        enc[Magic.Length] = key;
        for (var i = 0; i < data.Length; i++)
            enc[Magic.Length + 1 + i] = (byte)(data[i] ^ key ^ (byte)(i & 0xFF));
        return enc;
    }

    private static IMethod InjectResolver(ModuleDef module)
    {
        var helperType = new TypeDefUser("", "AE" + Guid.NewGuid().ToString("N")[..8], module.CorLibTypes.Object.TypeDefOrRef)
        {
            Attributes = dnlib.DotNet.TypeAttributes.NotPublic | dnlib.DotNet.TypeAttributes.Sealed | dnlib.DotNet.TypeAttributes.Abstract
        };
        module.Types.Add(helperType);

        var appDomainType = module.Import(typeof(AppDomain)).ToTypeSig();
        var objectType = module.CorLibTypes.Object;
        var resolveArgsType = module.Import(typeof(ResolveEventArgs)).ToTypeSig();
        var asmType = module.Import(typeof(Assembly)).ToTypeSig();
        var streamType = module.Import(typeof(Stream)).ToTypeSig();
        var memoryStreamType = module.Import(typeof(MemoryStream)).ToTypeSig();
        var byteArrayType = new SZArraySig(module.CorLibTypes.Byte);

        // Init: static void I()
        var init = new MethodDefUser(
            "I",
            MethodSig.CreateStatic(module.CorLibTypes.Void),
            dnlib.DotNet.MethodImplAttributes.IL,
            dnlib.DotNet.MethodAttributes.Private | dnlib.DotNet.MethodAttributes.Static);
        helperType.Methods.Add(init);

        // Resolver: static Assembly R(object sender, ResolveEventArgs args)
        var resolve = new MethodDefUser(
            "R",
            MethodSig.CreateStatic(asmType, objectType, resolveArgsType),
            dnlib.DotNet.MethodImplAttributes.IL,
            dnlib.DotNet.MethodAttributes.Private | dnlib.DotNet.MethodAttributes.Static);
        helperType.Methods.Add(resolve);

        var getCurrentDomain = module.Import(typeof(AppDomain).GetProperty("CurrentDomain")!.GetGetMethod()!);
        var addResolve = module.Import(typeof(AppDomain).GetEvent("AssemblyResolve")!.GetAddMethod()!);
        var resolveHandlerCtor = module.Import(typeof(ResolveEventHandler).GetConstructor(new[] { typeof(object), typeof(IntPtr) })!);

        init.Body = new CilBody { InitLocals = false, MaxStack = 4 };
        init.Body.Instructions.Add(Instruction.Create(OpCodes.Call, getCurrentDomain));
        init.Body.Instructions.Add(Instruction.Create(OpCodes.Ldnull));
        init.Body.Instructions.Add(Instruction.Create(OpCodes.Ldftn, resolve));
        init.Body.Instructions.Add(Instruction.Create(OpCodes.Newobj, resolveHandlerCtor));
        init.Body.Instructions.Add(Instruction.Create(OpCodes.Callvirt, addResolve));
        init.Body.Instructions.Add(Instruction.Create(OpCodes.Ret));

        var asmNameCtor = module.Import(typeof(AssemblyName).GetConstructor(new[] { typeof(string) })!);
        var asmNameGetName = module.Import(typeof(AssemblyName).GetProperty("Name")!.GetGetMethod()!);
        var resolveArgsName = module.Import(typeof(ResolveEventArgs).GetProperty("Name")!.GetGetMethod()!);
        var stringConcat = module.Import(typeof(string).GetMethod("Concat", new[] { typeof(string), typeof(string) })!);
        var getExecutingAssembly = module.Import(typeof(Assembly).GetMethod("GetExecutingAssembly", Type.EmptyTypes)!);
        var getManifestResourceStream = module.Import(typeof(Assembly).GetMethod("GetManifestResourceStream", new[] { typeof(string) })!);
        var streamCopyTo = module.Import(typeof(Stream).GetMethod("CopyTo", new[] { typeof(Stream) })!);
        var streamDispose = module.Import(typeof(Stream).GetMethod("Dispose", Type.EmptyTypes)!);
        var msCtor = module.Import(typeof(MemoryStream).GetConstructor(Type.EmptyTypes)!);
        var msCtorSegment = module.Import(typeof(MemoryStream).GetConstructor(new[] { typeof(byte[]), typeof(int), typeof(int), typeof(bool), typeof(bool) })!);
        var msToArray = module.Import(typeof(MemoryStream).GetMethod("ToArray", Type.EmptyTypes)!);
        var asmLoadBytes = module.Import(typeof(Assembly).GetMethod("Load", new[] { typeof(byte[]) })!);

        resolve.Body = new CilBody { InitLocals = true, MaxStack = 8 };
        var nameLocal = new Local(module.CorLibTypes.String);
        var resNameLocal = new Local(module.CorLibTypes.String);
        var streamLocal = new Local(streamType);
        var msLocal = new Local(memoryStreamType);
        var dataLocal = new Local(byteArrayType);
        var keyLocal = new Local(module.CorLibTypes.Byte);
        var iLocal = new Local(module.CorLibTypes.Int32);
        resolve.Body.Variables.Add(nameLocal);
        resolve.Body.Variables.Add(resNameLocal);
        resolve.Body.Variables.Add(streamLocal);
        resolve.Body.Variables.Add(msLocal);
        resolve.Body.Variables.Add(dataLocal);
        resolve.Body.Variables.Add(keyLocal);
        resolve.Body.Variables.Add(iLocal);

        var il = resolve.Body.Instructions;
        var retNull = Instruction.Create(OpCodes.Ldnull);
        var loopCheck = Instruction.Create(OpCodes.Nop);
        var loopBody = Instruction.Create(OpCodes.Nop);
        var loadAsm = Instruction.Create(OpCodes.Nop);

        // depName = new AssemblyName(args.Name).Name
        il.Add(Instruction.Create(OpCodes.Ldarg_1));
        il.Add(Instruction.Create(OpCodes.Callvirt, resolveArgsName));
        il.Add(Instruction.Create(OpCodes.Newobj, asmNameCtor));
        il.Add(Instruction.Create(OpCodes.Callvirt, asmNameGetName));
        il.Add(Instruction.Create(OpCodes.Stloc, nameLocal));

        // resName = "sbe." + depName
        il.Add(Instruction.Create(OpCodes.Ldstr, "sbe."));
        il.Add(Instruction.Create(OpCodes.Ldloc, nameLocal));
        il.Add(Instruction.Create(OpCodes.Call, stringConcat));
        il.Add(Instruction.Create(OpCodes.Stloc, resNameLocal));

        // s = Assembly.GetExecutingAssembly().GetManifestResourceStream(resName)
        il.Add(Instruction.Create(OpCodes.Call, getExecutingAssembly));
        il.Add(Instruction.Create(OpCodes.Ldloc, resNameLocal));
        il.Add(Instruction.Create(OpCodes.Callvirt, getManifestResourceStream));
        il.Add(Instruction.Create(OpCodes.Stloc, streamLocal));
        il.Add(Instruction.Create(OpCodes.Ldloc, streamLocal));
        il.Add(Instruction.Create(OpCodes.Brfalse, retNull));

        // ms = new MemoryStream(); s.CopyTo(ms); s.Dispose(); data = ms.ToArray()
        il.Add(Instruction.Create(OpCodes.Newobj, msCtor));
        il.Add(Instruction.Create(OpCodes.Stloc, msLocal));
        il.Add(Instruction.Create(OpCodes.Ldloc, streamLocal));
        il.Add(Instruction.Create(OpCodes.Ldloc, msLocal));
        il.Add(Instruction.Create(OpCodes.Callvirt, streamCopyTo));
        il.Add(Instruction.Create(OpCodes.Ldloc, streamLocal));
        il.Add(Instruction.Create(OpCodes.Callvirt, streamDispose));
        il.Add(Instruction.Create(OpCodes.Ldloc, msLocal));
        il.Add(Instruction.Create(OpCodes.Callvirt, msToArray));
        il.Add(Instruction.Create(OpCodes.Stloc, dataLocal));

        // validate header length and magic
        il.Add(Instruction.Create(OpCodes.Ldloc, dataLocal));
        il.Add(Instruction.Create(OpCodes.Ldlen));
        il.Add(Instruction.Create(OpCodes.Conv_I4));
        il.Add(Instruction.Create(OpCodes.Ldc_I4_5));
        il.Add(Instruction.Create(OpCodes.Blt, retNull));
        il.Add(Instruction.Create(OpCodes.Ldloc, dataLocal));
        il.Add(Instruction.Create(OpCodes.Ldc_I4_0));
        il.Add(Instruction.Create(OpCodes.Ldelem_U1));
        il.Add(Instruction.Create(OpCodes.Ldc_I4, (int)'S'));
        il.Add(Instruction.Create(OpCodes.Bne_Un, retNull));
        il.Add(Instruction.Create(OpCodes.Ldloc, dataLocal));
        il.Add(Instruction.Create(OpCodes.Ldc_I4_1));
        il.Add(Instruction.Create(OpCodes.Ldelem_U1));
        il.Add(Instruction.Create(OpCodes.Ldc_I4, (int)'B'));
        il.Add(Instruction.Create(OpCodes.Bne_Un, retNull));
        il.Add(Instruction.Create(OpCodes.Ldloc, dataLocal));
        il.Add(Instruction.Create(OpCodes.Ldc_I4_2));
        il.Add(Instruction.Create(OpCodes.Ldelem_U1));
        il.Add(Instruction.Create(OpCodes.Ldc_I4, (int)'A'));
        il.Add(Instruction.Create(OpCodes.Bne_Un, retNull));
        il.Add(Instruction.Create(OpCodes.Ldloc, dataLocal));
        il.Add(Instruction.Create(OpCodes.Ldc_I4_3));
        il.Add(Instruction.Create(OpCodes.Ldelem_U1));
        il.Add(Instruction.Create(OpCodes.Ldc_I4, (int)'1'));
        il.Add(Instruction.Create(OpCodes.Bne_Un, retNull));

        il.Add(Instruction.Create(OpCodes.Ldloc, dataLocal));
        il.Add(Instruction.Create(OpCodes.Ldc_I4_4));
        il.Add(Instruction.Create(OpCodes.Ldelem_U1));
        il.Add(Instruction.Create(OpCodes.Stloc, keyLocal));
        il.Add(Instruction.Create(OpCodes.Ldc_I4_5));
        il.Add(Instruction.Create(OpCodes.Stloc, iLocal));
        il.Add(Instruction.Create(OpCodes.Br, loopCheck));
        il.Add(loopBody);
        il.Add(Instruction.Create(OpCodes.Ldloc, dataLocal));
        il.Add(Instruction.Create(OpCodes.Ldloc, iLocal));
        il.Add(Instruction.Create(OpCodes.Ldloc, dataLocal));
        il.Add(Instruction.Create(OpCodes.Ldloc, iLocal));
        il.Add(Instruction.Create(OpCodes.Ldelem_U1));
        il.Add(Instruction.Create(OpCodes.Ldloc, keyLocal));
        il.Add(Instruction.Create(OpCodes.Xor));
        il.Add(Instruction.Create(OpCodes.Ldloc, iLocal));
        il.Add(Instruction.Create(OpCodes.Ldc_I4_5));
        il.Add(Instruction.Create(OpCodes.Sub));
        il.Add(Instruction.Create(OpCodes.Ldc_I4, 255));
        il.Add(Instruction.Create(OpCodes.And));
        il.Add(Instruction.Create(OpCodes.Xor));
        il.Add(Instruction.Create(OpCodes.Conv_U1));
        il.Add(Instruction.Create(OpCodes.Stelem_I1));
        il.Add(Instruction.Create(OpCodes.Ldloc, iLocal));
        il.Add(Instruction.Create(OpCodes.Ldc_I4_1));
        il.Add(Instruction.Create(OpCodes.Add));
        il.Add(Instruction.Create(OpCodes.Stloc, iLocal));
        il.Add(loopCheck);
        il.Add(Instruction.Create(OpCodes.Ldloc, iLocal));
        il.Add(Instruction.Create(OpCodes.Ldloc, dataLocal));
        il.Add(Instruction.Create(OpCodes.Ldlen));
        il.Add(Instruction.Create(OpCodes.Conv_I4));
        il.Add(Instruction.Create(OpCodes.Blt, loopBody));

        il.Add(loadAsm);
        il.Add(Instruction.Create(OpCodes.Ldloc, dataLocal));
        il.Add(Instruction.Create(OpCodes.Ldc_I4_5));
        il.Add(Instruction.Create(OpCodes.Ldloc, dataLocal));
        il.Add(Instruction.Create(OpCodes.Ldlen));
        il.Add(Instruction.Create(OpCodes.Conv_I4));
        il.Add(Instruction.Create(OpCodes.Ldc_I4_5));
        il.Add(Instruction.Create(OpCodes.Sub));
        il.Add(Instruction.Create(OpCodes.Ldc_I4_0));
        il.Add(Instruction.Create(OpCodes.Ldc_I4_1));
        il.Add(Instruction.Create(OpCodes.Newobj, msCtorSegment));
        il.Add(Instruction.Create(OpCodes.Callvirt, msToArray));
        il.Add(Instruction.Create(OpCodes.Call, asmLoadBytes));
        il.Add(Instruction.Create(OpCodes.Ret));

        il.Add(retNull);
        il.Add(Instruction.Create(OpCodes.Ret));

        return init;
    }

    private static void EnsureModuleCtorCalls(ModuleDef module, IMethod initMethod)
    {
        var global = module.GlobalType;
        var cctor = global.FindStaticConstructor();
        if (cctor == null)
        {
            cctor = new MethodDefUser(
                ".cctor",
                MethodSig.CreateStatic(module.CorLibTypes.Void),
                dnlib.DotNet.MethodImplAttributes.IL,
                dnlib.DotNet.MethodAttributes.Private | dnlib.DotNet.MethodAttributes.Static | dnlib.DotNet.MethodAttributes.SpecialName | dnlib.DotNet.MethodAttributes.RTSpecialName);
            cctor.Body = new CilBody();
            cctor.Body.Instructions.Add(Instruction.Create(OpCodes.Ret));
            global.Methods.Add(cctor);
        }
        if (cctor.Body == null)
        {
            cctor.Body = new CilBody();
            cctor.Body.Instructions.Add(Instruction.Create(OpCodes.Ret));
        }
        cctor.Body.Instructions.Insert(0, Instruction.Create(OpCodes.Call, initMethod));
    }
}
