import sharp from "sharp";

// Synthetic images for tests and the evaluation pack. Deterministic noise, so results are repeatable.
function noise(width: number, height: number, low = 60, range = 140) {
  const pixels = Buffer.alloc(width * height * 3);
  let seed = 7;
  for (let index = 0; index < pixels.length; index += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    pixels[index] = low + (seed % range);
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } });
}

export const syntheticImages = {
  /** Detailed, well-exposed texture. */
  sharp: () => noise(1600, 1200).jpeg({ quality: 90 }).toBuffer(),
  blurred: async () => sharp(await noise(1600, 1200).jpeg({ quality: 90 }).toBuffer()).blur(6).jpeg().toBuffer(),
  dark: () => noise(1600, 1200).linear(0.12, 0).jpeg().toBuffer(),
  overexposed: () => noise(1600, 1200, 200, 56).linear(1.4, 30).jpeg().toBuffer(),
  small: () => noise(320, 240).jpeg().toBuffer(),
  /** A wall-like texture with a darker irregular patch, as damp staining might look. Only quality can be judged from it. */
  stainedWall: async () => {
    const wall = await noise(1600, 1200, 150, 60).jpeg().toBuffer();
    const patch = await noise(500, 380, 70, 40).blur(3).png().toBuffer();
    return sharp(wall).composite([{ input: patch, left: 600, top: 400 }]).jpeg({ quality: 90 }).toBuffer();
  },
};
