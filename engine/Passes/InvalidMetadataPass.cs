using dnlib.DotNet;
using dnlib.DotNet.Emit;
using ShieldBinary.Engine;

namespace ShieldBinary.Engine.Passes;

/// <summary>
/// Injects metadata anomalies that are valid for CLR, but hostile to some static tooling.
/// Fully opt-in and conservative to preserve runtime compatibility.
/// </summary>
public sealed class InvalidMetadataPass : IProtectionPass
{
    public string Name => "invalid_metadata";

    public void Run(PipelineContext ctx, ModuleDef module)
    {
        if (!ctx.EnableInvalidMetadata)
            return;

        InjectConfusableDecoyType(module, ctx);
        InjectUnicodeNamedDecoyMethod(module, ctx);
    }

    private static void InjectConfusableDecoyType(ModuleDef module, PipelineContext ctx)
    {
        var n1 = ctx.LowEntropy ? "O" : "O" + Guid.NewGuid().ToString("N")[..4];
        var n2 = n1.Replace("O", "Ο"); // Greek Omicron, visually confusable
        var t1 = new TypeDefUser("", n1, module.CorLibTypes.Object.TypeDefOrRef)
        {
            Attributes = dnlib.DotNet.TypeAttributes.NotPublic | dnlib.DotNet.TypeAttributes.Class
        };
        var t2 = new TypeDefUser("", n2, module.CorLibTypes.Object.TypeDefOrRef)
        {
            Attributes = dnlib.DotNet.TypeAttributes.NotPublic | dnlib.DotNet.TypeAttributes.Class
        };
        module.Types.Add(t1);
        module.Types.Add(t2);
    }

    private static void InjectUnicodeNamedDecoyMethod(ModuleDef module, PipelineContext ctx)
    {
        var host = new TypeDefUser("", "M" + Guid.NewGuid().ToString("N")[..6], module.CorLibTypes.Object.TypeDefOrRef)
        {
            Attributes = dnlib.DotNet.TypeAttributes.NotPublic | dnlib.DotNet.TypeAttributes.Sealed | dnlib.DotNet.TypeAttributes.Abstract
        };
        module.Types.Add(host);

        // Method name uses zero-width/non-printable-like characters that remain valid metadata.
        var methodName = ctx.LowEntropy ? "m\u200b\u2060\u200d" : "m\u200b" + Guid.NewGuid().ToString("N")[..3] + "\u2060";
        var m = new MethodDefUser(
            methodName,
            MethodSig.CreateStatic(module.CorLibTypes.Void),
            dnlib.DotNet.MethodImplAttributes.IL,
            dnlib.DotNet.MethodAttributes.Private | dnlib.DotNet.MethodAttributes.Static);
        m.Body = new CilBody();
        m.Body.Instructions.Add(Instruction.Create(OpCodes.Ret));
        host.Methods.Add(m);
    }
}
