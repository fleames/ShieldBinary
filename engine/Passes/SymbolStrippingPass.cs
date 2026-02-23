using dnlib.DotNet;
using ShieldBinary.Engine;

namespace ShieldBinary.Engine.Passes;

public sealed class SymbolStrippingPass : IProtectionPass
{
    public string Name => "symbol_stripping";

    public void Run(PipelineContext ctx, ModuleDef module)
    {
        // Remove debug attributes from assembly
        if (module.Assembly?.CustomAttributes != null)
        {
            RemoveMatching(module.Assembly.CustomAttributes, IsDebugAttribute);
        }

        // Remove from module
        if (module.CustomAttributes != null)
        {
            RemoveMatching(module.CustomAttributes, IsDebugAttribute);
        }

        // Remove debug attributes from all types, methods, fields
        foreach (var type in module.GetAllTypes())
        {
            if (type.FullName?.StartsWith("System.") == true || type.FullName?.StartsWith("Microsoft.") == true)
                continue;
            if (type.CustomAttributes != null)
                RemoveMatching(type.CustomAttributes, IsDebugAttribute);
            foreach (var method in type.Methods)
            {
                if (method.CustomAttributes != null)
                    RemoveMatching(method.CustomAttributes, IsDebugAttribute);
            }
            foreach (var field in type.Fields)
            {
                if (field.CustomAttributes != null)
                    RemoveMatching(field.CustomAttributes, IsDebugAttribute);
            }
        }
    }

    private static void RemoveMatching(CustomAttributeCollection attrs, Func<CustomAttribute, bool> pred)
    {
        for (var i = attrs.Count - 1; i >= 0; i--)
        {
            if (pred(attrs[i]))
                attrs.RemoveAt(i);
        }
    }

    private static bool IsDebugAttribute(CustomAttribute attr)
    {
        var name = attr.TypeFullName ?? "";
        return name.Contains("Debuggable") ||
               name.Contains("DebuggerStepThrough") ||
               name.Contains("DebuggerHidden") ||
               name.Contains("DebuggerBrowsable") ||
               name.Contains("DebuggerDisplay") ||
               name.Contains("DebuggerTypeProxy") ||
               name.Contains("DebuggerNonUserCode") ||
               name.Contains("DebuggerStepperBoundary");
    }
}
