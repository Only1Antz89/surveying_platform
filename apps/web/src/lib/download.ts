import { workspaceFetch } from "./workspace-request";

/** Fetches a generated file and saves it, surfacing the server's message when it cannot be produced. */
export async function downloadFile(url: string, fallbackName: string, init?: RequestInit) {
  const response = await workspaceFetch(url, init);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "The document could not be produced.");
  }
  const name = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  const href = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = href; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
