import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Badge, Button, Card, Panel } from '../design-system';

const FEATURES = [
  {
    icon: '⬆',
    title: 'Upload & protect in seconds',
    body: 'Drag and drop your .exe or .dll. Auto-detects .NET assemblies and native PE binaries. Download the hardened output immediately.',
  },
  {
    icon: '🛡',
    title: 'Multiple protection tiers',
    body: 'From lightweight symbol stripping up to full IL virtualization, name obfuscation, control-flow flattening, and anti-debug — pick the level that fits.',
  },
  {
    icon: '🔬',
    title: 'Threat intelligence',
    body: 'Optional VirusTotal integration lets you verify your protected output and track which techniques get flagged over time.',
  },
  {
    icon: '✔',
    title: 'Compatibility checks',
    body: 'After protection the worker can launch your binary in an isolated environment and report pass metrics, size delta, and runtime compatibility.',
  },
];

const STEPS = [
  { n: '1', title: 'Upload', body: 'Select your .exe or .dll file — up to 100 MB.' },
  { n: '2', title: 'Configure', body: 'Choose a tier and any advanced opt-in techniques.' },
  { n: '3', title: 'Download', body: 'Your hardened binary is ready in seconds. Single-download, storage cleaned up automatically.' },
];

const TIERS = [
  {
    id: 'minimal',
    name: 'Minimal',
    summary: 'Symbol stripping + metadata cleanup. Maximum compatibility fallback.',
  },
  {
    id: 'basic',
    name: 'Basic',
    summary: '.NET: string encryption, IL virtualization. Native: AES-GCM + compression packing.',
  },
  {
    id: 'pro',
    name: 'Pro',
    summary: '+ Anti-ILDASM, constant encoding, opaque predicates, IL mutation.',
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    summary: '+ Name obfuscation, control-flow flattening, anti-debug, anti-tamper.',
  },
];

export default function Landing() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) {
      navigate('/dashboard', { replace: true });
    }
  }, [user, loading, navigate]);

  if (loading) return null;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', paddingBottom: '4rem' }}>

      {/* Beta banner */}
      <div style={{
        background: 'linear-gradient(90deg, rgba(99,167,255,0.12), rgba(123,93,255,0.12))',
        border: '1px solid rgba(99,167,255,0.28)',
        borderRadius: 10,
        padding: '0.6rem 1.1rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.7rem',
        marginBottom: '3rem',
        marginTop: '1.5rem',
        fontSize: '0.875rem',
      }}>
        <Badge tone="accent">Public Beta</Badge>
        <span style={{ color: 'var(--text-muted)' }}>
          All protection tiers are <strong style={{ color: 'var(--text)' }}>free</strong> during our public beta.
          No credit card needed.
        </span>
      </div>

      {/* Hero */}
      <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
        <h1 style={{
          fontSize: 'clamp(2rem, 5vw, 3.2rem)',
          fontWeight: 800,
          lineHeight: 1.15,
          margin: '0 0 1rem',
          background: 'linear-gradient(135deg, #e8efff 0%, #63a7ff 55%, #7b5dff 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}>
          Harden your Windows binaries.<br />In seconds.
        </h1>
        <p style={{
          fontSize: '1.1rem',
          color: 'var(--text-muted)',
          maxWidth: 560,
          margin: '0 auto 2rem',
          lineHeight: 1.7,
        }}>
          ShieldBinary Nexus applies obfuscation, encryption, and anti-analysis techniques
          to your .NET assemblies and native PE files — no setup required.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link to="/register" style={{ textDecoration: 'none' }}>
            <Button size="lg" variant="primary">Get started free</Button>
          </Link>
          <Link to="/login" style={{ textDecoration: 'none' }}>
            <Button size="lg" variant="ghost">Log in</Button>
          </Link>
        </div>
      </div>

      {/* Features */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '0.85rem',
        marginBottom: '3rem',
      }}>
        {FEATURES.map((f) => (
          <Card key={f.title}>
            <div style={{ fontSize: '1.4rem', marginBottom: '0.5rem' }}>{f.icon}</div>
            <div style={{ fontWeight: 700, marginBottom: '0.35rem', fontSize: '0.95rem' }}>{f.title}</div>
            <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>{f.body}</div>
          </Card>
        ))}
      </div>

      {/* How it works */}
      <Panel style={{ marginBottom: '2.5rem' }}>
        <h2 style={{ marginTop: 0, fontSize: '1.05rem', marginBottom: '1.2rem' }}>How it works</h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '1rem',
        }}>
          {STEPS.map((s) => (
            <div key={s.n} style={{ display: 'flex', gap: '0.85rem', alignItems: 'flex-start' }}>
              <div style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #63a7ff, #7b5dff)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: '0.875rem',
                flexShrink: 0,
                color: '#fff',
              }}>
                {s.n}
              </div>
              <div>
                <div style={{ fontWeight: 600, marginBottom: '0.2rem', fontSize: '0.9rem' }}>{s.title}</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>{s.body}</div>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {/* Tiers overview */}
      <h2 style={{ fontSize: '1.05rem', marginBottom: '0.85rem' }}>Protection tiers</h2>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
        gap: '0.75rem',
        marginBottom: '2.5rem',
      }}>
        {TIERS.map((t) => (
          <Card key={t.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{t.name}</span>
              <Badge tone="success">Free</Badge>
            </div>
            <div style={{ fontSize: '0.83rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>{t.summary}</div>
          </Card>
        ))}
      </div>

      {/* Bottom CTA */}
      <div style={{
        textAlign: 'center',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: '2rem',
        background: 'var(--bg-elevated)',
      }}>
        <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>
          Ready to protect your first binary?
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
          Create a free account — no credit card, no limits during beta.
        </div>
        <Link to="/register" style={{ textDecoration: 'none' }}>
          <Button size="lg" variant="primary">Create free account</Button>
        </Link>
      </div>
    </div>
  );
}
