using dnlib.DotNet;

namespace ShieldBinary.Engine.Passes;

public interface IProtectionPass
{
    string Name { get; }
    void Run(PipelineContext ctx, ModuleDef module);
}
