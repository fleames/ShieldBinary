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
      const res = await fetch(url, init);
      lastRes = res;

      if (res.ok || !isRetryable(res.status)) {
        return res;
      }
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
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
