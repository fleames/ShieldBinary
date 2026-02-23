using System;
using dnlib.DotNet;

namespace ShieldBinary.Engine.Passes;

public sealed class MetadataCleanupPass : IProtectionPass
{
    public string Name => "metadata_cleanup";

    public void Run(PipelineContext ctx, ModuleDef module)
    {
        // Remove custom attributes that expose info
        foreach (var type in module.Types)
        {
            if (type.CustomAttributes != null)
                RemoveMatching(type.CustomAttributes, IsSensitiveAttribute);
            foreach (var method in type.Methods)
            {
                if (method.CustomAttributes != null)
                    RemoveMatching(method.CustomAttributes, IsSensitiveAttribute);
            }
        }

        var asmAttrs = module.Assembly?.CustomAttributes;
        if (asmAttrs != null)
        {
            for (var i = asmAttrs.Count - 1; i >= 0; i--)
            {
                var a = asmAttrs[i];
                if (a?.TypeFullName?.Contains("AssemblyConfiguration") == true ||
                    a?.TypeFullName?.Contains("AssemblyFileVersion") == true)
                    asmAttrs.RemoveAt(i);
            }
        }
    }

    private static bool IsSensitiveAttribute(CustomAttribute attr) =>
        attr?.TypeFullName?.Contains("CompilerGenerated") == true ||
        attr?.TypeFullName?.Contains("IteratorStateMachine") == true;

    private static void RemoveMatching(dnlib.DotNet.CustomAttributeCollection attrs, Func<CustomAttribute, bool> pred)
    {
        for (var i = attrs.Count - 1; i >= 0; i--)
        {
            if (pred(attrs[i]))
                attrs.RemoveAt(i);
        }
    }
}
