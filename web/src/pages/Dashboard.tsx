import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiErrorFromResponse } from '../lib/api';
import { Alert, Badge, Button, Card, Panel, Progress, Select } from '../design-system';
import { loadUserSettings, type ProtectionPreset } from '../lib/userSettings';

const API = '/api/v1';
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

const TIERS = [
  {
    id: 'minimal',
    name: 'Minimal',
    price: 'Free (Beta)',
    desc: 'Maximum compatibility. .NET: symbol stripping, metadata cleanup only (no name/string obfuscation).',
  },
  {
    id: 'basic',
    name: 'Basic',
    price: 'Free (Beta)',
    desc: '.NET: symbol stripping, string encryption (no name obfuscation). Native: AES+compression packing.',
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
    desc: '.NET: same as Pro. Native: + extra XOR layer for stronger encryption.',
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
  { id: 'invalid_metadata', label: 'Invalid/confusable metadata injection', note: 'Tooling-hostile mode' },
  { id: 'method_body_encryption', label: 'Method body encryption (first-call decrypt)' },
  { id: 'dynamic_method_generation', label: 'Dynamic method generation warmup' },
  { id: 'runtime_rasp', label: 'Runtime self-protection (anti-debug/sandbox + integrity)' },
  { id: 'local_var_promotion', label: 'Local variable promotion (heap-backed state bag)' },
  { id: 'il_mutation', label: 'IL mutation equivalents' },
];

type JobStatus = 'idle' | 'uploading' | 'queued' | 'processing' | 'completed' | 'failed';
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
  pass_metrics?: PassMetric[];
  size_impact?: SizeImpact;
  compatibility_report?: CompatibilityReport;
  strength_score?: StrengthScore;
  retry_suggestions?: RetrySuggestion[];
  input_key: string;
  output_key?: string;
  error?: string;
};

type PassMetric = {
  name: string;
  duration_ms: number;
  success: boolean;
  error?: string;
  size_delta_bytes?: number;
};

type SizeImpact = {
  input_bytes: number;
  output_bytes: number;
  pass_deltas?: Record<string, number>;
};

type CompatibilityReport = {
  status: string;
  mode?: string;
  exit_code?: number;
  timed_out?: boolean;
  stdout_snippet?: string;
  stderr_snippet?: string;
  notes?: string;
};

type StrengthScore = {
  score: number;
  band: string;
  time_estimate?: string;
};

type RetrySuggestion = {
  label: string;
  reason?: string;
  tier?: string;
  low_entropy?: boolean;
  polymorphic_mode?: boolean;
  protections?: string[];
};

type ThreatIntelStatus = {
  enabled?: boolean;
  submitted?: boolean;
  job_id?: string;
  sample_hash?: string;
  provider?: string;
  provider_submission?: string;
  status?: string;
  analysis_status?: string;
  detected_count?: number;
  engine_count?: number;
  verdict_ratio?: number;
  last_error?: string;
};

type TechniqueFlag = {
  technique_key: string;
  severity: string;
  reason: string;
  state: string;
  last_detected_ratio: number;
  last_sample_count: number;
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
    case 'completed':
      return 'success';
    case 'failed':
      return 'danger';
    case 'processing':
      return 'accent';
    case 'queued':
      return 'warning';
    default:
      return 'neutral';
  }
}

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
  const [status, setStatus] = useState<JobStatus>('idle');
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

  const fetchThreatIntelFlags = useCallback(async () => {
    try {
      const r = await authFetch(`${API}/threat-intel/flags`);
      if (!r.ok) return;
      const d = await r.json();
      setIntelFlags(Array.isArray(d.flags) ? d.flags : []);
    } catch {
      setIntelFlags([]);
    }
  }, [authFetch]);

  const fetchThreatIntelStatus = useCallback(async (jobIdValue: string) => {
    try {
      const r = await authFetch(`${API}/jobs/${jobIdValue}/threat-intel`);
      if (!r.ok) return;
      const d = await r.json();
      setIntelByJob((prev) => ({ ...prev, [jobIdValue]: d }));
    } catch {
      // ignore
    }
  }, [authFetch]);

  const submitThreatIntel = useCallback(async (jobIdValue: string) => {
    setIntelSubmittingJobId(jobIdValue);
    try {
      const r = await authFetch(`${API}/jobs/${jobIdValue}/threat-intel/submit`, { method: 'POST' });
      if (!r.ok) {
        const msg = await apiErrorFromResponse(r, 'Threat-intel submission failed');
        setError(msg);
        return;
      }
      const d = await r.json();
      setIntelByJob((prev) => ({ ...prev, [jobIdValue]: d }));
      fetchThreatIntelFlags();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Threat-intel submission failed');
    } finally {
      setIntelSubmittingJobId(null);
    }
  }, [authFetch, fetchThreatIntelFlags]);

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
    }, readPollIntervalSetting());
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

  useEffect(() => {
    if (initialPresetAppliedRef.current) return;
    initialPresetAppliedRef.current = true;
    applyPreset(readDefaultPresetSetting());
  }, [applyPreset]);

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

  const handleRetryJob = useCallback(async (j: JobSummary, suggestion?: RetrySuggestion) => {
    if (j.status !== 'failed' || !j.input_key) return;
    setRetryingId(j.job_id);
    setError(null);
    try {
      const nextTier = suggestion?.tier || j.tier || 'basic';
      const nextLowEntropy = suggestion?.low_entropy ?? j.low_entropy ?? lowEntropy;
      const nextPolymorphic = suggestion?.polymorphic_mode ?? j.polymorphic_mode ?? polymorphicMode;
      const nextProtections = suggestion?.protections && suggestion.protections.length > 0
        ? suggestion.protections
        : mergeRetryProtections(j.protections);
      const jobRes = await authFetch(`${API}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input_key: j.input_key,
          tier: nextTier,
          binary_type: 'auto',
          low_entropy: nextLowEntropy,
          polymorphic_mode: nextPolymorphic,
          protections: nextProtections,
        }),
      });
      if (!jobRes.ok) {
        const msg = await apiErrorFromResponse(jobRes, 'Retry failed');
        throw new Error(msg);
      }
      const jobData = await jobRes.json();
      setJobId(jobData.job_id);
      setSelectedTier(nextTier);
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
    fetchThreatIntelFlags();
  }, [fetchJobs]);

  useEffect(() => {
    const completedJobs = displayJobs.filter((j) => j.status === 'completed' || j.status === 'failed');
    completedJobs.slice(0, 12).forEach((j) => {
      if (!intelByJob[j.job_id]) {
        fetchThreatIntelStatus(j.job_id);
      }
    });
  }, [displayJobs, intelByJob, fetchThreatIntelStatus]);

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
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <h1 className="page-title">
        Protect your binary
      </h1>
      <p className="page-subtitle">
        Upload a .NET assembly or native PE — we'll harden it with obfuscation and encryption.
      </p>

      {(error || (status === 'failed' && jobError)) && (
        <Alert tone="danger" style={{ marginBottom: '1.5rem' }}>
          {error || jobError}
        </Alert>
      )}

      {status !== 'idle' && status !== 'completed' && (
        <Panel style={{ marginBottom: '1.5rem' }}>
          <div style={{ marginBottom: '0.5rem', fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }}>
            {status} — {progress}%
          </div>
          <Progress value={progress} />
        </Panel>
      )}

      {intelFlags.length > 0 && (
        <Card style={{ marginBottom: '1rem' }}>
          <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Threat Intel Flags</div>
          <div style={{ display: 'grid', gap: '0.35rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            {intelFlags.slice(0, 6).map((f) => (
              <div key={`${f.technique_key}-${f.state}`}>
                <strong>{f.technique_key || 'unknown-technique'}</strong> · {f.severity || 'unknown'} · ratio {Number.isFinite(f.last_detected_ratio) ? (f.last_detected_ratio * 100).toFixed(0) : '0'}% · n={Number.isFinite(f.last_sample_count) ? f.last_sample_count : 0} · <Badge tone={f.state === 'open' ? 'warning' : 'neutral'}>{f.state || 'unknown'}</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {status === 'completed' && (
        <Panel tone="success" style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
          <span style={{ color: 'var(--success)' }}>Protection complete</span>
          <Button
            onClick={handleDownload}
            variant="success"
          >
            Download
          </Button>
        </Panel>
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
      <div className="dash-tier-list">
        {TIERS.map((t) => (
          <label
            key={t.id}
            className={`dash-tier-card${selectedTier === t.id ? ' is-selected' : ''}${isBusy ? ' is-disabled' : ''}`}
          >
            <input
              type="radio"
              name="tier"
              value={t.id}
              checked={selectedTier === t.id}
              onChange={() => setSelectedTier(t.id)}
              disabled={isBusy}
            />
            <div className="dash-tier-copy">
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
        <Select
          value={preset}
          onChange={(e) => applyPreset(e.target.value as ProtectionPreset)}
          disabled={isBusy}
          style={{ marginBottom: '0.55rem' }}
        >
          <option value="compatibility">Compatibility</option>
          <option value="balanced">Balanced</option>
          {supportsPolymorphicMode && <option value="polymorphic">Polymorphic</option>}
        </Select>
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
            disabled={isBusy}
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
            disabled={isBusy || lowEntropy}
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
          disabled={isBusy}
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
                disabled={isBusy}
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
        <Button disabled={!file || isBusy} onClick={handleProtect} size="lg">
          {isBusy ? 'Processing...' : 'Protect & process'}
        </Button>
        {(status === 'completed' || status === 'failed') && (
          <Button onClick={handleReset} variant="ghost" size="lg">
            Start over
          </Button>
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
            <Button
              onClick={handleClearHistory}
              disabled={jobsLoading || displayJobs.length === 0}
              variant="ghost"
              size="sm"
            >
              Clear history
            </Button>
            <Button
              onClick={() => { setJobsLoading(true); fetchJobs(); }}
              disabled={jobsLoading}
              variant="ghost"
              size="sm"
            >
              {jobsLoading ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
          {displayJobs.map((j) => (
            <div
              key={j.job_id}
              className={`dash-job-row${j.status === 'failed' ? ' is-failed' : ''}${j.status === 'processing' ? ' is-processing' : ''}${j.status === 'queued' ? ' is-queued' : ''}${j.status === 'completed' ? ' is-completed' : ''}`}
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
                  <span className="dash-job-status"><Badge tone={jobStatusTone(j.status)}>{j.status}</Badge></span>
                  {j.polymorphic_mode && ' · polymorphic'}
                  {j.protections && j.protections.length > 0 && ` · ${j.protections.length} opt-ins`}
                  {j.error && ` · ${j.error}`}
                </div>
                <div className={`dash-job-details${expandedJobId === j.job_id ? ' is-open' : ''}`}>
                    <div>
                      Job: <strong>{j.job_id}</strong>
                    </div>
                    <div>
                      Status: <strong>{j.status}</strong>
                      {typeof j.progress === 'number' && ` · ${j.progress}%`}
                    </div>
                    <div>
                      Opt-ins used:{' '}
                      {j.protections && j.protections.length > 0 ? (
                        <span style={{ display: 'inline-flex', gap: '0.35rem', flexWrap: 'wrap', verticalAlign: 'middle' }}>
                          {j.protections.map((p) => (
                            <Badge key={`${j.job_id}-${p}`} tone="accent">{p}</Badge>
                          ))}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>none</span>
                      )}
                    </div>
                    {j.strength_score && (
                      <div>
                        Strength: <strong>{j.strength_score.score}/100 ({j.strength_score.band})</strong>
                        {j.strength_score.time_estimate && ` · ${j.strength_score.time_estimate}`}
                      </div>
                    )}
                    {j.compatibility_report && (
                      <div>
                        Compatibility: <strong>{j.compatibility_report.status}</strong>
                        {j.compatibility_report.mode && ` (${j.compatibility_report.mode})`}
                        {typeof j.compatibility_report.exit_code === 'number' && ` · exit ${j.compatibility_report.exit_code}`}
                        {j.compatibility_report.timed_out && ' · timeout'}
                      </div>
                    )}
                    {j.size_impact && (
                      <div>
                        Size impact: in {j.size_impact.input_bytes || 0} bytes → out {j.size_impact.output_bytes || 0} bytes
                      </div>
                    )}
                    {j.pass_metrics && j.pass_metrics.length > 0 && (
                      <div style={{ marginTop: '0.3rem' }}>
                        Passes: {j.pass_metrics.slice(0, 6).map((m) => `${m.name} ${m.duration_ms}ms${m.success ? '' : ' (fail)'}`).join(' · ')}
                      </div>
                    )}
                    {j.compatibility_report?.notes && (
                      <div style={{ marginTop: '0.3rem' }}>{j.compatibility_report.notes}</div>
                    )}
                    {intelByJob[j.job_id]?.submitted && (
                      <div style={{ marginTop: '0.3rem' }}>
                        Threat intel: <strong>{intelByJob[j.job_id]?.status || intelByJob[j.job_id]?.analysis_status || 'pending'}</strong>
                        {typeof intelByJob[j.job_id]?.detected_count === 'number' && ` · detected ${intelByJob[j.job_id]?.detected_count}/${intelByJob[j.job_id]?.engine_count ?? 0}`}
                        {intelByJob[j.job_id]?.sample_hash && ` · sha256 ${intelByJob[j.job_id]?.sample_hash?.slice(0, 12)}...`}
                        {buildVirusTotalUrl(intelByJob[j.job_id]) && (
                          <>
                            {' '}·{' '}
                            <a
                              href={buildVirusTotalUrl(intelByJob[j.job_id]) as string}
                              target="_blank"
                              rel="noreferrer"
                              style={{ color: 'var(--accent)' }}
                              title="Open VirusTotal result"
                            >
                              Open VT
                            </a>
                          </>
                        )}
                      </div>
                    )}
                    {!j.strength_score && !j.compatibility_report && !j.size_impact && (!j.pass_metrics || j.pass_metrics.length === 0) && (
                      <div style={{ marginTop: '0.3rem' }}>
                        No observability details are available for this job yet. New jobs will include pass metrics, compatibility, and strength score.
                      </div>
                    )}
                  </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <Button
                  onClick={() => setExpandedJobId((prev) => prev === j.job_id ? null : j.job_id)}
                  variant="ghost"
                  size="sm"
                  title="Toggle details"
                >
                  {expandedJobId === j.job_id ? 'Hide details' : 'Details'}
                </Button>
                <Button
                  onClick={() => handleDeleteJob(j.job_id)}
                  variant="danger"
                  size="sm"
                  title="Delete job"
                >
                  Delete
                </Button>
                {j.status === 'completed' && j.output_key && (
                  <Button
                    onClick={() => handleDownloadJob(j.job_id, j.input_key)}
                    variant="success"
                    size="sm"
                  >
                    Download
                  </Button>
                )}
                {j.status === 'completed' && (
                  <Button
                    onClick={() => submitThreatIntel(j.job_id)}
                    disabled={intelSubmittingJobId === j.job_id || intelByJob[j.job_id]?.submitted}
                    variant="info"
                    size="sm"
                    title="Manual opt-in threat intelligence submission"
                  >
                    {intelByJob[j.job_id]?.submitted ? 'Intel submitted' : intelSubmittingJobId === j.job_id ? 'Submitting…' : 'Submit to Threat Intel'}
                  </Button>
                )}
                {j.status === 'completed' && intelByJob[j.job_id]?.submitted && buildVirusTotalUrl(intelByJob[j.job_id]) && (
                  <Button
                    onClick={() => window.open(buildVirusTotalUrl(intelByJob[j.job_id]) as string, '_blank', 'noopener,noreferrer')}
                    variant="info"
                    size="sm"
                    title="Open VirusTotal result page"
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
                      {retryingId === j.job_id ? 'Retrying...' : 'Retry'}
                    </Button>
                    {j.retry_suggestions && j.retry_suggestions.length > 0 && (
                      <Button
                        onClick={() => handleRetryJob(j, j.retry_suggestions?.[0])}
                        disabled={retryingId === j.job_id}
                        variant="primary"
                        size="sm"
                        title={j.retry_suggestions?.[0]?.reason || 'Retry with suggested fix'}
                      >
                        Suggested retry
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
