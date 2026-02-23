using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using dnlib.DotNet;
using dnlib.DotNet.Emit;
using ShieldBinary.Engine;

namespace ShieldBinary.Engine.Passes;

public sealed class StringEncryptionPass : IProtectionPass
{
    public string Name => "string_encryption";

    public void Run(PipelineContext ctx, ModuleDef module)
    {
        var decryptor = InjectDecryptor(module, ctx.LowEntropy);
        var entryPointType = module.EntryPoint?.DeclaringType;
        var strings = CollectStrings(module);
        // Process in reverse index order so inserts don't invalidate indices
        foreach (var (method, index, str, isProtected) in strings.OrderByDescending(x => x.Item2))
        {
            if (string.IsNullOrEmpty(str) || isProtected)
                continue;
            if (method.Body?.Instructions == null)
                continue;
            // Don't encrypt strings in entry point type (startup-critical)
            if (entryPointType != null && IsInType(entryPointType, method.DeclaringType))
                continue;
            // Don't encrypt strings that look like type names (breaks reflection, serialization)
            if (LooksLikeTypeOrReflectionName(str))
                continue;

            // This is anti-static-analysis obfuscation, not cryptographic confidentiality.
            // We avoid a fixed global key by deriving a per-string key from structural context.
            var keyBytes = BuildPerStringKey(ctx, module, method, index, str);
            var encrypted = Obfuscate(str, keyBytes);

            var instructions = method.Body.Instructions;
            var newIns = new List<Instruction>();
            newIns.Add(Instruction.Create(OpCodes.Ldc_I4, encrypted.Length));
            newIns.Add(Instruction.Create(OpCodes.Newarr, module.CorLibTypes.Byte.TypeDefOrRef));
            for (var i = 0; i < encrypted.Length; i++)
            {
                newIns.Add(Instruction.Create(OpCodes.Dup));
                newIns.Add(Instruction.Create(OpCodes.Ldc_I4, i));
                newIns.Add(Instruction.Create(OpCodes.Ldc_I4, (int)encrypted[i]));
                newIns.Add(Instruction.Create(OpCodes.Stelem_I1));
            }
            newIns.Add(Instruction.Create(OpCodes.Ldc_I4, keyBytes.Length));
            newIns.Add(Instruction.Create(OpCodes.Newarr, module.CorLibTypes.Byte.TypeDefOrRef));
            for (var i = 0; i < keyBytes.Length; i++)
            {
                newIns.Add(Instruction.Create(OpCodes.Dup));
                newIns.Add(Instruction.Create(OpCodes.Ldc_I4, i));
                newIns.Add(Instruction.Create(OpCodes.Ldc_I4, (int)keyBytes[i]));
                newIns.Add(Instruction.Create(OpCodes.Stelem_I1));
            }
            newIns.Add(Instruction.Create(OpCodes.Call, decryptor));

            instructions[index] = Instruction.Create(OpCodes.Nop);
            foreach (var n in newIns.AsEnumerable().Reverse())
            {
                instructions.Insert(index, n);
            }
        }
    }

    private static bool IsInType(TypeDef? parent, TypeDef? type)
    {
        while (type != null)
        {
            if (type == parent) return true;
            type = type.DeclaringType;
        }
        return false;
    }

    private static bool LooksLikeTypeOrReflectionName(string s)
    {
        if (string.IsNullOrEmpty(s) || s.Length > 500) return false;
        // Type names: "Namespace.Type" or "Namespace.Type, AssemblyName"
        if (s.Contains('.') && !s.Contains('/') && !s.Contains('\\'))
        {
            if (s.Contains(", ")) return true; // "Type, Assembly"
            if (s.Length >= 3 && char.IsLetter(s[0]) && s.IndexOf('.') > 0) return true;
        }
        // Common method names used with reflection (GetMethod, InvokeMember, etc.)
        if (s is "Main" or "Initialize" or "InitializeComponent" or "OnLoad" or "Run" or "Start")
            return true;
        return false;
    }

    private static byte[] BuildPerStringKey(PipelineContext ctx, ModuleDef module, MethodDef method, int instructionIndex, string value)
    {
        var moduleId = module.Mvid.ToString();
        var material = $"{moduleId}:{method.MDToken.ToInt32()}:{instructionIndex}:{value.Length}:{ctx.Tier}:{ctx.LowEntropy}";
        var digest = SHA256.HashData(Encoding.UTF8.GetBytes(material));
        var key = new byte[16];
        Buffer.BlockCopy(digest, 0, key, 0, key.Length);
        if (!ctx.LowEntropy)
        {
            var randomMask = new byte[16];
            ctx.Random.NextBytes(randomMask);
            for (var i = 0; i < key.Length; i++)
            {
                key[i] ^= randomMask[i];
            }
        }
        return key;
    }

    private static byte[] Obfuscate(string input, byte[] key)
    {
        var bytes = Encoding.UTF8.GetBytes(input);
        for (var i = 0; i < bytes.Length; i++)
        {
            var k0 = key[i % key.Length];
            var k1 = key[(i * 7 + 3) % key.Length];
            var mix = (byte)(((i * 131) ^ (i >> 1)) & 0xFF);
            bytes[i] ^= (byte)(k0 ^ k1 ^ mix);
        }
        return bytes;
    }

    private static IList<(MethodDef Method, int Index, string Value, bool IsProtected)> CollectStrings(ModuleDef module)
    {
        var result = new List<(MethodDef, int, string, bool)>();
        foreach (var type in module.GetAllTypes())
        {
            foreach (var method in type.Methods)
            {
                if (!method.HasBody)
                    continue;
                var protectedSet = CilBodyExtensions.GetProtectedInstructions(method.Body);
                for (var i = 0; i < method.Body.Instructions.Count; i++)
                {
                    var ins = method.Body.Instructions[i];
                    if (ins.OpCode.Code == Code.Ldstr)
                    {
                        result.Add((method, i, ins.Operand as string ?? "", protectedSet.Contains(ins)));
                    }
                }
            }
        }
        return result;
    }

    private IMethod InjectDecryptor(ModuleDef module, bool lowEntropy)
    {
        var helperName = lowEntropy ? "StrDec" : "S" + Guid.NewGuid().ToString("N")[..8];
        var helperType = new TypeDefUser("", helperName, module.CorLibTypes.Object.TypeDefOrRef);
        helperType.Attributes = dnlib.DotNet.TypeAttributes.NotPublic | dnlib.DotNet.TypeAttributes.Sealed | dnlib.DotNet.TypeAttributes.Abstract;
        module.Types.Add(helperType);

        var byteArraySig = new SZArraySig(module.CorLibTypes.Byte);
        var sig = MethodSig.CreateStatic(module.CorLibTypes.String, byteArraySig, byteArraySig);
        var decryptMethod = new MethodDefUser("D", sig, dnlib.DotNet.MethodImplAttributes.IL, dnlib.DotNet.MethodAttributes.Private | dnlib.DotNet.MethodAttributes.Static);
        helperType.Methods.Add(decryptMethod);

        var utf8Method = typeof(Encoding).GetMethod("get_UTF8", BindingFlags.Public | BindingFlags.Static, []);
        var getStringMethod = typeof(Encoding).GetMethod("GetString", [typeof(byte[])]);
        if (utf8Method == null || getStringMethod == null)
            throw new InvalidOperationException("Failed to resolve Encoding.UTF8 or GetString");
        var utf8Ref = module.Import(utf8Method);
        var getStringRef = module.Import(getStringMethod);

        var body = decryptMethod.Body ?? new CilBody();
        if (decryptMethod.Body == null)
            decryptMethod.Body = body;
        body.InitLocals = true;
        body.MaxStack = 8;
        var iLocal = new Local(module.CorLibTypes.Int32);
        body.Variables.Add(iLocal);

        var il = body.Instructions;
        il.Add(Instruction.Create(OpCodes.Ldc_I4_0));
        il.Add(Instruction.Create(OpCodes.Stloc, iLocal));
        var loopCheck = Instruction.Create(OpCodes.Ldloc, iLocal);
        il.Add(Instruction.Create(OpCodes.Br, loopCheck));
        var loopStart = Instruction.Create(OpCodes.Ldarg_0);
        il.Add(loopStart);
        il.Add(Instruction.Create(OpCodes.Ldloc, iLocal));
        il.Add(Instruction.Create(OpCodes.Ldelem_U1));
        // k0 = key[i%keyLen]
        il.Add(Instruction.Create(OpCodes.Ldarg_1));
        il.Add(Instruction.Create(OpCodes.Ldloc, iLocal));
        il.Add(Instruction.Create(OpCodes.Ldarg_1));
        il.Add(Instruction.Create(OpCodes.Ldlen));
        il.Add(Instruction.Create(OpCodes.Conv_I4));
        il.Add(Instruction.Create(OpCodes.Rem));
        il.Add(Instruction.Create(OpCodes.Ldelem_U1));
        // k1 = key[(i*7+3)%keyLen]
        il.Add(Instruction.Create(OpCodes.Ldarg_1));
        il.Add(Instruction.Create(OpCodes.Ldloc, iLocal));
        il.Add(Instruction.Create(OpCodes.Ldc_I4, 7));
        il.Add(Instruction.Create(OpCodes.Mul));
        il.Add(Instruction.Create(OpCodes.Ldc_I4_3));
        il.Add(Instruction.Create(OpCodes.Add));
        il.Add(Instruction.Create(OpCodes.Ldarg_1));
        il.Add(Instruction.Create(OpCodes.Ldlen));
        il.Add(Instruction.Create(OpCodes.Conv_I4));
        il.Add(Instruction.Create(OpCodes.Rem));
        il.Add(Instruction.Create(OpCodes.Ldelem_U1));
        il.Add(Instruction.Create(OpCodes.Xor));
        // mix = ((i*131) ^ (i>>1)) & 0xFF
        il.Add(Instruction.Create(OpCodes.Ldloc, iLocal));
        il.Add(Instruction.Create(OpCodes.Ldc_I4, 131));
        il.Add(Instruction.Create(OpCodes.Mul));
        il.Add(Instruction.Create(OpCodes.Ldloc, iLocal));
        il.Add(Instruction.Create(OpCodes.Ldc_I4_1));
        il.Add(Instruction.Create(OpCodes.Shr));
        il.Add(Instruction.Create(OpCodes.Xor));
        il.Add(Instruction.Create(OpCodes.Ldc_I4, 255));
        il.Add(Instruction.Create(OpCodes.And));
        il.Add(Instruction.Create(OpCodes.Xor));
        il.Add(Instruction.Create(OpCodes.Conv_U1));
        il.Add(Instruction.Create(OpCodes.Ldarg_0));
        il.Add(Instruction.Create(OpCodes.Ldloc, iLocal));
        il.Add(Instruction.Create(OpCodes.Stelem_I1));
        il.Add(Instruction.Create(OpCodes.Ldloc, iLocal));
        il.Add(Instruction.Create(OpCodes.Ldc_I4_1));
        il.Add(Instruction.Create(OpCodes.Add));
        il.Add(Instruction.Create(OpCodes.Stloc, iLocal));
        il.Add(loopCheck);
        il.Add(Instruction.Create(OpCodes.Ldarg_0));
        il.Add(Instruction.Create(OpCodes.Ldlen));
        il.Add(Instruction.Create(OpCodes.Conv_I4));
        il.Add(Instruction.Create(OpCodes.Blt, loopStart));
        il.Add(Instruction.Create(OpCodes.Call, utf8Ref)); // Encoding.UTF8
        il.Add(Instruction.Create(OpCodes.Ldarg_0));       // byte[] array
        il.Add(Instruction.Create(OpCodes.Callvirt, getStringRef)); // Encoding.GetString(array)
        il.Add(Instruction.Create(OpCodes.Ret));

        return decryptMethod;
    }
}
