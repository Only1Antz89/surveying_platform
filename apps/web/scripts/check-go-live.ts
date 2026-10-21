// Reports which production keys are missing or malformed, and the webhook
// URLs to register with each provider. It prints variable names only.
//
//   vercel env pull .env.production.local --environment=production
//   pnpm --filter @surveynt/web check:go-live -- --env-file .env.production.local
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { goLiveChecks } from "../src/lib/go-live-checks";

function parseEnvFile(path: string) {
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return env;
}

const { values } = parseArgs({ options: { "env-file": { type: "string" } } });
const env = values["env-file"] ? parseEnvFile(values["env-file"]) : process.env;
const checks = goLiveChecks(env);
for (const check of checks) {
  console.log(`${check.ready ? "READY  " : "NOT SET"}  ${check.label}`);
  if (check.missing.length) console.log(`         missing: ${check.missing.join(", ")}`);
  for (const problem of check.problems) console.log(`         problem: ${problem}`);
  for (const entry of check.register) console.log(`         register ${entry.label}: ${entry.url}`);
  for (const approval of check.approvals) console.log(`         also needs: ${approval}`);
}
const notReady = checks.filter((check) => !check.ready).length;
console.log(`\n${checks.length - notReady} of ${checks.length} services ready.`);
if (notReady) process.exitCode = 1;
