import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mock = vi.hoisted(() => ({ network: vi.fn() }));
vi.mock("./connection-network", () => ({ connectionJson: mock.network }));
import { geminiCompatibleEndpoint, geminiNativeEndpoint, groundedWebAnswer } from "./gemini-native";

const input = { credentialEnv: "TEST_GEMINI_SECRET", model: "gemini-3.1-flash-lite", query: "Party Wall Act notice period" };
beforeEach(() => { mock.network.mockReset(); vi.stubEnv("TEST_GEMINI_SECRET", "test-only-secret"); });

describe("Gemini native endpoint with Google Search grounding", () => {
  it("cohabits with the OpenAI-compatible endpoint on the same host", () => {
    expect(geminiCompatibleEndpoint).toBe(`${geminiNativeEndpoint}/openai`);
    expect(new URL(geminiNativeEndpoint).host).toBe(new URL(geminiCompatibleEndpoint).host);
  });
  it("sends only the confirmed query with the search tool and the key in a header", async () => {
    mock.network.mockResolvedValue({ candidates: [{ content: { parts: [{ text: "Two months for most works." }] }, groundingMetadata: { webSearchQueries: ["party wall notice"], groundingChunks: [{ web: { uri: "https://www.gov.uk/party-walls-building-works", title: "gov.uk" } }] } }] });
    const answer = await groundedWebAnswer(input);
    const [endpoint, path, options] = mock.network.mock.calls[0];
    expect(endpoint).toBe(geminiNativeEndpoint);
    expect(path).toBe("/models/gemini-3.1-flash-lite:generateContent");
    expect(options.headers).toEqual({ "x-goog-api-key": "test-only-secret" });
    expect(options.secret).toBeUndefined();
    expect(options.body.tools).toEqual([{ google_search: {} }]);
    expect(options.body.contents).toEqual([{ role: "user", parts: [{ text: input.query }] }]);
    expect(answer).toEqual({ content: "Two months for most works.", citations: [{ id: "web:1", label: "gov.uk", href: "https://www.gov.uk/party-walls-building-works" }], searchQueries: ["party wall notice"] });
  });
  it("keeps https sources only, removes duplicates and refuses ungrounded answers", async () => {
    mock.network.mockResolvedValue({ candidates: [{ content: { parts: [{ text: "Answer" }] }, groundingMetadata: { groundingChunks: [{ web: { uri: "http://insecure.example/" } }, { web: { uri: "https://a.example/x" } }, { web: { uri: "https://a.example/x" } }, { web: { uri: "javascript:alert(1)" } }] } }] });
    expect((await groundedWebAnswer(input)).citations).toEqual([{ id: "web:1", label: "a.example", href: "https://a.example/x" }]);
    mock.network.mockResolvedValue({ candidates: [{ content: { parts: [{ text: "Unsourced" }] } }] });
    await expect(groundedWebAnswer(input)).rejects.toThrow("sourced");
  });
  it("needs a credential and a Gemini model before contacting the provider", async () => {
    vi.stubEnv("TEST_GEMINI_SECRET", "");
    await expect(groundedWebAnswer(input)).rejects.toThrow("not configured");
    vi.stubEnv("TEST_GEMINI_SECRET", "test-only-secret");
    await expect(groundedWebAnswer({ ...input, model: "../../admin" })).rejects.toThrow("unavailable");
    expect(mock.network).not.toHaveBeenCalled();
  });
});
