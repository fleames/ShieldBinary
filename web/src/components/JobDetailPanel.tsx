import type { JobSummary, ThreatIntelStatus } from '../types/jobs';
import ProtectionScoreGauge from './ProtectionScoreGauge';
import { Badge } from '../design-system';

type Props = {
  job: JobSummary;
  intelStatus?: ThreatIntelStatus;
  vtUrl?: string | null;
};

function fmtBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
}

function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

export default function JobDetailPanel({ job, intelStatus, vtUrl }: Props) {
  const passes = job.pass_metrics ?? [];
  const maxDur = passes.length ? Math.max(...passes.map((p) => p.duration_ms), 1) : 1;

  const compat = job.compatibility_report;
  const compatOk = compat?.status === 'compatible';

  const sizeIn = job.size_impact?.input_bytes;
  const sizeOut = job.size_impact?.output_bytes;
  const sizeDeltaPct =
    sizeIn != null && sizeOut != null && sizeIn > 0
      ? Math.round(((sizeOut - sizeIn) / sizeIn) * 100)
      : null;

  const hasData =
    !!job.strength_score || !!compat || sizeIn != null || passes.length > 0;

  if (!hasData) {
    return (
      <div className="dash-detail">
        <p className="dash-detail__empty">
          No analysis data available for this job. New jobs include protection score, pass
          metrics, and compatibility reports.
        </p>
      </div>
    );
  }

  const detected = intelStatus?.detected_count ?? 0;
  const engineCount = intelStatus?.engine_count ?? 0;
  const dotCount = Math.min(engineCount, 60);

  return (
    <div className="dash-detail">

      {/* ── Top row: gauge + stat grid ── */}
      <div className="dash-detail__top">
        {job.strength_score && (
          <div className="dash-detail__gauge">
            <ProtectionScoreGauge
              score={job.strength_score.score}
              band={job.strength_score.band}
              size={118}
            />
          </div>
        )}

        <div className="dash-detail__stats">
          {sizeIn != null && sizeOut != null && (
            <div className="dash-detail__stat">
              <span className="dash-detail__stat-label">Size</span>
              <span className="dash-detail__stat-value">
                {fmtBytes(sizeIn)}
                <span className="dash-detail__arrow"> → </span>
                {fmtBytes(sizeOut)}
                {sizeDeltaPct !== null && (
                  <span
                    className="dash-detail__delta"
                    style={{
                      color:
                        Math.abs(sizeDeltaPct) > 120
                          ? 'var(--warning)'
                          : 'var(--text-muted)',
                    }}
                  >
                    {sizeDeltaPct > 0 ? '+' : ''}
                    {sizeDeltaPct}%
                  </span>
                )}
              </span>
            </div>
          )}

          {compat && (
            <div className="dash-detail__stat">
              <span className="dash-detail__stat-label">Compatibility</span>
              <span className="dash-detail__stat-value">
                <span style={{
                  color: compatOk ? 'var(--success)' : compat.status === 'warning' ? 'var(--warning)' : 'var(--error)',
                  marginRight: '0.3rem',
                }}>
                  {compatOk ? '✓' : '✗'}
                </span>
                {compat.status}
                {compat.mode && ` · ${compat.mode}`}
                {typeof compat.exit_code === 'number' && compat.exit_code !== 0 && ` · exit ${compat.exit_code}`}
                {compat.timed_out && ' · timed out'}
              </span>
            </div>
          )}

          {job.strength_score?.time_estimate && (
            <div className="dash-detail__stat">
              <span className="dash-detail__stat-label">RE resistance</span>
              <span className="dash-detail__stat-value">{job.strength_score.time_estimate}</span>
            </div>
          )}

          {job.binary_type && (
            <div className="dash-detail__stat">
              <span className="dash-detail__stat-label">Binary type</span>
              <span className="dash-detail__stat-value">{job.binary_type}</span>
            </div>
          )}

          {job.polymorphic_mode && (
            <div className="dash-detail__stat">
              <span className="dash-detail__stat-label">Mode</span>
              <span className="dash-detail__stat-value">Polymorphic</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Pass breakdown ── */}
      {passes.length > 0 && (
        <div className="dash-detail__section">
          <div className="dash-detail__section-title">Protection passes</div>
          <div className="dash-pass-list">
            {passes.map((p, i) => (
              <div key={`${p.name}-${i}`} className="dash-pass-row">
                <span className={`dash-pass-row__dot${p.success ? '' : ' is-failed'}`} />
                <span className="dash-pass-row__name">{p.name.replace(/_/g, ' ')}</span>
                <div className="dash-pass-row__bar-wrap">
                  <div
                    className="dash-pass-row__bar"
                    style={{ width: `${Math.max(2, Math.round((p.duration_ms / maxDur) * 100))}%` }}
                  />
                </div>
                <span className="dash-pass-row__dur">{fmtMs(p.duration_ms)}</span>
                {p.size_delta_bytes != null && p.size_delta_bytes !== 0 && (
                  <span className="dash-pass-row__delta">
                    {p.size_delta_bytes > 0 ? '+' : ''}
                    {fmtBytes(p.size_delta_bytes)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Threat intel ── */}
      {intelStatus?.submitted && (
        <div className="dash-detail__section">
          <div className="dash-detail__section-title">Threat intelligence</div>
          <div className="dash-intel-row">
            <div className="dash-intel-row__summary">
              <span className="dash-intel-row__count">
                <strong>{detected}</strong>
                <span style={{ color: 'var(--text-muted)' }}>
                  {' '}/ {engineCount || '?'} engines
                </span>
              </span>
              <span
                className="dash-intel-row__verdict"
                style={{ color: detected === 0 ? 'var(--success)' : 'var(--error)' }}
              >
                {detected === 0 ? 'Clean' : `${detected} detection${detected > 1 ? 's' : ''}`}
              </span>
              {vtUrl && (
                <a href={vtUrl} target="_blank" rel="noreferrer" className="dash-intel-link">
                  Open VirusTotal →
                </a>
              )}
            </div>

            {dotCount > 0 && (
              <div className="dash-intel-dots">
                {Array.from({ length: dotCount }).map((_, i) => (
                  <span
                    key={i}
                    className={`dash-intel-dot${i < detected ? ' is-detected' : ''}`}
                    title={i < detected ? 'Detected' : 'Clean'}
                  />
                ))}
              </div>
            )}

            {intelStatus.sample_hash && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                sha256: {intelStatus.sample_hash.slice(0, 16)}…
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Crash diagnostics ── */}
      {(job.status === 'failed' || compat?.status === 'incompatible') &&
        (job.error || compat?.stderr_snippet || compat?.stdout_snippet) && (
        <div className="dash-detail__section">
          <div className="dash-detail__section-title dash-detail__section-title--error">
            Crash diagnostics
          </div>
          {job.error && (
            <div className="dash-diag">
              <div className="dash-diag__label">Engine error</div>
              <pre className="dash-diag__code">{job.error}</pre>
            </div>
          )}
          {compat?.stderr_snippet && (
            <div className="dash-diag">
              <div className="dash-diag__label">Stderr</div>
              <pre className="dash-diag__code">{compat.stderr_snippet}</pre>
            </div>
          )}
          {compat?.stdout_snippet && (
            <div className="dash-diag">
              <div className="dash-diag__label">Stdout</div>
              <pre className="dash-diag__code">{compat.stdout_snippet}</pre>
            </div>
          )}
          <button
            className="dash-diag__copy"
            onClick={() => {
              const info = {
                job_id: job.job_id,
                status: job.status,
                tier: job.tier,
                binary_type: job.binary_type,
                engine_error: job.error ?? null,
                compat_report: compat ?? null,
                failed_passes: job.pass_metrics?.filter((p) => !p.success) ?? [],
              };
              navigator.clipboard.writeText(JSON.stringify(info, null, 2));
            }}
          >
            Copy debug JSON
          </button>
        </div>
      )}

      {/* ── Notes from compat report ── */}
      {compat?.notes && compat.status !== 'incompatible' && (
        <div className="dash-detail__section">
          <div className="dash-detail__section-title">Notes</div>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
            {compat.notes}
          </p>
        </div>
      )}

      {/* ── Job metadata ── */}
      <div className="dash-detail__section">
        <div className="dash-detail__section-title">Job info</div>
        <div className="dash-detail__meta">
          <code className="dash-detail__jobid">{job.job_id}</code>
          {job.protections && job.protections.length > 0 && (
            <div className="dash-detail__optins">
              {job.protections.map((p) => (
                <Badge key={p} tone="accent">
                  {p.replace(/_/g, ' ')}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
