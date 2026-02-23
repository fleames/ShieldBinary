using dnlib.DotNet;
using ShieldBinary.Engine;

namespace ShieldBinary.Engine.Passes;

/// <summary>
/// Scrambles non-public type and nested-type order to make structural analysis harder.
/// Conservative: preserves <Module>, entry point type, and public top-level type ordering.
/// </summary>
public sealed class TypeScramblePass : IProtectionPass
{
    public string Name => "type_scramble";

    public void Run(PipelineContext ctx, ModuleDef module)
    {
        if (!ctx.EnableTypeScramble)
            return;

        var entryType = module.EntryPoint?.DeclaringType;
        ReorderModuleTypes(ctx, module, entryType);
        foreach (var t in module.GetAllTypes())
            ReorderNestedTypes(ctx, t, entryType);
    }

    private static void ReorderModuleTypes(PipelineContext ctx, ModuleDef module, TypeDef? entryType)
    {
        var original = module.Types.ToList();
        var protectedTypes = new List<TypeDef>();
        var candidates = new List<TypeDef>();
        foreach (var t in original)
        {
            if (ShouldProtectOrder(t, entryType))
                protectedTypes.Add(t);
            else
                candidates.Add(t);
        }
        var scrambled = Scramble(ctx, candidates);
        module.Types.Clear();
        foreach (var t in protectedTypes)
            module.Types.Add(t);
        foreach (var t in scrambled)
            module.Types.Add(t);
    }

    private static void ReorderNestedTypes(PipelineContext ctx, TypeDef owner, TypeDef? entryType)
    {
        if (owner.NestedTypes == null || owner.NestedTypes.Count <= 1)
            return;
        var original = owner.NestedTypes.ToList();
        var protectedNested = new List<TypeDef>();
        var candidates = new List<TypeDef>();
        foreach (var t in original)
        {
            if (ShouldProtectOrder(t, entryType))
                protectedNested.Add(t);
            else
                candidates.Add(t);
        }
        var scrambled = Scramble(ctx, candidates);
        owner.NestedTypes.Clear();
        foreach (var t in protectedNested)
            owner.NestedTypes.Add(t);
        foreach (var t in scrambled)
            owner.NestedTypes.Add(t);
    }

    private static bool ShouldProtectOrder(TypeDef t, TypeDef? entryType)
    {
        if (t == entryType)
            return true;
        var name = t.Name?.ToString() ?? string.Empty;
        var ns = t.Namespace?.ToString() ?? string.Empty;
        if (ns == "<Module>" || name == "<Module>")
            return true;
        var vis = t.Attributes & dnlib.DotNet.TypeAttributes.VisibilityMask;
        if (vis is dnlib.DotNet.TypeAttributes.Public or dnlib.DotNet.TypeAttributes.NestedPublic)
            return true;
        return false;
    }

    private static List<TypeDef> Scramble(PipelineContext ctx, List<TypeDef> items)
    {
        if (items.Count <= 1)
            return items;
        if (ctx.LowEntropy)
        {
            return items
                .OrderBy(t => StableHash(t.FullName))
                .ThenBy(t => t.MDToken.Raw)
                .ToList();
        }
        return items
            .Select(t => new { T = t, K = ctx.Random.Next() })
            .OrderBy(x => x.K)
            .Select(x => x.T)
            .ToList();
    }

    private static int StableHash(string? s)
    {
        if (string.IsNullOrEmpty(s))
            return 0;
        unchecked
        {
            var h = 17;
            foreach (var c in s)
                h = h * 31 + c;
            return h;
        }
    }
}
