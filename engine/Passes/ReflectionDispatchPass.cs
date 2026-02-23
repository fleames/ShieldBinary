using System.Reflection;
using dnlib.DotNet;
using dnlib.DotNet.Emit;
using ShieldBinary.Engine;

namespace ShieldBinary.Engine.Passes;

/// <summary>
/// Rewrites eligible direct static calls to reflection-based invocation proxies.
/// Conservative scope to preserve compatibility.
/// </summary>
public sealed class ReflectionDispatchPass : IProtectionPass
{
    public string Name => "reflection_dispatch";

    public void Run(PipelineContext ctx, ModuleDef module)
    {
        if (!ctx.EnableReflectionDispatch)
            return;

        var helperType = new TypeDefUser("", "RD" + Guid.NewGuid().ToString("N")[..8], module.CorLibTypes.Object.TypeDefOrRef)
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
                RewriteCalls(module, helperType, method, proxyMap, ctx);
            }
        }
    }

    private static void RewriteCalls(
        ModuleDef module,
        TypeDef helperType,
        MethodDef method,
        Dictionary<string, IMethod> proxyMap,
        PipelineContext ctx)
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
                continue;
            if (ctx.Random.Next(100) > 30)
                continue; // keep overhead bounded

            var key = target.FullName;
            if (!proxyMap.TryGetValue(key, out var proxy))
            {
                proxy = TryCreateReflectionProxy(module, helperType, target);
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
        var sig = target.MethodSig;
        if (sig == null || sig.HasThis || sig.Generic || sig.ParamsAfterSentinel != null)
            return false;
        var name = target.Name?.ToString() ?? string.Empty;
        if (name == ".ctor" || name == ".cctor")
            return false;
        if (sig.RetType.ElementType is ElementType.ByRef or ElementType.TypedByRef)
            return false;
        foreach (var p in sig.Params)
        {
            if (p.ElementType is ElementType.ByRef or ElementType.TypedByRef)
                return false;
        }
        return true;
    }

    private static IMethod? TryCreateReflectionProxy(ModuleDef module, TypeDef helperType, IMethod target)
    {
        var targetRef = module.Import(target);
        var sig = targetRef.MethodSig;
        if (sig == null || sig.HasThis || sig.Generic || sig.ParamsAfterSentinel != null)
            return null;

        var proxy = new MethodDefUser(
            "P" + Guid.NewGuid().ToString("N")[..8],
            MethodSig.CreateStatic(sig.RetType, sig.Params.ToArray()),
            dnlib.DotNet.MethodImplAttributes.IL,
            dnlib.DotNet.MethodAttributes.Private | dnlib.DotNet.MethodAttributes.Static);
        proxy.Body = new CilBody { InitLocals = true, MaxStack = (ushort)Math.Max(8, sig.Params.Count + 5) };
        helperType.Methods.Add(proxy);

        var methodInfoType = module.Import(typeof(MethodInfo)).ToTypeSig();
        var objectType = module.CorLibTypes.Object;
        var objectArray = new SZArraySig(objectType);

        var miLocal = new Local(methodInfoType);
        var argsLocal = new Local(objectArray);
        proxy.Body.Variables.Add(miLocal);
        proxy.Body.Variables.Add(argsLocal);

        var getMethodFromHandle = module.Import(typeof(MethodBase).GetMethod("GetMethodFromHandle", new[] { typeof(RuntimeMethodHandle) })!);
        var invokeMethod = module.Import(typeof(MethodBase).GetMethod("Invoke", new[] { typeof(object), typeof(object[]) })!);

        var il = proxy.Body.Instructions;
        // mi = (MethodInfo)MethodBase.GetMethodFromHandle(ldtoken target)
        il.Add(Instruction.Create(OpCodes.Ldtoken, targetRef));
        il.Add(Instruction.Create(OpCodes.Call, getMethodFromHandle));
        il.Add(Instruction.Create(OpCodes.Castclass, module.Import(typeof(MethodInfo))));
        il.Add(Instruction.Create(OpCodes.Stloc, miLocal));

        // args = new object[paramCount]
        il.Add(Instruction.Create(OpCodes.Ldc_I4, sig.Params.Count));
        il.Add(Instruction.Create(OpCodes.Newarr, objectType.TypeDefOrRef));
        il.Add(Instruction.Create(OpCodes.Stloc, argsLocal));

        for (var i = 0; i < sig.Params.Count; i++)
        {
            il.Add(Instruction.Create(OpCodes.Ldloc, argsLocal));
            il.Add(Instruction.Create(OpCodes.Ldc_I4, i));
            il.Add(CreateLdarg(proxy, i));
            var p = sig.Params[i];
            if (p.IsValueType || p.IsPrimitive)
                il.Add(Instruction.Create(OpCodes.Box, p.ToTypeDefOrRef()));
            il.Add(Instruction.Create(OpCodes.Stelem_Ref));
        }

        il.Add(Instruction.Create(OpCodes.Ldloc, miLocal));
        il.Add(Instruction.Create(OpCodes.Ldnull));
        il.Add(Instruction.Create(OpCodes.Ldloc, argsLocal));
        il.Add(Instruction.Create(OpCodes.Callvirt, invokeMethod));

        if (sig.RetType.ElementType == ElementType.Void)
        {
            il.Add(Instruction.Create(OpCodes.Pop));
            il.Add(Instruction.Create(OpCodes.Ret));
        }
        else if (sig.RetType.IsValueType || sig.RetType.IsPrimitive)
        {
            il.Add(Instruction.Create(OpCodes.Unbox_Any, sig.RetType.ToTypeDefOrRef()));
            il.Add(Instruction.Create(OpCodes.Ret));
        }
        else
        {
            il.Add(Instruction.Create(OpCodes.Castclass, sig.RetType.ToTypeDefOrRef()));
            il.Add(Instruction.Create(OpCodes.Ret));
        }

        return proxy;
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
