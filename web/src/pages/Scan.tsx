import { useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiErrorFromResponse } from '../lib/api';

const API = '/api/v1';
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

type ScanResult = {
  path: string;
  size: number;
  valid_pe: boolean;
  is_dotnet: boolean;
  machine?: string;
  protected: boolean;
  protection_format?: string;
  protection_tier?: string;
  payload_size?: number;
  embedding?: string;
  error?: string;
};

export default function Scan() {
  const { authFetch } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && (f.name.endsWith('.exe') || f.name.endsWith('.dll'))) {
      if (f.size > MAX_FILE_SIZE) {
        setError(`File too large (max ${MAX_FILE_SIZE / 1024 / 1024} MB)`);
        return;
      }
      setFile(f);
      setResult(null);
      setError(null);
    } else {
      setError('Only .exe and .dll files are supported');
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
      setResult(null);
      setError(null);
    }
  }, []);

  const handleScan = useCallback(async () => {
    if (!file) return;
    setError(null);
    setScanning(true);
    try {
      const form = new FormData();
      form.append('file', file);

      const r = await authFetch(`${API}/scan`, {
        method: 'POST',
        body: form,
      });
      if (!r.ok) {
        const msg = await apiErrorFromResponse(r, 'Scan failed');
        throw new Error(msg);
      }
      const data = await r.json();
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed');
      setResult(null);
    } finally {
      setScanning(false);
    }
  }, [file, authFetch]);

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
        Scan executable
      </h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>
        Upload a .exe or .dll to detect PE type, architecture, and BinaryProtect protection.
      </p>

      {error && (
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
          {error}
        </div>
      )}

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        style={{
          border: '2px dashed var(--border)',
          borderRadius: 8,
          padding: '2rem',
          textAlign: 'center',
          background: 'var(--bg-muted)',
          cursor: scanning ? 'wait' : 'pointer',
          marginBottom: '2rem',
        }}
      >
        <input
          type="file"
          accept=".exe,.dll"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
          id="scan-file-upload"
          disabled={scanning}
        />
        <label
          htmlFor="scan-file-upload"
          style={{
            cursor: scanning ? 'wait' : 'pointer',
            display: 'block',
          }}
        >
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

      <button
        disabled={!file || scanning}
        onClick={handleScan}
        style={{
          padding: '0.75rem 1.5rem',
          background: file && !scanning ? 'var(--accent)' : 'var(--bg-muted)',
          color: 'white',
          border: 'none',
          borderRadius: 8,
          fontFamily: 'var(--font-sans)',
          fontWeight: 600,
          cursor: file && !scanning ? 'pointer' : 'not-allowed',
        }}
      >
        {scanning ? 'Scanning...' : 'Scan'}
      </button>

      {result && (
        <div
          style={{
            marginTop: '2rem',
            padding: '1.25rem',
            background: 'var(--bg-muted)',
            borderRadius: 8,
            border: '1px solid var(--border)',
          }}
        >
          <h2 style={{ fontSize: '1rem', marginBottom: '1rem' }}>Scan result</h2>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }}>
            {result.error ? (
              <div style={{ color: 'var(--error)' }}>Error: {result.error}</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr>
                    <td style={{ padding: '0.35rem 0.5rem 0.35rem 0', color: 'var(--text-muted)' }}>
                      File
                    </td>
                    <td style={{ padding: '0.35rem 0' }}>{result.path}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '0.35rem 0.5rem 0.35rem 0', color: 'var(--text-muted)' }}>
                      Size
                    </td>
                    <td style={{ padding: '0.35rem 0' }}>
                      {result.size.toLocaleString()} bytes
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '0.35rem 0.5rem 0.35rem 0', color: 'var(--text-muted)' }}>
                      Valid PE
                    </td>
                    <td style={{ padding: '0.35rem 0' }}>
                      {result.valid_pe ? (
                        <span style={{ color: 'var(--success)' }}>Yes</span>
                      ) : (
                        <span style={{ color: 'var(--error)' }}>No</span>
                      )}
                    </td>
                  </tr>
                  {result.valid_pe && (
                    <>
                      <tr>
                        <td style={{ padding: '0.35rem 0.5rem 0.35rem 0', color: 'var(--text-muted)' }}>
                          .NET
                        </td>
                        <td style={{ padding: '0.35rem 0' }}>
                          {result.is_dotnet ? (
                            <span style={{ color: 'var(--accent)' }}>Yes</span>
                          ) : (
                            'No'
                          )}
                        </td>
                      </tr>
                      {result.machine && (
                        <tr>
                          <td style={{ padding: '0.35rem 0.5rem 0.35rem 0', color: 'var(--text-muted)' }}>
                            Architecture
                          </td>
                          <td style={{ padding: '0.35rem 0' }}>{result.machine}</td>
                        </tr>
                      )}
                      <tr>
                        <td style={{ padding: '0.35rem 0.5rem 0.35rem 0', color: 'var(--text-muted)' }}>
                          Protected
                        </td>
                        <td style={{ padding: '0.35rem 0' }}>
                          {result.protected ? (
                            <span style={{ color: 'var(--success)' }}>
                              Yes ({result.protection_format}
                              {result.protection_tier && `, ${result.protection_tier}`})
                            </span>
                          ) : (
                            'No'
                          )}
                        </td>
                      </tr>
                      {result.protected && (
                        <>
                          {result.embedding && (
                            <tr>
                              <td style={{ padding: '0.35rem 0.5rem 0.35rem 0', color: 'var(--text-muted)' }}>
                                Embedding
                              </td>
                              <td style={{ padding: '0.35rem 0' }}>{result.embedding}</td>
                            </tr>
                          )}
                          {result.payload_size != null && (
                            <tr>
                              <td style={{ padding: '0.35rem 0.5rem 0.35rem 0', color: 'var(--text-muted)' }}>
                                Payload size
                              </td>
                              <td style={{ padding: '0.35rem 0' }}>
                                {result.payload_size.toLocaleString()} bytes
                              </td>
                            </tr>
                          )}
                        </>
                      )}
                    </>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
