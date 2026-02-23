using System.Linq;
using dnlib.DotNet;

namespace ShieldBinary.Engine.Passes;

/// <summary>Adds SuppressIldasmAttribute to hinder ILDASM (limited effect; modern decompilers ignore it).</summary>
public sealed class AntiILDASMPass : IProtectionPass
{
    public string Name => "anti_ildasm";

    public void Run(PipelineContext ctx, ModuleDef module)
    {
        var suppressType = new TypeRefUser(module, "System.Runtime.CompilerServices", "SuppressIldasmAttribute", module.CorLibTypes.AssemblyRef);
        var ctorSig = MethodSig.CreateInstance(module.CorLibTypes.Void);
        var ctorRef = new MemberRefUser(module, ".ctor", ctorSig, suppressType);
        var attr = new CustomAttribute(ctorRef);

        if (!module.Assembly.CustomAttributes.Any(c => c.TypeFullName?.Contains("SuppressIldasm") == true))
            module.Assembly.CustomAttributes.Add(attr);
    }
}
