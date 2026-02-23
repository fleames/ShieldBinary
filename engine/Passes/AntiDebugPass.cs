using System.Reflection;
using dnlib.DotNet;
using dnlib.DotNet.Emit;

namespace ShieldBinary.Engine.Passes;

/// <summary>Injects anti-debug checks (Debugger.IsAttached) at method entry. Exits if debugger detected.</summary>
public sealed class AntiDebugPass : IProtectionPass
{
    public string Name => "anti_debug";

    public void Run(PipelineContext ctx, ModuleDef module)
    {
        var exitMethod = InjectExitHelper(module);
        var checkMethod = InjectCheckHelper(module, exitMethod);

        foreach (var type in module.GetAllTypes())
        {
            foreach (var method in type.Methods)
            {
                if (!method.HasBody || method.Body.Instructions.Count < 2)
                    continue;
                if (method.IsConstructor || method.IsStaticConstructor)
                    continue;
                if (method == exitMethod || method == checkMethod)
                    continue;
                if (module.EntryPoint == method)
                    continue;

                if (ctx.Random.Next(100) > 30)
                    continue; // Only ~30% of methods to limit overhead
                try
                {
                    method.Body!.Instructions.Insert(0, Instruction.Create(OpCodes.Call, checkMethod));
                }
                catch
                {
                    // Skip
                }
            }
        }
    }

    private static IMethod InjectCheckHelper(ModuleDef module, IMethod exitMethod)
    {
        var isAttached = typeof(System.Diagnostics.Debugger).GetMethod("get_IsAttached", BindingFlags.Public | BindingFlags.Static);
        if (isAttached == null)
            throw new InvalidOperationException("Debugger.IsAttached not found");

        var helperName = "A" + Guid.NewGuid().ToString("N")[..6];
        var helperType = new TypeDefUser("", helperName, module.CorLibTypes.Object.TypeDefOrRef);
        helperType.Attributes = dnlib.DotNet.TypeAttributes.NotPublic | dnlib.DotNet.TypeAttributes.Sealed | dnlib.DotNet.TypeAttributes.Abstract;
        module.Types.Add(helperType);

        var sig = MethodSig.CreateStatic(module.CorLibTypes.Void);
        var checkMethod = new MethodDefUser("C", sig, dnlib.DotNet.MethodImplAttributes.IL, dnlib.DotNet.MethodAttributes.Private | dnlib.DotNet.MethodAttributes.Static);
        helperType.Methods.Add(checkMethod);

        var body = checkMethod.Body ?? new CilBody();
        checkMethod.Body = body;
        var isAttachedRef = module.Import(isAttached);
        var ret = Instruction.Create(OpCodes.Ret);
        body.Instructions.Add(Instruction.Create(OpCodes.Call, isAttachedRef));
        body.Instructions.Add(Instruction.Create(OpCodes.Brfalse, ret));
        body.Instructions.Add(Instruction.Create(OpCodes.Call, exitMethod));
        body.Instructions.Add(ret);
        return checkMethod;
    }

    private static IMethod InjectExitHelper(ModuleDef module)
    {
        var envExit = typeof(Environment).GetMethod("Exit", [typeof(int)]);
        if (envExit == null)
            throw new InvalidOperationException("Environment.Exit not found");

        var helperName = "E" + Guid.NewGuid().ToString("N")[..6];
        var helperType = new TypeDefUser("", helperName, module.CorLibTypes.Object.TypeDefOrRef);
        helperType.Attributes = dnlib.DotNet.TypeAttributes.NotPublic | dnlib.DotNet.TypeAttributes.Sealed | dnlib.DotNet.TypeAttributes.Abstract;
        module.Types.Add(helperType);

        var sig = MethodSig.CreateStatic(module.CorLibTypes.Void);
        var exitMethod = new MethodDefUser("X", sig, dnlib.DotNet.MethodImplAttributes.IL, dnlib.DotNet.MethodAttributes.Private | dnlib.DotNet.MethodAttributes.Static);
        helperType.Methods.Add(exitMethod);

        var body = exitMethod.Body ?? new CilBody();
        exitMethod.Body = body;
        body.Instructions.Add(Instruction.Create(OpCodes.Ldc_I4, 0xDEAD));
        body.Instructions.Add(Instruction.Create(OpCodes.Call, module.Import(envExit)));
        body.Instructions.Add(Instruction.Create(OpCodes.Ret));
        return exitMethod;
    }
}
