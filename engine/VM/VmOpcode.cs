namespace ShieldBinary.Engine.VM;

/// <summary>
/// Virtual machine opcodes for IL virtualization (Themida/VMProtect-style).
/// Stack-based design mirrors IL semantics.
/// </summary>
internal enum VmOpcode : byte
{
    Nop = 0,
    Dup = 1,
    Pop = 2,

    // Constants
    LdcI4 = 3,
    LdcI8 = 4,
    LdcR4 = 5,
    LdcR8 = 6,
    LdcNull = 7,

    // Arguments and locals (operand: index as I4)
    Ldarg = 10,
    Starg = 11,
    Ldloc = 12,
    Stloc = 13,

    // Arithmetic
    Add = 20,
    Sub = 21,
    Mul = 22,
    Div = 23,
    DivUn = 24,
    Rem = 25,
    RemUn = 26,
    Neg = 27,
    And = 28,
    Or = 29,
    Xor = 30,
    Not = 31,
    Shl = 32,
    Shr = 33,
    ShrUn = 34,

    // Compare
    Ceq = 40,
    Clt = 41,
    CltUn = 42,
    Cgt = 43,
    CgtUn = 44,

    // Branch (operand: offset I4)
    Br = 50,
    Beq = 51,
    Bne = 52,
    Brtrue = 53,
    Brfalse = 54,
    Ble = 55,
    Bge = 56,
    Blt = 57,
    Bgt = 58,

    // Call (operand: metadata token I4)
    Call = 60,
    Callvirt = 61,
    Newobj = 62,

    // Field (operand: token I4)
    Ldfld = 70,
    Stfld = 71,
    Ldsfld = 72,
    Stsfld = 73,

    // Array
    Newarr = 80,
    Ldelem = 81,
    Stelem = 82,
    Ldlen = 83,

    // Object ops (operand: token I4 for type)
    Box = 90,
    Unbox = 91,
    Castclass = 92,
    Isinst = 93,

    // Indirection
    LdindI4 = 100,
    LdindI8 = 101,
    StindI4 = 102,
    StindI8 = 103,

    // Return
    Ret = 0xFF,
}
