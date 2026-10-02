// Regenerates docs/property-intelligence/country-coverage.md from the registry.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { renderCoverageMarkdown } from "./coverage";

await writeFile(path.join(import.meta.dirname, "../../../../docs/property-intelligence/country-coverage.md"), renderCoverageMarkdown());
console.log("Wrote docs/property-intelligence/country-coverage.md");
