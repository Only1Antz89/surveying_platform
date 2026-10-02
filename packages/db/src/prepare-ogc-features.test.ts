import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSafeNextUrl, parseOgcArguments, prepareOgcFeatures, type OgcPrepareArguments } from "../scripts/prepare-ogc-features";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/geo+json" } });
}

async function argumentsForTest(): Promise<OgcPrepareArguments> {
  const directory = await mkdtemp(join(tmpdir(), "surveynt-ogc-"));
  temporaryDirectories.push(directory);
  return {
    endpoint: "https://environment.example/collections/flood/items",
    output: join(directory, "flood-zone-2.csv"),
    sourceCrs: "EPSG:4326",
    sourcePrefix: "flood_zone_2",
    filterField: "flood_zone",
    filterValue: "FZ2",
    pageSize: 1000,
    timeoutMs: 30_000,
    rewritePaginationOrigin: undefined,
  };
}

const feature = (id: number) => ({
  type: "Feature",
  id: `Flood.${id}`,
  properties: { flood_zone: "FZ2", flood_source: "Rivers" },
  geometry: { type: "Polygon", coordinates: [[[-2, 51], [-1, 51], [-2, 51]]] },
});

describe("OGC Features preparation", () => {
  it("requires HTTPS, WGS84 and bounded numeric options", () => {
    expect(parseOgcArguments(["--endpoint", "https://example.test/items", "--output", "/tmp/out.csv", "--source-crs", "EPSG:4326", "--source-prefix", "flood_zone_2", "--filter-field", "flood_zone", "--filter-value", "FZ2"]).pageSize).toBe(1000);
    expect(() => parseOgcArguments(["--endpoint", "http://example.test/items", "--output", "/tmp/out.csv", "--source-crs", "EPSG:4326", "--source-prefix", "flood", "--filter-field", "zone", "--filter-value", "2"])).toThrow(/HTTPS/);
    expect(() => parseOgcArguments(["--endpoint", "https://example.test/items", "--output", "/tmp/out.csv", "--source-crs", "EPSG:27700", "--source-prefix", "flood", "--filter-field", "zone", "--filter-value", "2"])).toThrow(/Usage/);
  });

  it("allows only same-origin, same-path pagination links", () => {
    const base = new URL("https://environment.example/collections/flood/items?limit=1000");
    expect(assertSafeNextUrl("?limit=1000&startIndex=1000", base).searchParams.get("startIndex")).toBe("1000");
    expect(assertSafeNextUrl("https://broken-backend.example/collections/flood/items?startIndex=1000", base, "https://broken-backend.example").origin).toBe(base.origin);
    expect(() => assertSafeNextUrl("https://attacker.example/collect", base)).toThrow(/approved collection/);
    expect(() => assertSafeNextUrl("https://environment.example/other/items", base)).toThrow(/approved collection/);
  });

  it("requires an exact HTTPS origin for an alternate pagination host", () => {
    const required = ["--endpoint", "https://example.test/items", "--output", "/tmp/out.csv", "--source-crs", "EPSG:4326", "--source-prefix", "flood", "--filter-field", "zone", "--filter-value", "2"];
    expect(parseOgcArguments([...required, "--rewrite-pagination-origin", "https://backend.example"]).rewritePaginationOrigin).toBe("https://backend.example");
    expect(() => parseOgcArguments([...required, "--rewrite-pagination-origin", "https://backend.example/path"])).toThrow(/HTTPS origin/);
  });

  it("downloads every page, validates counts and writes canonical CSV", async () => {
    const args = await argumentsForTest();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ type: "FeatureCollection", numberMatched: 2, numberReturned: 1, features: [feature(1)], links: [{ rel: "next", href: "?startIndex=1&limit=1000" }] }))
      .mockResolvedValueOnce(response({ type: "FeatureCollection", numberMatched: 2, numberReturned: 1, features: [feature(2)], links: [] }));
    const result = await prepareOgcFeatures(args, { fetcher, wait: async () => undefined });
    expect(result).toMatchObject({ records: 2, pages: 2, expectedRecords: 2 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toContain("filter=flood_zone%3D%27FZ2%27");
    const output = await readFile(args.output, "utf8");
    expect(output).toContain("flood_zone_2:Flood.1");
    expect(output).toContain("POLYGON((-2 51,-1 51,-2 51))");
    expect(output).toContain("datasetLayer");
  });

  it("retries bounded transient failures", async () => {
    const args = await argumentsForTest();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ error: "busy" }, 503))
      .mockResolvedValueOnce(response({ type: "FeatureCollection", numberMatched: 1, numberReturned: 1, features: [feature(1)], links: [] }));
    const wait = vi.fn(async () => undefined);
    await expect(prepareOgcFeatures(args, { fetcher, wait })).resolves.toMatchObject({ records: 1 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledOnce();
  });

  it("rejects mismatched layers and removes its partial output", async () => {
    const args = await argumentsForTest();
    const validFeatures = Array.from({ length: 2_000 }, (_, index) => feature(index));
    const mismatched = { ...feature(2_001), properties: { flood_zone: "FZ3" } };
    await expect(prepareOgcFeatures(args, { fetcher: async () => response({ type: "FeatureCollection", numberMatched: 2_001, numberReturned: 2_001, features: [...validFeatures, mismatched] }) })).rejects.toThrow(/did not match/);
    await expect(readFile(args.output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects malformed counts and unsafe service pagination", async () => {
    const badCount = await argumentsForTest();
    await expect(prepareOgcFeatures(badCount, { fetcher: async () => response({ type: "FeatureCollection", numberMatched: 1, numberReturned: 2, features: [feature(1)] }) })).rejects.toThrow(/numberReturned/);
    const unsafeNext = await argumentsForTest();
    await expect(prepareOgcFeatures(unsafeNext, { fetcher: async () => response({ type: "FeatureCollection", numberMatched: 1, numberReturned: 1, features: [feature(1)], links: [{ rel: "next", href: "https://attacker.example/items" }] }) })).rejects.toThrow(/approved collection/);
  });
});
