import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Badge, Button } from '../design-system';

/* ─── Icons ──────────────────────────────────────────────── */

const ShieldCheckIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    <polyline points="9 12 11 14 15 10"/>
  </svg>
);
const LockIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
);
const EyeOffIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
);
const TerminalIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 17 10 11 4 5"/>
    <line x1="12" y1="19" x2="20" y2="19"/>
  </svg>
);
const CpuIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="16" height="16" rx="2"/>
    <rect x="9" y="9" width="6" height="6"/>
    <line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/>
    <line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/>
    <line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/>
    <line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>
  </svg>
);
const GitBranchIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <line x1="6" y1="3" x2="6" y2="15"/>
    <circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><circle cx="6" cy="6" r="3"/>
    <path d="M18 9a9 9 0 0 1-9 9"/>
  </svg>
);

/* ─── Data ─────────────────────────────────────────────────── */

const RUNTIMES = [
  {
    lang: '.NET / C#',
    ext: '.exe · .dll',
    accent: 'var(--purple)',
    glow: 'rgba(146,101,255,0.15)',
    borderColor: 'rgba(146,101,255,0.35)',
    techniques: ['IL virtualization (VM bytecode)', 'Control-flow flattening', 'Name obfuscation', 'Anti-debug + Anti-tamper'],
  },
  {
    lang: 'Java / Kotlin',
    ext: '.jar',
    accent: '#f5a020',
    glow: 'rgba(245,160,32,0.13)',
    borderColor: 'rgba(245,160,32,0.35)',
    badge: 'New',
    techniques: ['Debug info strip', 'String XOR encryption', 'Class name obfuscation', 'Opaque predicate injection'],
  },
  {
    lang: 'Native PE',
    ext: '.exe · .dll (Win32 / x64)',
    accent: '#1fcf78',
    glow: 'rgba(31,207,120,0.12)',
    borderColor: 'rgba(31,207,120,0.28)',
    techniques: ['AES-GCM section encryption', 'Compression + XOR layer', 'Per-binary derived key', 'Minimal self-extracting stub'],
  },
];

const BENEFITS = [
  {
    Icon: LockIcon,
    color: 'var(--blue)',
    glow: 'rgba(80,144,255,0.16)',
    title: 'Stop crackers removing license checks',
    body: "IL virtualization converts your validation logic into custom bytecode that can't be patched with standard tools like dnSpy, de4dot, or Cheat Engine.",
  },
  {
    Icon: EyeOffIcon,
    color: 'var(--purple)',
    glow: 'rgba(146,101,255,0.15)',
    title: 'Keep algorithms private',
    body: "Control-flow flattening and name obfuscation make decompiled output unreadable. Competitors can't reverse your business logic or ML pipelines.",
  },
  {
    Icon: ShieldCheckIcon,
    color: 'var(--cyan)',
    glow: 'rgba(0,205,208,0.13)',
    title: 'Block tampering and integrity attacks',
    body: 'Anti-tamper chains SHA-256 hashes across your assembly at protection time. Any modification at rest or in memory triggers self-termination.',
  },
  {
    Icon: GitBranchIcon,
    color: '#1fcf78',
    glow: 'rgba(31,207,120,0.13)',
    title: 'Automate in your CI/CD pipeline',
    body: 'REST API and GitHub Actions integration means every release build is hardened before it ships. No manual steps, no forgotten runs.',
  },
];

const TECH_DEPTH = [
  { label: 'IL Virtualization', color: 'var(--blue)',   detail: 'Converts .NET method bodies to a custom bytecode VM. Each method gets a unique opcode table — standard devirtualizers find nothing to latch onto.' },
  { label: 'Control-Flow Flatten', color: 'var(--purple)', detail: 'Converts linear blocks into a switch-dispatch state machine. IDA Pro and Binary Ninja produce spaghetti graphs; static analysis yields no useful CFG.' },
  { label: 'JVM Name Obfuscation', color: '#f5a020',    detail: 'Renames every class and remaps all descriptors via ASM ClassRemapper. Decompiled output shows a/A, a/B… — no relationship to original names.' },
  { label: 'JVM String Encryption', color: '#f5a020',   detail: 'Replaces all string literals with XOR-encrypted constants, injects a synthetic decryptor class. Each string gets an independent key.' },
  { label: 'Anti-Debug',           color: 'var(--cyan)', detail: 'RDTSC timing checks, hardware breakpoint scanning via debug registers, TLS callbacks, and NtQueryInformationProcess — layered and configurable.' },
  { label: 'Anti-Tamper',          color: '#1fcf78',    detail: 'Seals a cryptographic hash chain across all methods at protection time. Any patch in file or loaded image triggers immediate termination.' },
  { label: 'Native AES-GCM Pack',  color: '#f5a020',    detail: 'For Win32/x64 PE binaries: compresses and AES-GCM encrypts all sections. A minimal loader stub decrypts at runtime with a per-binary derived key.' },
  { label: 'Polymorphic Mode',      color: 'var(--purple)', detail: 'Each build produces structurally different transformations from the same source. Hash-based AV signatures never match two consecutive builds.' },
];

const STEPS = [
  { n: '01', title: 'Upload your binary',       body: 'Drop a .exe, .dll, or .jar — up to 100 MB. We auto-detect .NET, Java/Kotlin, and native PE. No setup beyond email.' },
  { n: '02', title: 'Choose protection level',  body: 'Pick a tier from Minimal to Enterprise. Enable opt-in techniques for your specific threat model.' },
  { n: '03', title: 'Download hardened output', body: 'Protected binary ready in seconds. Compatibility check runs automatically in an isolated VM snapshot.' },
];

const TIERS = [
  { id: 'minimal',    name: 'Minimal',    badge: null,          summary: 'Maximum compatibility. Strips symbols and cleans metadata — safe baseline for all targets.',          techniques: ['Symbol stripping', 'Metadata cleanup'],                                               featured: false },
  { id: 'basic',      name: 'Basic',      badge: null,          summary: 'Core hardening. String encryption, IL virtualization for critical methods, native AES-GCM packing.',  techniques: ['String encryption', 'IL virtualization', 'Native AES-GCM'],                           featured: false },
  { id: 'pro',        name: 'Pro',        badge: null,          summary: 'Advanced obfuscation. Anti-ILDASM, constant encoding, opaque predicates, and IL mutation.',            techniques: ['Anti-ILDASM', 'Constant encoding', 'Opaque predicates', 'IL mutation'],              featured: false },
  { id: 'enterprise', name: 'Enterprise', badge: 'Recommended', summary: 'Maximum resistance. Full name obfuscation, control-flow flattening, anti-debug, anti-tamper.',        techniques: ['Name obfuscation', 'Control-flow flattening', 'Anti-debug', 'Anti-tamper', 'Polymorphic'], featured: true  },
];

type TerminalLine = { type: string; label?: string; text?: string };

const TERMINAL: Record<'dotnet' | 'jar', TerminalLine[]> = {
  dotnet: [
    { type: 'prompt', text: 'ghostbinary protect --tier enterprise ./App.exe' },
    { type: 'gap' },
    { type: 'info',   label: 'Detected', text: '.NET assembly x64 · CLR 4.0 · AnyCPU' },
    { type: 'gap' },
    { type: 'ok',     label: 'Symbol rename',  text: '1,847 identifiers → a(), b(), İıı…' },
    { type: 'ok',     label: 'String encrypt', text: '312 strings encrypted (per-string key)' },
    { type: 'ok',     label: 'IL virtualize',  text: '84 methods → custom VM bytecode' },
    { type: 'ok',     label: 'Control flow',   text: '1,236 blocks flattened → dispatch table' },
    { type: 'ok',     label: 'Anti-debug',     text: 'RDTSC + DR scan + TLS callback injected' },
    { type: 'ok',     label: 'Anti-tamper',    text: 'Hash chain sealed across 1,847 methods' },
    { type: 'ok',     label: 'Compatibility',  text: 'VM snapshot: exit 0 · pass' },
    { type: 'gap' },
    { type: 'metric', label: 'Score', text: '94 / 100  · Fortress' },
    { type: 'metric', label: 'Size',  text: '847 KB  (+105%)' },
    { type: 'metric', label: 'VT scan', text: '0 / 68 detections' },
    { type: 'gap' },
    { type: 'done',   text: 'Protected output ready for download.' },
  ],
  jar: [
    { type: 'prompt', text: 'ghostbinary protect --tier enterprise ./Payments.jar' },
    { type: 'gap' },
    { type: 'info',   label: 'Detected', text: 'Java/Kotlin JAR · 52 classes · JVM 17' },
    { type: 'gap' },
    { type: 'ok',     label: 'Debug strip',      text: 'LineNumberTable · LocalVariable removed' },
    { type: 'ok',     label: 'String encrypt',   text: '287 literals → XOR-encrypted, per-string keys' },
    { type: 'ok',     label: 'Name obfuscation', text: '52 classes → a/A … a/z, a/AA … (ClassRemapper)' },
    { type: 'ok',     label: 'Control flow',     text: '87 methods → opaque predicate injection' },
    { type: 'ok',     label: 'Anti-decompiler',  text: 'ACC_SYNTHETIC on 312 methods' },
    { type: 'gap' },
    { type: 'metric', label: 'Score', text: '88 / 100  · Hardened' },
    { type: 'metric', label: 'Size',  text: '241 KB  (+48%)' },
    { type: 'gap' },
    { type: 'done',   text: 'Protected output ready for download.' },
  ],
};

/* ─── Hero Shield ─────────────────────────────────────────── */

function HeroShield() {
  return (
    <div style={{ position: 'relative', width: 340, height: 340, flexShrink: 0 }}>
      <div style={{ position: 'absolute', inset: -60, background: 'radial-gradient(ellipse 65% 65% at 50% 50%, rgba(80,144,255,0.13), transparent 70%)', pointerEvents: 'none' }} />
      <svg viewBox="0 0 320 320" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
        <defs>
          <linearGradient id="sh-fill" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(80,144,255,0.22)"/>
            <stop offset="100%" stopColor="rgba(146,101,255,0.12)"/>
          </linearGradient>
          <linearGradient id="sh-stroke" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#5090ff" stopOpacity="0.85"/>
            <stop offset="100%" stopColor="#9265ff" stopOpacity="0.6"/>
          </linearGradient>
          <linearGradient id="sh-check" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#5090ff"/>
            <stop offset="100%" stopColor="#9265ff"/>
          </linearGradient>
          <filter id="sh-glow">
            <feGaussianBlur stdDeviation="7" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <circle cx="160" cy="160" r="130" fill="none" stroke="rgba(80,144,255,0.1)" strokeWidth="1" strokeDasharray="5 4"/>
        <circle cx="160" cy="160" r="150" fill="none" stroke="rgba(146,101,255,0.06)" strokeWidth="1" strokeDasharray="3 6"/>
        <path d="M160 52 L230 82 L230 154 C230 198 198 228 160 246 C122 228 90 198 90 154 L90 82 Z"
          fill="url(#sh-fill)" stroke="url(#sh-stroke)" strokeWidth="1.8" strokeLinejoin="round" filter="url(#sh-glow)"/>
        <path d="M160 72 L218 98 L218 154 C218 190 190 215 160 230" fill="none" stroke="rgba(80,144,255,0.22)" strokeWidth="1"/>
        <path d="M140 152 L155 168 L182 136" fill="none" stroke="url(#sh-check)"
          strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" filter="url(#sh-glow)"/>
        {/* Floating badges */}
        <g>
          <rect x="90" y="18" width="80" height="22" rx="11" fill="rgba(80,144,255,0.12)" stroke="rgba(80,144,255,0.3)" strokeWidth="1"/>
          <text x="130" y="32.5" textAnchor="middle" fill="rgba(166,200,255,0.85)" fontSize="9" fontWeight="700" fontFamily="Inter,system-ui,sans-serif" letterSpacing="0.07em">IL VM</text>
        </g>
        <g>
          <rect x="148" y="18" width="80" height="22" rx="11" fill="rgba(146,101,255,0.12)" stroke="rgba(146,101,255,0.3)" strokeWidth="1"/>
          <text x="188" y="32.5" textAnchor="middle" fill="rgba(200,175,255,0.85)" fontSize="9" fontWeight="700" fontFamily="Inter,system-ui,sans-serif" letterSpacing="0.07em">JVM</text>
        </g>
        <g>
          <rect x="234" y="120" width="80" height="22" rx="11" fill="rgba(0,205,208,0.1)" stroke="rgba(0,205,208,0.28)" strokeWidth="1"/>
          <text x="274" y="134.5" textAnchor="middle" fill="rgba(140,230,232,0.85)" fontSize="9" fontWeight="700" fontFamily="Inter,system-ui,sans-serif" letterSpacing="0.07em">ANTI-DEBUG</text>
        </g>
        <g>
          <rect x="218" y="228" width="88" height="22" rx="11" fill="rgba(0,205,208,0.08)" stroke="rgba(0,205,208,0.26)" strokeWidth="1"/>
          <text x="262" y="242.5" textAnchor="middle" fill="rgba(140,230,232,0.85)" fontSize="9" fontWeight="700" fontFamily="Inter,system-ui,sans-serif" letterSpacing="0.07em">ANTI-TAMPER</text>
        </g>
        <g>
          <rect x="4" y="120" width="76" height="22" rx="11" fill="rgba(31,207,120,0.08)" stroke="rgba(31,207,120,0.26)" strokeWidth="1"/>
          <text x="42" y="134.5" textAnchor="middle" fill="rgba(140,230,190,0.85)" fontSize="9" fontWeight="700" fontFamily="Inter,system-ui,sans-serif" letterSpacing="0.07em">AES-GCM</text>
        </g>
        <g>
          <rect x="4" y="228" width="76" height="22" rx="11" fill="rgba(245,160,32,0.1)" stroke="rgba(245,160,32,0.28)" strokeWidth="1"/>
          <text x="42" y="242.5" textAnchor="middle" fill="rgba(255,215,140,0.85)" fontSize="9" fontWeight="700" fontFamily="Inter,system-ui,sans-serif" letterSpacing="0.07em">CF FLATTEN</text>
        </g>
      </svg>
    </div>
  );
}

/* ─── Terminal renderer ───────────────────────────────────── */

function TerminalBody({ lines, accent }: { lines: TerminalLine[]; accent: string }) {
  return (
    <div style={{ padding: '1.4rem 1.8rem', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', lineHeight: 1.9 }}>
      {lines.map((line, i) => {
        if (line.type === 'gap') return <div key={i} style={{ height: '0.35rem' }} />;
        if (line.type === 'prompt') return (
          <div key={i} style={{ color: 'var(--text)' }}>
            <span style={{ color: accent, marginRight: '0.55rem', userSelect: 'none' }}>Ghost@Binary:~$</span>
            {line.text}
            <span style={{ display: 'inline-block', width: '0.5em', height: '1.1em', background: accent, marginLeft: '0.2em', verticalAlign: 'text-bottom', animation: 'gb-blink 1s step-end infinite' }} />
          </div>
        );
        if (line.type === 'info') return (
          <div key={i} style={{ display: 'flex', gap: '0.5rem', color: 'var(--text-muted)' }}>
            <span style={{ color: 'rgba(255,255,255,0.25)' }}>›</span>
            <span style={{ color: 'var(--text-muted)', minWidth: '72px' }}>{line.label}</span>
            <span style={{ color: 'var(--text-secondary)' }}>{line.text}</span>
          </div>
        );
        if (line.type === 'ok') return (
          <div key={i} style={{ display: 'flex', gap: '0.55rem' }}>
            <span style={{ color: 'var(--success)', userSelect: 'none' }}>✓</span>
            <span style={{ color: 'rgba(134,150,186,0.65)', minWidth: '138px', flexShrink: 0 }}>{line.label}</span>
            <span style={{ color: 'rgba(200,215,255,0.5)' }}>{line.text}</span>
          </div>
        );
        if (line.type === 'metric') return (
          <div key={i} style={{ display: 'flex', gap: '0.55rem' }}>
            <span style={{ color: accent, userSelect: 'none' }}>›</span>
            <span style={{ color: 'var(--text-muted)', minWidth: '138px', flexShrink: 0 }}>{line.label}</span>
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>{line.text}</span>
          </div>
        );
        if (line.type === 'done') return (
          <div key={i} style={{ color: 'var(--success)', fontWeight: 600, marginTop: '0.1rem' }}>{line.text}</div>
        );
        return null;
      })}
    </div>
  );
}

/* ─── Section header helper ──────────────────────────────── */

function SectionHead({ title, sub, accent = 'var(--blue)' }: { title: string; sub?: string; accent?: string }) {
  return (
    <div style={{ textAlign: 'center', marginBottom: '2.25rem' }}>
      <h2 style={{
        fontSize: 'clamp(1.25rem, 2.8vw, 1.55rem)',
        fontWeight: 800,
        letterSpacing: '-0.03em',
        margin: '0 0 0.55rem',
        background: `linear-gradient(130deg, #dce8ff 20%, ${accent} 70%)`,
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
      }}>{title}</h2>
      {sub && <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: 0, maxWidth: '52ch', marginInline: 'auto', lineHeight: 1.7 }}>{sub}</p>}
    </div>
  );
}

/* ─── Main component ────────────────────────────────────── */

export default function Landing() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [terminalTab, setTerminalTab] = useState<'dotnet' | 'jar'>('dotnet');

  useEffect(() => {
    if (!loading && user) navigate('/dashboard', { replace: true });
  }, [user, loading, navigate]);

  if (loading) return null;

  const termAccent = terminalTab === 'jar' ? '#f5a020' : 'var(--blue)';

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', paddingBottom: '6rem', position: 'relative' }}>

      {/* ── Ambient background orbs ── */}
      <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
        <div style={{ position: 'absolute', top: '-20vh', right: '-15vw', width: '70vw', height: '70vw', maxWidth: 900, maxHeight: 900, borderRadius: '50%', background: 'radial-gradient(circle, rgba(80,144,255,0.055) 0%, transparent 60%)' }} />
        <div style={{ position: 'absolute', top: '30vh', left: '-20vw', width: '60vw', height: '60vw', maxWidth: 800, maxHeight: 800, borderRadius: '50%', background: 'radial-gradient(circle, rgba(146,101,255,0.045) 0%, transparent 60%)' }} />
      </div>

      <div style={{ position: 'relative', zIndex: 1 }}>

        {/* ── Beta banner ── */}
        <div style={{
          marginTop: '2rem',
          marginBottom: '4rem',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem',
          animation: 'gb-fade-up 0.5s var(--ease-out) both',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.75rem',
            padding: '0.5rem 1.1rem', borderRadius: 9999,
            background: 'linear-gradient(var(--bg-elevated), var(--bg-elevated)) padding-box, linear-gradient(135deg, rgba(80,144,255,0.5), rgba(146,101,255,0.4)) border-box',
            border: '1px solid transparent',
            fontSize: '0.82rem',
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)', boxShadow: '0 0 10px var(--success)', display: 'block', flexShrink: 0 }} />
            <Badge tone="accent">Public Beta</Badge>
            <span style={{ color: 'var(--text-secondary)' }}>All tiers <strong style={{ color: 'var(--text)', fontWeight: 600 }}>free</strong> — no credit card required.</span>
          </div>
        </div>

        {/* ── Hero ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '3.5rem', marginBottom: '5rem', flexWrap: 'wrap',
          animation: 'gb-fade-up 0.6s 0.06s var(--ease-out) both',
        }}>
          {/* Copy */}
          <div style={{ flex: '1 1 420px', minWidth: 0 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
              padding: '0.3rem 0.75rem', borderRadius: 9999,
              background: 'rgba(80,144,255,0.1)', border: '1px solid rgba(80,144,255,0.26)',
              fontSize: '0.72rem', fontWeight: 700, color: 'var(--blue)',
              letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: '1.3rem',
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--blue)', boxShadow: '0 0 8px var(--blue)', display: 'block' }} />
              Binary Protection Platform
            </div>

            <h1 style={{
              fontSize: 'clamp(2.8rem, 6vw, 4.2rem)',
              fontWeight: 800,
              lineHeight: 1.06,
              letterSpacing: '-0.045em',
              margin: '0 0 1.2rem',
              background: 'linear-gradient(145deg, #ffffff 0%, #c8deff 30%, var(--blue) 60%, var(--purple) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>
              Stop Reverse<br />Engineers Cold.
            </h1>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.9rem' }}>
              {[
                ['Prevent cracking and license bypass',          'var(--blue)'],
                ['Keep algorithms private from competitors',     'var(--purple)'],
                ['Harden commercial software against analysis',  'var(--cyan)'],
                ['One-click CI/CD protection via REST API',      '#1fcf78'],
              ].map(([text, dot]) => (
                <div key={text} style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', fontSize: '0.93rem', color: 'var(--text-secondary)' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot, boxShadow: `0 0 6px ${dot}`, flexShrink: 0 }} />
                  {text}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', marginBottom: '1.35rem' }}>
              <Link to="/register" style={{ textDecoration: 'none' }}>
                <Button size="lg" variant="primary">Get started free →</Button>
              </Link>
              <Link to="/login" style={{ textDecoration: 'none' }}>
                <Button size="lg" variant="ghost">Sign in</Button>
              </Link>
            </div>

            {/* Language chips */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              {[
                { label: '.NET / C#',    color: 'var(--purple)', bg: 'rgba(146,101,255,0.12)', border: 'rgba(146,101,255,0.28)' },
                { label: 'Java / Kotlin (.jar)', color: '#f5a020', bg: 'rgba(245,160,32,0.1)', border: 'rgba(245,160,32,0.28)' },
                { label: 'Native PE',    color: '#1fcf78',      bg: 'rgba(31,207,120,0.1)', border: 'rgba(31,207,120,0.25)' },
                { label: 'API-first',    color: 'var(--blue)',  bg: 'rgba(80,144,255,0.1)', border: 'rgba(80,144,255,0.24)' },
              ].map((chip) => (
                <span key={chip.label} style={{
                  fontSize: '0.73rem', fontWeight: 600, padding: '0.25rem 0.65rem',
                  borderRadius: 9999, background: chip.bg, border: `1px solid ${chip.border}`, color: chip.color,
                }}>{chip.label}</span>
              ))}
            </div>
          </div>

          {/* Shield */}
          <div style={{ flex: '0 0 auto', display: 'flex', justifyContent: 'center' }}>
            <HeroShield />
          </div>
        </div>

        {/* ── Stats band ── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          borderRadius: 'var(--r-xl)',
          overflow: 'hidden',
          marginBottom: '4.5rem',
          background: 'linear-gradient(var(--bg-elevated), var(--bg-elevated)) padding-box, linear-gradient(135deg, rgba(80,144,255,0.3), rgba(146,101,255,0.2), rgba(0,205,208,0.15)) border-box',
          border: '1px solid transparent',
          boxShadow: 'var(--shadow-lg)',
          animation: 'gb-fade-up 0.6s 0.1s var(--ease-out) both',
        }}>
          {[
            { value: '3',    label: 'Runtimes',            sub: '.NET · JVM · PE' },
            { value: '20+',  label: 'Obfuscation passes',  sub: 'per .NET binary'  },
            { value: '0/68', label: 'VT detections',       sub: 'average output'   },
            { value: 'Free', label: 'During public beta',  sub: 'no credit card'   },
          ].map((s, i) => (
            <div key={s.label} style={{
              padding: '1.75rem 1rem', textAlign: 'center',
              borderRight: i < 3 ? '1px solid var(--border)' : 'none',
            }}>
              <div style={{
                fontSize: 'clamp(1.7rem, 3.5vw, 2.4rem)',
                fontWeight: 800, letterSpacing: '-0.04em',
                background: 'linear-gradient(135deg, #e0eaff, var(--blue))',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
                lineHeight: 1.1, marginBottom: '0.28rem',
              }}>{s.value}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text)', fontWeight: 600, marginBottom: '0.15rem' }}>{s.label}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{s.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Supported runtimes ── */}
        <div style={{ marginBottom: '4.5rem', animation: 'gb-fade-up 0.6s 0.12s var(--ease-out) both' }}>
          <SectionHead title="Three runtimes. One pipeline." sub="Upload .NET assemblies, Java/Kotlin JARs, or native Windows PE binaries — each gets purpose-built protection." />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
            {RUNTIMES.map((r) => (
              <div key={r.lang} style={{
                borderRadius: 'var(--r-xl)',
                background: 'linear-gradient(var(--bg-elevated), var(--bg-elevated)) padding-box, linear-gradient(135deg, ' + r.borderColor + ' 0%, rgba(255,255,255,0.05) 100%) border-box',
                border: '1px solid transparent',
                overflow: 'hidden',
                boxShadow: `var(--shadow-1), 0 0 40px ${r.glow}`,
              }}>
                {/* Colored header bar */}
                <div style={{ height: 3, background: `linear-gradient(90deg, ${r.accent}, transparent)` }} />
                <div style={{ padding: '1.35rem 1.4rem' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                    <span style={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.02em', color: 'var(--text)' }}>{r.lang}</span>
                    {r.badge && (
                      <span style={{
                        fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
                        padding: '0.15rem 0.45rem', borderRadius: 9999,
                        background: 'rgba(245,160,32,0.14)', border: '1px solid rgba(245,160,32,0.4)', color: '#f5a020',
                      }}>{r.badge}</span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.74rem', fontFamily: 'var(--font-mono)', color: r.accent, marginBottom: '1.1rem', opacity: 0.85 }}>{r.ext}</div>
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.3rem' }}>
                    {r.techniques.map((t) => (
                      <li key={t} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        <span style={{ color: r.accent, fontSize: '0.7rem', flexShrink: 0 }}>✓</span>
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Benefits ── */}
        <div style={{ marginBottom: '4.5rem' }}>
          <SectionHead title="Everything you need to ship hardened software" sub="Not just obfuscation — a complete protection pipeline with verification, threat intel, and CI integration." accent="var(--purple)" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
            {BENEFITS.map((f) => (
              <div key={f.title} style={{
                padding: '1.5rem 1.35rem',
                borderRadius: 'var(--r-xl)',
                background: 'linear-gradient(var(--bg-elevated), var(--bg-elevated)) padding-box, linear-gradient(145deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.03) 50%, rgba(255,255,255,0.08) 100%) border-box',
                border: '1px solid transparent',
                boxShadow: 'var(--shadow-1)',
              }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 'var(--r-lg)',
                  background: f.glow,
                  border: `1px solid ${f.color}28`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: '1.1rem', color: f.color,
                  boxShadow: `0 4px 20px ${f.glow}`,
                }}>
                  <f.Icon />
                </div>
                <div style={{ fontWeight: 700, fontSize: '0.94rem', marginBottom: '0.5rem', letterSpacing: '-0.015em', color: 'var(--text)' }}>{f.title}</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>{f.body}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Tabbed Terminal ── */}
        <div style={{
          borderRadius: 'var(--r-xl)', overflow: 'hidden', marginBottom: '4.5rem',
          background: 'linear-gradient(#010306, #010306) padding-box, linear-gradient(135deg, rgba(80,144,255,0.3), rgba(146,101,255,0.18)) border-box',
          border: '1px solid transparent',
          boxShadow: 'var(--shadow-lg), 0 0 100px rgba(80,144,255,0.07)',
        }}>
          {/* Chrome + tabs */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0.8rem 1.3rem', borderBottom: '1px solid rgba(255,255,255,0.05)',
            background: 'rgba(255,255,255,0.02)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57', display: 'block' }}/>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#febc2e', display: 'block' }}/>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c840', display: 'block' }}/>
            </div>
            {/* Tabs */}
            <div style={{ display: 'flex', gap: '0.3rem', background: 'rgba(255,255,255,0.04)', padding: '0.3rem', borderRadius: 'var(--r-md)' }}>
              {([['dotnet', '.NET / C#'], ['jar', 'Java / Kotlin']] as const).map(([tab, label]) => (
                <button
                  key={tab}
                  onClick={() => setTerminalTab(tab)}
                  style={{
                    padding: '0.3rem 0.85rem', borderRadius: 'var(--r-sm)', border: 'none', cursor: 'pointer',
                    fontSize: '0.75rem', fontWeight: 600, fontFamily: 'var(--font-mono)',
                    background: terminalTab === tab ? (tab === 'jar' ? 'rgba(245,160,32,0.18)' : 'rgba(80,144,255,0.2)') : 'transparent',
                    color: terminalTab === tab ? (tab === 'jar' ? '#f5a020' : 'var(--blue)') : 'var(--text-muted)',
                    transition: 'all 150ms',
                  }}
                >{label}</button>
              ))}
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'rgba(255,255,255,0.2)' }}>
              ghostbinary — enterprise protection
            </span>
          </div>
          <TerminalBody lines={TERMINAL[terminalTab]} accent={termAccent} />
        </div>

        {/* ── How it works ── */}
        <div style={{
          padding: '2.5rem 2.5rem', borderRadius: 'var(--r-xl)', marginBottom: '4.5rem',
          background: 'linear-gradient(var(--bg-elevated), var(--bg-elevated)) padding-box, linear-gradient(140deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.02) 50%, rgba(255,255,255,0.07) 100%) border-box',
          border: '1px solid transparent', boxShadow: 'var(--shadow-1)',
        }}>
          <SectionHead title="From upload to hardened binary in 60 seconds" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '2rem' }}>
            {STEPS.map((s, i) => (
              <div key={s.n} style={{ display: 'flex', gap: '1.1rem', alignItems: 'flex-start', position: 'relative' }}>
                {i < STEPS.length - 1 && (
                  <div style={{ position: 'absolute', left: 19, top: 38, width: 1, height: 'calc(100% + 1.5rem)', background: 'linear-gradient(to bottom, rgba(80,144,255,0.25), transparent)', display: 'none' }} />
                )}
                <div style={{
                  width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                  background: 'linear-gradient(135deg, var(--blue), var(--purple))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 800, fontSize: '0.76rem', color: '#fff',
                  boxShadow: '0 6px 22px rgba(80,144,255,0.4)',
                  fontFamily: 'var(--font-mono)',
                }}>{s.n}</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.94rem', marginBottom: '0.35rem', letterSpacing: '-0.015em', color: 'var(--text)' }}>{s.title}</div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>{s.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Technical depth ── */}
        <div style={{ marginBottom: '4.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
            <div style={{
              width: 38, height: 38, borderRadius: 'var(--r-md)',
              background: 'rgba(146,101,255,0.13)', border: '1px solid rgba(146,101,255,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--purple)',
              flexShrink: 0,
            }}><CpuIcon /></div>
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 0.15rem', color: 'var(--text)' }}>For security engineers</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: 0 }}>The actual techniques under the hood — not marketing copy.</p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.7rem' }}>
            {TECH_DEPTH.map((t) => (
              <div key={t.label} style={{
                padding: '1.1rem 1.2rem 1.1rem 1.05rem',
                borderRadius: 'var(--r-md)',
                background: 'rgba(255,255,255,0.022)',
                border: '1px solid var(--border)',
                display: 'flex', gap: '1rem', alignItems: 'flex-start',
              }}>
                <div style={{ width: 3, borderRadius: 2, background: `linear-gradient(to bottom, ${t.color}, transparent)`, alignSelf: 'stretch', flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.83rem', fontFamily: 'var(--font-mono)', color: t.color, marginBottom: '0.4rem' }}>{t.label}</div>
                  <p style={{ margin: 0, fontSize: '0.79rem', color: 'var(--text-muted)', lineHeight: 1.65 }}>{t.detail}</p>
                </div>
              </div>
            ))}
          </div>
          <p style={{ textAlign: 'center', marginTop: '1.1rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            + 14 more optional .NET techniques including resource encryption, reference proxying, dynamic method generation, and runtime RASP.
          </p>
        </div>

        {/* ── CI/CD callout ── */}
        <div style={{
          padding: '1.85rem 2.25rem', borderRadius: 'var(--r-xl)', marginBottom: '4.5rem',
          background: 'linear-gradient(rgba(10,20,46,0.92), rgba(6,14,32,0.96)) padding-box, linear-gradient(135deg, rgba(80,144,255,0.38), rgba(146,101,255,0.24)) border-box',
          border: '1px solid transparent', boxShadow: 'var(--shadow-1)',
          display: 'flex', gap: '2.5rem', alignItems: 'center', flexWrap: 'wrap',
        }}>
          <div style={{ flex: '1 1 300px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', marginBottom: '0.65rem', color: 'var(--blue)' }}>
              <TerminalIcon />
              <span style={{ fontWeight: 700, fontSize: '0.9rem', letterSpacing: '-0.01em' }}>API-first. CI/CD ready.</span>
            </div>
            <p style={{ margin: '0 0 1rem', color: 'var(--text-secondary)', fontSize: '0.86rem', lineHeight: 1.7 }}>
              Protect every release automatically. REST API, GitHub Actions integration, and JSON output.
              Your pipeline runs GhostBinary; your users get a hardened binary on every merge.
            </p>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: '0.79rem', color: 'rgba(255,255,255,0.35)',
              background: 'rgba(0,0,0,0.35)', padding: '0.6rem 1rem', borderRadius: 'var(--r-md)',
              display: 'inline-block', border: '1px solid rgba(255,255,255,0.05)',
            }}>
              <span style={{ color: 'var(--blue)' }}>uses:</span> ghostbinary/protect-action@v2
            </div>
          </div>
          <div style={{ flexShrink: 0 }}>
            <a href="/api/v1/docs" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
              <Button variant="ghost" size="sm">View API docs →</Button>
            </a>
          </div>
        </div>

        {/* ── Tier cards ── */}
        <div style={{ marginBottom: '4.5rem' }}>
          <SectionHead title="Protection tiers" sub="All tiers are free during public beta. No credit card required." accent="var(--cyan)" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(215px, 1fr))', gap: '0.9rem' }}>
            {TIERS.map((t) => (
              <div key={t.id} style={{
                padding: '1.4rem 1.35rem',
                borderRadius: 'var(--r-xl)',
                background: t.featured
                  ? 'linear-gradient(rgba(14,28,62,0.96), rgba(8,18,44,0.99)) padding-box, linear-gradient(135deg, var(--blue), var(--purple)) border-box'
                  : 'linear-gradient(var(--bg-elevated), var(--bg-elevated)) padding-box, linear-gradient(145deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.03) 50%, rgba(255,255,255,0.08) 100%) border-box',
                border: '1px solid transparent',
                boxShadow: t.featured ? 'var(--shadow-1), 0 0 60px rgba(80,144,255,0.2), 0 0 120px rgba(146,101,255,0.1)' : 'var(--shadow-1)',
                display: 'flex', flexDirection: 'column',
              }}>
                {t.featured && <div style={{ height: 2, background: 'linear-gradient(90deg, var(--blue), var(--purple))', borderRadius: 2, marginBottom: '1.2rem', marginInline: '-1.35rem', marginTop: '-1.4rem', borderTopLeftRadius: 'var(--r-xl)', borderTopRightRadius: 'var(--r-xl)' }} />}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.55rem' }}>
                  <span style={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.02em' }}>{t.name}</span>
                  <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                    {t.badge && (
                      <span style={{
                        fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                        padding: '0.17rem 0.5rem', borderRadius: 9999,
                        background: 'rgba(80,144,255,0.16)', border: '1px solid rgba(80,144,255,0.38)', color: '#a6c8ff',
                      }}>{t.badge}</span>
                    )}
                    <Badge tone="success">Free</Badge>
                  </div>
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.65, margin: '0 0 1rem', flex: 1 }}>{t.summary}</p>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.3rem' }}>
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
          textAlign: 'center', padding: '4rem 2rem',
          borderRadius: 'var(--r-xl)', position: 'relative', overflow: 'hidden',
          background: 'linear-gradient(var(--bg-elevated), var(--bg-elevated)) padding-box, linear-gradient(135deg, rgba(80,144,255,0.45), rgba(146,101,255,0.35), rgba(0,205,208,0.2)) border-box',
          border: '1px solid transparent',
          boxShadow: 'var(--shadow-lg), 0 0 120px rgba(80,144,255,0.08)',
        }}>
          {/* Background glow */}
          <div style={{ position: 'absolute', top: '-80px', left: '50%', transform: 'translateX(-50%)', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(80,144,255,0.09), transparent 65%)', pointerEvents: 'none' }} />
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.45rem',
              padding: '0.3rem 0.8rem', borderRadius: 9999,
              background: 'rgba(31,207,120,0.1)', border: '1px solid rgba(31,207,120,0.3)',
              fontSize: '0.72rem', fontWeight: 700, color: 'var(--success)',
              letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: '1.4rem',
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', boxShadow: '0 0 10px var(--success)', display: 'block' }} />
              Live now · Free beta
            </div>
            <h2 style={{
              fontSize: 'clamp(1.6rem, 3.5vw, 2.3rem)', fontWeight: 800, letterSpacing: '-0.04em',
              margin: '0 0 0.75rem', lineHeight: 1.15,
              background: 'linear-gradient(140deg, #ffffff 20%, #c8deff 50%, var(--blue) 90%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>
              Ready to protect your first binary?
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', margin: '0 auto 2.25rem', maxWidth: '44ch', lineHeight: 1.7 }}>
              Free account. No credit card. .NET, Java, and native PE — hardened output in under 60 seconds.
            </p>
            <div style={{ display: 'flex', gap: '0.85rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link to="/register" style={{ textDecoration: 'none' }}>
                <Button size="lg" variant="primary">Create free account →</Button>
              </Link>
              <a href="/api/v1/docs" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                <Button size="lg" variant="ghost">API reference</Button>
              </a>
            </div>
          </div>
        </div>


      </div>
    </div>
  );
}
