import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Manifest = {
  source: string;
  coverage: string;
  release: string;
  catalogueCount: number;
  excludedWelshAuthorities: number;
  entries: Array<{ authority: string; label: string; url: string; archive: string }>;
};

describe("committed HMLR England manifest", () => {
  it("retains the reviewed September 2026 authority selection", async () => {
    const path = resolve(import.meta.dirname, "../../../docs/property-intelligence/hmlr-england-authorities-2026-09.json");
    const manifest = JSON.parse(await readFile(path, "utf8")) as Manifest;
    expect(manifest).toMatchObject({ source: "hmlr_inspire", coverage: "ENG", release: "2026-09", catalogueCount: 318, excludedWelshAuthorities: 22 });
    expect(manifest.entries).toHaveLength(296);
    expect(new Set(manifest.entries.map(({ archive }) => archive)).size).toBe(296);
    expect(manifest.entries.every(({ label }) => /^[a-z0-9][a-z0-9-]*$/.test(label))).toBe(true);
    expect(manifest.entries.every(({ url, archive }) => url === `https://use-land-property-data.service.gov.uk/datasets/inspire/download/${archive}`)).toBe(true);
  });
});
