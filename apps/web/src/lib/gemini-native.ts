import "server-only";
import { z } from "zod";
import { connectionJson } from "./connection-network";
import { GovernanceError } from "./ai-governance";

// Gemini's native generateContent endpoint. It cohabits with the OpenAI-compatible
// endpoint (".../v1beta/openai") used for record-grounded answers: the same
// credential and outbound host, but it supports server tools such as Google Search
// grounding, which the compatible endpoint does not.
export const geminiNativeEndpoint = "https://generativelanguage.googleapis.com/v1beta";
export const geminiCompatibleEndpoint = `${geminiNativeEndpoint}/openai`;

export type WebCitation = { id: string; label: string; href: string };
export type WebAnswer = { content: string; citations: WebCitation[]; searchQueries: string[]; searchSuggestions: string };

const response = z.object({
  candidates: z.array(z.object({
    content: z.object({ parts: z.array(z.object({ text: z.string().optional() })).optional() }).optional(),
    groundingMetadata: z.object({
      webSearchQueries: z.array(z.string()).optional(),
      searchEntryPoint: z.object({ renderedContent: z.string().trim().min(1).max(100_000) }).optional(),
      groundingChunks: z.array(z.object({ web: z.object({ uri: z.string(), title: z.string().optional() }).optional() })).optional(),
    }).optional(),
  })).min(1),
});

const instruction = "You are SurvAI, assisting a UK chartered surveying practice. Answer the question using Google Search results only. Be concise: a short summary, then Markdown headings and short lists where helpful. Prefer official and primary sources (for example gov.uk, legislation.gov.uk, local authorities, RICS, the Met Office). State uncertainty and dates explicitly, and say when results do not answer the question. Do not give legal advice or professional findings.";

/** One Google-Search-grounded answer. The query has already been confirmed by the user. */
export async function groundedWebAnswer(input: { credentialEnv: string; model: string; query: string; endpoint?: string }): Promise<WebAnswer> {
  const secret = process.env[input.credentialEnv];
  if (!secret) throw new GovernanceError(503, "credential_unavailable", "Web search is not configured.");
  if (!/^gemini-[a-z0-9.-]+$/.test(input.model)) throw new GovernanceError(503, "invalid_model", "The configured web search model is unavailable.");
  const raw = await connectionJson(input.endpoint ?? geminiNativeEndpoint, `/models/${input.model}:generateContent`, {
    timeoutMs: 45000,
    headers: { "x-goog-api-key": secret },
    body: { systemInstruction: { parts: [{ text: instruction }] }, contents: [{ role: "user", parts: [{ text: input.query }] }], tools: [{ google_search: {} }], generationConfig: { maxOutputTokens: 1200 } },
  });
  const parsed = response.safeParse(raw);
  if (!parsed.success) throw new GovernanceError(502, "web_search_invalid", "Web search returned an unexpected response. Nothing was saved.");
  const candidate = parsed.data.candidates[0];
  const content = (candidate.content?.parts ?? []).map((part) => part.text ?? "").join("").trim();
  const seen = new Set<string>();
  const citations = (candidate.groundingMetadata?.groundingChunks ?? []).flatMap((chunk) => chunk.web && /^https:\/\//.test(chunk.web.uri) && !seen.has(chunk.web.uri) ? (seen.add(chunk.web.uri), [{ uri: chunk.web.uri, title: chunk.web.title }]) : [])
    .slice(0, 10).map((web, index) => ({ id: `web:${index + 1}`, label: web.title?.slice(0, 160) || new URL(web.uri).hostname, href: web.uri }));
  const searchSuggestions = candidate.groundingMetadata?.searchEntryPoint?.renderedContent;
  if (!content || !citations.length) throw new GovernanceError(502, "web_search_ungrounded", "Web search did not return sourced results for this query. Nothing was saved.");
  if (!searchSuggestions) throw new GovernanceError(502, "search_suggestions_missing", "Google Search Suggestions were unavailable. No web answer was saved.");
  return { searchSuggestions, content: content.slice(0, 12000), citations, searchQueries: (candidate.groundingMetadata?.webSearchQueries ?? []).slice(0, 5) };
}
