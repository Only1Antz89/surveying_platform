// Copies MapLibre's ES-module worker (and the shared chunk it imports) into
// public/ under a versioned path. The bundled library cannot find its worker
// next to the bundle, so the map sets this URL explicitly.
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const packageFile = require.resolve("maplibre-gl/package.json");
const { version } = JSON.parse(await readFile(packageFile, "utf8"));
const source = path.dirname(packageFile);
const target = path.join(import.meta.dirname, "..", "public", "vendor", "maplibre-gl", version);
await mkdir(target, { recursive: true });
for (const file of ["dist/maplibre-gl-worker.mjs", "dist/maplibre-gl-shared.mjs", "LICENSE.txt"]) {
  await copyFile(path.join(source, file), path.join(target, path.basename(file)));
}
