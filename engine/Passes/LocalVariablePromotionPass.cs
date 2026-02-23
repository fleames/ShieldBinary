using dnlib.DotNet;
using dnlib.DotNet.Emit;

namespace ShieldBinary.Engine.Passes;

/// <summary>
/// Promotes selected local variables into a heap-backed object[] state bag.
/// Conservative scope to preserve runtime compatibility.
/// </summary>
public sealed class LocalVariablePromotionPass : IProtectionPass
{
    public string Name => "local_variable_promotion";

    public void Run(PipelineContext ctx, ModuleDef module)
    {
        if (!ctx.EnableLocalVarPromotion)
            return;

        foreach (var type in module.GetAllTypes())
        {
            foreach (var method in type.Methods)
            {
                if (!method.HasBody || method.Body.Instructions.Count < 4)
                    continue;
                if (method.IsConstructor || method.IsStaticConstructor)
                    continue;
                if (CilBodyExtensions.HasExceptionHandlers(method.Body))
                    continue;
                if (HasUnsupportedLocalsUsage(method.Body))
                    continue;

                try
                {
                    PromoteMethodLocals(module, method, ctx);
                }
                catch
                {
                    // Skip methods that fail rewrite
                }
            }
        }
    }

    private static bool HasUnsupportedLocalsUsage(CilBody body)
    {
        foreach (var ins in body.Instructions)
        {
            if (ins.OpCode == OpCodes.Ldloca || ins.OpCode == OpCodes.Ldloca_S ||
                ins.OpCode == OpCodes.Ldarga || ins.OpCode == OpCodes.Ldarga_S)
                return true;
        }
        return false;
    }

    private static void PromoteMethodLocals(ModuleDef module, MethodDef method, PipelineContext ctx)
    {
        var body = method.Body!;
        if (body.Variables.Count == 0)
            return;

        var promoted = new List<Local>();
        foreach (var local in body.Variables)
        {
            if (local.Type.IsByRef || local.Type.ElementType == ElementType.TypedByRef)
                continue;
            if (local.Type.IsPinned)
                continue;
            if (IsSupportedLocalType(local.Type))
                promoted.Add(local);
        }
        if (promoted.Count == 0)
            return;

        if (!ctx.LowEntropy)
        {
            for (var i = promoted.Count - 1; i > 0; i--)
            {
                var j = ctx.Random.Next(i + 1);
                (promoted[i], promoted[j]) = (promoted[j], promoted[i]);
            }
        }
        var maxPromoted = ctx.PolymorphicMode ? 6 : 4;
        promoted = promoted.Take(Math.Min(maxPromoted, promoted.Count)).ToList();
        if (promoted.Count == 0)
            return;

        var slotMap = new Dictionary<Local, int>();
        for (var i = 0; i < promoted.Count; i++)
            slotMap[promoted[i]] = i;

        var stateLocal = new Local(new SZArraySig(module.CorLibTypes.Object));
        var tmpObjLocal = new Local(module.CorLibTypes.Object);
        body.Variables.Add(stateLocal);
        body.Variables.Add(tmpObjLocal);

        var init = BuildStateInit(module, promoted, stateLocal);
        for (var i = init.Count - 1; i >= 0; i--)
            body.Instructions.Insert(0, init[i]);

        for (var i = 0; i < body.Instructions.Count; i++)
        {
            var ins = body.Instructions[i];
            if (!TryGetLocalForInstruction(body, ins, out var local, out var isStore))
                continue;
            if (!slotMap.TryGetValue(local, out var slot))
                continue;

            if (isStore)
            {
                RewriteStore(module, body, i, local, slot, stateLocal, tmpObjLocal);
            }
            else
            {
                RewriteLoad(module, body, i, local, slot, stateLocal);
            }
        }
    }

    private static List<Instruction> BuildStateInit(ModuleDef module, List<Local> promoted, Local stateLocal)
    {
        var il = new List<Instruction>
        {
            Instruction.Create(OpCodes.Ldc_I4, promoted.Count),
            Instruction.Create(OpCodes.Newarr, module.CorLibTypes.Object.TypeDefOrRef),
            Instruction.Create(OpCodes.Stloc, stateLocal),
        };

        for (var i = 0; i < promoted.Count; i++)
        {
            var local = promoted[i];
            il.Add(Instruction.Create(OpCodes.Ldloc, stateLocal));
            il.Add(Instruction.Create(OpCodes.Ldc_I4, i));
            EmitDefaultObjectValue(module, il, local.Type);
            il.Add(Instruction.Create(OpCodes.Stelem_Ref));
        }
        return il;
    }

    private static void EmitDefaultObjectValue(ModuleDef module, List<Instruction> il, TypeSig type)
    {
        if (!type.IsValueType)
        {
            il.Add(Instruction.Create(OpCodes.Ldnull));
            return;
        }
        switch (type.ElementType)
        {
            case ElementType.Boolean:
            case ElementType.I1:
            case ElementType.U1:
            case ElementType.I2:
            case ElementType.U2:
            case ElementType.I4:
            case ElementType.U4:
            case ElementType.I:
            case ElementType.U:
                il.Add(Instruction.Create(OpCodes.Ldc_I4_0));
                break;
            case ElementType.I8:
            case ElementType.U8:
                il.Add(Instruction.Create(OpCodes.Ldc_I4_0));
                il.Add(Instruction.Create(OpCodes.Conv_I8));
                break;
            case ElementType.R4:
                il.Add(Instruction.Create(OpCodes.Ldc_R4, 0f));
                break;
            case ElementType.R8:
                il.Add(Instruction.Create(OpCodes.Ldc_R8, 0d));
                break;
            default:
                il.Add(Instruction.Create(OpCodes.Ldnull));
                return;
        }
        il.Add(Instruction.Create(OpCodes.Box, type.ToTypeDefOrRef()));
    }

    private static bool IsSupportedLocalType(TypeSig t)
    {
        if (t.IsByRef || t.ElementType == ElementType.TypedByRef)
            return false;
        if (!t.IsValueType)
            return true;
        return t.ElementType is ElementType.Boolean
            or ElementType.I1 or ElementType.U1
            or ElementType.I2 or ElementType.U2
            or ElementType.I4 or ElementType.U4
            or ElementType.I8 or ElementType.U8
            or ElementType.R4 or ElementType.R8
            or ElementType.I or ElementType.U;
    }

    private static bool TryGetLocalForInstruction(CilBody body, Instruction ins, out Local local, out bool isStore)
    {
        local = null!;
        isStore = false;
        switch (ins.OpCode.Code)
        {
            case Code.Ldloc:
            case Code.Ldloc_S:
                if (ins.Operand is Local l)
                {
                    local = l; isStore = false; return true;
                }
                break;
            case Code.Ldloc_0:
            case Code.Ldloc_1:
            case Code.Ldloc_2:
            case Code.Ldloc_3:
                {
                    var idx = ins.OpCode.Code - Code.Ldloc_0;
                    if (idx >= 0 && idx < body.Variables.Count)
                    {
                        local = body.Variables[idx]; isStore = false; return true;
                    }
                }
                break;
            case Code.Stloc:
            case Code.Stloc_S:
                if (ins.Operand is Local s)
                {
                    local = s; isStore = true; return true;
                }
                break;
            case Code.Stloc_0:
            case Code.Stloc_1:
            case Code.Stloc_2:
            case Code.Stloc_3:
                {
                    var idx = ins.OpCode.Code - Code.Stloc_0;
                    if (idx >= 0 && idx < body.Variables.Count)
                    {
                        local = body.Variables[idx]; isStore = true; return true;
                    }
                }
                break;
        }
        return false;
    }

    private static void RewriteLoad(ModuleDef module, CilBody body, int index, Local local, int slot, Local stateLocal)
    {
        var ins = body.Instructions[index];
        ins.OpCode = OpCodes.Ldloc;
        ins.Operand = stateLocal;
        body.Instructions.Insert(index + 1, Instruction.Create(OpCodes.Ldc_I4, slot));
        body.Instructions.Insert(index + 2, Instruction.Create(OpCodes.Ldelem_Ref));
        if (local.Type.IsValueType)
        {
            body.Instructions.Insert(index + 3, Instruction.Create(OpCodes.Unbox_Any, local.Type.ToTypeDefOrRef()));
        }
        else if (local.Type.ElementType == ElementType.String || local.Type.ElementType == ElementType.Class || local.Type.ElementType == ElementType.Object)
        {
            body.Instructions.Insert(index + 3, Instruction.Create(OpCodes.Castclass, local.Type.ToTypeDefOrRef()));
        }
    }

    private static void RewriteStore(ModuleDef module, CilBody body, int index, Local local, int slot, Local stateLocal, Local tmpObjLocal)
    {
        var ins = body.Instructions[index];
        if (local.Type.IsValueType)
        {
            ins.OpCode = OpCodes.Box;
            ins.Operand = local.Type.ToTypeDefOrRef();
            body.Instructions.Insert(index + 1, Instruction.Create(OpCodes.Stloc, tmpObjLocal));
        }
        else
        {
            ins.OpCode = OpCodes.Stloc;
            ins.Operand = tmpObjLocal;
        }
        body.Instructions.Insert(index + 2, Instruction.Create(OpCodes.Ldloc, stateLocal));
        body.Instructions.Insert(index + 3, Instruction.Create(OpCodes.Ldc_I4, slot));
        body.Instructions.Insert(index + 4, Instruction.Create(OpCodes.Ldloc, tmpObjLocal));
        body.Instructions.Insert(index + 5, Instruction.Create(OpCodes.Stelem_Ref));
    }
}
