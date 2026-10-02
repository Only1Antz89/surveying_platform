// Every outbound provider request goes through this wrapper. Hosts are fixed
// per adapter, so user input can only ever become query parameters, never a
// destination (SSRF protection). Responses are size-capped and time-bounded.

export type ProviderErrorCode = "host_not_allowed" | "timeout" | "network" | "rate_limited" | "http_client" | "http_server" | "redirect" | "too_large" | "invalid_json" | "invalid_response";

export class ProviderError extends Error {
  constructor(public readonly code: ProviderErrorCode, message: string, public readonly status: number | null = null) {
    super(message);
    this.name = "ProviderError";
  }

  /** Transient failures may be retried; client errors and invalid responses never are. */
  get transient() {
    return this.code === "timeout" || this.code === "network" || this.code === "rate_limited" || this.code === "http_server";
  }
}

export type ProviderFetchOptions = {
  allowedHosts: readonly string[];
  timeoutMs?: number;
  maxBytes?: number;
  userAgent?: string;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
};

export type ProviderResponse = { status: number; body: unknown };

async function readCapped(response: Response, maxBytes: number) {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new ProviderError("too_large", "The provider response exceeded the size limit.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new ProviderError("too_large", "The provider response exceeded the size limit.");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export function assertAllowedUrl(url: URL, allowedHosts: readonly string[]) {
  if (url.protocol !== "https:") throw new ProviderError("host_not_allowed", "Only HTTPS provider endpoints are permitted.");
  if (url.username || url.password) throw new ProviderError("host_not_allowed", "Provider URLs must not embed credentials.");
  if (!allowedHosts.includes(url.hostname.toLowerCase())) throw new ProviderError("host_not_allowed", `Requests to ${url.hostname} are not permitted for this provider.`);
}

/**
 * Fetches JSON from an allowlisted host. `notFoundIsEmpty` lets adapters map
 * a 404 for a lookup key to "no match" rather than an error.
 */
export async function providerFetchJson(input: string | URL, options: ProviderFetchOptions & { notFoundIsEmpty?: boolean; method?: "GET" | "POST"; body?: string }): Promise<ProviderResponse> {
  const url = new URL(input);
  assertAllowedUrl(url, options.allowedHosts);
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: options.method ?? "GET",
      body: options.body,
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
      headers: {
        accept: "application/json",
        ...(options.userAgent ? { "user-agent": options.userAgent } : {}),
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch (reason) {
    const name = (reason as { name?: string }).name;
    if (name === "TimeoutError" || name === "AbortError") throw new ProviderError("timeout", "The provider did not respond in time.");
    throw new ProviderError("network", "The provider could not be reached.");
  }
  if (response.status >= 300 && response.status < 400) throw new ProviderError("redirect", "The provider redirected unexpectedly.", response.status);
  if (response.status === 404 && options.notFoundIsEmpty) {
    await response.body?.cancel();
    return { status: 404, body: null };
  }
  if (response.status === 429) {
    await response.body?.cancel();
    throw new ProviderError("rate_limited", "The provider rate limit was reached.", 429);
  }
  if (response.status >= 500) {
    await response.body?.cancel();
    throw new ProviderError("http_server", "The provider returned a server error.", response.status);
  }
  if (response.status >= 400) {
    await response.body?.cancel();
    throw new ProviderError("http_client", "The provider rejected the request.", response.status);
  }
  const text = await readCapped(response, options.maxBytes ?? 2_000_000);
  try {
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } catch {
    throw new ProviderError("invalid_json", "The provider returned an unreadable response.", response.status);
  }
}

export async function withTransientRetry<T>(operation: () => Promise<T>, options: { attempts?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {}) {
  const attempts = options.attempts ?? 2;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (reason) {
      lastError = reason;
      if (!(reason instanceof ProviderError) || !reason.transient || attempt === attempts) throw reason;
      await sleep((options.baseDelayMs ?? 250) * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}
