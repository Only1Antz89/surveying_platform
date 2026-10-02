import { ProviderError, providerFetchJson } from "../http/provider-fetch";

export type ProbeResult = { status: "ok" | "failed" | "not_probed"; message: string; durationMs: number | null };

type Probe = (env: Record<string, string | undefined>, fetchImpl?: typeof fetch) => Promise<ProbeResult>;

async function timed(url: URL, fetchImpl?: typeof fetch): Promise<ProbeResult> {
  const started = Date.now();
  try {
    const response = await providerFetchJson(url, { allowedHosts: [url.hostname], timeoutMs: 5000, maxBytes: 500_000, fetchImpl });
    return { status: response.status >= 200 && response.status < 300 ? "ok" : "failed", message: `HTTP ${response.status}`, durationMs: Date.now() - started };
  } catch (reason) {
    return { status: "failed", message: reason instanceof ProviderError ? `${reason.code}: ${reason.message}`.slice(0, 300) : "Request failed.", durationMs: Date.now() - started };
  }
}

/**
 * Lightweight health probes for live APIs, one documented read each. Sources
 * whose usage policy discourages automated traffic, or whose endpoint has not
 * been verified, are never probed.
 */
const probes: Record<string, Probe> = {
  postcodes_io: (env, fetchImpl) => timed(new URL("/postcodes/SW1A1AA", env.POSTCODES_IO_BASE_URL || "https://api.postcodes.io"), fetchImpl),
  planning_data: (env, fetchImpl) => timed(new URL("/entity.json?dataset=conservation-area&limit=1", env.PLANNING_DATA_BASE_URL || "https://www.planning.data.gov.uk"), fetchImpl),
  nominatim: async () => ({ status: "not_probed", message: "Not probed: the usage policy discourages automated requests. Check the instance's status page.", durationMs: null }),
  epc_england_wales: async (env) => ({ status: "not_probed", message: env.EPC_API_BASE_URL ? "Not probed: confirm a documented status endpoint first." : "Not configured.", durationMs: null }),
};

export async function probeSource(key: string, env: Record<string, string | undefined>, fetchImpl?: typeof fetch): Promise<ProbeResult> {
  const probe = probes[key];
  return probe ? probe(env, fetchImpl) : { status: "not_probed", message: "Imported dataset: health comes from its import history.", durationMs: null };
}

export const probedSources = Object.keys(probes);
