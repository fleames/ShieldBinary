type Tier = {
  id: string;
  name: string;
  price: string;
  summary: string;
  techniques: string[];
};

const TIERS: Tier[] = [
  {
    id: 'minimal',
    name: 'Minimal',
    price: 'Free',
    summary: 'Maximum compatibility baseline protection.',
    techniques: [
      'Symbol stripping',
      'Metadata cleanup',
    ],
  },
  {
    id: 'basic',
    name: 'Basic',
    price: '$9',
    summary: 'Core hardening with compatibility-first defaults.',
    techniques: [
      'String encryption',
      'Virtualization',
      'Resource encryption (opt-in)',
      'Reference proxying (opt-in)',
      'Delegate proxying (opt-in)',
      'Reflection dispatch (opt-in)',
      'Type scrambling (opt-in)',
      'Assembly embedding (opt-in)',
      'Anti-decompiler (opt-in)',
      'Invalid metadata (opt-in)',
      'Method body encryption (opt-in)',
      'Dynamic method generation (opt-in)',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$39',
    summary: 'Advanced obfuscation and constant/IL hardening.',
    techniques: [
      'Anti-ILDASM',
      'Constant encoding',
      'IL mutation (opt-in)',
      'Opaque predicates',
      'All Basic techniques',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: '$149',
    summary: 'Maximum obfuscation stack for high-resistance scenarios.',
    techniques: [
      'Name obfuscation (random/sequential/unicode/unprintable)',
      'Anti-debug',
      'Anti-tamper',
      'Control-flow flattening',
      'Dead code injection',
      'Aggressive anti-decompiler mode (opt-in)',
      'All Pro techniques',
    ],
  },
];

const CROSS_CUTTING = [
  'Native packer hardening: AES-GCM authenticated payload format',
  'Single-download output policy with storage cleanup',
  'Publish profiles: ReadyToRun, Single-file, Trimming, NativeAOT (best effort)',
  'Assembly merge workflow with ILRepack scripts',
];

export default function Tiers() {
  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.6rem', marginBottom: '0.5rem' }}>Tiers, Features, and Techniques</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
        Complete overview of what each ShieldBinary tier includes. Items marked opt-in require explicit engine flags.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.9rem' }}>
        {TIERS.map((tier) => (
          <section
            key={tier.id}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 10,
              background: 'var(--bg-elevated)',
              padding: '1rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.35rem' }}>
              <h2 style={{ margin: 0, fontSize: '1rem' }}>{tier.name}</h2>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: '0.85rem' }}>{tier.price}</span>
            </div>
            <p style={{ margin: '0 0 0.75rem 0', color: 'var(--text-muted)', fontSize: '0.875rem' }}>{tier.summary}</p>
            <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'grid', gap: '0.35rem' }}>
              {tier.techniques.map((t) => (
                <li key={t} style={{ fontSize: '0.86rem' }}>{t}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section
        style={{
          marginTop: '1rem',
          border: '1px solid var(--border)',
          borderRadius: 10,
          background: 'var(--bg-elevated)',
          padding: '1rem',
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Cross-Cutting Features</h2>
        <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'grid', gap: '0.35rem' }}>
          {CROSS_CUTTING.map((f) => (
            <li key={f} style={{ fontSize: '0.86rem' }}>{f}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
