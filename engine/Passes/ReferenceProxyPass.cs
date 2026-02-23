using dnlib.DotNet;
using dnlib.DotNet.Emit;
using ShieldBinary.Engine;

namespace ShieldBinary.Engine.Passes;

public sealed class ReferenceProxyPass : IProtectionPass
{
    public string Name => "reference_proxy";

    public void Run(PipelineContext ctx, ModuleDef module)
    {
        if (!ctx.EnableReferenceProxy)
            return;

        var helperType = new TypeDefUser("", "RP" + Guid.NewGuid().ToString("N")[..8], module.CorLibTypes.Object.TypeDefOrRef)
        {
            Attributes = dnlib.DotNet.TypeAttributes.NotPublic | dnlib.DotNet.TypeAttributes.Sealed | dnlib.DotNet.TypeAttributes.Abstract
        };
        module.Types.Add(helperType);

        var proxyMap = new Dictionary<string, IMethod>();
        foreach (var type in module.GetAllTypes())
        {
            if (type == helperType)
                continue;
            foreach (var method in type.Methods)
            {
                if (!method.HasBody || method.Body.Instructions.Count == 0)
                    continue;
                RewriteCalls(module, helperType, method, proxyMap);
            }
        }
    }

    private static void RewriteCalls(ModuleDef module, TypeDef helperType, MethodDef method, Dictionary<string, IMethod> proxyMap)
    {
        var instructions = method.Body!.Instructions;
        for (var i = 0; i < instructions.Count; i++)
        {
            var ins = instructions[i];
            var isCall = ins.OpCode.Code == Code.Call;
            var isCallVirt = ins.OpCode.Code == Code.Callvirt;
            if (!isCall && !isCallVirt)
                continue;
            if (i > 0 && instructions[i - 1].OpCode.Code == Code.Constrained)
                continue; // avoid breaking constrained call semantics
            if (ins.Operand is not IMethod target)
                continue;
            if (!IsEligibleTarget(target))
                continue;

            if (isCallVirt && !IsEligibleVirtualTarget(target))
                continue;

            var key = (isCallVirt ? "virt:" : "call:") + target.FullName;
            if (!proxyMap.TryGetValue(key, out var proxy))
            {
                proxy = TryCreateProxyMethod(module, helperType, target, useCallVirt: isCallVirt);
                if (proxy == null)
                    continue;
                proxyMap[key] = proxy;
            }

            ins.OpCode = OpCodes.Call;
            ins.Operand = proxy;
        }
    }

    private static bool IsEligibleTarget(IMethod target)
    {
        if (target.Name == ".ctor" || target.Name == ".cctor")
            return false;
        var sig = target.MethodSig;
        if (sig == null || sig.ParamsAfterSentinel != null)
            return false;
        if (sig.Generic)
            return false;
        if (ContainsGenericPlaceholders(sig.RetType))
            return false;
        foreach (var p in sig.Params)
        {
            if (ContainsGenericPlaceholders(p))
                return false;
        }
        return true;
    }

    private static bool IsEligibleVirtualTarget(IMethod target)
    {
        var declType = target.DeclaringType?.ToTypeSig();
        if (declType == null || declType.IsValueType)
            return false;
        return true;
    }

    private static IMethod? TryCreateProxyMethod(ModuleDef module, TypeDef helperType, IMethod target, bool useCallVirt)
    {
        var targetRef = module.Import(target);
        var targetSig = targetRef.MethodSig;
        if (targetSig == null || targetRef.DeclaringType == null)
            return null;
        if (targetSig.ParamsAfterSentinel != null)
            return null;
        if (targetSig.Generic)
            return null;
        if (ContainsGenericPlaceholders(targetSig.RetType))
            return null;
        foreach (var p in targetSig.Params)
        {
            if (ContainsGenericPlaceholders(p))
                return null;
        }

        var paramTypes = new List<TypeSig>();
        if (targetSig.HasThis)
        {
            var thisType = targetRef.DeclaringType.ToTypeSig();
            if (thisType.IsValueType)
                return null; // keep first phase conservative
            paramTypes.Add(thisType);
        }
        foreach (var p in targetSig.Params)
            paramTypes.Add(p);

        var proxySig = MethodSig.CreateStatic(targetSig.RetType, paramTypes.ToArray());
        var proxyMethod = new MethodDefUser(
            "P" + Guid.NewGuid().ToString("N")[..8],
            proxySig,
            dnlib.DotNet.MethodImplAttributes.IL,
            dnlib.DotNet.MethodAttributes.Private | dnlib.DotNet.MethodAttributes.Static);
        helperType.Methods.Add(proxyMethod);

        var body = new CilBody { InitLocals = false, MaxStack = (ushort)Math.Max(8, paramTypes.Count + 2) };
        proxyMethod.Body = body;
        for (var i = 0; i < paramTypes.Count; i++)
            body.Instructions.Add(CreateLdarg(proxyMethod, i));

        body.Instructions.Add(Instruction.Create(useCallVirt ? OpCodes.Callvirt : OpCodes.Call, targetRef));
        body.Instructions.Add(Instruction.Create(OpCodes.Ret));
        return proxyMethod;
    }

    private static bool ContainsGenericPlaceholders(TypeSig t)
    {
        if (t == null)
            return false;
        if (t.ElementType == ElementType.Var || t.ElementType == ElementType.MVar)
            return true;
        if (t.Next != null && ContainsGenericPlaceholders(t.Next))
            return true;
        if (t is GenericInstSig gi)
        {
            foreach (var a in gi.GenericArguments)
                if (ContainsGenericPlaceholders(a))
                    return true;
        }
        return false;
    }

    private static Instruction CreateLdarg(MethodDef method, int index)
    {
        var p = method.Parameters[index];
        return index switch
        {
            0 => Instruction.Create(OpCodes.Ldarg_0),
            1 => Instruction.Create(OpCodes.Ldarg_1),
            2 => Instruction.Create(OpCodes.Ldarg_2),
            3 => Instruction.Create(OpCodes.Ldarg_3),
            _ => Instruction.Create(index <= 255 ? OpCodes.Ldarg_S : OpCodes.Ldarg, p),
        };
    }
}
