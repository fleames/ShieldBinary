using dnlib.DotNet;
using dnlib.DotNet.Emit;
using ShieldBinary.Engine;

namespace ShieldBinary.Engine.Passes;

/// <summary>
/// Conservative first-call decryption pattern for simple constant-returning int methods.
/// This is an opt-in bootstrap implementation for method-body encryption.
/// </summary>
public sealed class MethodBodyEncryptionPass : IProtectionPass
{
    public string Name => "method_body_encryption";

    public void Run(PipelineContext ctx, ModuleDef module)
    {
        if (!ctx.EnableMethodBodyEncryption)
            return;

        var helperType = new TypeDefUser("", "MBE" + Guid.NewGuid().ToString("N")[..8], module.CorLibTypes.Object.TypeDefOrRef)
        {
            Attributes = dnlib.DotNet.TypeAttributes.NotPublic | dnlib.DotNet.TypeAttributes.Sealed | dnlib.DotNet.TypeAttributes.Abstract
        };
        module.Types.Add(helperType);

        var encrypted = 0;
        foreach (var type in module.GetAllTypes())
        {
            foreach (var method in type.Methods)
            {
                if (method.IsConstructor || method.IsStaticConstructor)
                    continue;
                if (method.IsAbstract || method.IsPinvokeImpl)
                    continue;
                if (ctx.Random.Next(100) > 35)
                    continue;

                if (TryGetSimpleConstIntReturn(method, out var intValue))
                {
                    EncryptIntMethodBody(ctx, module, helperType, method, intValue, encrypted++);
                    continue;
                }
                if (TryGetSimpleConstStringReturn(method, out var strValue))
                {
                    EncryptStringMethodBody(ctx, module, helperType, method, strValue, encrypted++);
                    continue;
                }
                if (TryGetSimpleConstFloatReturn(method, out var fValue))
                {
                    EncryptFloatMethodBody(ctx, module, helperType, method, fValue, encrypted++);
                    continue;
                }
                if (TryGetSimpleConstDoubleReturn(method, out var dValue))
                {
                    EncryptDoubleMethodBody(ctx, module, helperType, method, dValue, encrypted++);
                }
            }
        }
    }

    private static bool TryGetSimpleConstIntReturn(MethodDef method, out int value)
    {
        value = 0;
        if (!method.HasBody || method.Body == null)
            return false;
        if (method.MethodSig == null || method.MethodSig.RetType.ElementType != ElementType.I4)
            return false;
        var ins = method.Body.Instructions.Where(i => i.OpCode.Code != Code.Nop).ToList();
        if (ins.Count != 2 || ins[1].OpCode.Code != Code.Ret)
            return false;
        return TryGetLdcI4(ins[0], out value);
    }

    private static bool TryGetSimpleConstStringReturn(MethodDef method, out string value)
    {
        value = string.Empty;
        if (!method.HasBody || method.Body == null)
            return false;
        if (method.MethodSig == null || method.MethodSig.RetType.ElementType != ElementType.String)
            return false;
        var ins = method.Body.Instructions.Where(i => i.OpCode.Code != Code.Nop).ToList();
        if (ins.Count != 2 || ins[1].OpCode.Code != Code.Ret)
            return false;
        if (ins[0].OpCode.Code != Code.Ldstr)
            return false;
        value = ins[0].Operand?.ToString() ?? string.Empty;
        return true;
    }

    private static bool TryGetSimpleConstFloatReturn(MethodDef method, out float value)
    {
        value = 0f;
        if (!method.HasBody || method.Body == null)
            return false;
        if (method.MethodSig == null || method.MethodSig.RetType.ElementType != ElementType.R4)
            return false;
        var ins = method.Body.Instructions.Where(i => i.OpCode.Code != Code.Nop).ToList();
        if (ins.Count != 2 || ins[1].OpCode.Code != Code.Ret)
            return false;
        if (ins[0].OpCode.Code != Code.Ldc_R4)
            return false;
        value = ins[0].Operand is float fv ? fv : 0f;
        return !(float.IsNaN(value) || float.IsInfinity(value));
    }

    private static bool TryGetSimpleConstDoubleReturn(MethodDef method, out double value)
    {
        value = 0d;
        if (!method.HasBody || method.Body == null)
            return false;
        if (method.MethodSig == null || method.MethodSig.RetType.ElementType != ElementType.R8)
            return false;
        var ins = method.Body.Instructions.Where(i => i.OpCode.Code != Code.Nop).ToList();
        if (ins.Count != 2 || ins[1].OpCode.Code != Code.Ret)
            return false;
        if (ins[0].OpCode.Code != Code.Ldc_R8)
            return false;
        value = ins[0].Operand is double dv ? dv : 0d;
        return !(double.IsNaN(value) || double.IsInfinity(value));
    }

    private static void EncryptIntMethodBody(PipelineContext ctx, ModuleDef module, TypeDef helperType, MethodDef method, int plainValue, int idx)
    {
        var key = ctx.LowEntropy ? ((Math.Abs(plainValue) % 251) + 3) : ctx.Random.Next(3, 255);
        var cipher = plainValue ^ key;

        var valueField = new FieldDefUser(
            "V" + idx.ToString("X"),
            new FieldSig(module.CorLibTypes.Int32),
            dnlib.DotNet.FieldAttributes.Private | dnlib.DotNet.FieldAttributes.Static);
        var readyField = new FieldDefUser(
            "R" + idx.ToString("X"),
            new FieldSig(module.CorLibTypes.Boolean),
            dnlib.DotNet.FieldAttributes.Private | dnlib.DotNet.FieldAttributes.Static);
        helperType.Fields.Add(valueField);
        helperType.Fields.Add(readyField);

        var body = new CilBody { InitLocals = false, MaxStack = 4 };
        var lReady = Instruction.Create(OpCodes.Nop);
        method.Body = body;
        body.Instructions.Add(Instruction.Create(OpCodes.Ldsfld, readyField));
        body.Instructions.Add(Instruction.Create(OpCodes.Brtrue_S, lReady));
        body.Instructions.Add(Instruction.Create(OpCodes.Ldc_I4, cipher));
        body.Instructions.Add(Instruction.Create(OpCodes.Ldc_I4, key));
        body.Instructions.Add(Instruction.Create(OpCodes.Xor));
        body.Instructions.Add(Instruction.Create(OpCodes.Stsfld, valueField));
        body.Instructions.Add(Instruction.Create(OpCodes.Ldc_I4_1));
        body.Instructions.Add(Instruction.Create(OpCodes.Stsfld, readyField));
        body.Instructions.Add(lReady);
        body.Instructions.Add(Instruction.Create(OpCodes.Ldsfld, valueField));
        body.Instructions.Add(Instruction.Create(OpCodes.Ret));
    }

    private static void EncryptStringMethodBody(PipelineContext ctx, ModuleDef module, TypeDef helperType, MethodDef method, string plainValue, int idx)
    {
        var key = ctx.LowEntropy ? (byte)((plainValue.Length % 251) + 3) : (byte)ctx.Random.Next(3, 255);
        var plainBytes = System.Text.Encoding.UTF8.GetBytes(plainValue);
        var encBytes = new byte[plainBytes.Length];
        for (var i = 0; i < plainBytes.Length; i++)
            encBytes[i] = (byte)(plainBytes[i] ^ key ^ (byte)(i & 0xFF));
        var cipherBase64 = Convert.ToBase64String(encBytes);

        var valueField = new FieldDefUser(
            "SV" + idx.ToString("X"),
            new FieldSig(module.CorLibTypes.String),
            dnlib.DotNet.FieldAttributes.Private | dnlib.DotNet.FieldAttributes.Static);
        var readyField = new FieldDefUser(
            "SR" + idx.ToString("X"),
            new FieldSig(module.CorLibTypes.Boolean),
            dnlib.DotNet.FieldAttributes.Private | dnlib.DotNet.FieldAttributes.Static);
        helperType.Fields.Add(valueField);
        helperType.Fields.Add(readyField);

        var fromBase64 = module.Import(typeof(Convert).GetMethod("FromBase64String", new[] { typeof(string) })!);
        var getUtf8 = module.Import(typeof(System.Text.Encoding).GetProperty("UTF8")!.GetGetMethod()!);
        var getString = module.Import(typeof(System.Text.Encoding).GetMethod("GetString", new[] { typeof(byte[]) })!);

        var body = new CilBody { InitLocals = true, MaxStack = 8 };
        var bytesLocal = new Local(new SZArraySig(module.CorLibTypes.Byte));
        var iLocal = new Local(module.CorLibTypes.Int32);
        body.Variables.Add(bytesLocal);
        body.Variables.Add(iLocal);
        var lReady = Instruction.Create(OpCodes.Nop);
        var lLoopCheck = Instruction.Create(OpCodes.Nop);
        var lLoopBody = Instruction.Create(OpCodes.Nop);
        method.Body = body;

        body.Instructions.Add(Instruction.Create(OpCodes.Ldsfld, readyField));
        body.Instructions.Add(Instruction.Create(OpCodes.Brtrue_S, lReady));
        body.Instructions.Add(Instruction.Create(OpCodes.Ldstr, cipherBase64));
        body.Instructions.Add(Instruction.Create(OpCodes.Call, fromBase64));
        body.Instructions.Add(Instruction.Create(OpCodes.Stloc, bytesLocal));
        body.Instructions.Add(Instruction.Create(OpCodes.Ldc_I4_0));
        body.Instructions.Add(Instruction.Create(OpCodes.Stloc, iLocal));
        body.Instructions.Add(Instruction.Create(OpCodes.Br, lLoopCheck));
        body.Instructions.Add(lLoopBody);
        body.Instructions.Add(Instruction.Create(OpCodes.Ldloc, bytesLocal));
        body.Instructions.Add(Instruction.Create(OpCodes.Ldloc, iLocal));
        body.Instructions.Add(Instruction.Create(OpCodes.Ldloc, bytesLocal));
        body.Instructions.Add(Instruction.Create(OpCodes.Ldloc, iLocal));
        body.Instructions.Add(Instruction.Create(OpCodes.Ldelem_U1));
        body.Instructions.Add(Instruction.Create(OpCodes.Ldc_I4, (int)key));
        body.Instructions.Add(Instruction.Create(OpCodes.Xor));
        body.Instructions.Add(Instruction.Create(OpCodes.Ldloc, iLocal));
        body.Instructions.Add(Instruction.Create(OpCodes.Ldc_I4, 255));
        body.Instructions.Add(Instruction.Create(OpCodes.And));
        body.Instructions.Add(Instruction.Create(OpCodes.Xor));
        body.Instructions.Add(Instruction.Create(OpCodes.Conv_U1));
        body.Instructions.Add(Instruction.Create(OpCodes.Stelem_I1));
        body.Instructions.Add(Instruction.Create(OpCodes.Ldloc, iLocal));
        body.Instructions.Add(Instruction.Create(OpCodes.Ldc_I4_1));
        body.Instructions.Add(Instruction.Create(OpCodes.Add));
        body.Instructions.Add(Instruction.Create(OpCodes.Stloc, iLocal));
        body.Instructions.Add(lLoopCheck);
        body.Instructions.Add(Instruction.Create(OpCodes.Ldloc, iLocal));
        body.Instructions.Add(Instruction.Create(OpCodes.Ldloc, bytesLocal));
        body.Instructions.Add(Instruction.Create(OpCodes.Ldlen));
        body.Instructions.Add(Instruction.Create(OpCodes.Conv_I4));
        body.Instructions.Add(Instruction.Create(OpCodes.Blt, lLoopBody));
        body.Instructions.Add(Instruction.Create(OpCodes.Call, getUtf8));
        body.Instructions.Add(Instruction.Create(OpCodes.Ldloc, bytesLocal));
        body.Instructions.Add(Instruction.Create(OpCodes.Callvirt, getString));
        body.Instructions.Add(Instruction.Create(OpCodes.Stsfld, valueField));
        body.Instructions.Add(Instruction.Create(OpCodes.Ldc_I4_1));
        body.Instructions.Add(Instruction.Create(OpCodes.Stsfld, readyField));
        body.Instructions.Add(lReady);
        body.Instructions.Add(Instruction.Create(OpCodes.Ldsfld, valueField));
        body.Instructions.Add(Instruction.Create(OpCodes.Ret));
    }

    private static void EncryptFloatMethodBody(PipelineContext ctx, ModuleDef module, TypeDef helperType, MethodDef method, float plainValue, int idx)
    {
        var key = ctx.LowEntropy ? 0x2A3F91D : ctx.Random.Next();
        var plainBits = BitConverter.SingleToInt32Bits(plainValue);
        var cipherBits = plainBits ^ key;

        var valueField = new FieldDefUser(
            "FV" + idx.ToString("X"),
            new FieldSig(module.CorLibTypes.Single),
            dnlib.DotNet.FieldAttributes.Private | dnlib.DotNet.FieldAttributes.Static);
        var readyField = new FieldDefUser(
            "FR" + idx.ToString("X"),
            new FieldSig(module.CorLibTypes.Boolean),
            dnlib.DotNet.FieldAttributes.Private | dnlib.DotNet.FieldAttributes.Static);
        helperType.Fields.Add(valueField);
        helperType.Fields.Add(readyField);

        var intToFloat = module.Import(typeof(BitConverter).GetMethod("Int32BitsToSingle", new[] { typeof(int) })!);

        var body = new CilBody { InitLocals = false, MaxStack = 4 };
        var lReady = Instruction.Create(OpCodes.Nop);
        method.Body = body;
        body.Instructions.Add(Instruction.Create(OpCodes.Ldsfld, readyField));
        body.Instructions.Add(Instruction.Create(OpCodes.Brtrue_S, lReady));
        body.Instructions.Add(Instruction.Create(OpCodes.Ldc_I4, cipherBits));
        body.Instructions.Add(Instruction.Create(OpCodes.Ldc_I4, key));
        body.Instructions.Add(Instruction.Create(OpCodes.Xor));
        body.Instructions.Add(Instruction.Create(OpCodes.Call, intToFloat));
        body.Instructions.Add(Instruction.Create(OpCodes.Stsfld, valueField));
        body.Instructions.Add(Instruction.Create(OpCodes.Ldc_I4_1));
        body.Instructions.Add(Instruction.Create(OpCodes.Stsfld, readyField));
        body.Instructions.Add(lReady);
        body.Instructions.Add(Instruction.Create(OpCodes.Ldsfld, valueField));
        body.Instructions.Add(Instruction.Create(OpCodes.Ret));
    }

    private static void EncryptDoubleMethodBody(PipelineContext ctx, ModuleDef module, TypeDef helperType, MethodDef method, double plainValue, int idx)
    {
        long key = ctx.LowEntropy ? 0x1F2E3D4C5B6A7980L : ((long)ctx.Random.Next() << 32) | (uint)ctx.Random.Next();
        var plainBits = BitConverter.DoubleToInt64Bits(plainValue);
        var cipherBits = plainBits ^ key;

        var valueField = new FieldDefUser(
            "DV" + idx.ToString("X"),
            new FieldSig(module.CorLibTypes.Double),
            dnlib.DotNet.FieldAttributes.Private | dnlib.DotNet.FieldAttributes.Static);
        var readyField = new FieldDefUser(
            "DR" + idx.ToString("X"),
            new FieldSig(module.CorLibTypes.Boolean),
            dnlib.DotNet.FieldAttributes.Private | dnlib.DotNet.FieldAttributes.Static);
        helperType.Fields.Add(valueField);
        helperType.Fields.Add(readyField);

        var longToDouble = module.Import(typeof(BitConverter).GetMethod("Int64BitsToDouble", new[] { typeof(long) })!);

        var body = new CilBody { InitLocals = false, MaxStack = 4 };
        var lReady = Instruction.Create(OpCodes.Nop);
        method.Body = body;
        body.Instructions.Add(Instruction.Create(OpCodes.Ldsfld, readyField));
        body.Instructions.Add(Instruction.Create(OpCodes.Brtrue_S, lReady));
        body.Instructions.Add(Instruction.Create(OpCodes.Ldc_I8, cipherBits));
        body.Instructions.Add(Instruction.Create(OpCodes.Ldc_I8, key));
        body.Instructions.Add(Instruction.Create(OpCodes.Xor));
        body.Instructions.Add(Instruction.Create(OpCodes.Call, longToDouble));
        body.Instructions.Add(Instruction.Create(OpCodes.Stsfld, valueField));
        body.Instructions.Add(Instruction.Create(OpCodes.Ldc_I4_1));
        body.Instructions.Add(Instruction.Create(OpCodes.Stsfld, readyField));
        body.Instructions.Add(lReady);
        body.Instructions.Add(Instruction.Create(OpCodes.Ldsfld, valueField));
        body.Instructions.Add(Instruction.Create(OpCodes.Ret));
    }

    private static bool TryGetLdcI4(Instruction ins, out int value)
    {
        switch (ins.OpCode.Code)
        {
            case Code.Ldc_I4_M1: value = -1; return true;
            case Code.Ldc_I4_0: value = 0; return true;
            case Code.Ldc_I4_1: value = 1; return true;
            case Code.Ldc_I4_2: value = 2; return true;
            case Code.Ldc_I4_3: value = 3; return true;
            case Code.Ldc_I4_4: value = 4; return true;
            case Code.Ldc_I4_5: value = 5; return true;
            case Code.Ldc_I4_6: value = 6; return true;
            case Code.Ldc_I4_7: value = 7; return true;
            case Code.Ldc_I4_8: value = 8; return true;
            case Code.Ldc_I4_S:
                value = ins.Operand is sbyte sb ? sb : 0;
                return true;
            case Code.Ldc_I4:
                value = ins.Operand is int iv ? iv : 0;
                return true;
            default:
                value = 0;
                return false;
        }
    }
}
