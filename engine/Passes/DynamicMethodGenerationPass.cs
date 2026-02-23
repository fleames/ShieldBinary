using System.Reflection;
using dnlib.DotNet;
using dnlib.DotNet.Emit;
using ShieldBinary.Engine;

namespace ShieldBinary.Engine.Passes;

/// <summary>
/// Injects a runtime warmup that generates and executes a DynamicMethod.
/// Fully opt-in and guarded by RuntimeFeature.IsDynamicCodeSupported.
/// </summary>
public sealed class DynamicMethodGenerationPass : IProtectionPass
{
    public string Name => "dynamic_method_generation";

    public void Run(PipelineContext ctx, ModuleDef module)
    {
        if (!ctx.EnableDynamicMethodGen)
            return;

        var warmup = InjectWarmup(module);
        EnsureModuleCtorCalls(module, warmup);
    }

    private static IMethod InjectWarmup(ModuleDef module)
    {
        var helperType = new TypeDefUser("", "DM" + Guid.NewGuid().ToString("N")[..8], module.CorLibTypes.Object.TypeDefOrRef)
        {
            Attributes = dnlib.DotNet.TypeAttributes.NotPublic | dnlib.DotNet.TypeAttributes.Sealed | dnlib.DotNet.TypeAttributes.Abstract
        };
        module.Types.Add(helperType);

        var warmup = new MethodDefUser(
            "W",
            MethodSig.CreateStatic(module.CorLibTypes.Void),
            dnlib.DotNet.MethodImplAttributes.IL,
            dnlib.DotNet.MethodAttributes.Private | dnlib.DotNet.MethodAttributes.Static);
        warmup.Body = new CilBody { InitLocals = true, MaxStack = 8 };
        helperType.Methods.Add(warmup);

        var dmType = module.Import(typeof(global::System.Reflection.Emit.DynamicMethod)).ToTypeSig();
        var ilgType = module.Import(typeof(global::System.Reflection.Emit.ILGenerator)).ToTypeSig();
        var delegateType = module.Import(typeof(Delegate)).ToTypeSig();
        var funcIntType = module.Import(typeof(Func<int>)).ToTypeSig();
        var opCodeTypeRef = module.Import(typeof(OpCodes));
        var runtimeFeatureGetter = module.Import(typeof(System.Runtime.CompilerServices.RuntimeFeature).GetProperty("IsDynamicCodeSupported")!.GetGetMethod()!);
        var dynamicMethodCtor = module.Import(typeof(global::System.Reflection.Emit.DynamicMethod).GetConstructor(new[] { typeof(string), typeof(Type), typeof(Type[]) })!);
        var getILGenerator = module.Import(typeof(global::System.Reflection.Emit.DynamicMethod).GetMethod("GetILGenerator", Type.EmptyTypes)!);
        var emitNoArg = module.Import(typeof(global::System.Reflection.Emit.ILGenerator).GetMethod("Emit", new[] { typeof(global::System.Reflection.Emit.OpCode) })!);
        var createDelegate = module.Import(typeof(global::System.Reflection.Emit.DynamicMethod).GetMethod("CreateDelegate", new[] { typeof(Type) })!);
        var funcInvoke = module.Import(typeof(Func<int>).GetMethod("Invoke", Type.EmptyTypes)!);
        var getTypeFromHandle = module.Import(typeof(Type).GetMethod("GetTypeFromHandle", new[] { typeof(RuntimeTypeHandle) })!);
        var ldc7Field = module.Import(typeof(global::System.Reflection.Emit.OpCodes).GetField("Ldc_I4_7", BindingFlags.Public | BindingFlags.Static)!);
        var retField = module.Import(typeof(global::System.Reflection.Emit.OpCodes).GetField("Ret", BindingFlags.Public | BindingFlags.Static)!);

        var dmLocal = new Local(dmType);
        var ilLocal = new Local(ilgType);
        var delLocal = new Local(delegateType);
        var fnLocal = new Local(funcIntType);
        warmup.Body.Variables.Add(dmLocal);
        warmup.Body.Variables.Add(ilLocal);
        warmup.Body.Variables.Add(delLocal);
        warmup.Body.Variables.Add(fnLocal);

        var il = warmup.Body.Instructions;
        var retIns = Instruction.Create(OpCodes.Ret);

        // if (!RuntimeFeature.IsDynamicCodeSupported) return;
        il.Add(Instruction.Create(OpCodes.Call, runtimeFeatureGetter));
        il.Add(Instruction.Create(OpCodes.Brfalse, retIns));

        // dm = new DynamicMethod("d", typeof(int), Type.EmptyTypes)
        il.Add(Instruction.Create(OpCodes.Ldstr, "d"));
        il.Add(Instruction.Create(OpCodes.Ldtoken, module.CorLibTypes.Int32.ToTypeDefOrRef()));
        il.Add(Instruction.Create(OpCodes.Call, getTypeFromHandle));
        il.Add(Instruction.Create(OpCodes.Ldsfld, module.Import(typeof(Type).GetField("EmptyTypes", BindingFlags.Public | BindingFlags.Static)!)));
        il.Add(Instruction.Create(OpCodes.Newobj, dynamicMethodCtor));
        il.Add(Instruction.Create(OpCodes.Stloc, dmLocal));

        // il = dm.GetILGenerator()
        il.Add(Instruction.Create(OpCodes.Ldloc, dmLocal));
        il.Add(Instruction.Create(OpCodes.Callvirt, getILGenerator));
        il.Add(Instruction.Create(OpCodes.Stloc, ilLocal));

        // il.Emit(OpCodes.Ldc_I4_7); il.Emit(OpCodes.Ret)
        il.Add(Instruction.Create(OpCodes.Ldloc, ilLocal));
        il.Add(Instruction.Create(OpCodes.Ldsfld, ldc7Field));
        il.Add(Instruction.Create(OpCodes.Callvirt, emitNoArg));
        il.Add(Instruction.Create(OpCodes.Ldloc, ilLocal));
        il.Add(Instruction.Create(OpCodes.Ldsfld, retField));
        il.Add(Instruction.Create(OpCodes.Callvirt, emitNoArg));

        // del = dm.CreateDelegate(typeof(Func<int>)); fn = (Func<int>)del; _ = fn.Invoke();
        il.Add(Instruction.Create(OpCodes.Ldloc, dmLocal));
        il.Add(Instruction.Create(OpCodes.Ldtoken, module.Import(typeof(Func<int>))));
        il.Add(Instruction.Create(OpCodes.Call, getTypeFromHandle));
        il.Add(Instruction.Create(OpCodes.Callvirt, createDelegate));
        il.Add(Instruction.Create(OpCodes.Stloc, delLocal));
        il.Add(Instruction.Create(OpCodes.Ldloc, delLocal));
        il.Add(Instruction.Create(OpCodes.Castclass, module.Import(typeof(Func<int>))));
        il.Add(Instruction.Create(OpCodes.Stloc, fnLocal));
        il.Add(Instruction.Create(OpCodes.Ldloc, fnLocal));
        il.Add(Instruction.Create(OpCodes.Callvirt, funcInvoke));
        il.Add(Instruction.Create(OpCodes.Pop));

        il.Add(retIns);
        return warmup;
    }

    private static void EnsureModuleCtorCalls(ModuleDef module, IMethod methodToCall)
    {
        var global = module.GlobalType;
        var cctor = global.FindStaticConstructor();
        if (cctor == null)
        {
            cctor = new MethodDefUser(
                ".cctor",
                MethodSig.CreateStatic(module.CorLibTypes.Void),
                dnlib.DotNet.MethodImplAttributes.IL,
                dnlib.DotNet.MethodAttributes.Private | dnlib.DotNet.MethodAttributes.Static | dnlib.DotNet.MethodAttributes.SpecialName | dnlib.DotNet.MethodAttributes.RTSpecialName);
            cctor.Body = new CilBody();
            cctor.Body.Instructions.Add(Instruction.Create(OpCodes.Ret));
            global.Methods.Add(cctor);
        }
        if (cctor.Body == null)
        {
            cctor.Body = new CilBody();
            cctor.Body.Instructions.Add(Instruction.Create(OpCodes.Ret));
        }
        cctor.Body.Instructions.Insert(0, Instruction.Create(OpCodes.Call, methodToCall));
    }
}
