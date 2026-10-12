import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocked = vi.hoisted(() => ({ dns: vi.fn(), addresses: [] as string[] }));
vi.mock("node:dns/promises", () => ({ lookup: mocked.dns }));
vi.mock("node:https", async () => {
 const { EventEmitter } = await import("node:events");
 return { request: (_url: URL, options: { family?: number; autoSelectFamily?: boolean; lookup: (host: string, options: { all: boolean }, callback: (error: Error | null, address: string | unknown[], family?: number) => void) => void }, onResponse: (response: InstanceType<typeof EventEmitter> & { statusCode: number }) => void) => {
  const request = Object.assign(new EventEmitter(), { write: () => {}, destroy: () => {}, end: () => {
   // Node's default auto-family mode asks lookup for an array; a single-address callback is invalid.
   const all = options.autoSelectFamily !== false && !options.family;
   options.lookup("example.com", { all }, (error, address) => {
    if (error || all && !Array.isArray(address)) { request.emit("error", error ?? new Error("ERR_INVALID_IP_ADDRESS")); return; }
    mocked.addresses.push(String(address));
    const response = Object.assign(new EventEmitter(), { statusCode: 200 });
    onResponse(response); response.emit("data", Buffer.from('{"available":true}')); response.emit("end");
   });
  } });
  return request;
 } };
});
import { connectionJson } from "./connection-network";
beforeEach(() => { vi.stubEnv("SURVEYNT_OUTBOUND_HOSTS", "example.com"); mocked.addresses.length = 0; mocked.dns.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]); });
afterEach(() => vi.unstubAllEnvs());
describe("pinned HTTPS transport on current Node", () => {
 it("reads provider JSON using only the validated pinned address", async () => {
  await expect(connectionJson("https://example.com/v1", "/models")).resolves.toEqual({ available: true }); expect(mocked.addresses).toEqual(["8.8.8.8"]);
 });
 it("rejects a mixed public/private DNS answer before opening a socket", async () => {
  mocked.dns.mockResolvedValue([{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }]);
  await expect(connectionJson("https://example.com/v1", "/models")).rejects.toThrow("restricted"); expect(mocked.addresses).toEqual([]);
 });
});
