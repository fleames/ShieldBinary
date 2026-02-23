using System.Linq;
using dnlib.DotNet;
using dnlib.DotNet.Emit;
using ShieldBinary.Engine;

namespace ShieldBinary.Engine.Passes;

/// <summary>
/// Hides direct static method calls behind delegate invocation proxies.
/// Conservative scope: rewrites eligible OpCodes.Call to static methods only.
/// </summary>
public sealed class DelegateProxyPass : IProtectionPass
{
    public string Name => "delegate_proxy";

    public void Run(PipelineContext ctx, ModuleDef module)
    {
        if (!ctx.EnableDelegateProxy)
            return;

        var helperType = new TypeDefUser("", "DP" + Guid.NewGuid().ToString("N")[..8], module.CorLibTypes.Object.TypeDefOrRef)
        {
            Attributes = dnlib.DotNet.TypeAttributes.NotPublic | dnlib.DotNet.TypeAttributes.Sealed | dnlib.DotNet.TypeAttributes.Abstract
        };
        module.Types.Add(helperType);

        var cctor = new MethodDefUser(
            ".cctor",
            MethodSig.CreateStatic(module.CorLibTypes.Void),
            dnlib.DotNet.MethodImplAttributes.IL,
            dnlib.DotNet.MethodAttributes.Private | dnlib.DotNet.MethodAttributes.Static | dnlib.DotNet.MethodAttributes.SpecialName | dnlib.DotNet.MethodAttributes.RTSpecialName);
        cctor.Body = new CilBody { InitLocals = false, MaxStack = 8 };
        helperType.Methods.Add(cctor);

        var proxyMap = new Dictionary<string, IMethod>();
        foreach (var type in module.GetAllTypes())
        {
            if (type == helperType)
                continue;
            foreach (var method in type.Methods)
            {
                if (!method.HasBody || method.Body.Instructions.Count == 0)
                    continue;
                RewriteCalls(module, helperType, cctor, method, proxyMap);
            }
        }

        cctor.Body!.Instructions.Add(Instruction.Create(OpCodes.Ret));
    }

    private static void RewriteCalls(
        ModuleDef module,
        TypeDef helperType,
        MethodDef cctor,
        MethodDef method,
        Dictionary<string, IMethod> proxyMap)
    {
        var instructions = method.Body!.Instructions;
        for (var i = 0; i < instructions.Count; i++)
        {
            var ins = instructions[i];
            if (ins.OpCode.Code != Code.Call)
                continue;
            if (ins.Operand is not IMethod target)
                continue;
            if (!IsEligibleTarget(target))
                continue;
            if (ins.Operand is MethodSpec)
                continue; // generic method instantiations deferred

            var key = target.FullName;
            if (!proxyMap.TryGetValue(key, out var proxy))
            {
                proxy = TryCreateDelegateProxy(module, helperType, cctor, target);
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
        var name = target.Name?.ToString() ?? string.Empty;
        if (name == ".ctor" || name == ".cctor")
            return false;
        var sig = target.MethodSig;
        if (sig == null || sig.HasThis || sig.Generic || sig.ParamsAfterSentinel != null)
            return false;
        foreach (var p in sig.Params)
        {
            if (p.ElementType == ElementType.TypedByRef || p.ElementType == ElementType.ByRef)
                return false;
        }
        return true;
    }

    private static IMethod? TryCreateDelegateProxy(ModuleDef module, TypeDef helperType, MethodDef cctor, IMethod target)
    {
        var targetRef = module.Import(target);
        var targetSig = targetRef.MethodSig;
        if (targetSig == null || targetSig.HasThis || targetSig.Generic || targetSig.ParamsAfterSentinel != null)
            return null;

        var delegateType = CreateDelegateType(module, targetSig);
        helperType.NestedTypes.Add(delegateType);
        var invoke = delegateType.Methods.First(m => m.Name == "Invoke");
        var ctor = delegateType.Methods.First(m => m.Name == ".ctor");

        var field = new FieldDefUser(
            "F" + Guid.NewGuid().ToString("N")[..8],
            new FieldSig(delegateType.ToTypeSig()),
            dnlib.DotNet.FieldAttributes.Private | dnlib.DotNet.FieldAttributes.Static | dnlib.DotNet.FieldAttributes.InitOnly);
        helperType.Fields.Add(field);

        // cctor: field = new Delegate(null, ldftn target)
        cctor.Body!.Instructions.Add(Instruction.Create(OpCodes.Ldnull));
        cctor.Body.Instructions.Add(Instruction.Create(OpCodes.Ldftn, targetRef));
        cctor.Body.Instructions.Add(Instruction.Create(OpCodes.Newobj, ctor));
        cctor.Body.Instructions.Add(Instruction.Create(OpCodes.Stsfld, field));

        var proxy = new MethodDefUser(
            "P" + Guid.NewGuid().ToString("N")[..8],
            MethodSig.CreateStatic(targetSig.RetType, targetSig.Params.ToArray()),
            dnlib.DotNet.MethodImplAttributes.IL,
            dnlib.DotNet.MethodAttributes.Private | dnlib.DotNet.MethodAttributes.Static);
        proxy.Body = new CilBody { InitLocals = false, MaxStack = (ushort)Math.Max(8, targetSig.Params.Count + 2) };
        helperType.Methods.Add(proxy);

        proxy.Body.Instructions.Add(Instruction.Create(OpCodes.Ldsfld, field));
        for (var i = 0; i < targetSig.Params.Count; i++)
            proxy.Body.Instructions.Add(CreateLdarg(proxy, i));
        proxy.Body.Instructions.Add(Instruction.Create(OpCodes.Callvirt, invoke));
        proxy.Body.Instructions.Add(Instruction.Create(OpCodes.Ret));

        // Optional second hop for graph-noise: proxy2 -> proxy -> delegate field.
        if (targetSig.Params.Count > 0 && targetSig.Params.Count <= 8)
        {
            var proxy2 = new MethodDefUser(
                "Q" + Guid.NewGuid().ToString("N")[..8],
                MethodSig.CreateStatic(targetSig.RetType, targetSig.Params.ToArray()),
                dnlib.DotNet.MethodImplAttributes.IL,
                dnlib.DotNet.MethodAttributes.Private | dnlib.DotNet.MethodAttributes.Static);
            proxy2.Body = new CilBody { InitLocals = false, MaxStack = (ushort)Math.Max(8, targetSig.Params.Count + 2) };
            helperType.Methods.Add(proxy2);
            for (var i = 0; i < targetSig.Params.Count; i++)
                proxy2.Body.Instructions.Add(CreateLdarg(proxy2, i));
            proxy2.Body.Instructions.Add(Instruction.Create(OpCodes.Call, proxy));
            proxy2.Body.Instructions.Add(Instruction.Create(OpCodes.Ret));
            return proxy2;
        }

        return proxy;
    }

    private static TypeDef CreateDelegateType(ModuleDef module, MethodSig invokeSig)
    {
        var delegateBase = module.Import(typeof(MulticastDelegate));
        var t = new TypeDefUser("", "D" + Guid.NewGuid().ToString("N")[..8], delegateBase)
        {
            Attributes = dnlib.DotNet.TypeAttributes.NestedPrivate |
                         dnlib.DotNet.TypeAttributes.Sealed |
                         dnlib.DotNet.TypeAttributes.AutoClass |
                         dnlib.DotNet.TypeAttributes.AnsiClass
        };

        var ctorSig = MethodSig.CreateInstance(module.CorLibTypes.Void, module.CorLibTypes.Object, module.CorLibTypes.IntPtr);
        var ctor = new MethodDefUser(
            ".ctor",
            ctorSig,
            dnlib.DotNet.MethodImplAttributes.Runtime,
            dnlib.DotNet.MethodAttributes.Public |
            dnlib.DotNet.MethodAttributes.HideBySig |
            dnlib.DotNet.MethodAttributes.SpecialName |
            dnlib.DotNet.MethodAttributes.RTSpecialName);
        t.Methods.Add(ctor);

        var invoke = new MethodDefUser(
            "Invoke",
            MethodSig.CreateInstance(invokeSig.RetType, invokeSig.Params.ToArray()),
            dnlib.DotNet.MethodImplAttributes.Runtime,
            dnlib.DotNet.MethodAttributes.Public |
            dnlib.DotNet.MethodAttributes.HideBySig |
            dnlib.DotNet.MethodAttributes.NewSlot |
            dnlib.DotNet.MethodAttributes.Virtual);
        t.Methods.Add(invoke);
        return t;
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
