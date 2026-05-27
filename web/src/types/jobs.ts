export type JobStatus = 'idle' | 'uploading' | 'queued' | 'processing' | 'completed' | 'failed';

export type PassMetric = {
  name: string;
  duration_ms: number;
  success: boolean;
  error?: string;
  size_delta_bytes?: number;
};

export type SizeImpact = {
  input_bytes: number;
  output_bytes: number;
  pass_deltas?: Record<string, number>;
};

export type CompatibilityReport = {
  status: string;
  mode?: string;
  exit_code?: number;
  timed_out?: boolean;
  stdout_snippet?: string;
  stderr_snippet?: string;
  notes?: string;
};

export type StrengthScore = {
  score: number;
  band: string;
  time_estimate?: string;
};

export type RetrySuggestion = {
  label: string;
  reason?: string;
  tier?: string;
  low_entropy?: boolean;
  polymorphic_mode?: boolean;
  protections?: string[];
};

export type ThreatIntelStatus = {
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

export type TechniqueFlag = {
  technique_key: string;
  severity: string;
  reason: string;
  state: string;
  last_detected_ratio: number;
  last_sample_count: number;
};

export type JobSummary = {
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
