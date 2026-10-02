import { describe, expect, it } from "vitest";
import { buildHmlrManifest } from "../scripts/prepare-hmlr-manifest";

const welsh = ["Blaenau_Gwent_County_Borough_Council", "Bridgend_County_Borough_Council", "Caerphilly_County_Borough_Council", "Cardiff_Council", "Carmarthenshire_County_Council", "Ceredigion_County_Council", "Conwy_County_Borough_Council", "Denbighshire_County_Council", "Flintshire_County_Council", "Gwynedd_Council", "Isle_of_Anglesey_County_Council", "Merthyr_Tydfil_County_Borough_Council", "Monmouthshire_County_Council", "Neath_Port_Talbot_County_Borough_Council", "Newport_City_Council", "Pembrokeshire_County_Council", "Powys_County_Council", "Rhondda_Cynon_Taf_County_Borough_Council", "Swansea_Council", "Torfaen_County_Borough_Council", "Vale_of_Glamorgan_Council", "Wrexham_County_Borough_Council"];

function catalogue() {
  const english = Array.from({ length: 296 }, (_, index) => `English_Authority_${String(index + 1).padStart(3, "0")}`);
  return [...english, ...welsh].map((name) => ({ href: `https://use-land-property-data.service.gov.uk/datasets/inspire/download/${name}.zip`, rowText: `${name.replaceAll("_", " ")}\tDownload .gml` }));
}

describe("HMLR England manifest", () => {
  it("excludes all 22 Welsh principal areas and retains 296 England downloads", () => {
    const manifest = buildHmlrManifest(catalogue(), "2026-09", "2026-09-06");
    expect(manifest.entries).toHaveLength(296);
    expect(manifest.excludedWelshAuthorities).toBe(22);
    expect(manifest.entries[0]).toMatchObject({ label: "english-authority-001", archive: "English_Authority_001.zip" });
  });

  it("rejects catalogue drift, duplicate files and off-origin URLs", () => {
    expect(() => buildHmlrManifest(catalogue().slice(1), "2026-09", "2026-09-06")).toThrow(/318/);
    const duplicate = catalogue(); duplicate[1] = duplicate[0];
    expect(() => buildHmlrManifest(duplicate, "2026-09", "2026-09-06")).toThrow(/duplicate/);
    const hostile = catalogue(); hostile[0] = { href: "https://example.test/file.zip", rowText: "Bad\tDownload .gml" };
    expect(() => buildHmlrManifest(hostile, "2026-09", "2026-09-06")).toThrow(/unapproved/);
  });
});
