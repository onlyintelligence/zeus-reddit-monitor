/**
 * Minimal fetch wrapper: retries on 429/5xx with exponential backoff + jitter,
 * honours Retry-After, and always sends a User-Agent (Reddit RSS 429s without one).
 */
export interface HttpOptions extends RequestInit {
  retries?: number;
  userAgent?: string;
  timeoutMs?: number;
}

export class HttpError extends Error {
  constructor(public status: number, public body: string, public url: string) {
    super(`HTTP ${status} for ${url}: ${body.slice(0, 300)}`);
  }
}

export async function http(url: string, opts: HttpOptions = {}): Promise<Response> {
  const { retries = 3, userAgent, timeoutMs = 20_000, ...init } = opts;
  const headers = new Headers(init.headers);
  if (userAgent) headers.set("user-agent", userAgent);
  let attempt = 0;
  for (;;) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, headers, signal: ctl.signal });
      if (res.ok) return res;
      const body = await res.text();
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= retries) throw new HttpError(res.status, body, url);
      const ra = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 500 * 2 ** attempt + Math.random() * 300;
      await new Promise((r) => setTimeout(r, wait));
      attempt++;
    } finally {
      clearTimeout(t);
    }
  }
}

export async function httpJson<T = unknown>(url: string, opts: HttpOptions = {}): Promise<T> {
  const res = await http(url, opts);
  return (await res.json()) as T;
}

export const form = (o: Record<string, string | number | boolean | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined) p.set(k, String(v));
  return p;
};
