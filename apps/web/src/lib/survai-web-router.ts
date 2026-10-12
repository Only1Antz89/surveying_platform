import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// SurvAI's decision maker for questions the practice's records cannot answer.
// The record-grounded answer reports its own coverage; these deterministic rules
// then decide whether a web search may be offered, and build a query that carries
// no personal data. Nothing is searched until the user confirms the exact query.

export type AnswerCoverage = "answered" | "partial" | "not_in_records";
export type WebProposal = { query: string; reason: string; token: string; expiresAt: string };
type ProposalClaims = { q: string; o: string; u: string; e: number };

/** Pages whose subject is private practice data; web results cannot help and must not be offered. */
const privatePages = new Set(["finance", "billing", "quotes", "team", "governance", "documents", "account", "client-case", "support-session"]);
const email = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const phone = /(?:\+44\s?|\b0)(?:\d\s?){9,10}\b/g;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Removes contact details and the names of people or organisations known from the supplied records. */
export function sanitiseWebQuery(query: string, privateNames: string[]): string | null {
  let cleaned = query.replace(email, " ").replace(phone, " ");
  for (const name of privateNames.map((item) => item.trim()).filter((item) => item.length >= 3).sort((a, b) => b.length - a.length)) cleaned = cleaned.replace(new RegExp(`\\b${escape(name)}\\b`, "gi"), " ");
  cleaned = cleaned.replace(/\s+/g, " ").replace(/\s+([,.?!])/g, "$1").trim().slice(0, 200);
  return cleaned.split(" ").filter((word) => /[a-z0-9]/i.test(word)).length >= 3 ? cleaned : null;
}

/** Names of clients, contacts and people found in supplied sources, used only to keep them out of web queries. */
export function privateNamesFrom(sources: { data: unknown }[]): string[] {
  const names = new Set<string>();
  const visit = (value: unknown, key = "") => {
    if (typeof value === "string" && /^(client|clientName|displayName|name|contact|customer|firstName|lastName|assignee)$/i.test(key) && value.length <= 120) names.add(value);
    else if (Array.isArray(value)) value.forEach((item) => visit(item, key));
    else if (value && typeof value === "object") for (const [childKey, child] of Object.entries(value)) visit(child, childKey);
  };
  for (const source of sources) visit(source.data);
  return [...names];
}

function signingKey() {
  const secret = process.env.SURVAI_WEB_PROPOSAL_SECRET ?? process.env.SURVEYNT_CONNECTION_SECRET_GEMINI;
  return secret ? createHash("sha256").update(`survai-web-proposal:${secret}`).digest() : null;
}

export function signProposal(claims: ProposalClaims): string | null {
  const key = signingKey();
  if (!key) return null;
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
}

/** Returns the confirmed query only for the same user and practice, before expiry. */
export function verifyProposal(token: string, expected: { organisationId: string; userId: string }, now = Date.now()): string | null {
  const key = signingKey();
  const [body, signature] = token.split(".");
  if (!key || !body || !signature || token.length > 2000) return null;
  const actual = Buffer.from(signature), wanted = Buffer.from(createHmac("sha256", key).update(body).digest("base64url"));
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString()) as ProposalClaims;
    return claims.o === expected.organisationId && claims.u === expected.userId && claims.e > now && typeof claims.q === "string" ? claims.q : null;
  } catch { return null; }
}

/** The decision: offer a confirmed web search only when records fall short and a safe query exists. */
export function decideWebProposal(input: { enabled: boolean; coverage: AnswerCoverage; suggestedQuery?: string | null; question: string; page?: string; sources: { data: unknown }[]; organisationId: string; userId: string; now?: number }): WebProposal | null {
  if (!input.enabled || input.coverage === "answered" || (input.page && privatePages.has(input.page))) return null;
  const query = sanitiseWebQuery(input.suggestedQuery?.trim() || input.question, privateNamesFrom(input.sources));
  if (!query) return null;
  const expires = (input.now ?? Date.now()) + 10 * 60_000;
  const token = signProposal({ q: query, o: input.organisationId, u: input.userId, e: expires });
  if (!token) return null;
  return { query, token, expiresAt: new Date(expires).toISOString(), reason: input.coverage === "partial" ? "Your records only partly answer this." : "Your records do not answer this." };
}
