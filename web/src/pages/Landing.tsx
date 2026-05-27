import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Badge, Button } from '../design-system';

/* ---- Icons (inline SVG, no deps) ---- */

const UploadIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const ShieldIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const ScanIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const CheckIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

/* ---- Data ---- */

const FEATURES = [
  {
    Icon: UploadIcon,
    color: 'var(--blue)',
    glow: 'rgba(80,144,255,0.18)',
    title: 'Upload & protect in seconds',
    body: 'Drag-drop your .exe or .dll. Auto-detects .NET assemblies and native PE binaries. Hardened output is available for download the moment the job completes.',
  },
  {
    Icon: ShieldIcon,
    color: 'var(--purple)',
    glow: 'rgba(146,101,255,0.16)',
    title: 'Multiple protection tiers',
    body: 'From lightweight symbol stripping to full IL virtualization, name obfuscation, control-flow flattening, and anti-debug. Choose the level that fits your threat model.',
  },
  {
    Icon: ScanIcon,
    color: 'var(--cyan)',
    glow: 'rgba(0,205,208,0.14)',
    title: 'Threat intelligence',
    body: 'Optional VirusTotal integration lets you verify your protected output and observe which techniques get flagged over time — so you can tune for maximum evasion.',
  },
  {
    Icon: CheckIcon,
    color: 'var(--success)',
    glow: 'rgba(31,207,120,0.14)',
    title: 'Compatibility checks',
    body: 'After protection the worker launches your binary in an isolated snapshot environment and reports pass/fail metrics, size delta, and runtime compatibility notes.',
  },
];

const STEPS = [
  {
    n: '1',
    title: 'Upload',
    body: 'Select your .exe or .dll file — up to 100 MB. We auto-detect binary type.',
  },
  {
    n: '2',
    title: 'Configure',
    body: 'Choose a protection tier and enable opt-in techniques for your threat model.',
  },
  {
    n: '3',
    title: 'Download',
    body: 'Your hardened binary is ready in seconds. Single-use link, storage cleaned automatically.',
  },
];

const TIERS = [
  {
    id: 'minimal',
    name: 'Minimal',
    summary: 'Symbol stripping + metadata cleanup. Maximum compatibility baseline.',
    techniques: ['Symbol stripping', 'Metadata cleanup'],
  },
  {
    id: 'basic',
    name: 'Basic',
    summary: 'Core hardening. String encryption, IL virtualization, native AES-GCM packing.',
    techniques: ['String encryption', 'IL virtualization', 'Native AES-GCM packing'],
  },
  {
    id: 'pro',
    name: 'Pro',
    summary: 'Advanced stack. Anti-ILDASM, constant encoding, opaque predicates, IL mutation.',
    techniques: ['Anti-ILDASM', 'Constant encoding', 'Opaque predicates', 'IL mutation'],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    summary: 'Maximum resistance. Name obfuscation, control-flow flattening, anti-debug, anti-tamper.',
    techniques: ['Name obfuscation', 'Control-flow flattening', 'Anti-debug', 'Anti-tamper'],
    featured: true,
  },
];

const TERMINAL_LINES = [
  { type: 'cmd',  text: 'ghostbinary protect --tier enterprise ./app.exe' },
  { type: 'gap' },
  { type: 'ok',   text: 'PE detection       .NET assembly (x64, AnyCPU)' },
  { type: 'ok',   text: 'Name obfuscation   1,847 symbols renamed' },
  { type: 'ok',   text: 'String encryption  312 strings encrypted (AES-128)' },
  { type: 'ok',   text: 'IL virtualization  84 methods virtualized' },
  { type: 'ok',   text: 'Control flow       1,236 blocks flattened' },
  { type: 'ok',   text: 'Anti-debug         RDTSC + TLS callbacks injected' },
  { type: 'ok',   text: 'Anti-tamper        Hash chain sealed' },
  { type: 'gap' },
  { type: 'stat', text: 'Strength score     94/100  (Fortress)' },
  { type: 'stat', text: 'Output size        847 KB  (+105%)' },
  { type: 'gap' },
  { type: 'done', text: 'Protected output ready for download.' },
];

/* ---- Component ---- */

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
    <div style={{ maxWidth: 1000, margin: '0 auto', paddingBottom: '5rem' }}>

      {/* ── Beta banner ── */}
      <div style={{
        marginTop: '1.75rem',
        marginBottom: '3.5rem',
        marginInline: 'auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.75rem',
        padding: '0.55rem 1.1rem',
        width: 'fit-content',
        borderRadius: '9999px',
        background:
          'linear-gradient(var(--bg-elevated), var(--bg-elevated)) padding-box,' +
          'linear-gradient(135deg, rgba(80,144,255,0.45), rgba(146,101,255,0.35)) border-box',
        border: '1px solid transparent',
        fontSize: '0.82rem',
      }}>
        <Badge tone="accent">Public Beta</Badge>
        <span style={{ color: 'var(--text-secondary)' }}>
          All protection tiers are{' '}
          <strong style={{ color: 'var(--text)', fontWeight: 600 }}>free</strong>
          {' '}— no credit card required.
        </span>
      </div>

      {/* ── Hero ── */}
      <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
        <h1 style={{
          fontSize: 'clamp(2.4rem, 6vw, 3.6rem)',
          fontWeight: 800,
          lineHeight: 1.1,
          letterSpacing: '-0.04em',
          margin: '0 0 1.1rem',
          background: 'linear-gradient(135deg, #dce8ff 0%, var(--blue) 48%, var(--purple) 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}>
          Harden your Windows<br />binaries. In seconds.
        </h1>

        <p style={{
          fontSize: 'clamp(1rem, 2.2vw, 1.12rem)',
          color: 'var(--text-secondary)',
          maxWidth: 540,
          margin: '0 auto 2.2rem',
          lineHeight: 1.7,
        }}>
          GhostBinary applies obfuscation, encryption, and anti-analysis techniques to
          your .NET assemblies and native PE files — no setup, no install, no limits during beta.
        </p>

        <div style={{
          display: 'flex',
          gap: '0.75rem',
          justifyContent: 'center',
          flexWrap: 'wrap',
          marginBottom: '1rem',
        }}>
          <Link to="/register" style={{ textDecoration: 'none' }}>
            <Button size="lg" variant="primary">Get started free</Button>
          </Link>
          <Link to="/login" style={{ textDecoration: 'none' }}>
            <Button size="lg" variant="ghost">Sign in</Button>
          </Link>
        </div>

        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
          No setup required · Instant output · Single-download policy
        </p>
      </div>

      {/* ── Stats strip ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: '1px',
        background: 'var(--border)',
        borderRadius: 'var(--r-lg)',
        overflow: 'hidden',
        marginBottom: '3.5rem',
      }}>
        {[
          { value: '4',    label: 'Protection tiers' },
          { value: '20+',  label: 'Obfuscation techniques' },
          { value: '100MB', label: 'Max file size' },
          { value: 'Free', label: 'During public beta' },
        ].map((s) => (
          <div key={s.label} style={{
            background: 'var(--bg-elevated)',
            padding: '1.4rem 1.2rem',
            textAlign: 'center',
          }}>
            <div style={{
              fontSize: 'clamp(1.6rem, 3vw, 2rem)',
              fontWeight: 800,
              letterSpacing: '-0.03em',
              background: 'linear-gradient(135deg, var(--blue), var(--purple))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              lineHeight: 1.1,
              marginBottom: '0.35rem',
            }}>{s.value}</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 500 }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* ── Features ── */}
      <div style={{ marginBottom: '3.5rem' }}>
        <h2 style={{
          textAlign: 'center',
          fontSize: '1.3rem',
          fontWeight: 700,
          letterSpacing: '-0.02em',
          margin: '0 0 1.75rem',
          color: 'var(--text)',
        }}>
          Everything you need to ship hardened binaries
        </h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '0.85rem',
        }}>
          {FEATURES.map((f) => (
            <div key={f.title} style={{
              padding: '1.4rem 1.25rem',
              borderRadius: 'var(--r-lg)',
              background:
                'linear-gradient(var(--bg-elevated), var(--bg-elevated)) padding-box,' +
                'linear-gradient(140deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.04) 45%, rgba(255,255,255,0.09) 100%) border-box',
              border: '1px solid transparent',
              boxShadow: 'var(--shadow-1)',
              transition: 'transform 190ms var(--ease-out), box-shadow 190ms var(--ease-out)',
            }}>
              <div style={{
                width: 40,
                height: 40,
                borderRadius: 'var(--r-md)',
                background: f.glow,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '1rem',
                color: f.color,
              }}>
                <f.Icon />
              </div>
              <div style={{
                fontWeight: 600,
                fontSize: '0.93rem',
                marginBottom: '0.5rem',
                letterSpacing: '-0.01em',
                color: 'var(--text)',
              }}>
                {f.title}
              </div>
              <div style={{
                fontSize: '0.83rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.65,
              }}>
                {f.body}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── How it works ── */}
      <div style={{
        padding: '2rem 2rem',
        borderRadius: 'var(--r-xl)',
        background:
          'linear-gradient(var(--bg-elevated), var(--bg-elevated)) padding-box,' +
          'linear-gradient(140deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.03) 50%, rgba(255,255,255,0.08) 100%) border-box',
        border: '1px solid transparent',
        boxShadow: 'var(--shadow-1)',
        marginBottom: '3.5rem',
      }}>
        <h2 style={{
          textAlign: 'center',
          fontSize: '1.1rem',
          fontWeight: 700,
          letterSpacing: '-0.02em',
          margin: '0 0 2rem',
        }}>
          How it works
        </h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1.5rem',
        }}>
          {STEPS.map((s) => (
            <div key={s.n} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
              <div style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, var(--blue), var(--purple))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: '0.85rem',
                color: '#fff',
                flexShrink: 0,
                boxShadow: '0 4px 14px rgba(80,144,255,0.35)',
              }}>
                {s.n}
              </div>
              <div>
                <div style={{
                  fontWeight: 600,
                  fontSize: '0.93rem',
                  marginBottom: '0.3rem',
                  letterSpacing: '-0.01em',
                }}>
                  {s.title}
                </div>
                <div style={{
                  fontSize: '0.82rem',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.65,
                }}>
                  {s.body}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Terminal showcase ── */}
      <div style={{
        borderRadius: 'var(--r-xl)',
        overflow: 'hidden',
        background:
          'linear-gradient(#020508, #020508) padding-box,' +
          'linear-gradient(135deg, rgba(80,144,255,0.3), rgba(146,101,255,0.22)) border-box',
        border: '1px solid transparent',
        boxShadow: 'var(--shadow-lg), 0 0 60px rgba(80,144,255,0.08)',
        marginBottom: '3.5rem',
      }}>
        {/* Terminal chrome */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.85rem 1.2rem',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(255,255,255,0.025)',
        }}>
          <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f57', display: 'block' }} />
          <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#febc2e', display: 'block' }} />
          <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#28c840', display: 'block' }} />
          <span style={{
            marginLeft: '0.5rem',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.75rem',
            color: 'rgba(255,255,255,0.3)',
          }}>
            ghostbinary — terminal
          </span>
        </div>
        {/* Terminal body */}
        <div style={{
          padding: '1.4rem 1.6rem',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.82rem',
          lineHeight: 1.8,
        }}>
          {TERMINAL_LINES.map((line, i) => {
            if (line.type === 'gap') return <div key={i} style={{ height: '0.5rem' }} />;
            if (line.type === 'cmd') return (
              <div key={i} style={{ color: 'var(--text)' }}>
                <span style={{ color: 'var(--blue)', marginRight: '0.5rem' }}>Ghost@Binary:~$</span>
                {line.text}
                <span style={{
                  display: 'inline-block',
                  width: '0.55em',
                  height: '1em',
                  background: 'var(--blue)',
                  marginLeft: '0.2em',
                  verticalAlign: 'text-bottom',
                  animation: 'gb-blink 1s step-end infinite',
                }} />
              </div>
            );
            if (line.type === 'ok') return (
              <div key={i} style={{ color: 'rgba(255,255,255,0.55)' }}>
                <span style={{ color: 'var(--success)', marginRight: '0.6rem' }}>✓</span>
                {line.text}
              </div>
            );
            if (line.type === 'stat') return (
              <div key={i} style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
                <span style={{ color: 'var(--blue)', marginRight: '0.6rem' }}>›</span>
                {line.text}
              </div>
            );
            if (line.type === 'done') return (
              <div key={i} style={{ color: 'var(--success)', fontWeight: 600 }}>
                {line.text}
              </div>
            );
            return null;
          })}
        </div>
      </div>

      {/* ── Tier cards ── */}
      <div style={{ marginBottom: '3.5rem' }}>
        <h2 style={{
          textAlign: 'center',
          fontSize: '1.1rem',
          fontWeight: 700,
          letterSpacing: '-0.02em',
          margin: '0 0 1.75rem',
        }}>
          Protection tiers — all free during beta
        </h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: '0.8rem',
        }}>
          {TIERS.map((t) => (
            <div key={t.id} style={{
              padding: '1.25rem',
              borderRadius: 'var(--r-lg)',
              background: t.featured
                ? 'linear-gradient(rgba(16,32,68,0.92), rgba(10,22,48,0.96)) padding-box, linear-gradient(135deg, var(--blue), var(--purple)) border-box'
                : 'linear-gradient(var(--bg-elevated), var(--bg-elevated)) padding-box, linear-gradient(140deg, rgba(255,255,255,0.11) 0%, rgba(255,255,255,0.04) 50%, rgba(255,255,255,0.09) 100%) border-box',
              border: '1px solid transparent',
              boxShadow: t.featured
                ? 'var(--shadow-1), 0 10px 40px rgba(80,144,255,0.18)'
                : 'var(--shadow-1)',
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '0.6rem',
              }}>
                <span style={{
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  letterSpacing: '-0.01em',
                }}>
                  {t.name}
                </span>
                <Badge tone={t.featured ? 'accent' : 'success'}>
                  Free
                </Badge>
              </div>
              <p style={{
                fontSize: '0.81rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
                margin: '0 0 0.8rem',
              }}>
                {t.summary}
              </p>
              <ul style={{
                margin: 0,
                padding: 0,
                listStyle: 'none',
                display: 'grid',
                gap: '0.3rem',
              }}>
                {t.techniques.map((tech) => (
                  <li key={tech} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    fontSize: '0.79rem',
                    color: 'var(--text-muted)',
                  }}>
                    <span style={{ color: 'var(--success)', fontSize: '0.75rem' }}>✓</span>
                    {tech}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* ── Bottom CTA ── */}
      <div style={{
        textAlign: 'center',
        padding: '3rem 2rem',
        borderRadius: 'var(--r-xl)',
        background:
          'linear-gradient(var(--bg-elevated), var(--bg-elevated)) padding-box,' +
          'linear-gradient(135deg, rgba(80,144,255,0.4), rgba(146,101,255,0.32)) border-box',
        border: '1px solid transparent',
        boxShadow: 'var(--shadow-lg), 0 0 80px rgba(80,144,255,0.08)',
      }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.28rem 0.75rem',
          borderRadius: 'var(--r-pill)',
          background: 'rgba(80,144,255,0.12)',
          border: '1px solid rgba(80,144,255,0.28)',
          fontSize: '0.72rem',
          fontWeight: 600,
          color: 'var(--blue)',
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          marginBottom: '1.25rem',
        }}>
          ● Live now
        </div>
        <h2 style={{
          fontSize: 'clamp(1.4rem, 3vw, 1.9rem)',
          fontWeight: 800,
          letterSpacing: '-0.03em',
          margin: '0 0 0.7rem',
          lineHeight: 1.2,
        }}>
          Ready to protect your first binary?
        </h2>
        <p style={{
          color: 'var(--text-secondary)',
          fontSize: '0.9rem',
          margin: '0 auto 1.75rem',
          maxWidth: 440,
          lineHeight: 1.65,
        }}>
          Create a free account and harden your first binary in under 60 seconds.
          No credit card, no setup, no limits during beta.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link to="/register" style={{ textDecoration: 'none' }}>
            <Button size="lg" variant="primary">Create free account</Button>
          </Link>
          <a href="/api/v1/docs" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
            <Button size="lg" variant="ghost">API docs</Button>
          </a>
        </div>
      </div>

    </div>
  );
}
