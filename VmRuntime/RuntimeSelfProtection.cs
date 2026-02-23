using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Reflection;
using System.Reflection.Emit;
using System.Security.Cryptography;
using System.Threading;

namespace ShieldBinary.VmRuntime;

public static class RuntimeSelfProtection
{
    private static readonly OpCode[] OneByteOpCodes = new OpCode[0x100];
    private static readonly OpCode[] TwoByteOpCodes = new OpCode[0x100];

    static RuntimeSelfProtection()
    {
        var fields = typeof(OpCodes).GetFields(BindingFlags.Public | BindingFlags.Static);
        foreach (var f in fields)
        {
            if (f.FieldType != typeof(OpCode))
                continue;
            var op = (OpCode)f.GetValue(null);
            var v = (ushort)op.Value;
            if (v < 0x100)
                OneByteOpCodes[v] = op;
            else if ((v & 0xFF00) == 0xFE00)
                TwoByteOpCodes[v & 0xFF] = op;
        }
    }

    public static void Guard(int[] methodTokens, string[] expectedHashes)
    {
        try
        {
            if (DetectDebugger())
            {
                GracefulFail();
                return;
            }
            if (DetectSandbox())
            {
                GracefulFail();
                return;
            }
            if (DetectTimingAnomaly())
            {
                GracefulFail();
                return;
            }
            if (!VerifyMethodIntegrity(methodTokens, expectedHashes))
            {
                GracefulFail();
            }
        }
        catch
        {
            GracefulFail();
        }
    }

    private static bool DetectDebugger()
    {
        if (Debugger.IsAttached || Debugger.IsLogging())
            return true;
        var profiling = Environment.GetEnvironmentVariable("COR_ENABLE_PROFILING");
        if (string.Equals(profiling, "1", StringComparison.Ordinal))
            return true;
        var complus = Environment.GetEnvironmentVariable("COMPlus_ZapDisable");
        if (string.Equals(complus, "1", StringComparison.Ordinal))
            return true;
        return false;
    }

    private static bool DetectSandbox()
    {
        try
        {
            var suspicious = new[] { "sandbox", "malware", "analysis", "vmware", "vbox", "virtual", "test", "sample" };
            var machine = (Environment.MachineName ?? string.Empty).ToLowerInvariant();
            var user = (Environment.UserName ?? string.Empty).ToLowerInvariant();
            foreach (var s in suspicious)
            {
                if (machine.Contains(s) || user.Contains(s))
                    return true;
            }
            if (Environment.ProcessorCount <= 1)
                return true;

            var procCount = Process.GetProcesses().Length;
            if (procCount > 0 && procCount < 18)
                return true;
        }
        catch
        {
            // ignore and continue
        }
        return false;
    }

    private static bool DetectTimingAnomaly()
    {
        var sw = Stopwatch.StartNew();
        Thread.Sleep(25);
        sw.Stop();
        return sw.ElapsedMilliseconds > 1200;
    }

    private static bool VerifyMethodIntegrity(int[] methodTokens, string[] expectedHashes)
    {
        if (methodTokens == null || expectedHashes == null)
            return false;
        var n = Math.Min(methodTokens.Length, expectedHashes.Length);
        if (n == 0)
            return true;
        var module = Assembly.GetExecutingAssembly().ManifestModule;
        for (var i = 0; i < n; i++)
        {
            if (!TryResolveMethod(module, methodTokens[i], out var method))
                return false;
            var body = method.GetMethodBody();
            if (body == null)
                return false;
            var il = body.GetILAsByteArray();
            if (il == null || il.Length == 0)
                return false;
            var actual = HashOpcodeStream(il);
            if (!string.Equals(actual, expectedHashes[i], StringComparison.OrdinalIgnoreCase))
                return false;
        }
        return true;
    }

    private static string HashOpcodeStream(byte[] il)
    {
        var normalized = new List<byte>(il.Length);
        var i = 0;
        while (i < il.Length)
        {
            var b = il[i++];
            ushort value;
            OpCode op;
            if (b == 0xFE && i < il.Length)
            {
                var b2 = il[i++];
                value = (ushort)(0xFE00 | b2);
                op = TwoByteOpCodes[b2];
            }
            else
            {
                value = b;
                op = OneByteOpCodes[b];
            }
            normalized.Add((byte)value);
            normalized.Add((byte)(value >> 8));
            AdvanceOperand(op, il, ref i);
        }
        using var sha = SHA256.Create();
        var hash = sha.ComputeHash(normalized.ToArray());
        return BitConverter.ToString(hash).Replace("-", string.Empty);
    }

    private static void AdvanceOperand(OpCode op, byte[] il, ref int i)
    {
        switch (op.OperandType)
        {
            case OperandType.InlineNone:
                return;
            case OperandType.ShortInlineBrTarget:
            case OperandType.ShortInlineI:
            case OperandType.ShortInlineVar:
                i += 1;
                return;
            case OperandType.InlineVar:
                i += 2;
                return;
            case OperandType.InlineI:
            case OperandType.InlineBrTarget:
            case OperandType.InlineField:
            case OperandType.InlineMethod:
            case OperandType.InlineSig:
            case OperandType.InlineString:
            case OperandType.InlineTok:
            case OperandType.InlineType:
            case OperandType.ShortInlineR:
                i += 4;
                return;
            case OperandType.InlineI8:
            case OperandType.InlineR:
                i += 8;
                return;
            case OperandType.InlineSwitch:
                if (i + 4 > il.Length)
                {
                    i = il.Length;
                    return;
                }
                var c = il[i] | (il[i + 1] << 8) | (il[i + 2] << 16) | (il[i + 3] << 24);
                i += 4 + (c * 4);
                return;
            default:
                return;
        }
    }

    private static bool TryResolveMethod(Module module, int token, out MethodBase method)
    {
        method = null;
        try
        {
            method = module.ResolveMethod(token);
            return method != null;
        }
        catch
        {
            return false;
        }
    }

    private static void GracefulFail()
    {
        try
        {
            var seed = unchecked(Environment.TickCount ^ Process.GetCurrentProcess().Id);
            var rng = new Random(seed);
            Thread.Sleep(120 + rng.Next(120, 420));
        }
        catch
        {
            // ignored
        }
        Environment.Exit(0);
    }
}
