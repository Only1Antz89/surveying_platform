import sharp from "sharp";

// Photo controls for restricted staging (Node only). Stripping metadata and
// cropping are deterministic. Faces, legible text, number plates, documents
// and distinctive location cues are not detected automatically, so every
// photo needs a privacy reviewer's decision before it could be released.

export const PHOTO_TRANSFORM = "photo-strip-v1";

export const photoReviewChecklist = [
  "No face or person is visible, including reflections.",
  "No legible text: house names or numbers, letters, documents, screens, labels with names.",
  "No vehicle number plate.",
  "No distinctive view that could locate the property (street scene, landmark, neighbouring buildings).",
  "The crop keeps only the defect and enough context to understand it.",
] as const;

export type CropRegion = { left: number; top: number; width: number; height: number };

/**
 * Re-encodes the image without EXIF (including GPS), XMP, IPTC or ICC data,
 * applying the orientation first so the picture looks the same. Optionally crops.
 */
export async function stripImageMetadata(input: Buffer, crop?: CropRegion) {
  const before = await sharp(input).metadata();
  let pipeline = sharp(input).rotate();
  if (crop) pipeline = pipeline.extract(crop);
  const output = await pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  const after = await sharp(output).metadata();
  return {
    buffer: output,
    transform: PHOTO_TRANSFORM,
    width: after.width ?? null,
    height: after.height ?? null,
    removed: { exif: Boolean(before.exif), icc: Boolean(before.icc), xmp: Boolean(before.xmp), iptc: Boolean(before.iptc) },
    remaining: { exif: Boolean(after.exif), icc: Boolean(after.icc), xmp: Boolean(after.xmp), iptc: Boolean(after.iptc) },
    reviewRequired: true as const,
  };
}
