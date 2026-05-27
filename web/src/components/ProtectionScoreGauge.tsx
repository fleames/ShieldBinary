type Props = {
  score: number;
  band?: string;
  size?: number;
};

export default function ProtectionScoreGauge({ score, band, size = 120 }: Props) {
  const clamped = Math.max(0, Math.min(100, score));
  const r = size * 0.41;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const arcLength = circumference * 0.75; // 270° arc
  const filled = arcLength * (clamped / 100);
  const strokeWidth = size * 0.065;

  const stopA = clamped >= 75 ? '#5090ff' : clamped >= 45 ? '#f5a020' : '#ff3d55';
  const stopB = clamped >= 75 ? '#9265ff' : clamped >= 45 ? '#db8e18' : '#c42040';
  const glowColor = stopA + '88';

  const gradId = `psg-${Math.round(clamped)}-${size}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ overflow: 'visible' }}
      aria-label={`Protection score: ${clamped} out of 100`}
    >
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={stopA} />
          <stop offset="100%" stopColor={stopB} />
        </linearGradient>
      </defs>

      {/* Track ring */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="rgba(255,255,255,0.055)"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={`${arcLength} ${circumference - arcLength}`}
        transform={`rotate(135, ${cx}, ${cy})`}
      />

      {/* Score arc */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circumference - filled}`}
        transform={`rotate(135, ${cx}, ${cy})`}
        style={{
          transition: 'stroke-dasharray 0.9s cubic-bezier(0.16, 1, 0.3, 1)',
          filter: `drop-shadow(0 0 ${size * 0.06}px ${glowColor})`,
        }}
      />

      {/* Score number */}
      <text
        x={cx}
        y={cy - size * 0.04}
        textAnchor="middle"
        dominantBaseline="central"
        fill="#ecf1ff"
        fontSize={size * 0.24}
        fontWeight="700"
        fontFamily="Inter, system-ui, sans-serif"
      >
        {clamped}
      </text>

      {/* /100 label */}
      <text
        x={cx}
        y={cy + size * 0.16}
        textAnchor="middle"
        dominantBaseline="central"
        fill="#4e6282"
        fontSize={size * 0.085}
        fontFamily="Inter, system-ui, sans-serif"
      >
        / 100
      </text>

      {/* Band label */}
      {band && (
        <text
          x={cx}
          y={cy + size * 0.30}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#8696ba"
          fontSize={size * 0.075}
          fontFamily="Inter, system-ui, sans-serif"
          letterSpacing="0.07em"
        >
          {band.toUpperCase()}
        </text>
      )}
    </svg>
  );
}
