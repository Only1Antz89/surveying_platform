import type { SurvaiAction } from "./survai-context";

export type SurvaiWebProposal = { query: string; reason: string; token: string; expiresAt: string };
export type SurvaiAnswer = { role: string; content: string; demo?: boolean; model?: string; citations?: { id: string; label: string; href: string }[]; coverage?: "answered" | "partial" | "not_in_records"; webProposal?: SurvaiWebProposal | null; web?: boolean; query?: string; searchSuggestions?: string | null };
export type SurvaiReview = { id: string; title: string; question: string; status: "working" | "ready" | "error"; answer?: SurvaiAnswer; error?: string; webToken?: string };

/** Web citations link out to public pages; record citations stay inside the workspace. */
export const isWebCitation = (citation: { id: string; href: string }) => citation.id.startsWith("web:") && citation.href.startsWith("https://");
export type SurvaiResultBlock = { kind: "paragraph" | "heading"; text: string } | { kind: "list"; items: string[] };

/** Requests stay in the governed conversation; only answers enter the results UI. */
export function survaiReviewsFromHistory(messages: SurvaiAnswer[], actions: SurvaiAction[]): SurvaiReview[] {
 let question = "";
 return messages.flatMap((message, index) => {
  if (message.role === "user") { question = message.content; return []; }
  if (message.role !== "assistant") return [];
  return [{ id: `saved:${index}`, title: actions.find(action => action.question === question)?.label ?? "Saved review", question, status: "ready" as const, answer: message }];
 });
}

/** Format provider prose without inventing findings or interpreting HTML. */
export function survaiResultBlocks(answer: string): SurvaiResultBlock[] {
 const blocks: SurvaiResultBlock[] = [];
 let paragraph: string[] = [];
 const flush = () => { if (paragraph.length) { blocks.push({ kind: "paragraph", text: paragraph.join("\n") }); paragraph = []; } };
 for (const line of answer.replace(/\r\n/g, "\n").split("\n")) {
  const heading = line.match(/^#{1,6}\s+(.+)$/);
  const item = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.+)$/);
  if (!line.trim()) { flush(); continue; }
  if (heading) { flush(); blocks.push({ kind: "heading", text: heading[1] }); }
  else if (item) { flush(); const last = blocks[blocks.length - 1]; if (last?.kind === "list") last.items.push(item[1]); else blocks.push({ kind: "list", items: [item[1]] }); }
  else paragraph.push(line);
 }
 flush();
 return blocks;
}
