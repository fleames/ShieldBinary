using dnlib.DotNet;
using dnlib.DotNet.Emit;
using ShieldBinary.Engine.Passes;

namespace ShieldBinary.Engine.VM;

/// <summary>
/// Compiles IL instructions to VM bytecode. Supports a subset of IL for stability.
/// Skips methods with exception handlers, byrefs, or unsupported opcodes.
/// </summary>
internal sealed class ILToVmCompiler
{
    private readonly MethodDef _method;
    private readonly ModuleDef _module;
    private readonly VmWriter _writer;
    private readonly Dictionary<Instruction, int> _insToOffset = new();
    private readonly List<(int pos, Instruction target, VmOpcode branchOp)> _patches = new();
    private readonly Dictionary<Instruction, int> _switchTargets = new(); // Switch: multiple targets

    public ILToVmCompiler(MethodDef method, byte[]? opcodeEncodeMap = null)
    {
        _method = method;
        _module = method.Module;
        _writer = new VmWriter(opcodeEncodeMap);
    }

    public bool TryCompile(out byte[] bytecode, out object[] tokenTable)
    {
        bytecode = Array.Empty<byte>();
        tokenTable = Array.Empty<object>();

        var body = _method.Body;
        if (body?.Instructions == null || body.Instructions.Count == 0)
            return false;

        if (CilBodyExtensions.HasExceptionHandlers(body))
            return false;

        if (HasUnsupportedOpcodes(body))
            return false;

        if (HasByRef(body))
            return false;

        try
        {
            CompileBody(body);
            foreach (var (pos, target, branchOp) in _patches)
            {
                if (_insToOffset.TryGetValue(target, out var tgtOffset))
                    _writer.PatchBranch(pos, tgtOffset);
            }
            bytecode = _writer.ToArray();
            tokenTable = _writer.GetTokenList();
            return bytecode.Length > 0;
        }
        catch
        {
            return false;
        }
    }

    private static bool HasUnsupportedOpcodes(CilBody body)
    {
        foreach (var ins in body.Instructions)
        {
            var op = ins.OpCode.Code;
            if (op is Code.Switch or Code.Throw or Code.Rethrow or Code.Endfilter or Code.Endfinally)
                return true;
            if (op is Code.Arglist or Code.Mkrefany or Code.Refanyval or Code.Refanytype)
                return true;
            if (op is Code.Localloc or Code.Cpblk or Code.Initblk)
                return true;
            if (op == Code.Jmp)
                return true;
        }
        return false;
    }

    private static bool HasByRef(CilBody body)
    {
        foreach (var ins in body.Instructions)
        {
            var op = ins.OpCode;
            if (op == OpCodes.Ldarga || op == OpCodes.Ldarga_S || op == OpCodes.Starg ||
                op == OpCodes.Ldloca || op == OpCodes.Ldloca_S)
                return true;
            if (ins.Operand is Parameter param && param.Type.IsByRef)
                return true;
            if (ins.Operand is Local local && local.Type.IsByRef)
                return true;
        }
        return false;
    }

    private void CompileBody(CilBody body)
    {
        var instructions = body.Instructions;
        var paramBase = _method.IsStatic ? 0 : 1;

        for (var i = 0; i < instructions.Count; i++)
        {
            var ins = instructions[i];
            _insToOffset[ins] = _writer.Length;

            switch (ins.OpCode.Code)
            {
                case Code.Nop:
                    _writer.Emit(VmOpcode.Nop);
                    break;
                case Code.Dup:
                    _writer.Emit(VmOpcode.Dup);
                    break;
                case Code.Pop:
                    _writer.Emit(VmOpcode.Pop);
                    break;

                case Code.Ldc_I4:
                case Code.Ldc_I4_S:
                    _writer.EmitI4(VmOpcode.LdcI4, ins.GetLdcI4Value());
                    break;
                case Code.Ldc_I4_0: _writer.EmitI4(VmOpcode.LdcI4, 0); break;
                case Code.Ldc_I4_1: _writer.EmitI4(VmOpcode.LdcI4, 1); break;
                case Code.Ldc_I4_2: _writer.EmitI4(VmOpcode.LdcI4, 2); break;
                case Code.Ldc_I4_3: _writer.EmitI4(VmOpcode.LdcI4, 3); break;
                case Code.Ldc_I4_4: _writer.EmitI4(VmOpcode.LdcI4, 4); break;
                case Code.Ldc_I4_5: _writer.EmitI4(VmOpcode.LdcI4, 5); break;
                case Code.Ldc_I4_6: _writer.EmitI4(VmOpcode.LdcI4, 6); break;
                case Code.Ldc_I4_7: _writer.EmitI4(VmOpcode.LdcI4, 7); break;
                case Code.Ldc_I4_8: _writer.EmitI4(VmOpcode.LdcI4, 8); break;
                case Code.Ldc_I4_M1: _writer.EmitI4(VmOpcode.LdcI4, -1); break;
                case Code.Ldc_I8:
                    _writer.EmitI8(VmOpcode.LdcI8, (long)(ins.Operand ?? 0L));
                    break;
                case Code.Ldc_R4:
                    _writer.EmitR4(VmOpcode.LdcR4, (float)(ins.Operand ?? 0f));
                    break;
                case Code.Ldc_R8:
                    _writer.EmitR8(VmOpcode.LdcR8, (double)(ins.Operand ?? 0.0));
                    break;
                case Code.Ldnull:
                    _writer.Emit(VmOpcode.LdcNull);
                    break;

                case Code.Ldarg:
                case Code.Ldarg_S:
                    _writer.EmitI4(VmOpcode.Ldarg, GetArgIndex(ins.Operand, paramBase));
                    break;
                case Code.Ldarg_0: _writer.EmitI4(VmOpcode.Ldarg, paramBase + 0); break;
                case Code.Ldarg_1: _writer.EmitI4(VmOpcode.Ldarg, paramBase + 1); break;
                case Code.Ldarg_2: _writer.EmitI4(VmOpcode.Ldarg, paramBase + 2); break;
                case Code.Ldarg_3: _writer.EmitI4(VmOpcode.Ldarg, paramBase + 3); break;
                case Code.Starg:
                case Code.Starg_S:
                    _writer.EmitI4(VmOpcode.Starg, GetArgIndex(ins.Operand, paramBase));
                    break;

                case Code.Ldloc:
                case Code.Ldloc_S:
                    _writer.EmitI4(VmOpcode.Ldloc, GetLocalIndex(ins.Operand, body));
                    break;
                case Code.Ldloc_0: _writer.EmitI4(VmOpcode.Ldloc, 0); break;
                case Code.Ldloc_1: _writer.EmitI4(VmOpcode.Ldloc, 1); break;
                case Code.Ldloc_2: _writer.EmitI4(VmOpcode.Ldloc, 2); break;
                case Code.Ldloc_3: _writer.EmitI4(VmOpcode.Ldloc, 3); break;
                case Code.Stloc:
                case Code.Stloc_S:
                    _writer.EmitI4(VmOpcode.Stloc, GetLocalIndex(ins.Operand, body));
                    break;
                case Code.Stloc_0: _writer.EmitI4(VmOpcode.Stloc, 0); break;
                case Code.Stloc_1: _writer.EmitI4(VmOpcode.Stloc, 1); break;
                case Code.Stloc_2: _writer.EmitI4(VmOpcode.Stloc, 2); break;
                case Code.Stloc_3: _writer.EmitI4(VmOpcode.Stloc, 3); break;

                case Code.Add: _writer.Emit(VmOpcode.Add); break;
                case Code.Add_Ovf:
                case Code.Add_Ovf_Un: _writer.Emit(VmOpcode.Add); break;
                case Code.Sub: _writer.Emit(VmOpcode.Sub); break;
                case Code.Sub_Ovf:
                case Code.Sub_Ovf_Un: _writer.Emit(VmOpcode.Sub); break;
                case Code.Mul: _writer.Emit(VmOpcode.Mul); break;
                case Code.Div: _writer.Emit(VmOpcode.Div); break;
                case Code.Div_Un: _writer.Emit(VmOpcode.DivUn); break;
                case Code.Rem: _writer.Emit(VmOpcode.Rem); break;
                case Code.Rem_Un: _writer.Emit(VmOpcode.RemUn); break;
                case Code.Neg: _writer.Emit(VmOpcode.Neg); break;
                case Code.And: _writer.Emit(VmOpcode.And); break;
                case Code.Or: _writer.Emit(VmOpcode.Or); break;
                case Code.Xor: _writer.Emit(VmOpcode.Xor); break;
                case Code.Not: _writer.Emit(VmOpcode.Not); break;
                case Code.Shl: _writer.Emit(VmOpcode.Shl); break;
                case Code.Shr: _writer.Emit(VmOpcode.Shr); break;
                case Code.Shr_Un: _writer.Emit(VmOpcode.ShrUn); break;

                case Code.Ceq: _writer.Emit(VmOpcode.Ceq); break;
                case Code.Clt: _writer.Emit(VmOpcode.Clt); break;
                case Code.Clt_Un: _writer.Emit(VmOpcode.CltUn); break;
                case Code.Cgt: _writer.Emit(VmOpcode.Cgt); break;
                case Code.Cgt_Un: _writer.Emit(VmOpcode.CgtUn); break;

                case Code.Br:
                case Code.Br_S:
                    EmitBranch(ins, VmOpcode.Br);
                    break;
                case Code.Beq:
                case Code.Beq_S:
                    EmitBranch(ins, VmOpcode.Beq);
                    break;
                case Code.Bne_Un:
                case Code.Bne_Un_S:
                    EmitBranch(ins, VmOpcode.Bne);
                    break;
                case Code.Brtrue:
                case Code.Brtrue_S:
                    EmitBranch(ins, VmOpcode.Brtrue);
                    break;
                case Code.Brfalse:
                case Code.Brfalse_S:
                    EmitBranch(ins, VmOpcode.Brfalse);
                    break;
                case Code.Bge:
                case Code.Bge_S:
                case Code.Bge_Un:
                case Code.Bge_Un_S:
                    EmitBranch(ins, VmOpcode.Bge);
                    break;
                case Code.Ble:
                case Code.Ble_S:
                case Code.Ble_Un:
                case Code.Ble_Un_S:
                    EmitBranch(ins, VmOpcode.Ble);
                    break;
                case Code.Blt:
                case Code.Blt_S:
                case Code.Blt_Un:
                case Code.Blt_Un_S:
                    EmitBranch(ins, VmOpcode.Blt);
                    break;
                case Code.Bgt:
                case Code.Bgt_S:
                case Code.Bgt_Un:
                case Code.Bgt_Un_S:
                    EmitBranch(ins, VmOpcode.Bgt);
                    break;

                case Code.Call:
                    EmitCall(ins, false);
                    break;
                case Code.Callvirt:
                    EmitCall(ins, true);
                    break;
                case Code.Newobj:
                    EmitNewobj(ins);
                    break;

                case Code.Ldfld:
                case Code.Ldsfld:
                    EmitField(ins, true);
                    break;
                case Code.Stfld:
                case Code.Stsfld:
                    EmitField(ins, false);
                    break;

                case Code.Newarr:
                    EmitNewarr(ins);
                    break;
                case Code.Ldelem_I4:
                case Code.Ldelem_I8:
                case Code.Ldelem_R4:
                case Code.Ldelem_R8:
                case Code.Ldelem_Ref:
                case Code.Ldelem_I:
                case Code.Ldelem_U1:
                case Code.Ldelem_U2:
                case Code.Ldelem_U4:
                    _writer.Emit(VmOpcode.Ldelem); // VM will handle type
                    break;
                case Code.Stelem_I4:
                case Code.Stelem_I8:
                case Code.Stelem_R4:
                case Code.Stelem_R8:
                case Code.Stelem_Ref:
                case Code.Stelem_I:
                case Code.Stelem_I1:
                case Code.Stelem_I2:
                    _writer.Emit(VmOpcode.Stelem);
                    break;
                case Code.Ldlen:
                    _writer.Emit(VmOpcode.Ldlen);
                    break;

                case Code.Box:
                    EmitTokenOp(ins, VmOpcode.Box);
                    break;
                case Code.Unbox:
                    EmitTokenOp(ins, VmOpcode.Unbox);
                    break;
                case Code.Unbox_Any:
                    EmitTokenOp(ins, VmOpcode.Unbox); // VM treats unbox+load as unbox pushing value
                    break;
                case Code.Castclass:
                    EmitTokenOp(ins, VmOpcode.Castclass);
                    break;
                case Code.Isinst:
                    EmitTokenOp(ins, VmOpcode.Isinst);
                    break;

                case Code.Ret:
                    _writer.Emit(VmOpcode.Ret);
                    break;

                case Code.Conv_I4:
                case Code.Conv_I8:
                case Code.Conv_R4:
                case Code.Conv_R8:
                case Code.Conv_U4:
                case Code.Conv_U8:
                    _writer.Emit(VmOpcode.Nop); // Conv: VM stack is object[]; no-op for now
                    break;

                default:
                    throw new NotSupportedException($"Unsupported IL: {ins.OpCode}");
            }
        }
    }

    private void EmitBranch(Instruction ins, VmOpcode branchOp)
    {
        var target = ins.Operand as Instruction;
        if (target == null) return;
        var pos = _writer.Length;
        _writer.EmitI4(branchOp, 0); // Patch later
        _patches.Add((pos, target, branchOp));
    }

    private void EmitCall(Instruction ins, bool virt)
    {
        var method = ins.Operand as IMethod;
        if (method == null) return;
        var token = method.ResolveMethodDef()?.MDToken.Raw ?? 0;
        if (token == 0 && method is MethodDef md)
            token = md.MDToken.Raw;
        var idx = _writer.AddToken(method);
        _writer.EmitI4(virt ? VmOpcode.Callvirt : VmOpcode.Call, idx);
    }

    private void EmitNewobj(Instruction ins)
    {
        var ctor = ins.Operand as IMethod;
        if (ctor == null) return;
        var idx = _writer.AddToken(ctor);
        _writer.EmitI4(VmOpcode.Newobj, idx);
    }

    private void EmitField(Instruction ins, bool load)
    {
        var field = ins.Operand as IField;
        if (field == null) return;
        var idx = _writer.AddToken(field);
        var op = ins.OpCode.Code is Code.Ldsfld or Code.Stsfld
            ? (load ? VmOpcode.Ldsfld : VmOpcode.Stsfld)
            : (load ? VmOpcode.Ldfld : VmOpcode.Stfld);
        _writer.EmitI4(op, idx);
    }

    private void EmitNewarr(Instruction ins)
    {
        var elemType = ins.Operand as ITypeDefOrRef;
        if (elemType == null) return;
        var idx = _writer.AddToken(elemType);
        _writer.EmitI4(VmOpcode.Newarr, idx);
    }

    private void EmitTokenOp(Instruction ins, VmOpcode op)
    {
        var type = ins.Operand as ITypeDefOrRef;
        if (type == null) return;
        var idx = _writer.AddToken(type);
        _writer.EmitI4(op, idx);
    }

    private static int GetArgIndex(object? operand, int paramBase)
    {
        if (operand is Parameter p)
            return paramBase + p.Index;
        return 0;
    }

    private static int GetLocalIndex(object? operand, CilBody body)
    {
        if (operand is Local loc)
            return body.Variables.IndexOf(loc);
        return 0;
    }
}
