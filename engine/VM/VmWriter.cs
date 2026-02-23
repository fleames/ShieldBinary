using System.Reflection;

namespace ShieldBinary.Engine.VM;

/// <summary>
/// Writes VM bytecode to a buffer. Operands follow opcodes in little-endian.
/// </summary>
internal sealed class VmWriter
{
    private readonly List<byte> _buffer = new();
    private readonly Dictionary<object, int> _tokenMap = new();
    private readonly List<object> _tokenList = new();
    private readonly byte[] _encodeMap;

    public VmWriter(byte[]? encodeMap = null)
    {
        _encodeMap = encodeMap is { Length: 256 } ? encodeMap : BuildIdentityMap();
    }

    public byte[] ToArray() => _buffer.ToArray();

    public void Emit(VmOpcode op)
    {
        _buffer.Add(_encodeMap[(byte)op]);
    }

    public void EmitI4(VmOpcode op, int value)
    {
        _buffer.Add(_encodeMap[(byte)op]);
        _buffer.Add((byte)value);
        _buffer.Add((byte)(value >> 8));
        _buffer.Add((byte)(value >> 16));
        _buffer.Add((byte)(value >> 24));
    }

    public void EmitI8(VmOpcode op, long value)
    {
        _buffer.Add(_encodeMap[(byte)op]);
        for (var i = 0; i < 8; i++)
            _buffer.Add((byte)(value >> (i * 8)));
    }

    public void EmitR4(VmOpcode op, float value)
    {
        _buffer.Add(_encodeMap[(byte)op]);
        var bits = BitConverter.SingleToInt32Bits(value);
        for (var i = 0; i < 4; i++)
            _buffer.Add((byte)(bits >> (i * 8)));
    }

    public void EmitR8(VmOpcode op, double value)
    {
        _buffer.Add(_encodeMap[(byte)op]);
        var bits = BitConverter.DoubleToInt64Bits(value);
        for (var i = 0; i < 8; i++)
            _buffer.Add((byte)(bits >> (i * 8)));
    }

    public int AddToken(object token)
    {
        if (_tokenMap.TryGetValue(token, out var idx))
            return idx;
        idx = _tokenList.Count;
        _tokenList.Add(token);
        _tokenMap[token] = idx;
        return idx;
    }

    public object[] GetTokenList() => _tokenList.ToArray();

    public int Length => _buffer.Count;

    public int GetLabel() => _buffer.Count;

    public void PatchBranch(int labelPos, int targetOffset)
    {
        // Operand is absolute target offset (I4)
        _buffer[labelPos + 1] = (byte)targetOffset;
        _buffer[labelPos + 2] = (byte)(targetOffset >> 8);
        _buffer[labelPos + 3] = (byte)(targetOffset >> 16);
        _buffer[labelPos + 4] = (byte)(targetOffset >> 24);
    }

    private static byte[] BuildIdentityMap()
    {
        var map = new byte[256];
        for (var i = 0; i < map.Length; i++)
            map[i] = (byte)i;
        return map;
    }
}
