using System.Collections.Generic;
using dnlib.DotNet.Emit;

namespace ShieldBinary.Engine.Passes;

/// <summary>
/// Instructions that cannot be removed or replaced without breaking branch targets or exception handlers.
/// </summary>
internal static class CilBodyExtensions
{
    public static HashSet<Instruction> GetProtectedInstructions(CilBody body)
    {
        var set = new HashSet<Instruction>();
        if (body?.Instructions == null) return set;

        foreach (var ins in body.Instructions)
        {
            if (ins.Operand is Instruction target)
                set.Add(target);
            if (ins.Operand is Instruction[] targets)
            {
                foreach (var t in targets)
                    set.Add(t);
            }
        }

        if (body.ExceptionHandlers != null)
        {
            foreach (var eh in body.ExceptionHandlers)
            {
                if (eh.TryStart != null) set.Add(eh.TryStart);
                if (eh.TryEnd != null) set.Add(eh.TryEnd);
                if (eh.HandlerStart != null) set.Add(eh.HandlerStart);
                if (eh.HandlerEnd != null) set.Add(eh.HandlerEnd);
                if (eh.FilterStart != null) set.Add(eh.FilterStart);
            }
        }

        return set;
    }

    public static bool HasExceptionHandlers(CilBody body) =>
        body?.ExceptionHandlers != null && body.ExceptionHandlers.Count > 0;
}
