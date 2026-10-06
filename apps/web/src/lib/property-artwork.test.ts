import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { artworkForPropertyType, propertyArtwork, propertyTypeOptions } from "./property-artwork";

describe("illustrative property artwork selection", () => {
  it.each(propertyTypeOptions)("assigns the suggested $label type to its registered artwork", option => {
    expect(artworkForPropertyType(option.label)).toMatchObject({ src: propertyArtwork[option.artwork].src, generic: false });
  });
  it("makes every artwork available through a form suggestion", () => {
    expect(new Set(propertyTypeOptions.map(option => option.artwork))).toEqual(new Set(Object.keys(propertyArtwork)));
  });
  it.each(Object.values(propertyArtwork))("ships the $title production asset", async artwork => {
    const file = fileURLToPath(new URL(`../../public${artwork.src}`, import.meta.url));
    expect(existsSync(file)).toBe(true);
    const metadata = await sharp(file).metadata();
    expect(metadata).toMatchObject({ format: "webp", width: 960, height: 960 });
  });
  it.each([
    ["Victorian terrace", "surveynt-architecture.webp"],
    ["Semi-detached house", "semi-detached.webp"],
    ["semi_detached", "semi-detached.webp"],
    ["Victorian semi", "semi-detached.webp"],
    ["Detached house", "detached.webp"],
    ["Detached bungalow", "bungalow.webp"],
    ["Flat", "apartments.webp"],
    ["Commercial offices", "office.webp"],
    ["Agricultural land", "rural-land.webp"],
    ["Building plot", "development-land.webp"],
    ["Terraced row", "terraced-row.webp"],
    ["Stone cottage", "cottage.webp"],
    ["Maisonette flat", "maisonette.webp"],
    ["Industrial warehouse", "warehouse.webp"],
    ["Woodland parcel", "woodland.webp"],
    ["Brownfield development site", "development-land.webp"],
    ["Coastal wetland", "coastal-wetland.webp"],
    ["Retail shop", "commercial.webp"],
    ["Coastal cottage", "cottage.webp"],
    ["Woodland cottage", "cottage.webp"],
    ["Rural detached house", "detached.webp"],
    ["Coastal apartment", "apartments.webp"],
    ["Maisonettes", "maisonette.webp"],
    ["Semi–detached house", "semi-detached.webp"],
    ["Industrial land", "rural-land.webp"],
    ["Coastal office", "office.webp"],
    ["Woodland workshop", "warehouse.webp"],
  ])("selects %s without changing the property type", (type, file) => {
    expect(artworkForPropertyType(type).src.endsWith(file)).toBe(true);
    expect(artworkForPropertyType(type).generic).toBe(false);
  });
  it.each([null, undefined, "", "Not recorded", "Unknown building", "Rural property"])("keeps an unrecognised type explicitly generic", type => {
    expect(artworkForPropertyType(type)).toMatchObject({ generic: true, title: "Generic architectural illustration" });
  });
});
