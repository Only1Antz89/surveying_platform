import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  // AI use must pass the governance gate (A6): obtain models only through governedModelFor().
  {
    rules: {
      "no-restricted-imports": ["error", { paths: [{ name: "@surveynt/assistant", importNames: ["getAssistantModel", "noProviderModel", "getGovernedModel"], message: "Use governedModelFor() from @/lib/ai-governance so AI use passes the governance gate." }] }],
    },
  },
  { files: ["src/lib/ai-governance.ts"], rules: { "no-restricted-imports": "off" } },
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Third-party files copied at build time (scripts/copy-maplibre-worker.mjs).
    "public/vendor/**",
    "public/fieldwork/vendor/**",
  ]),
]);

export default eslintConfig;
