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

type JobStatus = 'idle' | 'uploading' | 'queued' | 'processing' | 'completed' | 'failed';

type JobSummary = {
  job_id: string;
  status: string;
  progress: number;
  tier: string;
  binary_type?: string;
  input_key: string;
  output_key?: string;
  error?: string;
};

function fileNameFromKey(key: string): string {
  const parts = key.split('/');
  return parts[parts.length - 1] || key;
}

export default function Dashboard() {
  const { authFetch } = useAuth();
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [selectedTier, setSelectedTier] = useState('basic');
  const [lowEntropy, setLowEntropy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      input_key: file ? `inputs/.../${file.name}` : '',
      output_key: status === 'completed' ? 'out' : undefined,
      error: jobError || undefined,
    };
    return [current, ...jobs];
  }, [jobs, jobId, status, progress, selectedTier, file?.name, jobError]);

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
          low_entropy: lowEntropy,
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
  }, [file, selectedTier, lowEntropy, pollJob, authFetch, fetchJobs]);

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
          low_entropy: lowEntropy,
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
  }, [authFetch, pollJob, fetchJobs, lowEntropy]);

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
