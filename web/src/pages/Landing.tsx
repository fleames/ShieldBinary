import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Badge, Button } from '../design-system';

/* ─── Inline SVG icons ──────────────────────────────────── */

const ShieldCheckIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    <polyline points="9 12 11 14 15 10"/>
  </svg>
);

const LockIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
);

const EyeOffIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
);


const TerminalIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 17 10 11 4 5"/>
    <line x1="12" y1="19" x2="20" y2="19"/>
  </svg>
);

const CpuIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="16" height="16" rx="2"/>
    <rect x="9" y="9" width="6" height="6"/>
    <line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/>
    <line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/>
    <line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/>
    <line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>
  </svg>
);

const GitBranchIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <line x1="6" y1="3" x2="6" y2="15"/>
    <circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><circle cx="6" cy="6" r="3"/>
    <path d="M18 9a9 9 0 0 1-9 9"/>
  </svg>
);

/* ─── Data ─────────────────────────────────────────────── */

const BENEFITS = [
  {
    Icon: LockIcon,
    color: 'var(--blue)',
    glow: 'rgba(80,144,255,0.14)',
    title: 'Stop crackers from removing license checks',
    body: "IL virtualization converts your validation logic into custom bytecode that can't be patched with standard tools like dnSpy, de4dot, or Cheat Engine.",
  },
  {
    Icon: EyeOffIcon,
    color: 'var(--purple)',
    glow: 'rgba(146,101,255,0.14)',
    title: 'Keep your algorithms private',
    body: "Control-flow flattening and name obfuscation make decompiled output unreadable. Competitors can't reverse your business logic or training pipelines.",
  },
  {
    Icon: ShieldCheckIcon,
    color: 'var(--cyan)',
    glow: 'rgba(0,205,208,0.12)',
    title: 'Block tampering and integrity attacks',
    body: 'Anti-tamper chains SHA-256 hashes across your assembly at protection time. Any modification at rest or in memory triggers self-termination.',
  },
  {
    Icon: GitBranchIcon,
    color: '#1fcf78',
    glow: 'rgba(31,207,120,0.12)',
    title: 'Automate protection in your CI/CD pipeline',
    body: 'REST API + GitHub Actions integration means every release build is automatically hardened before it ships. No manual steps, no forgotten runs.',
  },
];

const TECH_DEPTH = [
  {
    label: 'IL Virtualization (.NET)',
    color: 'var(--blue)',
    detail: 'Converts .NET method bodies to a custom bytecode VM. Each method gets a unique opcode table — standard devirtualizers find nothing to latch onto.',
  },
  {
    label: 'Control-Flow Flattening',
    color: 'var(--purple)',
    detail: 'Converts linear blocks into a switch-dispatch state machine. IDA Pro and Binary Ninja produce spaghetti graphs; static analysis yields no useful CFG.',
  },
  {
    label: 'JVM Name Obfuscation',
    color: 'var(--blue)',
    detail: 'Renames every class, remaps all descriptors and type references via ASM ClassRemapper. Decompiled output shows a/A, a/B… with no relationship to original names.',
  },
  {
    label: 'JVM String Encryption',
    color: '#f5a020',
    detail: 'Replaces all string literals with XOR-encrypted constants and injects a synthetic decryptor class. Each string gets an independent key — bulk decryption scripts fail.',
  },
  {
    label: 'Anti-Debug',
    color: 'var(--cyan)',
    detail: 'RDTSC timing checks, hardware breakpoint scanning via debug registers, TLS callbacks, and NtQueryInformationProcess inspection — layered and configurable.',
  },
  {
    label: 'Anti-Tamper',
    color: '#1fcf78',
    detail: 'Seals a cryptographic hash chain across all methods at protection time. Any patch in the file or loaded image triggers immediate process termination.',
  },
  {
    label: 'Native AES-GCM Packing',
    color: '#f5a020',
    detail: 'For Win32/x64 PE binaries: compresses and AES-GCM encrypts all sections. A minimal loader stub decrypts at runtime with a per-binary derived key.',
  },
  {
    label: 'Polymorphic Mode',
    color: 'var(--purple)',
    detail: 'Each build produces structurally different IL transformations from the same source. Hash-based AV signatures never match two consecutive builds.',
  },
];

const STEPS = [
  {
    n: '01',
    title: 'Upload your binary',
    body: 'Drop a .exe, .dll, or .jar — up to 100 MB. We auto-detect .NET, Java/Kotlin, and native PE. No account setup beyond email.',
  },
  {
    n: '02',
    title: 'Choose your protection level',
    body: 'Pick a tier from Minimal to Enterprise. Enable opt-in techniques for your specific threat model.',
  },
  {
    n: '03',
    title: 'Download the hardened output',
    body: 'Protected binary is ready in seconds. Compatibility check runs automatically in an isolated VM snapshot.',
  },
];

const TIERS = [
  {
    id: 'minimal',
    name: 'Minimal',
    badge: null,
    summary: 'Maximum compatibility baseline. Strips symbols and cleans metadata — safe for all deployment targets.',
    techniques: ['Symbol stripping', 'Metadata cleanup'],
    featured: false,
  },
  {
    id: 'basic',
    name: 'Basic',
    badge: null,
    summary: 'Core hardening layer. String encryption, IL virtualization for critical methods, native AES-GCM packing.',
    techniques: ['String encryption', 'IL virtualization', 'Native AES-GCM'],
    featured: false,
  },
  {
    id: 'pro',
    name: 'Pro',
    badge: null,
    summary: 'Advanced obfuscation stack. Anti-ILDASM, constant encoding, opaque predicates, and IL mutation.',
    techniques: ['Anti-ILDASM', 'Constant encoding', 'Opaque predicates', 'IL mutation'],
    featured: false,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    badge: 'Recommended',
    summary: 'Maximum resistance. Full name obfuscation, control-flow flattening, anti-debug, and anti-tamper.',
    techniques: ['Name obfuscation', 'Control-flow flattening', 'Anti-debug', 'Anti-tamper', 'Polymorphic mode'],
    featured: true,
  },
];

const TERMINAL_LINES_JAR = [
  { type: 'prompt', text: 'ghostbinary protect --tier enterprise ./Payments.jar' },
  { type: 'gap' },
  { type: 'info',   label: 'Detected', text: 'Java/Kotlin JAR · 52 classes · JVM 17' },
  { type: 'gap' },
  { type: 'ok',     label: 'Debug strip',     text: 'LineNumberTable · LocalVariable removed (52 classes)' },
  { type: 'ok',     label: 'String encrypt',  text: '287 literals → XOR-encrypted, per-string keys' },
  { type: 'ok',     label: 'Name obfuscation',text: '52 classes → a/A … a/z, a/AA … (ClassRemapper)' },
  { type: 'ok',     label: 'Control flow',    text: '87 methods → opaque predicate injection' },
  { type: 'ok',     label: 'Anti-decompiler', text: 'ACC_SYNTHETIC on 312 methods' },
  { type: 'gap' },
  { type: 'metric', label: 'Score', text: '88 / 100  · Hardened' },
  { type: 'metric', label: 'Size',  text: '241 KB  (+48%)' },
  { type: 'gap' },
  { type: 'done',   text: 'Protected output ready for download.' },
];

const TERMINAL_LINES = [
  { type: 'prompt', text: 'ghostbinary protect --tier enterprise ./app.exe' },
  { type: 'gap' },
  { type: 'info',   label: 'Detected', text: '.NET assembly x64 (CLR 4.0.30319, AnyCPU)' },
  { type: 'gap' },
  { type: 'ok',     label: 'Symbol rename', text: '1,847 identifiers → a(), b(), İıı…' },
  { type: 'ok',     label: 'String encrypt', text: '312 strings encrypted (AES-128, per-string key)' },
  { type: 'ok',     label: 'IL virtualize', text: '84 methods → custom VM bytecode' },
  { type: 'ok',     label: 'Control flow', text: '1,236 blocks flattened to dispatch table' },
  { type: 'ok',     label: 'Anti-debug', text: 'RDTSC + DR register scan + TLS callback injected' },
  { type: 'ok',     label: 'Anti-tamper', text: 'Hash chain sealed across 1,847 methods' },
  { type: 'ok',     label: 'Compatibility', text: 'VM snapshot: exit 0 · pass' },
  { type: 'gap' },
  { type: 'metric', label: 'Score', text: '94 / 100  · Fortress' },
  { type: 'metric', label: 'Size', text: '847 KB  (+105%)' },
  { type: 'metric', label: 'VT scan', text: '0 / 68 detections' },
  { type: 'gap' },
  { type: 'done',   text: 'Protected output ready for download.' },
];

/* ─── Hero shield SVG ───────────────────────────────────── */

function HeroShield() {
  return (
    <div style={{ position: 'relative', width: 320, height: 320, flexShrink: 0 }}>
      {/* Outer glow */}
      <div style={{
        position: 'absolute',
        inset: -40,
        background: 'radial-gradient(ellipse 60% 60% at 50% 50%, rgba(80,144,255,0.14), transparent 70%)',
        pointerEvents: 'none',
      }} />
      <svg viewBox="0 0 320 320" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
        <defs>
          <linearGradient id="sh-fill" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(80,144,255,0.18)"/>
            <stop offset="100%" stopColor="rgba(146,101,255,0.10)"/>
          </linearGradient>
          <linearGradient id="sh-stroke" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#5090ff" stopOpacity="0.75"/>
            <stop offset="100%" stopColor="#9265ff" stopOpacity="0.55"/>
          </linearGradient>
          <linearGradient id="sh-check" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#5090ff"/>
            <stop offset="100%" stopColor="#9265ff"/>
          </linearGradient>
          <filter id="sh-glow">
            <feGaussianBlur stdDeviation="6" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>

        {/* Orbiting dashed rings */}
        <circle cx="160" cy="160" r="130" fill="none" stroke="rgba(80,144,255,0.1)" strokeWidth="1" strokeDasharray="5 4"/>
        <circle cx="160" cy="160" r="148" fill="none" stroke="rgba(146,101,255,0.07)" strokeWidth="1" strokeDasharray="3 5"/>

        {/* Shield body */}
        <path
          d="M160 52 L230 82 L230 154 C230 198 198 228 160 246 C122 228 90 198 90 154 L90 82 Z"
          fill="url(#sh-fill)"
          stroke="url(#sh-stroke)"
          strokeWidth="1.8"
          strokeLinejoin="round"
          filter="url(#sh-glow)"
        />

        {/* Inner shield detail line */}
        <path
          d="M160 72 L218 98 L218 154 C218 190 190 215 160 230"
          fill="none"
          stroke="rgba(80,144,255,0.2)"
          strokeWidth="1"
        />

        {/* Check mark */}
        <path
          d="M140 152 L155 168 L182 136"
          fill="none"
          stroke="url(#sh-check)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#sh-glow)"
        />

        {/* Floating technique badges — orbiting */}
        {/* Top */}
        <g>
          <rect x="100" y="20" width="120" height="22" rx="11" fill="rgba(80,144,255,0.1)" stroke="rgba(80,144,255,0.28)" strokeWidth="1"/>
          <text x="160" y="34.5" textAnchor="middle" fill="rgba(166,200,255,0.8)" fontSize="9.5" fontWeight="700" fontFamily="Inter,system-ui,sans-serif" letterSpacing="0.07em">IL VIRTUALIZATION</text>
        </g>
        {/* Right */}
        <g>
          <rect x="236" y="130" width="78" height="22" rx="11" fill="rgba(146,101,255,0.1)" stroke="rgba(146,101,255,0.28)" strokeWidth="1"/>
          <text x="275" y="144.5" textAnchor="middle" fill="rgba(200,175,255,0.8)" fontSize="9.5" fontWeight="700" fontFamily="Inter,system-ui,sans-serif" letterSpacing="0.07em">ANTI-DEBUG</text>
        </g>
        {/* Bottom right */}
        <g>
          <rect x="220" y="228" width="90" height="22" rx="11" fill="rgba(0,205,208,0.08)" stroke="rgba(0,205,208,0.26)" strokeWidth="1"/>
          <text x="265" y="242.5" textAnchor="middle" fill="rgba(140,230,232,0.8)" fontSize="9.5" fontWeight="700" fontFamily="Inter,system-ui,sans-serif" letterSpacing="0.07em">ANTI-TAMPER</text>
        </g>
        {/* Left */}
        <g>
          <rect x="6" y="130" width="72" height="22" rx="11" fill="rgba(31,207,120,0.08)" stroke="rgba(31,207,120,0.25)" strokeWidth="1"/>
          <text x="42" y="144.5" textAnchor="middle" fill="rgba(140,230,190,0.8)" fontSize="9.5" fontWeight="700" fontFamily="Inter,system-ui,sans-serif" letterSpacing="0.07em">AES-GCM</text>
        </g>
      </svg>
    </div>
  );
}

/* ─── Main component ───────────────────────────────────── */

export default function Landing() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) navigate('/dashboard', { replace: true });
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
        animation: 'gb-fade-up 0.5s var(--ease-out) both',
      }}>
        <Badge tone="accent">Public Beta</Badge>
        <span style={{ color: 'var(--text-secondary)' }}>
          All protection tiers are{' '}
          <strong style={{ color: 'var(--text)', fontWeight: 600 }}>free</strong>
          {' '}— no credit card required.
        </span>
      </div>

      {/* ── Hero ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '3rem',
        marginBottom: '4.5rem',
        flexWrap: 'wrap',
        animation: 'gb-fade-up 0.6s 0.05s var(--ease-out) both',
      }}>
        {/* Left: copy */}
        <div style={{ flex: '1 1 420px', minWidth: 0 }}>
          {/* Above-the-fold benefit statement */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.45rem',
            padding: '0.28rem 0.72rem',
            borderRadius: 'var(--r-pill)',
            background: 'rgba(80,144,255,0.1)',
            border: '1px solid rgba(80,144,255,0.24)',
            fontSize: '0.73rem',
            fontWeight: 700,
            color: 'var(--blue)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            marginBottom: '1.2rem',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--blue)', display: 'inline-block', boxShadow: '0 0 8px var(--blue)' }} />
            Binary Protection Platform
          </div>

          <h1 style={{
            fontSize: 'clamp(2.5rem, 5.5vw, 3.8rem)',
            fontWeight: 800,
            lineHeight: 1.08,
            letterSpacing: '-0.04em',
            margin: '0 0 1.1rem',
            background: 'linear-gradient(140deg, #dce8ff 0%, var(--blue) 40%, var(--purple) 90%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}>
            Stop Reverse<br />Engineers Cold.
          </h1>

          {/* Benefit bullets — 5-second comprehension */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.45rem',
            marginBottom: '1.75rem',
          }}>
            {[
              'Prevent cracking and license bypass',
              'Keep algorithms private from competitors',
              'Harden commercial software against malware analysis',
              'One-click CI/CD protection pipeline via REST API',
            ].map((b) => (
              <div key={b} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.91rem', color: 'var(--text-secondary)' }}>
                <span style={{ color: 'var(--success)', flexShrink: 0, fontSize: '0.8rem' }}>✓</span>
                {b}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.1rem' }}>
            <Link to="/register" style={{ textDecoration: 'none' }}>
              <Button size="lg" variant="primary">Get started free →</Button>
            </Link>
            <Link to="/login" style={{ textDecoration: 'none' }}>
              <Button size="lg" variant="ghost">Sign in</Button>
            </Link>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            fontSize: '0.77rem',
            color: 'var(--text-muted)',
            flexWrap: 'wrap',
          }}>
            {['.NET assemblies', 'Java / Kotlin (.jar)', 'Native Win32/x64 PE', 'API-first'].map((t, i) => (
              <span key={t} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {i > 0 && <span style={{ opacity: 0.3 }}>·</span>}
                {t}
              </span>
            ))}
          </div>
        </div>

        {/* Right: hero shield visual */}
        <div style={{ flex: '0 0 auto', display: 'flex', justifyContent: 'center' }}>
          <HeroShield />
        </div>
      </div>

      {/* ── Stats strip ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: '1px',
        background: 'var(--border)',
        borderRadius: 'var(--r-lg)',
        overflow: 'hidden',
        marginBottom: '4rem',
        animation: 'gb-fade-up 0.6s 0.1s var(--ease-out) both',
      }}>
        {[
          { value: '4',     label: 'Protection tiers'     },
          { value: '20+',   label: 'Obfuscation passes'   },
          { value: '0/68',  label: 'VT detections (avg)'  },
          { value: 'Free',  label: 'During public beta'   },
        ].map((s) => (
          <div key={s.label} style={{
            background: 'var(--bg-elevated)',
            padding: '1.35rem 1.1rem',
            textAlign: 'center',
          }}>
            <div style={{
              fontSize: 'clamp(1.5rem, 3vw, 2rem)',
              fontWeight: 800,
              letterSpacing: '-0.03em',
              background: 'linear-gradient(135deg, var(--blue), var(--purple))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              lineHeight: 1.1,
              marginBottom: '0.3rem',
            }}>{s.value}</div>
            <div style={{ fontSize: '0.77rem', color: 'var(--text-muted)', fontWeight: 500 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Supported runtimes ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '0.75rem',
        marginBottom: '4rem',
        animation: 'gb-fade-up 0.6s 0.12s var(--ease-out) both',
      }}>
        {[
          {
            lang: '.NET / C#',
            ext: '.exe · .dll',
            color: 'var(--purple)',
            glow: 'rgba(146,101,255,0.13)',
            border: 'rgba(146,101,255,0.28)',
            techniques: ['IL virtualization', 'Control-flow flattening', 'Anti-debug / Anti-tamper', 'Name obfuscation'],
          },
          {
            lang: 'Java / Kotlin',
            ext: '.jar',
            color: '#f5a020',
            glow: 'rgba(245,160,32,0.11)',
            border: 'rgba(245,160,32,0.28)',
            techniques: ['Debug info strip', 'String XOR encryption', 'Class name obfuscation', 'Opaque predicate CFG'],
            badge: 'New',
          },
          {
            lang: 'Native PE',
            ext: '.exe · .dll (Win32/x64)',
            color: '#1fcf78',
            glow: 'rgba(31,207,120,0.11)',
            border: 'rgba(31,207,120,0.25)',
            techniques: ['AES-GCM section encryption', 'Compression + padding', 'Per-binary derived key', 'Minimal loader stub'],
          },
        ].map((r) => (
          <div key={r.lang} style={{
            padding: '1.25rem 1.3rem',
            borderRadius: 'var(--r-lg)',
            background:
              'linear-gradient(var(--bg-elevated), var(--bg-elevated)) padding-box,' +
              `linear-gradient(140deg, ${r.border} 0%, rgba(255,255,255,0.04) 100%) border-box`,
            border: '1px solid transparent',
            boxShadow: 'var(--shadow-1)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
              <span style={{ fontWeight: 700, fontSize: '0.95rem', letterSpacing: '-0.01em' }}>{r.lang}</span>
              {r.badge && (
                <span style={{
                  fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                  padding: '0.15rem 0.48rem', borderRadius: 'var(--r-pill)',
                  background: 'rgba(245,160,32,0.14)', border: '1px solid rgba(245,160,32,0.35)',
                  color: '#f5a020',
                }}>{r.badge}</span>
              )}
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginBottom: '0.85rem', fontFamily: 'var(--font-mono)' }}>
              {r.ext}
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.22rem' }}>
              {r.techniques.map((t) => (
                <li key={t} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  <span style={{ color: r.color, fontSize: '0.7rem' }}>✓</span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* ── "What it does for you" benefit grid ── */}
      <div style={{ marginBottom: '4rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h2 style={{
            fontSize: '1.35rem',
            fontWeight: 700,
            letterSpacing: '-0.025em',
            margin: '0 0 0.55rem',
          }}>
            Everything developers need to ship hardened software
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: 0, maxWidth: '55ch', marginInline: 'auto', lineHeight: 1.6 }}>
            Not just obfuscation — a complete protection pipeline with verification, threat intel, and CI integration.
          </p>
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '0.85rem',
        }}>
          {BENEFITS.map((f) => (
            <div key={f.title} style={{
              padding: '1.4rem 1.25rem',
              borderRadius: 'var(--r-lg)',
              background:
                'linear-gradient(var(--bg-elevated), var(--bg-elevated)) padding-box,' +
                'linear-gradient(140deg, rgba(255,255,255,0.11) 0%, rgba(255,255,255,0.04) 50%, rgba(255,255,255,0.09) 100%) border-box',
              border: '1px solid transparent',
              boxShadow: 'var(--shadow-1)',
              transition: 'transform 190ms var(--ease-out), box-shadow 190ms var(--ease-out)',
            }}>
              <div style={{
                width: 42, height: 42,
                borderRadius: 'var(--r-md)',
                background: f.glow,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: '1rem',
                color: f.color,
              }}>
                <f.Icon />
              </div>
              <div style={{
                fontWeight: 600,
                fontSize: '0.92rem',
                marginBottom: '0.48rem',
                letterSpacing: '-0.01em',
                color: 'var(--text)',
              }}>
                {f.title}
              </div>
              <div style={{
                fontSize: '0.82rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.65,
              }}>
                {f.body}
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
          'linear-gradient(#020407, #020407) padding-box,' +
          'linear-gradient(135deg, rgba(80,144,255,0.32), rgba(146,101,255,0.22)) border-box',
        border: '1px solid transparent',
        boxShadow: 'var(--shadow-lg), 0 0 80px rgba(80,144,255,0.07)',
        marginBottom: '4rem',
      }}>
        {/* Window chrome */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.48rem',
          padding: '0.82rem 1.2rem',
          borderBottom: '1px solid rgba(255,255,255,0.055)',
          background: 'rgba(255,255,255,0.022)',
        }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57', display: 'block' }}/>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#febc2e', display: 'block' }}/>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c840', display: 'block' }}/>
          <span style={{
            marginLeft: '0.55rem',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.72rem',
            color: 'rgba(255,255,255,0.25)',
          }}>
            ghostbinary — enterprise protection
          </span>
        </div>
        {/* Body */}
        <div style={{
          padding: '1.4rem 1.65rem',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.81rem',
          lineHeight: 1.85,
        }}>
          {TERMINAL_LINES.map((line, i) => {
            if (line.type === 'gap') return <div key={i} style={{ height: '0.4rem' }} />;
            if (line.type === 'prompt') return (
              <div key={i} style={{ color: 'var(--text)' }}>
                <span style={{ color: 'var(--blue)', marginRight: '0.5rem', userSelect: 'none' }}>Ghost@Binary:~$</span>
                {line.text}
                <span style={{
                  display: 'inline-block',
                  width: '0.5em',
                  height: '1.1em',
                  background: 'var(--blue)',
                  marginLeft: '0.2em',
                  verticalAlign: 'text-bottom',
                  animation: 'gb-blink 1s step-end infinite',
                }} />
              </div>
            );
            if (line.type === 'info') return (
              <div key={i} style={{ color: 'var(--text-muted)' }}>
                <span style={{ color: 'rgba(255,255,255,0.3)', marginRight: '0.5rem' }}>›</span>
                <span style={{ color: 'var(--text-muted)', marginRight: '0.4rem' }}>{line.label}</span>
                <span style={{ color: 'var(--text-secondary)' }}>{line.text}</span>
              </div>
            );
            if (line.type === 'ok') return (
              <div key={i} style={{ display: 'flex', gap: '0.5rem', color: 'rgba(255,255,255,0.5)' }}>
                <span style={{ color: 'var(--success)', userSelect: 'none' }}>✓</span>
                <span style={{ color: 'rgba(134,150,186,0.7)', minWidth: '120px', flexShrink: 0 }}>{line.label}</span>
                <span>{line.text}</span>
              </div>
            );
            if (line.type === 'metric') return (
              <div key={i} style={{ display: 'flex', gap: '0.5rem' }}>
                <span style={{ color: 'var(--blue)', userSelect: 'none' }}>›</span>
                <span style={{ color: 'var(--text-muted)', minWidth: '120px', flexShrink: 0 }}>{line.label}</span>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{line.text}</span>
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

      {/* ── Java/Kotlin terminal showcase ── */}
      <div style={{
        borderRadius: 'var(--r-xl)',
        overflow: 'hidden',
        background:
          'linear-gradient(#020407, #020407) padding-box,' +
          'linear-gradient(135deg, rgba(245,160,32,0.3), rgba(80,144,255,0.18)) border-box',
        border: '1px solid transparent',
        boxShadow: 'var(--shadow-lg), 0 0 80px rgba(245,160,32,0.05)',
        marginBottom: '4rem',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.48rem',
          padding: '0.82rem 1.2rem',
          borderBottom: '1px solid rgba(255,255,255,0.055)',
          background: 'rgba(255,255,255,0.022)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.48rem' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57', display: 'block' }}/>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#febc2e', display: 'block' }}/>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c840', display: 'block' }}/>
            <span style={{
              marginLeft: '0.55rem',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.72rem',
              color: 'rgba(255,255,255,0.25)',
            }}>
              ghostbinary — java/kotlin enterprise protection
            </span>
          </div>
          <span style={{
            fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
            padding: '0.15rem 0.48rem', borderRadius: 'var(--r-pill)',
            background: 'rgba(245,160,32,0.14)', border: '1px solid rgba(245,160,32,0.35)',
            color: '#f5a020',
          }}>New</span>
        </div>
        <div style={{
          padding: '1.4rem 1.65rem',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.81rem',
          lineHeight: 1.85,
        }}>
          {TERMINAL_LINES_JAR.map((line, i) => {
            if (line.type === 'gap') return <div key={i} style={{ height: '0.4rem' }} />;
            if (line.type === 'prompt') return (
              <div key={i} style={{ color: 'var(--text)' }}>
                <span style={{ color: '#f5a020', marginRight: '0.5rem', userSelect: 'none' }}>Ghost@Binary:~$</span>
                {line.text}
                <span style={{
                  display: 'inline-block', width: '0.5em', height: '1.1em',
                  background: '#f5a020', marginLeft: '0.2em', verticalAlign: 'text-bottom',
                  animation: 'gb-blink 1s step-end infinite',
                }} />
              </div>
            );
            if (line.type === 'info') return (
              <div key={i} style={{ color: 'var(--text-muted)' }}>
                <span style={{ color: 'rgba(255,255,255,0.3)', marginRight: '0.5rem' }}>›</span>
                <span style={{ color: 'var(--text-muted)', marginRight: '0.4rem' }}>{line.label}</span>
                <span style={{ color: 'var(--text-secondary)' }}>{line.text}</span>
              </div>
            );
            if (line.type === 'ok') return (
              <div key={i} style={{ display: 'flex', gap: '0.5rem', color: 'rgba(255,255,255,0.5)' }}>
                <span style={{ color: 'var(--success)', userSelect: 'none' }}>✓</span>
                <span style={{ color: 'rgba(134,150,186,0.7)', minWidth: '148px', flexShrink: 0 }}>{line.label}</span>
                <span>{line.text}</span>
              </div>
            );
            if (line.type === 'metric') return (
              <div key={i} style={{ display: 'flex', gap: '0.5rem' }}>
                <span style={{ color: '#f5a020', userSelect: 'none' }}>›</span>
                <span style={{ color: 'var(--text-muted)', minWidth: '148px', flexShrink: 0 }}>{line.label}</span>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{line.text}</span>
              </div>
            );
            if (line.type === 'done') return (
              <div key={i} style={{ color: 'var(--success)', fontWeight: 600 }}>{line.text}</div>
            );
            return null;
          })}
        </div>
      </div>

      {/* ── How it works ── */}
      <div style={{
        padding: '2.25rem 2.25rem',
        borderRadius: 'var(--r-xl)',
        background:
          'linear-gradient(var(--bg-elevated), var(--bg-elevated)) padding-box,' +
          'linear-gradient(140deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.03) 50%, rgba(255,255,255,0.08) 100%) border-box',
        border: '1px solid transparent',
        boxShadow: 'var(--shadow-1)',
        marginBottom: '4rem',
      }}>
        <h2 style={{ textAlign: 'center', fontSize: '1.1rem', fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 2rem' }}>
          From upload to hardened binary in 60 seconds
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem' }}>
          {STEPS.map((s) => (
            <div key={s.n} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
              <div style={{
                width: 38, height: 38,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, var(--blue), var(--purple))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 800, fontSize: '0.78rem', color: '#fff',
                flexShrink: 0,
                boxShadow: '0 4px 18px rgba(80,144,255,0.38)',
                fontFamily: 'var(--font-mono)',
              }}>
                {s.n}
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.92rem', marginBottom: '0.3rem', letterSpacing: '-0.01em' }}>
                  {s.title}
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.65 }}>
                  {s.body}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Technical depth (for security nerds) ── */}
      <div style={{ marginBottom: '4rem' }}>
        {/* Section header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.75rem' }}>
          <div style={{
            width: 36, height: 36,
            borderRadius: 'var(--r-sm)',
            background: 'rgba(146,101,255,0.12)',
            border: '1px solid rgba(146,101,255,0.28)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--purple)',
          }}>
            <CpuIcon />
          </div>
          <div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.2 }}>
              For security engineers
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: 0 }}>
              The actual techniques under the hood — not marketing copy.
            </p>
          </div>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '0.7rem',
        }}>
          {TECH_DEPTH.map((t) => (
            <div key={t.label} style={{
              padding: '1.1rem 1.2rem',
              borderRadius: 'var(--r-md)',
              background: 'rgba(255,255,255,0.025)',
              border: '1px solid var(--border)',
              transition: 'border-color 190ms var(--ease-out), background 190ms var(--ease-out)',
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                marginBottom: '0.45rem',
              }}>
                <span style={{
                  width: 6, height: 6,
                  borderRadius: '50%',
                  background: t.color,
                  boxShadow: `0 0 8px ${t.color}88`,
                  flexShrink: 0,
                }} />
                <span style={{ fontWeight: 700, fontSize: '0.84rem', fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                  {t.label}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.65 }}>
                {t.detail}
              </p>
            </div>
          ))}
        </div>

        <p style={{ textAlign: 'center', marginTop: '1.1rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          + 14 more optional .NET techniques including resource encryption, reference proxying, dynamic method generation, and runtime RASP. Java/Kotlin support is in active development.
        </p>
      </div>

      {/* ── CI/CD highlight ── */}
      <div style={{
        padding: '1.75rem 2rem',
        borderRadius: 'var(--r-xl)',
        background:
          'linear-gradient(rgba(12,24,48,0.9), rgba(8,16,36,0.95)) padding-box,' +
          'linear-gradient(135deg, rgba(80,144,255,0.35), rgba(146,101,255,0.22)) border-box',
        border: '1px solid transparent',
        boxShadow: 'var(--shadow-1)',
        marginBottom: '4rem',
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: '2rem',
        alignItems: 'center',
        flexWrap: 'wrap',
      }}>
        <div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            marginBottom: '0.6rem', color: 'var(--blue)',
          }}>
            <TerminalIcon />
            <span style={{ fontWeight: 700, fontSize: '0.88rem', letterSpacing: '-0.01em' }}>
              API-first. CI/CD ready.
            </span>
          </div>
          <p style={{ margin: '0 0 0.9rem', color: 'var(--text-secondary)', fontSize: '0.86rem', lineHeight: 1.6 }}>
            Protect every release automatically. REST API, GitHub Actions integration, and JSON output mode.
            Your pipeline runs ghostbinary; your users get a hardened binary on every merge.
          </p>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'rgba(255,255,255,0.35)', background: 'rgba(0,0,0,0.3)', padding: '0.6rem 0.9rem', borderRadius: 'var(--r-sm)', display: 'inline-block' }}>
            <span style={{ color: 'var(--blue)' }}>uses:</span> ghostbinary/protect-action@v2
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flexShrink: 0 }}>
          <a href="/api/v1/docs" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
            <Button variant="ghost" size="sm">API docs →</Button>
          </a>
        </div>
      </div>

      {/* ── Tier cards ── */}
      <div style={{ marginBottom: '4rem' }}>
        <h2 style={{ textAlign: 'center', fontSize: '1.15rem', fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 0.5rem' }}>
          Protection tiers
        </h2>
        <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0 0 1.75rem' }}>
          All tiers are free during public beta.
        </p>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: '0.8rem',
        }}>
          {TIERS.map((t) => (
            <div key={t.id} style={{
              padding: '1.3rem',
              borderRadius: 'var(--r-lg)',
              background: t.featured
                ? 'linear-gradient(rgba(16,32,68,0.94), rgba(10,22,48,0.98)) padding-box, linear-gradient(135deg, var(--blue), var(--purple)) border-box'
                : 'linear-gradient(var(--bg-elevated), var(--bg-elevated)) padding-box, linear-gradient(140deg, rgba(255,255,255,0.11) 0%, rgba(255,255,255,0.04) 50%, rgba(255,255,255,0.09) 100%) border-box',
              border: '1px solid transparent',
              boxShadow: t.featured ? 'var(--shadow-1), 0 12px 48px rgba(80,144,255,0.18)' : 'var(--shadow-1)',
              display: 'flex',
              flexDirection: 'column',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.55rem' }}>
                <span style={{ fontWeight: 700, fontSize: '0.95rem', letterSpacing: '-0.01em' }}>{t.name}</span>
                <div style={{ display: 'flex', gap: '0.35rem' }}>
                  {t.badge && (
                    <span style={{
                      fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                      padding: '0.18rem 0.5rem', borderRadius: 'var(--r-pill)',
                      background: 'rgba(80,144,255,0.14)', border: '1px solid rgba(80,144,255,0.35)',
                      color: '#a6c8ff',
                    }}>{t.badge}</span>
                  )}
                  <Badge tone="success">Free</Badge>
                </div>
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 0.85rem', flex: 1 }}>
                {t.summary}
              </p>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.28rem' }}>
                {t.techniques.map((tech) => (
                  <li key={tech} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    <span style={{ color: t.featured ? 'var(--blue)' : 'var(--success)', fontSize: '0.72rem' }}>✓</span>
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
        padding: '3.25rem 2rem',
        borderRadius: 'var(--r-xl)',
        background:
          'linear-gradient(var(--bg-elevated), var(--bg-elevated)) padding-box,' +
          'linear-gradient(135deg, rgba(80,144,255,0.42), rgba(146,101,255,0.32)) border-box',
        border: '1px solid transparent',
        boxShadow: 'var(--shadow-lg), 0 0 80px rgba(80,144,255,0.07)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Background glow orb */}
        <div style={{
          position: 'absolute',
          top: '-60px', left: '50%', transform: 'translateX(-50%)',
          width: 400, height: 400,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(80,144,255,0.08), transparent 70%)',
          pointerEvents: 'none',
        }} />

        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.45rem',
          padding: '0.28rem 0.75rem', borderRadius: 'var(--r-pill)',
          background: 'rgba(80,144,255,0.12)', border: '1px solid rgba(80,144,255,0.28)',
          fontSize: '0.72rem', fontWeight: 700, color: 'var(--blue)',
          letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '1.25rem',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', display: 'inline-block', boxShadow: '0 0 8px var(--success)' }} />
          Live now
        </div>

        <h2 style={{
          fontSize: 'clamp(1.5rem, 3.2vw, 2rem)',
          fontWeight: 800,
          letterSpacing: '-0.035em',
          margin: '0 0 0.7rem',
          lineHeight: 1.2,
        }}>
          Ready to protect your first binary?
        </h2>
        <p style={{
          color: 'var(--text-secondary)',
          fontSize: '0.9rem',
          margin: '0 auto 1.9rem',
          maxWidth: '42ch',
          lineHeight: 1.65,
        }}>
          Free account. No credit card. Hardened output in under 60 seconds.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link to="/register" style={{ textDecoration: 'none' }}>
            <Button size="lg" variant="primary">Create free account →</Button>
          </Link>
          <a href="/api/v1/docs" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
            <Button size="lg" variant="ghost">API reference</Button>
          </a>
        </div>
      </div>

    </div>
  );
}
