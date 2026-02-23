import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiErrorFromResponse } from '../lib/api';

const API = '/api/v1';
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

const TIERS = [
  {
    id: 'minimal',
    name: 'Minimal',
    price: 'Free',
    desc: 'Maximum compatibility. .NET: symbol stripping, metadata cleanup only (no name/string obfuscation).',
  },
  {
    id: 'basic',
    name: 'Basic',
    price: '$9',
    desc: '.NET: symbol stripping, string encryption (no name obfuscation). Native: AES+compression packing.',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$39',
    desc: '.NET: + control-flow flattening, constant encoding, dead code insertion. Native: + padding.',
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: '$149',
    desc: '.NET: same as Pro. Native: + extra XOR layer for stronger encryption.',
  },
];

const ADVANCED_TECHNIQUES: { id: string; label: string; note?: string }[] = [
  { id: 'resource_encryption', label: 'Resource encryption' },
  { id: 'reference_proxy', label: 'Reference proxying' },
  { id: 'delegate_proxy', label: 'Delegate proxying' },
  { id: 'reflection_dispatch', label: 'Reflection dispatch' },
  { id: 'type_scramble', label: 'Type scrambling' },
  { id: 'assembly_embed', label: 'Assembly embed + resolver' },
  { id: 'anti_decompiler', label: 'Anti-decompiler (conservative)' },
  { id: 'anti_decompiler_aggressive', label: 'Anti-decompiler (aggressive)', note: 'Higher breakage risk' },
  { id: 'invalid_metadata', label: 'Invalid/confusable metadata injection', note: 'Tooling-hostile mode' },
  { id: 'method_body_encryption', label: 'Method body encryption (first-call decrypt)' },
  { id: 'dynamic_method_generation', label: 'Dynamic method generation warmup' },
  { id: 'runtime_rasp', label: 'Runtime self-protection (anti-debug/sandbox + integrity)' },
  { id: 'local_var_promotion', label: 'Local variable promotion (heap-backed state bag)' },
  { id: 'il_mutation', label: 'IL mutation equivalents' },
];

type JobStatus = 'idle' | 'uploading' | 'queued' | 'processing' | 'completed' | 'failed';
type ProtectionPreset = 'compatibility' | 'balanced' | 'polymorphic';

const POLYMORPHIC_PRESET_PROTECTIONS = ['il_mutation'];
const PRO_OR_ENTERPRISE_TIERS = new Set(['pro', 'enterprise']);

type JobSummary = {
  job_id: string;
  status: string;
  progress: number;
  tier: string;
  binary_type?: string;
  low_entropy?: boolean;
  polymorphic_mode?: boolean;
  protections?: string[];
  input_key: string;
  output_key?: string;
  error?: string;
};

function fileNameFromKey(key: string): string {
  const parts = key.split('/');
  return parts[parts.length - 1] || key;
}

function hasExactProtections(actual: string[], expected: string[]): boolean {
  if (actual.length !== expected.length) return false;
  const set = new Set(actual);
  return expected.every((v) => set.has(v));
}

export default function Dashboard() {
  const { authFetch } = useAuth();
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [selectedTier, setSelectedTier] = useState('basic');
  const [preset, setPreset] = useState<ProtectionPreset>('balanced');
  const [lowEntropy, setLowEntropy] = useState(false);
  const [polymorphicMode, setPolymorphicMode] = useState(false);
  const [renameMode, setRenameMode] = useState<'random' | 'sequential' | 'unicode' | 'unprintable'>('random');
  const [selectedProtections, setSelectedProtections] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const supportsAdvancedTechniques = PRO_OR_ENTERPRISE_TIERS.has(selectedTier);
  const supportsPolymorphicMode = PRO_OR_ENTERPRISE_TIERS.has(selectedTier);
  const supportsRenameMode = selectedTier === 'enterprise';
  const supportsLowEntropy = selectedTier !== 'minimal';

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
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

  const buildProtectionPayload = useCallback(() => {
    const p = supportsAdvancedTechniques ? [...selectedProtections] : [];
    if (supportsRenameMode) {
      if (renameMode === 'sequential') p.push('rename_mode_sequential');
      else if (renameMode === 'unicode') p.push('rename_mode_unicode');
      else if (renameMode === 'unprintable') p.push('rename_mode_unprintable');
      else p.push('rename_mode_random');
    }
    return Array.from(new Set(p));
  }, [selectedProtections, renameMode, supportsAdvancedTechniques, supportsRenameMode]);

  // Merge current job into list if not present (handles API/Redis sync delay)
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
    }, 1500);
  }, [stopPolling, authFetch, fetchJobs]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f && (f.name.endsWith('.exe') || f.name.endsWith('.dll'))) {
      if (f.size > MAX_FILE_SIZE) {
        setError(`File too large (max ${MAX_FILE_SIZE / 1024 / 1024} MB)`);
        return;
      }
      setFile(f);
      setError(null);
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      if (f.size > MAX_FILE_SIZE) {
        setError(`File too large (max ${MAX_FILE_SIZE / 1024 / 1024} MB)`);
        setFile(null);
        return;
      }
      setFile(f);
      setError(null);
    }
  }, []);

  const toggleProtection = useCallback((id: string) => {
    setSelectedProtections((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id);
      return [...prev, id];
    });
  }, []);

  const applyPreset = useCallback((nextPreset: ProtectionPreset) => {
    if (nextPreset === 'polymorphic' && !supportsPolymorphicMode) {
      nextPreset = 'balanced';
    }
    setPreset(nextPreset);
    if (nextPreset === 'compatibility') {
      setLowEntropy(true);
      setPolymorphicMode(false);
      setRenameMode('random');
      setSelectedProtections([]);
      return;
    }
    if (nextPreset === 'balanced') {
      setLowEntropy(false);
      setPolymorphicMode(false);
      setRenameMode('random');
      setSelectedProtections([]);
      return;
    }
    setLowEntropy(false);
    setPolymorphicMode(true);
    setRenameMode('random');
    setSelectedProtections(POLYMORPHIC_PRESET_PROTECTIONS);
  }, [supportsPolymorphicMode]);

  const handleProtect = useCallback(async () => {
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      setError(`File too large (max ${MAX_FILE_SIZE / 1024 / 1024} MB)`);
      return;
    }
    setError(null);
    setStatus('uploading');

    try {
      const form = new FormData();
      form.append('file', file);

      const uploadRes = await authFetch(`${API}/upload`, {
        method: 'POST',
        body: form,
      });
      if (!uploadRes.ok) {
        const msg = await apiErrorFromResponse(uploadRes, 'Upload failed');
        throw new Error(msg);
      }
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
      if (!jobRes.ok) {
        const msg = await apiErrorFromResponse(jobRes, 'Failed to create job');
        throw new Error(msg);
      }
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
      if (!r.ok) {
        const msg = await apiErrorFromResponse(r, 'Download failed');
        throw new Error(msg);
      }
      const ct = r.headers.get('Content-Type') || '';
      if (ct.includes('application/json')) {
        const d = await r.json();
        if (d.download_url) {
          window.open(d.download_url, '_blank');
          fetchJobs();
          return;
        }
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `protected-${file?.name || 'output.dll'}`;
      a.click();
      URL.revokeObjectURL(url);
      fetchJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    }
  }, [jobId, file?.name, authFetch, fetchJobs]);

  const mergeRetryProtections = useCallback((jobProtections?: string[]) => {
    if (jobProtections && jobProtections.length > 0) return jobProtections;
    return buildProtectionPayload();
  }, [buildProtectionPayload]);

  const handleRetryJob = useCallback(async (j: JobSummary) => {
    if (j.status !== 'failed' || !j.input_key) return;
    setRetryingId(j.job_id);
    setError(null);
    try {
      const jobRes = await authFetch(`${API}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input_key: j.input_key,
          tier: j.tier || 'basic',
          binary_type: 'auto',
          low_entropy: j.low_entropy ?? lowEntropy,
          polymorphic_mode: j.polymorphic_mode ?? polymorphicMode,
          protections: mergeRetryProtections(j.protections),
        }),
      });
      if (!jobRes.ok) {
        const msg = await apiErrorFromResponse(jobRes, 'Retry failed');
        throw new Error(msg);
      }
      const jobData = await jobRes.json();
      setJobId(jobData.job_id);
      setSelectedTier(j.tier || 'basic');
      setStatus('queued');
      setProgress(0);
      setJobError(null);
      pollJob(jobData.job_id);
      fetchJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Retry failed');
    } finally {
      setRetryingId(null);
    }
  }, [authFetch, pollJob, fetchJobs, lowEntropy, polymorphicMode, mergeRetryProtections]);

  const handleReset = useCallback(() => {
    stopPolling();
    setFile(null);
    setJobId(null);
    setStatus('idle');
    setProgress(0);
    setError(null);
    setJobError(null);
  }, [stopPolling]);

  const handleDownloadJob = useCallback(async (id: string, inputKey: string) => {
    try {
      const r = await authFetch(`${API}/jobs/${id}/download`);
      if (!r.ok) {
        const msg = await apiErrorFromResponse(r, 'Download failed');
        throw new Error(msg);
      }
      const ct = r.headers.get('Content-Type') || '';
      if (ct.includes('application/json')) {
        const d = await r.json();
        if (d.download_url) {
          window.open(d.download_url, '_blank');
          fetchJobs();
          return;
        }
      }
      const blob = await r.blob();
      const ext = inputKey.match(/\.(exe|dll)$/i)?.[1] || 'dll';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `protected.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      fetchJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    }
  }, [authFetch, fetchJobs]);

  const handleDeleteJob = useCallback(async (id: string) => {
    try {
      const r = await authFetch(`${API}/jobs/${id}`, { method: 'DELETE' });
      if (!r.ok) {
        const msg = await apiErrorFromResponse(r, 'Delete failed');
        throw new Error(msg);
      }
      if (jobId === id) handleReset();
      fetchJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  }, [authFetch, fetchJobs, jobId, handleReset]);

  const handleClearHistory = useCallback(async () => {
    if (!window.confirm('Delete all job history? This cannot be undone.')) return;
    try {
      const r = await authFetch(`${API}/jobs`, { method: 'DELETE' });
      if (!r.ok) {
        const msg = await apiErrorFromResponse(r, 'Clear failed');
        throw new Error(msg);
      }
      handleReset();
      fetchJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Clear failed');
    }
  }, [authFetch, fetchJobs, handleReset]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  useEffect(() => {
    if (lowEntropy) setPolymorphicMode(false);
  }, [lowEntropy]);

  useEffect(() => {
    if (!supportsAdvancedTechniques && selectedProtections.length > 0) {
      setSelectedProtections([]);
    }
    if (!supportsRenameMode && renameMode !== 'random') {
      setRenameMode('random');
    }
    if (!supportsPolymorphicMode && polymorphicMode) {
      setPolymorphicMode(false);
    }
    if (!supportsLowEntropy && lowEntropy) {
      setLowEntropy(false);
    }
  }, [supportsAdvancedTechniques, supportsRenameMode, supportsPolymorphicMode, supportsLowEntropy, selectedProtections.length, renameMode, polymorphicMode, lowEntropy]);

  useEffect(() => {
    if (lowEntropy && !polymorphicMode && renameMode === 'random' && selectedProtections.length === 0) {
      setPreset('compatibility');
      return;
    }
    if (!lowEntropy && !polymorphicMode && renameMode === 'random' && selectedProtections.length === 0) {
      setPreset('balanced');
      return;
    }
    if (!lowEntropy && polymorphicMode && renameMode === 'random' && hasExactProtections(selectedProtections, POLYMORPHIC_PRESET_PROTECTIONS)) {
      setPreset('polymorphic');
    }
  }, [lowEntropy, polymorphicMode, renameMode, selectedProtections]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
        Protect your binary
      </h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>
        Upload a .NET assembly or native PE — we'll harden it with obfuscation and encryption.
      </p>

      {(error || (status === 'failed' && jobError)) && (
        <div
          role="alert"
          style={{
            padding: '0.75rem 1rem',
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid var(--error)',
            borderRadius: 8,
            marginBottom: '1.5rem',
            color: 'var(--error)',
          }}
        >
          {error || jobError}
        </div>
      )}

      {status !== 'idle' && status !== 'completed' && (
        <div
          style={{
            padding: '1rem',
            background: 'var(--bg-muted)',
            borderRadius: 8,
            marginBottom: '1.5rem',
          }}
        >
          <div style={{ marginBottom: '0.5rem', fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }}>
            {status} — {progress}%
          </div>
          <div
            style={{
              height: 4,
              background: 'var(--border)',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${progress}%`,
                background: 'var(--accent)',
                transition: 'width 0.3s',
              }}
            />
          </div>
        </div>
      )}

      {status === 'completed' && (
        <div
          style={{
            padding: '1rem',
            background: 'rgba(34, 197, 94, 0.1)',
            border: '1px solid var(--success)',
            borderRadius: 8,
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
          }}
        >
          <span style={{ color: 'var(--success)' }}>Protection complete</span>
          <button
            onClick={handleDownload}
            style={{
              padding: '0.5rem 1rem',
              background: 'var(--success)',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Download
          </button>
        </div>
      )}

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        style={{
          border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 8,
          padding: '2rem',
          textAlign: 'center',
          background: dragOver ? 'rgba(59, 130, 246, 0.08)' : 'var(--bg-muted)',
          cursor: status === 'uploading' || status === 'queued' || status === 'processing' ? 'wait' : 'pointer',
          marginBottom: '2rem',
          opacity: status === 'uploading' || status === 'queued' || status === 'processing' ? 0.7 : 1,
        }}
      >
        <input
          type="file"
          accept=".exe,.dll"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
          id="file-upload"
          disabled={status === 'uploading' || status === 'queued' || status === 'processing'}
        />
        <label htmlFor="file-upload" style={{ cursor: status === 'uploading' || status === 'queued' || status === 'processing' ? 'wait' : 'pointer', display: 'block' }}>
          {file ? (
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--success)' }}>
              {file.name} ({(file.size / 1024).toFixed(1)} KB)
            </span>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>
              Drop your .exe or .dll here, or click to browse
            </span>
          )}
        </label>
      </div>

      <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Protection tier</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {TIERS.map((t) => (
          <label
            key={t.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              padding: '1rem',
              border: `1px solid ${selectedTier === t.id ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 8,
              cursor: 'pointer',
              background: selectedTier === t.id ? 'rgba(59, 130, 246, 0.1)' : 'var(--bg-elevated)',
              opacity: status === 'uploading' || status === 'queued' || status === 'processing' ? 0.6 : 1,
            }}
          >
            <input
              type="radio"
              name="tier"
              value={t.id}
              checked={selectedTier === t.id}
              onChange={() => setSelectedTier(t.id)}
              disabled={status === 'uploading' || status === 'queued' || status === 'processing'}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{t.name} — {t.price}</div>
              <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{t.desc}</div>
            </div>
          </label>
        ))}
      </div>

      <div style={{ marginTop: '1rem' }}>
        <label
          style={{
            display: 'block',
            marginBottom: '0.5rem',
            fontSize: '0.875rem',
            color: 'var(--text-muted)',
          }}
        >
          Preset profile
        </label>
        <select
          value={preset}
          onChange={(e) => applyPreset(e.target.value as ProtectionPreset)}
          disabled={status === 'uploading' || status === 'queued' || status === 'processing'}
          style={{
            width: '100%',
            padding: '0.55rem 0.7rem',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--bg-elevated)',
            color: 'var(--text)',
            marginBottom: '0.55rem',
          }}
        >
          <option value="compatibility">Compatibility</option>
          <option value="balanced">Balanced</option>
          {supportsPolymorphicMode && <option value="polymorphic">Polymorphic</option>}
        </select>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Compatibility = low-entropy safe defaults, Balanced = general defaults, Polymorphic = high-variance templates.
        </div>
      </div>

      {supportsLowEntropy && (
      <div style={{ marginTop: '1rem' }}>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            padding: '0.75rem 1rem',
            border: '1px solid var(--border)',
            borderRadius: 8,
            cursor: 'pointer',
            background: 'var(--bg-elevated)',
            opacity: status === 'uploading' || status === 'queued' || status === 'processing' ? 0.6 : 1,
          }}
        >
          <input
            type="checkbox"
            checked={lowEntropy}
            onChange={(e) => setLowEntropy(e.target.checked)}
            disabled={status === 'uploading' || status === 'queued' || status === 'processing'}
          />
          <span>
            <strong>Low entropy</strong> — Deterministic encoding (fixed keys, reproducible output for testing)
          </span>
        </label>
      </div>
      )}

      {supportsPolymorphicMode && (
      <div style={{ marginTop: '0.75rem' }}>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            padding: '0.75rem 1rem',
            border: '1px solid var(--border)',
            borderRadius: 8,
            cursor: 'pointer',
            background: 'var(--bg-elevated)',
            opacity: status === 'uploading' || status === 'queued' || status === 'processing' ? 0.6 : 1,
          }}
        >
          <input
            type="checkbox"
            checked={polymorphicMode}
            onChange={(e) => setPolymorphicMode(e.target.checked)}
            disabled={status === 'uploading' || status === 'queued' || status === 'processing' || lowEntropy}
          />
          <span>
            <strong>Polymorphic mode</strong> — Higher-variance IL templates per build
            {lowEntropy && <span style={{ color: 'var(--text-muted)' }}> (disabled while Low entropy is on)</span>}
          </span>
        </label>
      </div>
      )}

      {supportsRenameMode && (
      <div style={{ marginTop: '1rem' }}>
        <label
          style={{
            display: 'block',
            marginBottom: '0.5rem',
            fontSize: '0.875rem',
            color: 'var(--text-muted)',
          }}
        >
          Name obfuscation mode
        </label>
        <select
          value={renameMode}
          onChange={(e) => setRenameMode(e.target.value as 'random' | 'sequential' | 'unicode' | 'unprintable')}
          disabled={status === 'uploading' || status === 'queued' || status === 'processing'}
          style={{
            width: '100%',
            padding: '0.55rem 0.7rem',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--bg-elevated)',
            color: 'var(--text)',
          }}
        >
          <option value="random">Random (default)</option>
          <option value="sequential">Sequential</option>
          <option value="unicode">Unicode</option>
          <option value="unprintable">Unprintable (unsafe)</option>
        </select>
      </div>
      )}

      {supportsAdvancedTechniques && (
      <div style={{ marginTop: '1rem', border: '1px solid var(--border)', borderRadius: 8, padding: '0.9rem', background: 'var(--bg-elevated)' }}>
        <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Advanced .NET techniques (opt-in)</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.65rem' }}>
          Selected options are applied per job. Aggressive modes can reduce compatibility.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.45rem 0.8rem' }}>
          {ADVANCED_TECHNIQUES.map((tech) => (
            <label key={tech.id} style={{ display: 'flex', gap: '0.55rem', alignItems: 'flex-start', opacity: status === 'uploading' || status === 'queued' || status === 'processing' ? 0.6 : 1 }}>
              <input
                type="checkbox"
                checked={selectedProtections.includes(tech.id)}
                onChange={() => toggleProtection(tech.id)}
                disabled={status === 'uploading' || status === 'queued' || status === 'processing'}
              />
              <span style={{ fontSize: '0.84rem' }}>
                {tech.label}
                {tech.note && <span style={{ color: 'var(--text-muted)' }}> - {tech.note}</span>}
              </span>
            </label>
          ))}
        </div>
      </div>
      )}

      <div style={{ marginTop: '2rem', display: 'flex', gap: '0.75rem' }}>
        <button
          disabled={!file || status === 'uploading' || status === 'queued' || status === 'processing'}
          onClick={handleProtect}
          style={{
            padding: '0.75rem 1.5rem',
            background: file && status !== 'uploading' && status !== 'queued' && status !== 'processing' ? 'var(--accent)' : 'var(--bg-muted)',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            fontFamily: 'var(--font-sans)',
            fontWeight: 600,
            cursor: file && status !== 'uploading' && status !== 'queued' && status !== 'processing' ? 'pointer' : 'not-allowed',
          }}
        >
          {status === 'uploading' || status === 'queued' || status === 'processing'
            ? 'Processing...'
            : 'Protect & process'}
        </button>
        {(status === 'completed' || status === 'failed') && (
          <button
            onClick={handleReset}
            style={{
              padding: '0.75rem 1.5rem',
              background: 'var(--bg-muted)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontFamily: 'var(--font-sans)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Start over
          </button>
        )}
      </div>

      <h2 style={{ fontSize: '1rem', marginTop: '2.5rem', marginBottom: '0.75rem' }}>Recent jobs</h2>
      {jobsLoading && jobs.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading...</div>
      ) : displayJobs.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No jobs yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <button
              onClick={handleClearHistory}
              disabled={jobsLoading || displayJobs.length === 0}
              style={{
                padding: '0.35rem 0.6rem',
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: 'var(--text-muted)',
                fontSize: '0.75rem',
                cursor: jobsLoading || displayJobs.length === 0 ? 'not-allowed' : 'pointer',
                opacity: jobsLoading || displayJobs.length === 0 ? 0.6 : 1,
              }}
            >
              Clear history
            </button>
            <button
              onClick={() => { setJobsLoading(true); fetchJobs(); }}
              disabled={jobsLoading}
              style={{
                padding: '0.35rem 0.6rem',
                background: 'var(--bg-muted)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: 'var(--text-muted)',
                fontSize: '0.75rem',
                cursor: jobsLoading ? 'wait' : 'pointer',
                opacity: jobsLoading ? 0.7 : 1,
              }}
            >
              {jobsLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
          {displayJobs.map((j) => (
            <div
              key={j.job_id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '1rem',
                padding: '0.75rem 1rem',
                background: 'var(--bg-muted)',
                borderRadius: 8,
                border: '1px solid var(--border)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {fileNameFromKey(j.input_key)}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {j.tier}
                  {j.binary_type && (
                    <span style={{
                      marginLeft: '0.35rem',
                      padding: '0.1rem 0.35rem',
                      background: j.binary_type === 'dotnet' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(34, 197, 94, 0.2)',
                      borderRadius: 4,
                      fontSize: '0.65rem',
                    }}>
                      {j.binary_type}
                    </span>
                  )}{' '}
                  · {j.status}
                  {j.polymorphic_mode && ' · polymorphic'}
                  {j.protections && j.protections.length > 0 && ` · ${j.protections.length} opt-ins`}
                  {j.error && ` · ${j.error}`}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button
                  onClick={() => handleDeleteJob(j.job_id)}
                  style={{
                    padding: '0.4rem 0.75rem',
                    background: 'transparent',
                    color: 'var(--text-muted)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    fontSize: '0.875rem',
                    cursor: 'pointer',
                  }}
                  title="Delete job"
                >
                  Delete
                </button>
                {j.status === 'completed' && j.output_key && (
                  <button
                    onClick={() => handleDownloadJob(j.job_id, j.input_key)}
                    style={{
                      padding: '0.4rem 0.75rem',
                      background: 'var(--accent)',
                      color: 'white',
                      border: 'none',
                      borderRadius: 6,
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Download
                  </button>
                )}
                {j.status === 'failed' && (
                  <button
                    onClick={() => handleRetryJob(j)}
                    disabled={retryingId === j.job_id}
                    style={{
                      padding: '0.4rem 0.75rem',
                      background: 'var(--bg-muted)',
                      color: 'var(--text)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      cursor: retryingId === j.job_id ? 'wait' : 'pointer',
                    }}
                  >
                    {retryingId === j.job_id ? 'Retrying...' : 'Retry'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
