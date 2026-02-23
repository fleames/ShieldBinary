using System;
using System.IO;
using dnlib.DotNet;
using dnlib.DotNet.Emit;
using ShieldBinary.Engine;

namespace ShieldBinary.Engine.Passes;

public sealed class ResourceEncryptionPass : IProtectionPass
{
    private static readonly byte[] Magic = { (byte)'S', (byte)'B', (byte)'R', (byte)'1' };

    public string Name => "resource_encryption";

    public void Run(PipelineContext ctx, ModuleDef module)
    {
        if (!ctx.EnableResourceEncryption)
            return;

        EncryptEmbeddedResources(ctx, module);
        RewriteManifestResourceCalls(module);
    }

    private static void EncryptEmbeddedResources(PipelineContext ctx, ModuleDef module)
    {
        for (var i = 0; i < module.Resources.Count; i++)
        {
            if (module.Resources[i] is not EmbeddedResource res)
                continue;
            if (ShouldSkipResource(res))
                continue;

            byte[] data;
            try
            {
                data = res.CreateReader().ToArray();
            }
            catch
            {
                continue;
            }

            if (data.Length == 0)
                continue;
            if (IsAlreadyEncrypted(data))
                continue;

            var key = ctx.LowEntropy
                ? (byte)((Math.Abs(res.Name.GetHashCode()) % 250) + 1)
                : (byte)ctx.Random.Next(1, 256);

            var enc = new byte[Magic.Length + 1 + data.Length];
            Buffer.BlockCopy(Magic, 0, enc, 0, Magic.Length);
            enc[Magic.Length] = key;
            for (var j = 0; j < data.Length; j++)
            {
                enc[Magic.Length + 1 + j] = (byte)(data[j] ^ key ^ (byte)(j & 0xFF));
            }

            module.Resources[i] = new EmbeddedResource(res.Name, enc, res.Attributes);
        }
    }

    private static bool ShouldSkipResource(EmbeddedResource res)
    {
        var name = res.Name ?? string.Empty;
        if (name.EndsWith(".resources", StringComparison.OrdinalIgnoreCase))
            return true;
        if (name.EndsWith(".g.resources", StringComparison.OrdinalIgnoreCase))
            return true;
        return false;
    }

    private static bool IsAlreadyEncrypted(byte[] data)
    {
        if (data.Length < Magic.Length + 1)
            return false;
        for (var i = 0; i < Magic.Length; i++)
        {
            if (data[i] != Magic[i])
                return false;
        }
        return true;
    }

    private static void RewriteManifestResourceCalls(ModuleDef module)
    {
        var helper = InjectResourceHelper(module);
        foreach (var type in module.GetAllTypes())
        {
            foreach (var method in type.Methods)
            {
                if (!method.HasBody || method.Body.Instructions.Count == 0)
                    continue;
                var instructions = method.Body.Instructions;
                for (var i = 0; i < instructions.Count; i++)
                {
                    var ins = instructions[i];
                    if (ins.OpCode.Code != Code.Call && ins.OpCode.Code != Code.Callvirt)
                        continue;
                    if (ins.Operand is not IMethod called)
                        continue;
                    if (!IsAssemblyGetManifestResourceStream(called))
                        continue;
                    ins.OpCode = OpCodes.Call;
                    ins.Operand = helper;
                }
            }
        }
    }

    private static bool IsAssemblyGetManifestResourceStream(IMethod method)
    {
        if (!string.Equals(method.Name, "GetManifestResourceStream", StringComparison.Ordinal))
            return false;
        var decl = method.DeclaringType?.FullName ?? string.Empty;
        if (!string.Equals(decl, "System.Reflection.Assembly", StringComparison.Ordinal))
            return false;
        var sig = method.MethodSig;
        if (sig == null || sig.Params.Count != 1)
            return false;
        return string.Equals(sig.Params[0].FullName, "System.String", StringComparison.Ordinal);
    }

    private static IMethod InjectResourceHelper(ModuleDef module)
    {
        var helperTypeName = "R" + Guid.NewGuid().ToString("N")[..8];
        var helperType = new TypeDefUser("", helperTypeName, module.CorLibTypes.Object.TypeDefOrRef)
        {
            Attributes = dnlib.DotNet.TypeAttributes.NotPublic | dnlib.DotNet.TypeAttributes.Sealed | dnlib.DotNet.TypeAttributes.Abstract
        };
        module.Types.Add(helperType);

        var asmType = module.Import(typeof(global::System.Reflection.Assembly)).ToTypeSig();
        var streamType = module.Import(typeof(Stream)).ToTypeSig();
        var strType = module.CorLibTypes.String;
        var msTypeRef = module.Import(typeof(MemoryStream));
        var msTypeSig = msTypeRef.ToTypeSig();
        var byteArraySig = new SZArraySig(module.CorLibTypes.Byte);

        var sig = MethodSig.CreateStatic(streamType, asmType, strType);
        var helper = new MethodDefUser("G", sig, dnlib.DotNet.MethodImplAttributes.IL, dnlib.DotNet.MethodAttributes.Private | dnlib.DotNet.MethodAttributes.Static);
        helperType.Methods.Add(helper);

        var getResource = module.Import(typeof(global::System.Reflection.Assembly).GetMethod("GetManifestResourceStream", new[] { typeof(string) })!);
        var streamCopyTo = module.Import(typeof(Stream).GetMethod("CopyTo", new[] { typeof(Stream) })!);
        var streamDispose = module.Import(typeof(Stream).GetMethod("Dispose", Type.EmptyTypes)!);
        var msCtorEmpty = module.Import(typeof(MemoryStream).GetConstructor(Type.EmptyTypes)!);
        var msCtorBytes = module.Import(typeof(MemoryStream).GetConstructor(new[] { typeof(byte[]) })!);
        var msCtorSegment = module.Import(typeof(MemoryStream).GetConstructor(new[] { typeof(byte[]), typeof(int), typeof(int), typeof(bool), typeof(bool) })!);
        var msToArray = module.Import(typeof(MemoryStream).GetMethod("ToArray", Type.EmptyTypes)!);

        var body = new CilBody { InitLocals = true, MaxStack = 8 };
        helper.Body = body;

        var streamLocal = new Local(streamType);
        var memLocal = new Local(msTypeSig);
        var dataLocal = new Local(byteArraySig);
        var iLocal = new Local(module.CorLibTypes.Int32);
        body.Variables.Add(streamLocal);
        body.Variables.Add(memLocal);
        body.Variables.Add(dataLocal);
        body.Variables.Add(iLocal);

        var il = body.Instructions;
        var retNull = Instruction.Create(OpCodes.Ldnull);
        var checkHeader = Instruction.Create(OpCodes.Nop);
        var loopCheck = Instruction.Create(OpCodes.Nop);
        var loopBody = Instruction.Create(OpCodes.Nop);
        var returnSegment = Instruction.Create(OpCodes.Nop);
        var returnPlain = Instruction.Create(OpCodes.Nop);

        // s = asm.GetManifestResourceStream(name)
        il.Add(Instruction.Create(OpCodes.Ldarg_0));
        il.Add(Instruction.Create(OpCodes.Ldarg_1));
        il.Add(Instruction.Create(OpCodes.Callvirt, getResource));
        il.Add(Instruction.Create(OpCodes.Stloc, streamLocal));
        // if (s == null) return null;
        il.Add(Instruction.Create(OpCodes.Ldloc, streamLocal));
        il.Add(Instruction.Create(OpCodes.Brfalse, retNull));

        // ms = new MemoryStream()
        il.Add(Instruction.Create(OpCodes.Newobj, msCtorEmpty));
        il.Add(Instruction.Create(OpCodes.Stloc, memLocal));
        // s.CopyTo(ms); s.Dispose();
        il.Add(Instruction.Create(OpCodes.Ldloc, streamLocal));
        il.Add(Instruction.Create(OpCodes.Ldloc, memLocal));
        il.Add(Instruction.Create(OpCodes.Callvirt, streamCopyTo));
        il.Add(Instruction.Create(OpCodes.Ldloc, streamLocal));
        il.Add(Instruction.Create(OpCodes.Callvirt, streamDispose));
        // data = ms.ToArray();
        il.Add(Instruction.Create(OpCodes.Ldloc, memLocal));
        il.Add(Instruction.Create(OpCodes.Callvirt, msToArray));
        il.Add(Instruction.Create(OpCodes.Stloc, dataLocal));
        // if (data.Length < 5) return new MemoryStream(data);
        il.Add(Instruction.Create(OpCodes.Ldloc, dataLocal));
        il.Add(Instruction.Create(OpCodes.Ldlen));
        il.Add(Instruction.Create(OpCodes.Conv_I4));
        il.Add(Instruction.Create(OpCodes.Ldc_I4_5));
        il.Add(Instruction.Create(OpCodes.Bge, checkHeader));
        il.Add(Instruction.Create(OpCodes.Ldloc, dataLocal));
        il.Add(Instruction.Create(OpCodes.Newobj, msCtorBytes));
        il.Add(Instruction.Create(OpCodes.Ret));

        // if magic mismatch return plain stream
        il.Add(checkHeader);
        il.Add(Instruction.Create(OpCodes.Ldloc, dataLocal));
        il.Add(Instruction.Create(OpCodes.Ldc_I4_0));
        il.Add(Instruction.Create(OpCodes.Ldelem_U1));
        il.Add(Instruction.Create(OpCodes.Ldc_I4, (int)'S'));
        il.Add(Instruction.Create(OpCodes.Bne_Un, returnPlain));
        il.Add(Instruction.Create(OpCodes.Ldloc, dataLocal));
        il.Add(Instruction.Create(OpCodes.Ldc_I4_1));
        il.Add(Instruction.Create(OpCodes.Ldelem_U1));
        il.Add(Instruction.Create(OpCodes.Ldc_I4, (int)'B'));
        il.Add(Instruction.Create(OpCodes.Bne_Un, returnPlain));
        il.Add(Instruction.Create(OpCodes.Ldloc, dataLocal));
        il.Add(Instruction.Create(OpCodes.Ldc_I4_2));
        il.Add(Instruction.Create(OpCodes.Ldelem_U1));
        il.Add(Instruction.Create(OpCodes.Ldc_I4, (int)'R'));
        il.Add(Instruction.Create(OpCodes.Bne_Un, returnPlain));
        il.Add(Instruction.Create(OpCodes.Ldloc, dataLocal));
        il.Add(Instruction.Create(OpCodes.Ldc_I4_3));
        il.Add(Instruction.Create(OpCodes.Ldelem_U1));
        il.Add(Instruction.Create(OpCodes.Ldc_I4, (int)'1'));
        il.Add(Instruction.Create(OpCodes.Bne_Un, returnPlain));

        // for (i = 5; i < data.Length; i++) data[i] = data[i] ^ data[4] ^ (byte)((i-5)&0xFF);
        il.Add(Instruction.Create(OpCodes.Ldc_I4_5));
        il.Add(Instruction.Create(OpCodes.Stloc, iLocal));
        il.Add(Instruction.Create(OpCodes.Br, loopCheck));

        il.Add(loopBody);
        il.Add(Instruction.Create(OpCodes.Ldloc, dataLocal));
        il.Add(Instruction.Create(OpCodes.Ldloc, iLocal));
        il.Add(Instruction.Create(OpCodes.Ldloc, dataLocal));
        il.Add(Instruction.Create(OpCodes.Ldloc, iLocal));
        il.Add(Instruction.Create(OpCodes.Ldelem_U1));
        il.Add(Instruction.Create(OpCodes.Ldloc, dataLocal));
        il.Add(Instruction.Create(OpCodes.Ldc_I4_4));
        il.Add(Instruction.Create(OpCodes.Ldelem_U1));
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
        il.Add(Instruction.Create(OpCodes.Br, returnSegment));

        il.Add(returnPlain);
        il.Add(Instruction.Create(OpCodes.Ldloc, dataLocal));
        il.Add(Instruction.Create(OpCodes.Newobj, msCtorBytes));
        il.Add(Instruction.Create(OpCodes.Ret));

        il.Add(returnSegment);
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
        il.Add(Instruction.Create(OpCodes.Ret));

        il.Add(retNull);
        il.Add(Instruction.Create(OpCodes.Ret));

        return helper;
    }
}
