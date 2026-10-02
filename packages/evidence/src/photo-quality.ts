import sharp from "sharp";

export const PHOTO_ANALYSER = "photo-quality-v1";

/**
 * Provisional thresholds, set against synthetic images only. They must be
 * calibrated on real survey photos before they are relied on.
 */
export const photoThresholds = { minShortSide: 1000, minMegapixels: 1, blurVariance: 60, darkMean: 45, darkFraction: 0.5, brightFraction: 0.35, brightMean: 230 };

export const photoQualityFlags = ["low_resolution", "possibly_blurred", "too_dark", "overexposed"] as const;
export type PhotoQualityFlag = (typeof photoQualityFlags)[number];

const flagMessages: Record<PhotoQualityFlag, string> = {
  low_resolution: "Low resolution: detail may not be readable in the report.",
  possibly_blurred: "Possibly blurred: consider retaking.",
  too_dark: "Very dark: consider retaking with more light.",
  overexposed: "Overexposed: highlights may hide detail.",
};

export type PhotoQuality =
  | { analyser: typeof PHOTO_ANALYSER; status: "completed"; width: number; height: number; format: string | null; sharpness: number; meanLuminance: number; darkFraction: number; brightFraction: number; flags: PhotoQualityFlag[]; messages: string[] }
  | { analyser: typeof PHOTO_ANALYSER; status: "unavailable"; reason: string };

/**
 * Deterministic quality hints for a photo: resolution, a blur measure
 * (variance of the Laplacian on a 512 px greyscale copy) and exposure. These
 * are prompts to retake a photo, never findings about the building.
 */
export async function analysePhoto(input: Uint8Array): Promise<PhotoQuality> {
  try {
    const metadata = await sharp(input, { failOn: "error" }).metadata();
    const rotated = [5, 6, 7, 8].includes(metadata.orientation ?? 1);
    const width = (rotated ? metadata.height : metadata.width) ?? 0;
    const height = (rotated ? metadata.width : metadata.height) ?? 0;
    const { data, info } = await sharp(input, { failOn: "error" }).rotate().resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true }).toColourspace("b-w").raw().toBuffer({ resolveWithObject: true });
    const channels = info.channels;
    const at = (x: number, y: number) => data[(y * info.width + x) * channels];
    let sum = 0, sumSquares = 0, count = 0, luminance = 0, dark = 0, bright = 0;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const value = at(x, y);
        luminance += value;
        if (value < 8) dark += 1;
        if (value > 247) bright += 1;
        if (x > 0 && y > 0 && x < info.width - 1 && y < info.height - 1) {
          const laplacian = 4 * value - at(x - 1, y) - at(x + 1, y) - at(x, y - 1) - at(x, y + 1);
          sum += laplacian; sumSquares += laplacian * laplacian; count += 1;
        }
      }
    }
    const pixels = info.width * info.height;
    const mean = count ? sum / count : 0;
    const sharpness = count ? sumSquares / count - mean * mean : 0;
    const meanLuminance = luminance / pixels;
    const darkFraction = dark / pixels;
    const brightFraction = bright / pixels;
    const flags: PhotoQualityFlag[] = [];
    if (Math.min(width, height) < photoThresholds.minShortSide || (width * height) / 1e6 < photoThresholds.minMegapixels) flags.push("low_resolution");
    if (meanLuminance < photoThresholds.darkMean || darkFraction > photoThresholds.darkFraction) flags.push("too_dark");
    if (meanLuminance > photoThresholds.brightMean || brightFraction > photoThresholds.brightFraction) flags.push("overexposed");
    // Extreme exposure flattens contrast, so the blur measure is not meaningful; say so rather than guess.
    const exposureProblem = flags.includes("too_dark") || flags.includes("overexposed");
    if (!exposureProblem && sharpness < photoThresholds.blurVariance) flags.push("possibly_blurred");
    const messages = flags.map((flag) => flagMessages[flag]);
    if (exposureProblem) messages.push("Sharpness was not judged because of the exposure.");
    return { analyser: PHOTO_ANALYSER, status: "completed", width, height, format: metadata.format ?? null, sharpness: Math.round(sharpness * 10) / 10, meanLuminance: Math.round(meanLuminance * 10) / 10, darkFraction: Math.round(darkFraction * 1000) / 1000, brightFraction: Math.round(brightFraction * 1000) / 1000, flags, messages };
  } catch {
    return { analyser: PHOTO_ANALYSER, status: "unavailable", reason: "This image could not be analysed (for example a HEIC photo or a damaged file). The original is kept unchanged." };
  }
}
