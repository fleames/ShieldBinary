using System;
using dnlib.DotNet;

namespace ShieldBinary.Engine.Passes;

public sealed class MetadataCleanupPass : IProtectionPass
{
    public string Name => "metadata_cleanup";

    public void Run(PipelineContext ctx, ModuleDef module)
    {
        // Remove custom attributes that expose compiler/build fingerprints.
        foreach (var type in module.GetAllTypes())
        {
            if (type.CustomAttributes != null)
                RemoveMatching(type.CustomAttributes, IsSensitiveAttribute);
            foreach (var field in type.Fields)
            {
                if (field.CustomAttributes != null)
                    RemoveMatching(field.CustomAttributes, IsSensitiveAttribute);
            }
            foreach (var method in type.Methods)
            {
                if (method.CustomAttributes != null)
                    RemoveMatching(method.CustomAttributes, IsSensitiveAttribute);
                if (method.ParamDefs != null)
                {
                    foreach (var p in method.ParamDefs)
                    {
                        if (p.CustomAttributes != null)
                            RemoveMatching(p.CustomAttributes, IsSensitiveAttribute);
                    }
                }
            }
            foreach (var prop in type.Properties)
            {
                if (prop.CustomAttributes != null)
                    RemoveMatching(prop.CustomAttributes, IsSensitiveAttribute);
            }
            foreach (var ev in type.Events)
            {
                if (ev.CustomAttributes != null)
                    RemoveMatching(ev.CustomAttributes, IsSensitiveAttribute);
            }
        }

        var asmAttrs = module.Assembly?.CustomAttributes;
        if (asmAttrs != null)
        {
            for (var i = asmAttrs.Count - 1; i >= 0; i--)
            {
                var a = asmAttrs[i];
                if (a?.TypeFullName?.Contains("AssemblyConfiguration") == true ||
                    a?.TypeFullName?.Contains("AssemblyFileVersion") == true ||
                    a?.TypeFullName?.Contains("AssemblyInformationalVersion") == true ||
                    a?.TypeFullName?.Contains("AssemblyCompany") == true ||
                    a?.TypeFullName?.Contains("AssemblyProduct") == true)
                    asmAttrs.RemoveAt(i);
            }
        }

        // Reduce metadata breadcrumbs commonly used for fingerprinting.
        if (module.Assembly != null)
        {
            module.Assembly.Version = new Version(0, 0, 0, 0);
        }
    }

    private static bool IsSensitiveAttribute(CustomAttribute attr) =>
        attr?.TypeFullName?.Contains("CompilerGenerated") == true ||
        attr?.TypeFullName?.Contains("IteratorStateMachine") == true ||
        attr?.TypeFullName?.Contains("AsyncStateMachine") == true ||
        attr?.TypeFullName?.Contains("Debugger") == true ||
        attr?.TypeFullName?.Contains("GeneratedCode") == true;

    private static void RemoveMatching(dnlib.DotNet.CustomAttributeCollection attrs, Func<CustomAttribute, bool> pred)
    {
        for (var i = attrs.Count - 1; i >= 0; i--)
        {
            if (pred(attrs[i]))
                attrs.RemoveAt(i);
        }
    }
}
