using System.Collections.Generic;
using dnlib.DotNet;

namespace ShieldBinary.Engine;

internal static class ModuleExtensions
{
    public static IEnumerable<TypeDef> GetAllTypes(this ModuleDef module)
    {
        foreach (var type in module.Types)
        {
            yield return type;
            foreach (var nested in type.GetAllNestedTypes())
                yield return nested;
        }
    }

    private static IEnumerable<TypeDef> GetAllNestedTypes(this TypeDef type)
    {
        foreach (var nested in type.NestedTypes)
        {
            yield return nested;
            foreach (var inner in nested.GetAllNestedTypes())
                yield return inner;
        }
    }
}
