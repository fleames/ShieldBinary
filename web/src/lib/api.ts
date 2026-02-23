/**
 * API helper with retry for transient failures and clearer error messages.
 */

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

function isRetryable(status: number): boolean {
  // Network errors come as status 0; 5xx and 429 are retryable
  return status === 0 || (status >= 500 && status < 600) || status === 429;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function apiFetch(
  url: string,
  init?: RequestInit,
  retries = MAX_RETRIES
): Promise<Response> {
  let lastRes: Response | null = null;
  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/60f530a7-18e0-420c-9616-89f6ce8bf38b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:'baseline',hypothesisId:'H5',location:'web/src/lib/api.ts:30',message:'apiFetch request start',data:{url,attempt,retries,method:init?.method ?? 'GET'},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      const res = await fetch(url, init);
      lastRes = res;
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/60f530a7-18e0-420c-9616-89f6ce8bf38b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:'baseline',hypothesisId:'H5',location:'web/src/lib/api.ts:34',message:'apiFetch response received',data:{url,attempt,status:res.status,ok:res.ok},timestamp:Date.now()})}).catch(()=>{});
      // #endregion

      if (res.ok || !isRetryable(res.status)) {
        return res;
      }
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/60f530a7-18e0-420c-9616-89f6ce8bf38b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:'baseline',hypothesisId:'H5',location:'web/src/lib/api.ts:43',message:'apiFetch request threw',data:{url,attempt,error:e instanceof Error ? e.message : String(e)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      lastErr = e;
      lastRes = null;
    }

    if (attempt < retries) {
      await delay(RETRY_DELAY_MS * (attempt + 1));
    }
  }

  if (lastRes) return lastRes;
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export function apiErrorMessage(res: Response, fallback: string): string {
  if (res.status === 401) {
    return 'Session expired. Please log in again.';
  }
  if (res.status === 429) {
    return 'Too many requests. Please try again later.';
  }
  if (res.status === 0) {
    return 'Network error. Please check your connection and try again.';
  }
  return fallback;
}

export async function apiErrorFromResponse(res: Response, fallback: string): Promise<string> {
  const msg = apiErrorMessage(res, fallback);
  try {
    const d = await res.json();
    if (d && typeof d.error === 'string') {
      const suffix = d.remaining != null ? ` (${d.remaining} remaining this hour)` : '';
      return d.error + suffix;
    }
  } catch {
    // ignore
  }
  return msg !== fallback ? msg : fallback;
}
