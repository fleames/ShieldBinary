using System;
using System.Reflection;

namespace ShieldBinary.VmRuntime;

/// <summary>
/// Runtime interpreter for ShieldBinary virtualized IL bytecode.
/// Referenced by protected assemblies; must be deployed alongside.
/// </summary>
public static class VmRunner
{
    private delegate bool VmOpHandler(
        byte[] bc,
        int[] tokens,
        object[] args,
        object[] locals,
        object[] stack,
        ref int sp,
        ref int ip,
        Module module,
        out object returnValue);

    /// <summary>
    /// Execute virtualized bytecode. Called from virtualized method stubs.
    /// </summary>
    /// <param name="bytecode">VM bytecode (opcodes + operands)</param>
    /// <param name="tokens">Metadata token table (method/field/type RIDs)</param>
    /// <param name="args">Boxed arguments (incl. 'this' for instance methods)</param>
    /// <param name="locals">Boxed locals (pre-allocated, length = local count)</param>
    /// <param name="maxStack">Maximum stack depth</param>
    /// <param name="module">Module for token resolution (assembly context)</param>
    /// <returns>Boxed return value, or null for void</returns>
    public static object Run(
        byte[] bytecode,
        int[] tokens,
        byte[] opcodeDecodeMap,
        byte[] dispatchSchedule,
        object[] args,
        object[] locals,
        int maxStack,
        Module module)
    {
        if (bytecode == null || bytecode.Length == 0)
            return null;

        var stack = new object[maxStack];
        var sp = 0;
        var ip = 0;
        var bc = bytecode;
        var dispatchMap = BuildRandomDispatchMap();
        var dispatchUnmap = InvertMap(dispatchMap);
        var dispatchMap2 = BuildRandomDispatchMap();
        var dispatchUnmap2 = InvertMap(dispatchMap2);
        var handlerTable = BuildHandlerTable();

        try
        {
            while (ip < bc.Length)
            {
                var encoded = bc[ip++];
                var decoded = (opcodeDecodeMap != null && opcodeDecodeMap.Length == 256) ? opcodeDecodeMap[encoded] : encoded;
                var op = (VmOpcode)decoded;
                var dispatchEngine = GetDispatchEngine(dispatchSchedule, ip);
                if (dispatchEngine == 1)
                {
                    var k = dispatchMap[(byte)op];
                    op = (VmOpcode)dispatchUnmap[k];
                }
                else if (dispatchEngine == 2)
                {
                    var k1 = dispatchMap[(byte)op];
                    var k2 = dispatchMap2[k1];
                    op = (VmOpcode)dispatchUnmap2[k2];
                }
                else if (dispatchEngine == 3)
                {
                    var handler = handlerTable[(byte)op];
                    if (handler == null)
                        throw new InvalidProgramException($"Unknown VM opcode: {op}");
                    if (handler(bc, tokens, args, locals, stack, ref sp, ref ip, module, out var tableResult))
                        return tableResult;
                    continue;
                }
                if (ExecuteOpcode(op, bc, tokens, args, locals, stack, ref sp, ref ip, module, out var directResult))
                    return directResult;
            }
        }
        catch (Exception ex)
        {
            WriteCrashReport(ex, ip, sp, bc, stack, opcodeDecodeMap);
            throw;
        }

        return sp > 0 ? stack[sp - 1] : null;
    }

    private static void WriteCrashReport(Exception ex, int ip, int sp, byte[] bc, object[] stack, byte[] opcodeDecodeMap)
    {
        try
        {
            var sb = new System.Text.StringBuilder();
            sb.AppendLine("=== ShieldBinary VmRuntime Crash ===");
            sb.AppendLine($"Time:      {DateTime.UtcNow:yyyy-MM-dd HH:mm:ss} UTC");
            sb.AppendLine($"Exception: {ex.GetType().FullName}: {ex.Message}");
            sb.AppendLine($"IP:        {ip} / {bc?.Length ?? 0}");
            sb.AppendLine($"SP:        {sp}");
            if (bc != null && ip > 0 && ip <= bc.Length)
            {
                var lastByte = bc[Math.Max(0, ip - 1)];
                var decoded = (opcodeDecodeMap?.Length == 256) ? opcodeDecodeMap[lastByte] : lastByte;
                sb.AppendLine($"Last byte: 0x{lastByte:X2} → opcode 0x{decoded:X2} ({(VmOpcode)decoded})");
            }
            for (var i = 0; i < Math.Min(sp, stack?.Length ?? 0); i++)
                sb.AppendLine($"  stack[{i}]: {stack![i]?.GetType().Name ?? "null"} = {stack[i]}");
            sb.AppendLine();
            sb.AppendLine(ex.StackTrace);
            sb.AppendLine("=====================");

            var report = sb.ToString();
            Console.Error.WriteLine(report);
            var dir = AppDomain.CurrentDomain.BaseDirectory;
            System.IO.File.AppendAllText(System.IO.Path.Combine(dir, "vmruntime_crash.txt"), report);
        }
        catch { }
    }

    private static VmOpHandler[] BuildHandlerTable()
    {
        var table = new VmOpHandler[256];
        foreach (VmOpcode op in Enum.GetValues(typeof(VmOpcode)))
        {
            var captured = op;
            table[(byte)captured] = (byte[] bc, int[] tokens, object[] args, object[] locals, object[] stack, ref int sp, ref int ip, Module module, out object returnValue) =>
                ExecuteOpcode(captured, bc, tokens, args, locals, stack, ref sp, ref ip, module, out returnValue);
        }
        return table;
    }

    private static bool ExecuteOpcode(
        VmOpcode op,
        byte[] bc,
        int[] tokens,
        object[] args,
        object[] locals,
        object[] stack,
        ref int sp,
        ref int ip,
        Module module,
        out object returnValue)
    {
        returnValue = null;
        switch (op)
        {
            case VmOpcode.Nop:
                return false;
            case VmOpcode.Dup:
                stack[sp] = stack[sp - 1];
                sp++;
                return false;
            case VmOpcode.Pop:
                sp--;
                return false;

            case VmOpcode.LdcI4:
                stack[sp++] = ReadI4(bc, ref ip);
                return false;
            case VmOpcode.LdcI8:
                stack[sp++] = ReadI8(bc, ref ip);
                return false;
            case VmOpcode.LdcR4:
                stack[sp++] = ReadR4(bc, ref ip);
                return false;
            case VmOpcode.LdcR8:
                stack[sp++] = ReadR8(bc, ref ip);
                return false;
            case VmOpcode.LdcNull:
                stack[sp++] = null;
                return false;

            case VmOpcode.Ldarg:
                stack[sp++] = args[ReadI4(bc, ref ip)];
                return false;
            case VmOpcode.Starg:
                args[ReadI4(bc, ref ip)] = stack[--sp];
                return false;
            case VmOpcode.Ldloc:
                stack[sp++] = locals[ReadI4(bc, ref ip)];
                return false;
            case VmOpcode.Stloc:
                locals[ReadI4(bc, ref ip)] = stack[--sp];
                return false;

            case VmOpcode.Add:
                sp--;
                stack[sp - 1] = Add(stack[sp - 1], stack[sp]);
                return false;
            case VmOpcode.Sub:
                sp--;
                stack[sp - 1] = Sub(stack[sp - 1], stack[sp]);
                return false;
            case VmOpcode.Mul:
                sp--;
                stack[sp - 1] = Mul(stack[sp - 1], stack[sp]);
                return false;
            case VmOpcode.Div:
                sp--;
                stack[sp - 1] = Div(stack[sp - 1], stack[sp]);
                return false;
            case VmOpcode.DivUn:
                sp--;
                stack[sp - 1] = DivUn(stack[sp - 1], stack[sp]);
                return false;
            case VmOpcode.Rem:
                sp--;
                stack[sp - 1] = Rem(stack[sp - 1], stack[sp]);
                return false;
            case VmOpcode.RemUn:
                sp--;
                stack[sp - 1] = RemUn(stack[sp - 1], stack[sp]);
                return false;
            case VmOpcode.Neg:
                stack[sp - 1] = Neg(stack[sp - 1]);
                return false;
            case VmOpcode.And:
                sp--;
                stack[sp - 1] = And(stack[sp - 1], stack[sp]);
                return false;
            case VmOpcode.Or:
                sp--;
                stack[sp - 1] = Or(stack[sp - 1], stack[sp]);
                return false;
            case VmOpcode.Xor:
                sp--;
                stack[sp - 1] = Xor(stack[sp - 1], stack[sp]);
                return false;
            case VmOpcode.Not:
                stack[sp - 1] = Not(stack[sp - 1]);
                return false;
            case VmOpcode.Shl:
                sp--;
                stack[sp - 1] = Shl(stack[sp - 1], stack[sp]);
                return false;
            case VmOpcode.Shr:
                sp--;
                stack[sp - 1] = Shr(stack[sp - 1], stack[sp]);
                return false;
            case VmOpcode.ShrUn:
                sp--;
                stack[sp - 1] = ShrUn(stack[sp - 1], stack[sp]);
                return false;

            case VmOpcode.Ceq:
                sp--;
                stack[sp - 1] = object.Equals(stack[sp - 1], stack[sp]) ? 1 : 0;
                return false;
            case VmOpcode.Clt:
                sp--;
                stack[sp - 1] = Clt(stack[sp - 1], stack[sp]) ? 1 : 0;
                return false;
            case VmOpcode.CltUn:
                sp--;
                stack[sp - 1] = CltUn(stack[sp - 1], stack[sp]) ? 1 : 0;
                return false;
            case VmOpcode.Cgt:
                sp--;
                stack[sp - 1] = Cgt(stack[sp - 1], stack[sp]) ? 1 : 0;
                return false;
            case VmOpcode.CgtUn:
                sp--;
                stack[sp - 1] = CgtUn(stack[sp - 1], stack[sp]) ? 1 : 0;
                return false;

            case VmOpcode.Br:
                ip = ReadI4(bc, ref ip);
                return false;
            case VmOpcode.Beq:
                if (Equals(stack[sp - 2], stack[sp - 1])) ip = ReadI4(bc, ref ip);
                else ip += 4;
                sp -= 2;
                return false;
            case VmOpcode.Bne:
                if (!Equals(stack[sp - 2], stack[sp - 1])) ip = ReadI4(bc, ref ip);
                else ip += 4;
                sp -= 2;
                return false;
            case VmOpcode.Brtrue:
                if (IsTrue(stack[--sp])) ip = ReadI4(bc, ref ip);
                else ip += 4;
                return false;
            case VmOpcode.Brfalse:
                if (!IsTrue(stack[--sp])) ip = ReadI4(bc, ref ip);
                else ip += 4;
                return false;
            case VmOpcode.Bge:
                if (!Clt(stack[sp - 2], stack[sp - 1])) ip = ReadI4(bc, ref ip);
                else ip += 4;
                sp -= 2;
                return false;
            case VmOpcode.Ble:
                if (Clt(stack[sp - 2], stack[sp - 1]) || Equals(stack[sp - 2], stack[sp - 1])) ip = ReadI4(bc, ref ip);
                else ip += 4;
                sp -= 2;
                return false;
            case VmOpcode.Blt:
                if (Clt(stack[sp - 2], stack[sp - 1])) ip = ReadI4(bc, ref ip);
                else ip += 4;
                sp -= 2;
                return false;
            case VmOpcode.Bgt:
                if (Cgt(stack[sp - 2], stack[sp - 1])) ip = ReadI4(bc, ref ip);
                else ip += 4;
                sp -= 2;
                return false;

            case VmOpcode.Call:
                var callMethod = (MethodInfo)module.ResolveMethod(ReadToken(bc, ref ip, tokens));
                var callParamCount = callMethod.GetParameters().Length;
                object callResult;
                if (callMethod.IsStatic)
                {
                    var callArgs = PopArgs(callParamCount, stack, ref sp);
                    callResult = callMethod.Invoke(null, callArgs);
                }
                else
                {
                    var callAllArgs = PopArgs(callParamCount + 1, stack, ref sp);
                    var callThis = callAllArgs[0];
                    var callArgArr = new object[callParamCount];
                    Array.Copy(callAllArgs, 1, callArgArr, 0, callParamCount);
                    callResult = callMethod.Invoke(callThis, callArgArr);
                }
                if (callMethod.ReturnType != typeof(void))
                    stack[sp++] = callResult;
                return false;
            case VmOpcode.Callvirt:
                var virtMethod = (MethodInfo)module.ResolveMethod(ReadToken(bc, ref ip, tokens))!;
                var virtParamCount = virtMethod.GetParameters().Length;
                var virtArgs = PopArgs(virtParamCount + 1, stack, ref sp);
                var virtThis = virtArgs[0];
                var virtArgArr = new object[virtParamCount];
                Array.Copy(virtArgs, 1, virtArgArr, 0, virtParamCount);
                var virtResult = virtMethod.Invoke(virtThis, virtArgArr);
                if (virtMethod.ReturnType != typeof(void))
                    stack[sp++] = virtResult;
                return false;
            case VmOpcode.Newobj:
                var ctor = module.ResolveMethod(ReadToken(bc, ref ip, tokens))!;
                var ctorParamCount = ctor.GetParameters().Length;
                var ctorArgs = PopArgs(ctorParamCount, stack, ref sp);
                stack[sp++] = Activator.CreateInstance(ctor.DeclaringType!, ctorArgs);
                return false;

            case VmOpcode.Ldfld:
                var ldfld = module.ResolveField(ReadToken(bc, ref ip, tokens))!;
                var ldfldObj = stack[--sp];
                stack[sp++] = ldfld.GetValue(ldfldObj);
                return false;
            case VmOpcode.Stfld:
                var stfld = module.ResolveField(ReadToken(bc, ref ip, tokens))!;
                var stfldVal = stack[--sp];
                var stfldObj = stack[--sp];
                stfld.SetValue(stfldObj, stfldVal);
                return false;
            case VmOpcode.Ldsfld:
                var ldsfld = module.ResolveField(ReadToken(bc, ref ip, tokens))!;
                stack[sp++] = ldsfld.GetValue(null);
                return false;
            case VmOpcode.Stsfld:
                var stsfld = module.ResolveField(ReadToken(bc, ref ip, tokens))!;
                stsfld.SetValue(null, stack[--sp]);
                return false;

            case VmOpcode.Newarr:
                var arrLen = Convert.ToInt32(stack[--sp]);
                var arrElemToken = ReadToken(bc, ref ip, tokens);
                var arrElemType = arrElemToken != 0 ? module.ResolveType(arrElemToken) : typeof(object);
                stack[sp++] = Array.CreateInstance(arrElemType, arrLen);
                return false;
            case VmOpcode.Ldelem:
                var idx = Convert.ToInt32(stack[--sp]);
                var arr = stack[--sp];
                stack[sp++] = ((Array)arr!).GetValue(idx);
                return false;
            case VmOpcode.Stelem:
                var stelemVal = stack[--sp];
                var stelemIdx = Convert.ToInt32(stack[--sp]);
                var stelemArr = stack[--sp];
                ((Array)stelemArr!).SetValue(stelemVal, stelemIdx);
                return false;
            case VmOpcode.Ldlen:
                stack[sp - 1] = ((Array)stack[sp - 1]!).Length;
                return false;

            case VmOpcode.Box:
                var boxType = module.ResolveType(ReadToken(bc, ref ip, tokens));
                stack[sp - 1] = stack[sp - 1] == null ? null : Convert.ChangeType(stack[sp - 1], boxType);
                return false;
            case VmOpcode.Unbox:
                var unboxType = module.ResolveType(ReadToken(bc, ref ip, tokens));
                var unboxVal = stack[--sp];
                stack[sp++] = unboxVal == null ? null : Convert.ChangeType(unboxVal, unboxType);
                return false;
            case VmOpcode.Castclass:
                var castType = module.ResolveType(ReadToken(bc, ref ip, tokens));
                stack[sp - 1] = stack[sp - 1] == null ? null : Convert.ChangeType(stack[sp - 1], castType);
                return false;
            case VmOpcode.Isinst:
                var isinstType = module.ResolveType(ReadToken(bc, ref ip, tokens));
                var isinstVal = stack[sp - 1];
                stack[sp - 1] = isinstVal != null && isinstType.IsInstanceOfType(isinstVal) ? isinstVal : null;
                return false;

            case VmOpcode.Ret:
                returnValue = sp > 0 ? stack[sp - 1] : null;
                return true;
            default:
                throw new InvalidProgramException($"Unknown VM opcode: {op}");
        }
    }

    private static byte GetDispatchEngine(byte[] dispatchSchedule, int ip)
    {
        if (dispatchSchedule == null || dispatchSchedule.Length == 0)
            return 0;
        var segment = (ip >> 4) % dispatchSchedule.Length;
        return dispatchSchedule[segment];
    }

    private static byte[] BuildRandomDispatchMap()
    {
        var map = new byte[256];
        for (var i = 0; i < map.Length; i++)
            map[i] = (byte)i;
        var seed = unchecked(Environment.TickCount ^ Guid.NewGuid().GetHashCode());
        var rng = new Random(seed);
        for (var i = map.Length - 1; i > 0; i--)
        {
            var j = rng.Next(i + 1);
            var t = map[i];
            map[i] = map[j];
            map[j] = t;
        }
        return map;
    }

    private static byte[] InvertMap(byte[] map)
    {
        var inv = new byte[256];
        for (var i = 0; i < map.Length; i++)
            inv[map[i]] = (byte)i;
        return inv;
    }

    private static int ReadI4(byte[] bc, ref int ip)
    {
        var v = bc[ip] | (bc[ip + 1] << 8) | (bc[ip + 2] << 16) | (bc[ip + 3] << 24);
        ip += 4;
        return v;
    }

    private static long ReadI8(byte[] bc, ref int ip)
    {
        var v = (long)bc[ip] | ((long)bc[ip + 1] << 8) | ((long)bc[ip + 2] << 16) | ((long)bc[ip + 3] << 24) |
                ((long)bc[ip + 4] << 32) | ((long)bc[ip + 5] << 40) | ((long)bc[ip + 6] << 48) | ((long)bc[ip + 7] << 56);
        ip += 8;
        return v;
    }

    private static float ReadR4(byte[] bc, ref int ip)
    {
        var i = bc[ip] | (bc[ip + 1] << 8) | (bc[ip + 2] << 16) | (bc[ip + 3] << 24);
        ip += 4;
        return BitConverter.ToSingle(BitConverter.GetBytes(i), 0);
    }

    private static double ReadR8(byte[] bc, ref int ip)
    {
        var i = (long)bc[ip] | ((long)bc[ip + 1] << 8) | ((long)bc[ip + 2] << 16) | ((long)bc[ip + 3] << 24) |
                ((long)bc[ip + 4] << 32) | ((long)bc[ip + 5] << 40) | ((long)bc[ip + 6] << 48) | ((long)bc[ip + 7] << 56);
        ip += 8;
        return BitConverter.Int64BitsToDouble(i);
    }

    private static int ReadToken(byte[] bc, ref int ip, int[] tokens)
    {
        var idx = ReadI4(bc, ref ip);
        return idx >= 0 && idx < tokens.Length ? tokens[idx] : 0;
    }

    private static object[] PopArgs(int count, object[] stack, ref int sp)
    {
        var arr = new object[count];
        for (var i = count - 1; i >= 0; i--)
            arr[i] = stack[--sp];
        return arr;
    }

    private static bool IsTrue(object v)
    {
        if (v == null) return false;
        if (v is bool b) return b;
        if (v is int i) return i != 0;
        if (v is long l) return l != 0;
        return true;
    }

    private static object Add(object a, object b)
    {
        if (a is int ai && b is int bi) return ai + bi;
        if (a is long al && b is long bl) return al + bl;
        if (a is float af && b is float bf) return af + bf;
        if (a is double ad && b is double bd) return ad + bd;
        return Convert.ToDouble(a) + Convert.ToDouble(b);
    }

    private static object Sub(object a, object b)
    {
        if (a is int ai && b is int bi) return ai - bi;
        if (a is long al && b is long bl) return al - bl;
        if (a is float af && b is float bf) return af - bf;
        if (a is double ad && b is double bd) return ad - bd;
        return Convert.ToDouble(a) - Convert.ToDouble(b);
    }

    private static object Mul(object a, object b)
    {
        if (a is int ai && b is int bi) return ai * bi;
        if (a is long al && b is long bl) return al * bl;
        if (a is float af && b is float bf) return af * bf;
        if (a is double ad && b is double bd) return ad * bd;
        return Convert.ToDouble(a) * Convert.ToDouble(b);
    }

    private static object Div(object a, object b)
    {
        if (a is int ai && b is int bi) return ai / bi;
        if (a is long al && b is long bl) return al / bl;
        if (a is float af && b is float bf) return af / bf;
        if (a is double ad && b is double bd) return ad / bd;
        return Convert.ToDouble(a) / Convert.ToDouble(b);
    }

    private static object DivUn(object a, object b) => Div(ToUnsigned(a), ToUnsigned(b));
    private static object Rem(object a, object b)
    {
        if (a is int ai && b is int bi) return ai % bi;
        if (a is long al && b is long bl) return al % bl;
        return Convert.ToInt64(a) % Convert.ToInt64(b);
    }

    private static object RemUn(object a, object b) => Rem(ToUnsigned(a), ToUnsigned(b));
    private static object ToUnsigned(object v)
    {
        if (v is int i) return (uint)i;
        if (v is long l) return (ulong)l;
        return v;
    }

    private static object Neg(object v)
    {
        if (v is int i) return -i;
        if (v is long l) return -l;
        if (v is float f) return -f;
        if (v is double d) return -d;
        return -Convert.ToDouble(v);
    }

    private static object And(object a, object b)
    {
        if (a is int ai && b is int bi) return ai & bi;
        if (a is long al && b is long bl) return al & bl;
        return Convert.ToInt64(a) & Convert.ToInt64(b);
    }

    private static object Or(object a, object b)
    {
        if (a is int ai && b is int bi) return ai | bi;
        if (a is long al && b is long bl) return al | bl;
        return Convert.ToInt64(a) | Convert.ToInt64(b);
    }

    private static object Xor(object a, object b)
    {
        if (a is int ai && b is int bi) return ai ^ bi;
        if (a is long al && b is long bl) return al ^ bl;
        return Convert.ToInt64(a) ^ Convert.ToInt64(b);
    }

    private static object Not(object v)
    {
        if (v is int i) return ~i;
        if (v is long l) return ~l;
        return ~Convert.ToInt64(v);
    }

    private static object Shl(object a, object b) => Convert.ToInt64(a) << (int)Convert.ToInt64(b);
    private static object Shr(object a, object b) => Convert.ToInt64(a) >> (int)Convert.ToInt64(b);
    private static object ShrUn(object a, object b) => (long)((ulong)Convert.ToInt64(a) >> (int)Convert.ToInt64(b));

    private static bool Clt(object a, object b)
    {
        if (a is int ai && b is int bi) return ai < bi;
        if (a is long al && b is long bl) return al < bl;
        if (a is float af && b is float bf) return af < bf;
        if (a is double ad && b is double bd) return ad < bd;
        return Convert.ToDouble(a) < Convert.ToDouble(b);
    }

    private static bool CltUn(object a, object b)
    {
        if (a is int ai && b is int bi) return (uint)ai < (uint)bi;
        if (a is long al && b is long bl) return (ulong)al < (ulong)bl;
        return Clt(a, b);
    }

    private static bool Cgt(object a, object b)
    {
        if (a is int ai && b is int bi) return ai > bi;
        if (a is long al && b is long bl) return al > bl;
        if (a is float af && b is float bf) return af > bf;
        if (a is double ad && b is double bd) return ad > bd;
        return Convert.ToDouble(a) > Convert.ToDouble(b);
    }

    private static bool CgtUn(object a, object b)
    {
        if (a is int ai && b is int bi) return (uint)ai > (uint)bi;
        if (a is long al && b is long bl) return (ulong)al > (ulong)bl;
        return Cgt(a, b);
    }

    private enum VmOpcode : byte
    {
        Nop = 0, Dup = 1, Pop = 2,
        LdcI4 = 3, LdcI8 = 4, LdcR4 = 5, LdcR8 = 6, LdcNull = 7,
        Ldarg = 10, Starg = 11, Ldloc = 12, Stloc = 13,
        Add = 20, Sub = 21, Mul = 22, Div = 23, DivUn = 24, Rem = 25, RemUn = 26, Neg = 27,
        And = 28, Or = 29, Xor = 30, Not = 31, Shl = 32, Shr = 33, ShrUn = 34,
        Ceq = 40, Clt = 41, CltUn = 42, Cgt = 43, CgtUn = 44,
        Br = 50, Beq = 51, Bne = 52, Brtrue = 53, Brfalse = 54, Ble = 55, Bge = 56, Blt = 57, Bgt = 58,
        Call = 60, Callvirt = 61, Newobj = 62,
        Ldfld = 70, Stfld = 71, Ldsfld = 72, Stsfld = 73,
        Newarr = 80, Ldelem = 81, Stelem = 82, Ldlen = 83,
        Box = 90, Unbox = 91, Castclass = 92, Isinst = 93,
        Ret = 0xFF,
    }
}
