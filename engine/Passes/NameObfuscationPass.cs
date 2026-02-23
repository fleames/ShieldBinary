using System.Linq;
using dnlib.DotNet;
using dnlib.DotNet.Emit;
using ShieldBinary.Engine;

namespace ShieldBinary.Engine.Passes;

public sealed class NameObfuscationPass : IProtectionPass
{
    private static readonly string[] ObfuscatedPrefixes = { "a", "b", "c", "d", "x", "y", "z", "m", "n", "p" };
    private static readonly char[] UnicodeAlphabet = { 'α', 'β', 'γ', 'δ', 'λ', 'μ', 'π', 'σ', 'τ', 'ω' };
    private static readonly string[] UnprintableJoiners = { "\u200C", "\u200D", "\u2060" };
    private readonly Dictionary<string, string> _nameMap = new();
    private int _sequentialCounter;

    public string Name => "name_obfuscation";

    public void Run(PipelineContext ctx, ModuleDef module)
    {
        var entryPointType = module.EntryPoint?.DeclaringType;
        foreach (var type in module.GetAllTypes().ToList())
        {
            if (ShouldSkip(type, entryPointType))
                continue;
            ObfuscateType(ctx, type);
        }
    }

    private static bool ShouldSkip(TypeDef type, TypeDef? entryPointType)
    {
        var fn = type.FullName ?? "";
        var ns = type.Namespace ?? "";
        var name = type.Name ?? "";
        if (ns == "<Module>" || name.StartsWith("<"))
            return true;
        if (fn.StartsWith("System.") || fn.StartsWith("Microsoft."))
            return true;
        // Don't obfuscate entry point type or its nested types
        if (IsOrNestedIn(entryPointType, type))
            return true;
        // Don't obfuscate public types - they're used by reflection, DI, serialization, plugins
        if (IsPublicOrNestedPublic(type))
            return true;
        // Don't obfuscate types used by reflection/serialization (or their nested types)
        if (HasReflectionSensitiveAttributeInHierarchy(type))
            return true;
        return false;
    }

    private static bool IsPublicOrNestedPublic(TypeDef type)
    {
        var vis = type.Attributes & TypeAttributes.VisibilityMask;
        return vis == TypeAttributes.Public || vis == TypeAttributes.NestedPublic;
    }

    private static bool IsOrNestedIn(TypeDef? ancestor, TypeDef? type)
    {
        while (type != null)
        {
            if (type == ancestor) return true;
            type = type.DeclaringType;
        }
        return false;
    }

    private static bool HasReflectionSensitiveAttributeInHierarchy(TypeDef type)
    {
        var t = type;
        while (t != null)
        {
            if (HasReflectionSensitiveAttribute(t)) return true;
            t = t.DeclaringType;
        }
        return false;
    }

    private static bool HasReflectionSensitiveAttribute(TypeDef type)
    {
        if (type.CustomAttributes == null) return false;
        foreach (var attr in type.CustomAttributes)
        {
            var name = attr.TypeFullName ?? "";
            if (name.Contains("Serializable") || name.Contains("DataContract") ||
                name.Contains("KnownType") || name.Contains("XmlType") || name.Contains("XmlRoot") ||
                name.Contains("Obfuscation") || name.Contains("Export") || name.Contains("PartCreationPolicy") ||
                name.Contains("Component") || name.Contains("ComVisible") || name.Contains("ComImport") ||
                name.Contains("ContentProperty") || name.Contains("TemplatePart") ||
                name.Contains("Authorize") || name.Contains("ApiController") || name.Contains("Route"))
                return true;
        }
        return false;
    }

    private void ObfuscateType(PipelineContext ctx, TypeDef type)
    {
        var fullName = type.FullName ?? type.Name ?? "";
        var newName = GenerateObfuscatedName(ctx, fullName);
        _nameMap[fullName] = newName;
        type.Name = newName;
        type.Namespace = "";

        foreach (var method in type.Methods)
        {
            if (method.IsConstructor || method.IsStaticConstructor)
                continue;
            if (method.Name.StartsWith("get_") || method.Name.StartsWith("set_"))
                continue;
            ObfuscateMethod(ctx, method);
            ObfuscateParameters(ctx, method);
        }
        foreach (var field in type.Fields)
        {
            field.Name = GenerateObfuscatedName(ctx, field.FullName ?? field.Name ?? "");
        }
        foreach (var prop in type.Properties)
        {
            var newPropName = GenerateObfuscatedName(ctx, prop.FullName ?? prop.Name ?? "");
            prop.Name = newPropName;
            if (prop.GetMethod != null) prop.GetMethod.Name = "get_" + newPropName;
            if (prop.SetMethod != null) prop.SetMethod.Name = "set_" + newPropName;
        }
        foreach (var evt in type.Events)
        {
            var newEventName = GenerateObfuscatedName(ctx, evt.FullName ?? evt.Name ?? "");
            evt.Name = newEventName;
            if (evt.AddMethod != null) evt.AddMethod.Name = "add_" + newEventName;
            if (evt.RemoveMethod != null) evt.RemoveMethod.Name = "remove_" + newEventName;
            if (evt.InvokeMethod != null) evt.InvokeMethod.Name = "raise_" + newEventName;
        }
    }

    private void ObfuscateMethod(PipelineContext ctx, MethodDef method)
    {
        if (method.Name.StartsWith("get_") || method.Name.StartsWith("set_"))
            return; // Keep property accessors in sync with property names
        method.Name = GenerateObfuscatedName(ctx, method.FullName ?? method.Name ?? "");
    }

    private void ObfuscateParameters(PipelineContext ctx, MethodDef method)
    {
        if (method.ParamDefs == null || method.ParamDefs.Count == 0)
            return;
        foreach (var p in method.ParamDefs)
        {
            // Skip return parameter metadata (sequence 0).
            if (p.Sequence == 0)
                continue;
            var original = $"{method.FullName}:param:{p.Sequence}:{p.Name}";
            p.Name = GenerateObfuscatedName(ctx, original);
        }
    }

    private string GenerateObfuscatedName(PipelineContext ctx, string original)
    {
        if (_nameMap.TryGetValue(original, out var existing))
            return existing;

        string generated = ctx.RenameMode switch
        {
            RenameMode.Sequential => GenerateSequentialName(),
            RenameMode.Unicode => GenerateUnicodeName(ctx),
            RenameMode.Unprintable when ctx.AllowUnsafeRename => GenerateUnprintableName(ctx),
            RenameMode.Unprintable => GenerateRandomLikeName(ctx, original),
            _ => GenerateRandomLikeName(ctx, original),
        };
        _nameMap[original] = generated;
        return generated;
    }

    private string GenerateSequentialName()
    {
        _sequentialCounter++;
        return "n" + _sequentialCounter.ToString("X");
    }

    private string GenerateUnicodeName(PipelineContext ctx)
    {
        int idx;
        int suff;
        if (ctx.LowEntropy)
        {
            idx = _sequentialCounter % UnicodeAlphabet.Length;
            _sequentialCounter++;
            suff = _sequentialCounter;
        }
        else
        {
            idx = ctx.Random.Next(UnicodeAlphabet.Length);
            suff = ctx.Random.Next(100, 99999);
        }
        return UnicodeAlphabet[idx] + suff.ToString("X");
    }

    private string GenerateUnprintableName(PipelineContext ctx)
    {
        var baseName = GenerateUnicodeName(ctx);
        var j1 = UnprintableJoiners[ctx.Random.Next(UnprintableJoiners.Length)];
        var j2 = UnprintableJoiners[ctx.Random.Next(UnprintableJoiners.Length)];
        return "_" + j1 + baseName + j2;
    }

    private string GenerateRandomLikeName(PipelineContext ctx, string original)
    {
        int idx;
        int suff;
        if (ctx.LowEntropy)
        {
            var hash = (uint)original.GetHashCode();
            idx = (int)(hash % (uint)ObfuscatedPrefixes.Length);
            suff = (int)(hash % 0xE678) + 0x1000; // 0x1000..0xF678
        }
        else
        {
            idx = ctx.Random.Next(ObfuscatedPrefixes.Length);
            suff = ctx.PolymorphicMode
                ? ctx.Random.Next(10000, 9999999)
                : ctx.Random.Next(1000, 99999);
        }
        return ObfuscatedPrefixes[idx] + suff.ToString("X");
    }
}
