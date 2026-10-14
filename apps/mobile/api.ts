import { PermanentError } from "./offline-queue";

export const endpoint = process.env.EXPO_PUBLIC_SURVEYNT_URL ?? "";
type TokenSource = (options: { template: string }) => Promise<string | null>;

/** Authenticated calls to the practice's Surveynt API with the dedicated mobile token. */
export function apiClient(getToken: TokenSource) {
  async function call(path: string, init: RequestInit) {
    const token = await getToken({ template: "surveynt-mobile" });
    let response: Response;
    try { response = await fetch(`${endpoint}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...init.headers } }); }
    catch { throw new Error("No connection. Changes are kept on this device."); }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error?.message ?? "Request failed.";
      // Retry later for sign-in, rate limit and server problems; anything else needs the surveyor's attention.
      if ([401, 408, 425, 429].includes(response.status) || response.status >= 500) throw new Error(message);
      throw new PermanentError(message);
    }
    return payload.data;
  }
  return {
    get: (path: string) => call(path, { method: "GET" }),
    json: (path: string, body: unknown) => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    form: (path: string, form: FormData) => call(path, { method: "POST", body: form }),
  };
}
export type ApiClient = ReturnType<typeof apiClient>;
