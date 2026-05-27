import { useState, useCallback, useRef, useEffect, useMemo, Fragment } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiErrorFromResponse } from '../lib/api';
import { Alert, Badge, Button, Card, Progress, Select, Checkbox } from '../design-system';
import { loadUserSettings, type ProtectionPreset } from '../lib/userSettings';
import JobDetailPanel from '../components/JobDetailPanel';
import type {
  JobSummary,
  ThreatIntelStatus,
  TechniqueFlag,
  RetrySuggestion,
} from '../types/jobs';

const API = '/api/v1';
const MAX_FILE_SIZE = 100 * 1024 * 1024;

const TIERS = [
  {
    id: 'minimal',
    name: 'Minimal',
    price: 'Free (Beta)',
    desc: 'Maximum compatibility. .NET: symbol stripping, metadata cleanup only.',
  },
  {
    id: 'basic',
    name: 'Basic',
    price: 'Free (Beta)',
    desc: '.NET: symbol stripping, string encryption. Native: AES + compression packing.',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 'Free (Beta)',
    desc: '.NET: + control-flow flattening, constant encoding, dead code insertion. Native: + padding.',
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Free (Beta)',
    desc: '.NET: + name obfuscation, anti-debug, anti-tamper. Native: + extra XOR layer.',
    badge: 'Most protected',
  },
];

function readDefaultTierSetting(): string {
  const requested = loadUserSettings().defaultTier;
  return TIERS.some((t) => t.id === requested) ? requested : 'basic';
}

function readDefaultPresetSetting(): ProtectionPreset {
  return loadUserSettings().defaultPreset;
}

function readPollIntervalSetting(): number {
  return loadUserSettings().jobPollIntervalMs;
}

const ADVANCED_TECHNIQUES: { id: string; label: string; note?: string }[] = [
  { id: 'resource_encryption', label: 'Resource encryption' },
  { id: 'reference_proxy', label: 'Reference proxying' },
  { id: 'delegate_proxy', label: 'Delegate proxying' },
  { id: 'reflection_dispatch', label: 'Reflection dispatch' },
  { id: 'type_scramble', label: 'Type scrambling' },
  { id: 'assembly_embed', label: 'Assembly embed + resolver' },
  { id: 'anti_decompiler', label: 'Anti-decompiler (conservative)' },
  { id: 'anti_decompiler_aggressive', label: 'Anti-decompiler (aggressive)', note: 'Higher breakage risk' },
  { id: 'invalid_metadata', label: 'Invalid metadata injection', note: 'Tooling-hostile' },
  { id: 'method_body_encryption', label: 'Method body encryption' },
  { id: 'dynamic_method_generation', label: 'Dynamic method generation' },
  { id: 'runtime_rasp', label: 'Runtime self-protection (RASP)' },
  { id: 'local_var_promotion', label: 'Local variable promotion' },
  { id: 'il_mutation', label: 'IL mutation equivalents' },
];

type UIJobStatus = 'idle' | 'uploading' | 'queued' | 'processing' | 'completed' | 'failed';
const POLYMORPHIC_PRESET_PROTECTIONS = ['il_mutation'];
const PRO_OR_ENTERPRISE_TIERS = new Set(['pro', 'enterprise']);

function fileNameFromKey(key: string): string {
  const parts = key.split('/');
  return parts[parts.length - 1] || key;
}

function hasExactProtections(actual: string[], expected: string[]): boolean {
  if (actual.length !== expected.length) return false;
  const set = new Set(actual);
  return expected.every((v) => set.has(v));
}

function buildVirusTotalUrl(s?: ThreatIntelStatus): string | null {
  if (!s || s.provider !== 'virustotal') return null;
  if (s.provider_submission) {
    return `https://www.virustotal.com/gui/analysis/${encodeURIComponent(s.provider_submission)}`;
  }
  if (s.sample_hash) {
    return `https://www.virustotal.com/gui/file/${encodeURIComponent(s.sample_hash)}/detection`;
  }
  return null;
}

function jobStatusTone(status: string): 'neutral' | 'accent' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'completed': return 'success';
    case 'failed':    return 'danger';
    case 'processing': return 'accent';
    case 'queued':    return 'warning';
    default:          return 'neutral';
  }
}

const ACTIVE_PHASES: UIJobStatus[] = ['uploading', 'queued', 'processing'];
const PHASE_LABELS: Record<string, string> = {
  uploading:  'Uploading binary…',
  queued:     'Waiting in queue…',
  processing: 'Applying protections…',
};

export default function Dashboard() {
  const { authFetch } = useAuth();
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [selectedTier, setSelectedTier] = useState(readDefaultTierSetting);
  const [preset, setPreset] = useState<ProtectionPreset>('balanced');
  const [lowEntropy, setLowEntropy] = useState(false);
  const [polymorphicMode, setPolymorphicMode] = useState(false);
  const [renameMode, setRenameMode] = useState<'random' | 'sequential' | 'unicode' | 'unprintable'>('random');
  const [selectedProtections, setSelectedProtections] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<UIJobStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [intelByJob, setIntelByJob] = useState<Record<string, ThreatIntelStatus>>({});
  const [intelFlags, setIntelFlags] = useState<TechniqueFlag[]>([]);
  const [intelSubmittingJobId, setIntelSubmittingJobId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initialPresetAppliedRef = useRef(false);

  const supportsAdvancedTechniques = PRO_OR_ENTERPRISE_TIERS.has(selectedTier);
  const supportsPolymorphicMode = PRO_OR_ENTERPRISE_TIERS.has(selectedTier);
  const supportsRenameMode = selectedTier === 'enterprise';
  const supportsLowEntropy = selectedTier !== 'minimal';
  const isBusy = status === 'uploading' || status === 'queued' || status === 'processing';

  // ── Polling / fetch helpers ──────────────────────────────────────────────

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const fetchJobs = useCallback(async () => {
    try {
      const r = await authFetch(`${API}/jobs`);
      if (r.ok) {
        const d = await r.json();
        setJobs(d.jobs || []);
      } else if (r.status === 401) {
        setJobs([]);
      }
    } catch {
      setJobs([]);
    } finally {
      setJobsLoading(false);
    }
  }, [authFetch]);

  const fetchThreatIntelFlags = useCallback(async () => {
    try {
      const r = await authFetch(`${API}/threat-intel/flags`);
      if (!r.ok) return;
      const d = await r.json();
      setIntelFlags(Array.isArray(d.flags) ? d.flags : []);
    } catch { setIntelFlags([]); }
  }, [authFetch]);

  const fetchThreatIntelStatus = useCallback(async (jobIdValue: string) => {
    try {
      const r = await authFetch(`${API}/jobs/${jobIdValue}/threat-intel`);
      if (!r.ok) return;
      const d = await r.json();
      setIntelByJob((prev) => ({ ...prev, [jobIdValue]: d }));
    } catch { /* ignore */ }
  }, [authFetch]);

  const submitThreatIntel = useCallback(async (jobIdValue: string) => {
    setIntelSubmittingJobId(jobIdValue);
    try {
      const r = await authFetch(`${API}/jobs/${jobIdValue}/threat-intel/submit`, { method: 'POST' });
      if (!r.ok) {
        const msg = await apiErrorFromResponse(r, 'Threat-intel submission failed');
        setError(msg); return;
      }
      const d = await r.json();
      setIntelByJob((prev) => ({ ...prev, [jobIdValue]: d }));
      fetchThreatIntelFlags();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Threat-intel submission failed');
    } finally { setIntelSubmittingJobId(null); }
  }, [authFetch, fetchThreatIntelFlags]);

  const buildProtectionPayload = useCallback(() => {
    const p = supportsAdvancedTechniques ? [...selectedProtections] : [];
    if (supportsRenameMode) {
      if (renameMode === 'sequential')   p.push('rename_mode_sequential');
      else if (renameMode === 'unicode') p.push('rename_mode_unicode');
      else if (renameMode === 'unprintable') p.push('rename_mode_unprintable');
      else p.push('rename_mode_random');
    }
    return Array.from(new Set(p));
  }, [selectedProtections, renameMode, supportsAdvancedTechniques, supportsRenameMode]);

  const displayJobs = useMemo(() => {
    if (!jobId) return jobs;
    if (jobs.some((j) => j.job_id === jobId)) return jobs;
    const current: JobSummary = {
      job_id: jobId,
      status,
      progress,
      tier: selectedTier,
      binary_type: undefined,
      low_entropy: lowEntropy,
      polymorphic_mode: polymorphicMode,
      protections: buildProtectionPayload(),
      input_key: file ? `inputs/.../${file.name}` : '',
      output_key: status === 'completed' ? 'out' : undefined,
      error: jobError || undefined,
    };
    return [current, ...jobs];
  }, [jobs, jobId, status, progress, selectedTier, lowEntropy, polymorphicMode, buildProtectionPayload, file?.name, jobError]);

  const pollJob = useCallback((id: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const r = await authFetch(`${API}/jobs/${id}`);
        if (!r.ok) {
          const msg = await apiErrorFromResponse(r, 'Failed to get job status');
          throw new Error(msg);
        }
        const d = await r.json();
        setStatus(d.status);
        setProgress(d.progress ?? 0);
        setJobError(d.error || null);
        if (d.status === 'completed' || d.status === 'failed') {
          stopPolling();
          fetchJobs();
        }
      } catch (e) {
        stopPolling();
        setStatus('failed');
        setError(e instanceof Error ? e.message : 'Failed to poll status');
      }
    }, readPollIntervalSetting());
  }, [stopPolling, authFetch, fetchJobs]);

  // ── Event handlers ────────────────────────────────────────────────────────

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f && (f.name.endsWith('.exe') || f.name.endsWith('.dll'))) {
      if (f.size > MAX_FILE_SIZE) { setError(`File too large (max ${MAX_FILE_SIZE / 1024 / 1024} MB)`); return; }
      setFile(f); setError(null);
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      if (f.size > MAX_FILE_SIZE) { setError(`File too large (max ${MAX_FILE_SIZE / 1024 / 1024} MB)`); setFile(null); return; }
      setFile(f); setError(null);
    }
  }, []);

  const toggleProtection = useCallback((id: string) => {
    setSelectedProtections((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }, []);

  const applyPreset = useCallback((nextPreset: ProtectionPreset) => {
    if (nextPreset === 'polymorphic' && !supportsPolymorphicMode) nextPreset = 'balanced';
    setPreset(nextPreset);
    if (nextPreset === 'compatibility') {
      setLowEntropy(true); setPolymorphicMode(false); setRenameMode('random'); setSelectedProtections([]); return;
    }
    if (nextPreset === 'balanced') {
      setLowEntropy(false); setPolymorphicMode(false); setRenameMode('random'); setSelectedProtections([]); return;
    }
    setLowEntropy(false); setPolymorphicMode(true); setRenameMode('random');
    setSelectedProtections(POLYMORPHIC_PRESET_PROTECTIONS);
  }, [supportsPolymorphicMode]);

  useEffect(() => {
    if (initialPresetAppliedRef.current) return;
    initialPresetAppliedRef.current = true;
    applyPreset(readDefaultPresetSetting());
  }, [applyPreset]);

  const handleProtect = useCallback(async () => {
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) { setError(`File too large (max ${MAX_FILE_SIZE / 1024 / 1024} MB)`); return; }
    setError(null); setStatus('uploading');
    try {
      const form = new FormData();
      form.append('file', file);
      const uploadRes = await authFetch(`${API}/upload`, { method: 'POST', body: form });
      if (!uploadRes.ok) throw new Error(await apiErrorFromResponse(uploadRes, 'Upload failed'));
      const uploadData = await uploadRes.json();

      setStatus('queued');
      const jobRes = await authFetch(`${API}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input_key: uploadData.input_key,
          tier: selectedTier,
          binary_type: 'auto',
          low_entropy: supportsLowEntropy ? lowEntropy : false,
          polymorphic_mode: supportsPolymorphicMode ? polymorphicMode : false,
          protections: buildProtectionPayload(),
        }),
      });
      if (!jobRes.ok) throw new Error(await apiErrorFromResponse(jobRes, 'Failed to create job'));
      const jobData = await jobRes.json();
      setJobId(jobData.job_id);
      pollJob(jobData.job_id);
      fetchJobs();
    } catch (e) {
      setStatus('failed');
      setError(e instanceof Error ? e.message : 'Something went wrong');
    }
  }, [file, selectedTier, lowEntropy, polymorphicMode, buildProtectionPayload, pollJob, authFetch, fetchJobs, supportsLowEntropy, supportsPolymorphicMode]);

  const handleDownload = useCallback(async () => {
    if (!jobId) return;
    try {
      const r = await authFetch(`${API}/jobs/${jobId}/download`);
      if (!r.ok) throw new Error(await apiErrorFromResponse(r, 'Download failed'));
      const ct = r.headers.get('Content-Type') || '';
      if (ct.includes('application/json')) {
        const d = await r.json();
        if (d.download_url) { window.open(d.download_url, '_blank'); fetchJobs(); return; }
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `protected-${file?.name || 'output.dll'}`; a.click();
      URL.revokeObjectURL(url);
      fetchJobs();
    } catch (e) { setError(e instanceof Error ? e.message : 'Download failed'); }
  }, [jobId, file?.name, authFetch, fetchJobs]);

  const mergeRetryProtections = useCallback((jobProtections?: string[]) => {
    if (jobProtections && jobProtections.length > 0) return jobProtections;
    return buildProtectionPayload();
  }, [buildProtectionPayload]);

  const handleRetryJob = useCallback(async (j: JobSummary, suggestion?: RetrySuggestion) => {
    if (j.status !== 'failed' || !j.input_key) return;
    setRetryingId(j.job_id); setError(null);
    try {
      const nextTier = suggestion?.tier || j.tier || 'basic';
      const nextLowEntropy = suggestion?.low_entropy ?? j.low_entropy ?? lowEntropy;
      const nextPolymorphic = suggestion?.polymorphic_mode ?? j.polymorphic_mode ?? polymorphicMode;
      const nextProtections = suggestion?.protections?.length
        ? suggestion.protections
        : mergeRetryProtections(j.protections);
      const jobRes = await authFetch(`${API}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input_key: j.input_key, tier: nextTier, binary_type: 'auto',
          low_entropy: nextLowEntropy, polymorphic_mode: nextPolymorphic, protections: nextProtections,
        }),
      });
      if (!jobRes.ok) throw new Error(await apiErrorFromResponse(jobRes, 'Retry failed'));
      const jobData = await jobRes.json();
      setJobId(jobData.job_id); setSelectedTier(nextTier); setStatus('queued');
      setProgress(0); setJobError(null);
      pollJob(jobData.job_id); fetchJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Retry failed');
    } finally { setRetryingId(null); }
  }, [authFetch, pollJob, fetchJobs, lowEntropy, polymorphicMode, mergeRetryProtections]);

  const handleReset = useCallback(() => {
    stopPolling(); setFile(null); setJobId(null); setStatus('idle');
    setProgress(0); setError(null); setJobError(null);
  }, [stopPolling]);

  const handleDownloadJob = useCallback(async (id: string, inputKey: string) => {
    try {
      const r = await authFetch(`${API}/jobs/${id}/download`);
      if (!r.ok) throw new Error(await apiErrorFromResponse(r, 'Download failed'));
      const ct = r.headers.get('Content-Type') || '';
      if (ct.includes('application/json')) {
        const d = await r.json();
        if (d.download_url) { window.open(d.download_url, '_blank'); fetchJobs(); return; }
      }
      const blob = await r.blob();
      const ext = inputKey.match(/\.(exe|dll)$/i)?.[1] || 'dll';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `protected.${ext}`; a.click();
      URL.revokeObjectURL(url);
      fetchJobs();
    } catch (e) { setError(e instanceof Error ? e.message : 'Download failed'); }
  }, [authFetch, fetchJobs]);

  const handleDeleteJob = useCallback(async (id: string) => {
    try {
      const r = await authFetch(`${API}/jobs/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(await apiErrorFromResponse(r, 'Delete failed'));
      if (jobId === id) handleReset();
      fetchJobs();
    } catch (e) { setError(e instanceof Error ? e.message : 'Delete failed'); }
  }, [authFetch, fetchJobs, jobId, handleReset]);

  const handleClearHistory = useCallback(async () => {
    if (!window.confirm('Delete all job history? This cannot be undone.')) return;
    try {
      const r = await authFetch(`${API}/jobs`, { method: 'DELETE' });
      if (!r.ok) throw new Error(await apiErrorFromResponse(r, 'Clear failed'));
      handleReset(); fetchJobs();
    } catch (e) { setError(e instanceof Error ? e.message : 'Clear failed'); }
  }, [authFetch, fetchJobs, handleReset]);

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => { fetchJobs(); fetchThreatIntelFlags(); }, [fetchJobs]);

  useEffect(() => {
    const completedJobs = displayJobs.filter((j) => j.status === 'completed' || j.status === 'failed');
    completedJobs.slice(0, 12).forEach((j) => {
      if (!intelByJob[j.job_id]) fetchThreatIntelStatus(j.job_id);
    });
  }, [displayJobs, intelByJob, fetchThreatIntelStatus]);

  useEffect(() => { if (lowEntropy) setPolymorphicMode(false); }, [lowEntropy]);

  useEffect(() => {
    if (!supportsAdvancedTechniques && selectedProtections.length > 0) setSelectedProtections([]);
    if (!supportsRenameMode && renameMode !== 'random') setRenameMode('random');
    if (!supportsPolymorphicMode && polymorphicMode) setPolymorphicMode(false);
    if (!supportsLowEntropy && lowEntropy) setLowEntropy(false);
  }, [supportsAdvancedTechniques, supportsRenameMode, supportsPolymorphicMode, supportsLowEntropy, selectedProtections.length, renameMode, polymorphicMode, lowEntropy]);

  useEffect(() => {
    if (lowEntropy && !polymorphicMode && renameMode === 'random' && selectedProtections.length === 0) {
      setPreset('compatibility'); return;
    }
    if (!lowEntropy && !polymorphicMode && renameMode === 'random' && selectedProtections.length === 0) {
      setPreset('balanced'); return;
    }
    if (!lowEntropy && polymorphicMode && renameMode === 'random' && hasExactProtections(selectedProtections, POLYMORPHIC_PRESET_PROTECTIONS)) {
      setPreset('polymorphic');
    }
  }, [lowEntropy, polymorphicMode, renameMode, selectedProtections]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>

      <h1 className="page-title">Protect your binary</h1>
      <p className="page-subtitle">
        Upload a .NET assembly or native PE — we'll harden it with obfuscation and encryption.
      </p>

      {/* ── Error ── */}
      {(error || (status === 'failed' && jobError)) && (
        <Alert tone="danger" style={{ marginBottom: '1.25rem' }}>
          {error || jobError}
        </Alert>
      )}

      {/* ── Active job progress ── */}
      {isBusy && (
        <div className="dash-active-job" style={{ marginBottom: '1.25rem' }}>
          <div className="dash-active-job__phases">
            {ACTIVE_PHASES.map((phase, i) => {
              const currentIdx = ACTIVE_PHASES.indexOf(status as UIJobStatus);
              const phaseIdx = i;
              const isDone = phaseIdx < currentIdx;
              const isActive = phase === status;
              return (
                <Fragment key={phase}>
                  <div className={`dash-active-job__phase${isActive ? ' is-active' : ''}${isDone ? ' is-done' : ''}`}>
                    <span className="dash-active-job__phase-dot" />
                    {phase}
                  </div>
                  {i < ACTIVE_PHASES.length - 1 && (
                    <span className="dash-active-job__phase-sep">→</span>
                  )}
                </Fragment>
              );
            })}
          </div>
          <div className="dash-active-job__progress-label">
            <span>{PHASE_LABELS[status] ?? status}</span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} />
        </div>
      )}

      {/* ── Threat intel flags ── */}
      {intelFlags.length > 0 && (
        <Card style={{ marginBottom: '1.1rem', padding: '1rem 1.25rem' }}>
          <div className="dash-detail__section-title" style={{ marginBottom: '0.5rem' }}>
            Threat intel flags
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            {intelFlags.slice(0, 6).map((f) => (
              <div key={`${f.technique_key}-${f.state}`} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', flexWrap: 'wrap' }}>
                <strong style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                  {f.technique_key || 'unknown'}
                </strong>
                <span style={{ color: 'var(--text-muted)' }}>·</span>
                <span style={{ color: 'var(--text-muted)' }}>{f.severity}</span>
                <span style={{ color: 'var(--text-muted)' }}>·</span>
                <span style={{ color: 'var(--text-muted)' }}>
                  ratio {Number.isFinite(f.last_detected_ratio) ? (f.last_detected_ratio * 100).toFixed(0) : 0}%
                </span>
                <Badge tone={f.state === 'open' ? 'warning' : 'neutral'}>{f.state}</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Success banner ── */}
      {status === 'completed' && (
        <div className="dash-success-banner" style={{ marginBottom: '1.25rem' }}>
          <div>
            <div className="dash-success-banner__text">Protection complete</div>
            <div className="dash-success-banner__meta">
              Single-use download — file is deleted after you save it
            </div>
          </div>
          <Button onClick={handleDownload} variant="success" size="lg">
            Download protected binary
          </Button>
        </div>
      )}

      {/* ── Upload zone ── */}
      <div
        className={`dash-upload-zone${dragOver ? ' is-drag-over' : ''}${isBusy ? ' is-busy' : ''}${file ? ' has-file' : ''}`}
        onDragOver={(e) => { e.preventDefault(); if (!isBusy) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={isBusy ? undefined : handleDrop}
        onClick={() => { if (!isBusy) document.getElementById('file-upload')?.click(); }}
      >
        <input
          type="file"
          accept=".exe,.dll"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
          id="file-upload"
          disabled={isBusy}
        />
        {file ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.6rem' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
                stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div className="dash-upload-zone__file">{file.name}</div>
            <div className="dash-upload-zone__filesize">
              {(file.size / 1024 / 1024).toFixed(2)} MB · click to change
            </div>
          </>
        ) : (
          <>
            <div className="dash-upload-zone__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
                strokeLinecap="round" strokeLinejoin="round" style={{ width: '100%', height: '100%' }}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <div className="dash-upload-zone__title">
              {dragOver ? 'Drop to upload' : 'Drop your binary here'}
            </div>
            <div className="dash-upload-zone__subtitle">or click to browse</div>
            <div className="dash-upload-zone__chips">
              <span className="dash-upload-chip">.exe</span>
              <span className="dash-upload-chip">.dll</span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>max 100 MB</span>
            </div>
          </>
        )}
      </div>

      {/* ── Tier selection ── */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div className="dash-section-label">Protection tier</div>
        <div className="dash-tier-list">
          {TIERS.map((t) => (
            <label
              key={t.id}
              className={`dash-tier-card${selectedTier === t.id ? ' is-selected' : ''}${isBusy ? ' is-disabled' : ''}`}
              style={{ position: 'relative' }}
            >
              <input
                type="radio"
                name="tier"
                value={t.id}
                checked={selectedTier === t.id}
                onChange={() => setSelectedTier(t.id)}
                disabled={isBusy}
                style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
              />
              <span className={`dash-tier-radio${selectedTier === t.id ? ' is-selected' : ''}`} />
              <div className="dash-tier-copy">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.18rem' }}>
                  <span className="dash-tier-name">{t.name}</span>
                  {'badge' in t && t.badge && (
                    <span className="dash-tier-badge">{t.badge as string}</span>
                  )}
                </div>
                <div className="dash-tier-price">{t.price}</div>
                <div className="dash-tier-desc">{t.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* ── Preset ── */}
      <div style={{ marginBottom: '1.1rem' }}>
        <div className="dash-section-label">Preset profile</div>
        <Select
          value={preset}
          onChange={(e) => applyPreset(e.target.value as ProtectionPreset)}
          disabled={isBusy}
        >
          <option value="compatibility">Compatibility — low-entropy, maximum compat</option>
          <option value="balanced">Balanced — standard defaults</option>
          {supportsPolymorphicMode && (
            <option value="polymorphic">Polymorphic — high-variance IL templates</option>
          )}
        </Select>
      </div>

      {/* ── Toggle options ── */}
      {(supportsLowEntropy || supportsPolymorphicMode) && (
        <div className="dash-options-row">
          {supportsLowEntropy && (
            <label className={`dash-option-toggle${lowEntropy ? ' is-checked' : ''}${isBusy ? ' is-disabled' : ''}`}>
              <Checkbox
                checked={lowEntropy}
                onChange={(e) => setLowEntropy(e.target.checked)}
                disabled={isBusy}
              />
              <div className="dash-option-toggle__text">
                <div className="dash-option-toggle__title">Low entropy</div>
                <div className="dash-option-toggle__desc">
                  Deterministic encoding — fixed keys, reproducible output for testing
                </div>
              </div>
            </label>
          )}
          {supportsPolymorphicMode && (
            <label className={`dash-option-toggle${polymorphicMode ? ' is-checked' : ''}${isBusy || lowEntropy ? ' is-disabled' : ''}`}>
              <Checkbox
                checked={polymorphicMode}
                onChange={(e) => setPolymorphicMode(e.target.checked)}
                disabled={isBusy || lowEntropy}
              />
              <div className="dash-option-toggle__text">
                <div className="dash-option-toggle__title">Polymorphic mode</div>
                <div className="dash-option-toggle__desc">
                  Higher-variance IL templates per build
                  {lowEntropy && <span style={{ color: 'var(--warning)' }}> · disabled with low entropy</span>}
                </div>
              </div>
            </label>
          )}
        </div>
      )}

      {/* ── Rename mode ── */}
      {supportsRenameMode && (
        <div style={{ marginTop: '0.9rem' }}>
          <div className="dash-section-label">Name obfuscation mode</div>
          <Select
            value={renameMode}
            onChange={(e) => setRenameMode(e.target.value as 'random' | 'sequential' | 'unicode' | 'unprintable')}
            disabled={isBusy}
          >
            <option value="random">Random (default)</option>
            <option value="sequential">Sequential</option>
            <option value="unicode">Unicode</option>
            <option value="unprintable">Unprintable (unsafe)</option>
          </Select>
        </div>
      )}

      {/* ── Advanced techniques ── */}
      {supportsAdvancedTechniques && (
        <div className="dash-advanced-box">
          <div className="dash-advanced-box__title">Advanced .NET techniques</div>
          <div className="dash-advanced-box__desc">
            Opt-in per job. Aggressive modes may reduce compatibility.
          </div>
          <div className="dash-advanced-grid">
            {ADVANCED_TECHNIQUES.map((tech) => (
              <label key={tech.id} className="dash-advanced-item" style={{ opacity: isBusy ? 0.55 : 1 }}>
                <Checkbox
                  checked={selectedProtections.includes(tech.id)}
                  onChange={() => toggleProtection(tech.id)}
                  disabled={isBusy}
                />
                <span>
                  {tech.label}
                  {tech.note && (
                    <span style={{ color: 'var(--text-muted)' }}> · {tech.note}</span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* ── Action buttons ── */}
      <div className="dash-actions">
        <Button disabled={!file || isBusy} onClick={handleProtect} size="lg">
          {isBusy ? 'Processing…' : 'Protect & process'}
        </Button>
        {(status === 'completed' || status === 'failed') && (
          <Button onClick={handleReset} variant="ghost" size="lg">
            Start over
          </Button>
        )}
      </div>

      {/* ── Job history ── */}
      <div style={{ marginTop: '3rem' }}>
        <div className="dash-section-header">
          <h2 className="dash-section-title">Job history</h2>
          <div style={{ display: 'flex', gap: '0.45rem' }}>
            <Button
              onClick={() => { setJobsLoading(true); fetchJobs(); }}
              disabled={jobsLoading}
              variant="ghost"
              size="sm"
            >
              {jobsLoading ? 'Refreshing…' : 'Refresh'}
            </Button>
            <Button
              onClick={handleClearHistory}
              disabled={jobsLoading || displayJobs.length === 0}
              variant="ghost"
              size="sm"
            >
              Clear all
            </Button>
          </div>
        </div>

        {jobsLoading && jobs.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', padding: '1rem 0' }}>
            Loading…
          </div>
        ) : displayJobs.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', padding: '1rem 0' }}>
            No jobs yet. Upload a binary above to get started.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {displayJobs.map((j) => (
              <div
                key={j.job_id}
                className={`dash-job-row${j.status === 'failed' ? ' is-failed' : ''}${j.status === 'processing' ? ' is-processing' : ''}${j.status === 'queued' ? ' is-queued' : ''}${j.status === 'completed' ? ' is-completed' : ''}`}
                style={{ flexDirection: 'column', alignItems: 'stretch' }}
              >
                {/* ── Row header ── */}
                <div className="dash-job-row__main">
                  <div className="dash-job-row__file">
                    <span className="dash-job-row__filename">{fileNameFromKey(j.input_key)}</span>
                    <div className="dash-job-row__meta">
                      <Badge tone={jobStatusTone(j.status)}>{j.status}</Badge>
                      {j.tier && <Badge tone="neutral">{j.tier}</Badge>}
                      {j.binary_type && <Badge tone="accent">{j.binary_type}</Badge>}
                      {j.strength_score && (
                        <span className="dash-job-score">{j.strength_score.score}/100</span>
                      )}
                      {j.status === 'failed' && j.error && (
                        <span style={{ fontSize: '0.74rem', color: 'var(--error)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {j.error}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="dash-job-row__actions">
                    {j.status === 'completed' && j.output_key && (
                      <Button onClick={() => handleDownloadJob(j.job_id, j.input_key)} variant="success" size="sm">
                        Download
                      </Button>
                    )}
                    {j.status === 'completed' && !intelByJob[j.job_id]?.submitted && (
                      <Button
                        onClick={() => submitThreatIntel(j.job_id)}
                        disabled={intelSubmittingJobId === j.job_id}
                        variant="info"
                        size="sm"
                      >
                        {intelSubmittingJobId === j.job_id ? 'Scanning…' : 'Scan VT'}
                      </Button>
                    )}
                    {j.status === 'completed' && intelByJob[j.job_id]?.submitted && buildVirusTotalUrl(intelByJob[j.job_id]) && (
                      <Button
                        onClick={() => window.open(buildVirusTotalUrl(intelByJob[j.job_id]) as string, '_blank', 'noopener,noreferrer')}
                        variant="info"
                        size="sm"
                      >
                        Open VT
                      </Button>
                    )}
                    {j.status === 'failed' && (
                      <>
                        <Button
                          onClick={() => handleRetryJob(j)}
                          disabled={retryingId === j.job_id}
                          variant="warning"
                          size="sm"
                        >
                          {retryingId === j.job_id ? 'Retrying…' : 'Retry'}
                        </Button>
                        {j.retry_suggestions?.[0] && (
                          <Button
                            onClick={() => handleRetryJob(j, j.retry_suggestions?.[0])}
                            disabled={retryingId === j.job_id}
                            variant="primary"
                            size="sm"
                            title={j.retry_suggestions[0].reason}
                          >
                            Suggested fix
                          </Button>
                        )}
                      </>
                    )}
                    <Button
                      onClick={() => setExpandedJobId((prev) => prev === j.job_id ? null : j.job_id)}
                      variant="ghost"
                      size="sm"
                    >
                      {expandedJobId === j.job_id ? '▲ Collapse' : '▼ Details'}
                    </Button>
                    <Button onClick={() => handleDeleteJob(j.job_id)} variant="danger" size="sm">
                      Delete
                    </Button>
                  </div>
                </div>

                {/* ── Expandable detail panel ── */}
                <div className={`dash-job-details${expandedJobId === j.job_id ? ' is-open' : ''}`}>
                  <div>
                    <JobDetailPanel
                      job={j}
                      intelStatus={intelByJob[j.job_id]}
                      vtUrl={buildVirusTotalUrl(intelByJob[j.job_id])}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
