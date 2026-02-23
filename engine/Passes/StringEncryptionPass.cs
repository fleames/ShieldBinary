using System.Linq;
using System.Reflection;
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

            // Per-string 4-byte key; use fixed key in low-entropy mode to reduce output entropy
            byte[] keyBytes;
            if (ctx.LowEntropy)
            {
                keyBytes = [0x9E, 0x37, 0x79, 0xB9]; // fixed key (reduces randomness in output)
            }
            else
            {
                keyBytes = new byte[4];
                ctx.Random.NextBytes(keyBytes);
            }
            var encrypted = XorEncrypt(str, keyBytes);

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
            // Push 4-byte key as int (little-endian)
            var keyInt = BitConverter.ToInt32(keyBytes, 0);
            newIns.Add(Instruction.Create(OpCodes.Ldc_I4, keyInt));
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

    private static byte[] XorEncrypt(string input, byte[] key)
    {
        var bytes = Encoding.UTF8.GetBytes(input);
        for (var i = 0; i < bytes.Length; i++)
            bytes[i] ^= (byte)(key[i % key.Length] ^ (i & 0xFF));
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
        var sig = MethodSig.CreateStatic(module.CorLibTypes.String, byteArraySig, module.CorLibTypes.Int32);
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
        // key[i%4]: (key >> ((i%4)*8)) & 0xFF
        il.Add(Instruction.Create(OpCodes.Ldarg_1));
        il.Add(Instruction.Create(OpCodes.Ldloc, iLocal));
        il.Add(Instruction.Create(OpCodes.Ldc_I4, 4));
        il.Add(Instruction.Create(OpCodes.Rem));
        il.Add(Instruction.Create(OpCodes.Ldc_I4, 8));
        il.Add(Instruction.Create(OpCodes.Mul));
        il.Add(Instruction.Create(OpCodes.Shr_Un));
        il.Add(Instruction.Create(OpCodes.Ldc_I4, 255));
        il.Add(Instruction.Create(OpCodes.And));
        il.Add(Instruction.Create(OpCodes.Ldloc, iLocal));
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
