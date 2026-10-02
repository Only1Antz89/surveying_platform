// Runs the synthetic evaluation pack and prints a summary. Exits non-zero on any failure or unsupported claim.
import { runEvaluation } from "./cases";

const summary = await runEvaluation();
for (const result of summary.results) console.log(`${result.passed ? "PASS" : "FAIL"}  ${result.id.padEnd(28)} ${result.observed}`);
console.log(`\n${summary.passed}/${summary.total} passed · abstentions ${summary.correctAbstentions}/${summary.abstentionCases} · unsupported claims ${summary.unsupportedClaims}`);
if (summary.passed !== summary.total || summary.unsupportedClaims > 0) process.exitCode = 1;
