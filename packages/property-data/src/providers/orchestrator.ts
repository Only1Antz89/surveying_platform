import type { PropertyLocation, ProviderResult } from "../contract";
import { ProviderError } from "../http/provider-fetch";
import { result, type IntelligenceProvider, type ProviderContext } from "./types";

export type ProviderOutcome = { providerKey: string; results: ProviderResult[]; durationMs: number };

class ProviderTimeout extends Error {}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.finally(() => timer && clearTimeout(timer)),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ProviderTimeout()), timeoutMs); }),
  ]);
}

function failureResults(provider: IntelligenceProvider, reason: unknown, now: Date): ProviderResult[] {
  const transient = reason instanceof ProviderTimeout || (reason instanceof ProviderError && reason.transient);
  const code = reason instanceof ProviderTimeout ? "timeout" : reason instanceof ProviderError ? reason.code : (reason as { code?: string })?.code ?? "unexpected";
  const message = transient ? "The source did not respond in time. Earlier results, if any, are still shown with their dates." : "The source returned something that could not be used. No result was recorded.";
  return provider.categories.map((category) => result(provider.key, { category, status: transient ? "unavailable" : "error", coverage: "unknown", now, message, errorCode: String(code).slice(0, 60) }));
}

/**
 * Runs providers independently with a concurrency limit and an outer timeout.
 * A failing provider yields explicit unavailable/error results and never
 * discards results from other providers.
 */
export async function runProviders(providers: IntelligenceProvider[], location: PropertyLocation, context: ProviderContext, options: { concurrency?: number; timeoutMs?: number } = {}): Promise<ProviderOutcome[]> {
  const queue = [...providers];
  const outcomes: ProviderOutcome[] = [];
  const worker = async () => {
    for (let provider = queue.shift(); provider; provider = queue.shift()) {
      const started = Date.now();
      const applicability = provider.applicability(location, context);
      if (!applicability.ok) {
        outcomes.push({ providerKey: provider.key, durationMs: 0, results: provider.categories.map((category) => result(provider!.key, { category, status: applicability.status, coverage: applicability.coverage, now: context.now, message: applicability.message })) });
        continue;
      }
      try {
        const results = await withTimeout(provider.run(location, context), options.timeoutMs ?? 15_000);
        outcomes.push({ providerKey: provider.key, durationMs: Date.now() - started, results });
      } catch (reason) {
        outcomes.push({ providerKey: provider.key, durationMs: Date.now() - started, results: failureResults(provider, reason, context.now) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 3, providers.length || 1)) }, worker));
  return outcomes.sort((a, b) => a.providerKey.localeCompare(b.providerKey));
}
