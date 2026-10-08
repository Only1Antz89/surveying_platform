// Responsive (6 widths x light/dark) and axe WCAG 2.2 AA sweep over key pages in local preview.
// Run: SURVEYNT_URL=http://127.0.0.1:3100 CHROMIUM_PATH=/path/to/chrome node acceptance/responsive-accessibility.mjs <output-dir>
// Requires playwright-core and axe-core resolvable from the working directory.
import { createRequire } from "node:module";
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync } from "node:fs";
const base = process.env.SURVEYNT_URL ?? "http://127.0.0.1:3100"; const out = process.argv[2] ?? ".";
const axe = readFileSync(createRequire(process.cwd() + "/").resolve("axe-core/axe.min.js"), "utf8");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const probe = await (await browser.newContext()).newPage();
await probe.goto(`${base}/app/demo/jobs`);
const jobHref = await probe.locator("a[href*='/app/demo/jobs/']").first().getAttribute("href");
const jobId = jobHref.split("/")[4];
const pages = ["/", "/start", "/app/demo/overview", "/app/demo/jobs", jobHref, `/app/demo/jobs/${jobId}/survey`, "/app/demo/clients", "/app/demo/properties", "/app/demo/calendar", "/app/demo/routes", "/app/demo/finance", "/app/demo/documents", "/app/demo/team", "/app/demo/settings", "/platform/tenants"];
const widths = [360, 390, 768, 1024, 1440, 1920]; const themes = ["light", "dark"];
const report = { overflow: [], axe: {}, errors: [] };
for (const theme of themes) for (const width of widths) {
  const context = await browser.newContext({ viewport: { width, height: width < 800 ? 844 : 900 }, colorScheme: theme, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", e => report.errors.push({ theme, width, url: page.url(), message: e.message.slice(0, 200) }));
  for (const path of pages) {
    const response = await page.goto(base + path, { waitUntil: "networkidle" }).catch(e => ({ status: () => `error ${e.message.slice(0, 60)}` }));
    if (response.status() !== 200) report.errors.push({ theme, width, path, status: response.status() });
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement; if (doc.scrollWidth <= doc.clientWidth + 1) return null;
      const culprits = [...document.querySelectorAll("body *")].filter(el => { const r = el.getBoundingClientRect(); return r.right > doc.clientWidth + 1 && r.width > 0 && getComputedStyle(el).position !== "fixed"; })
        .filter(el => !el.parentElement || el.parentElement.getBoundingClientRect().right <= doc.clientWidth + 1).slice(0, 4).map(el => `${el.tagName.toLowerCase()}.${[...el.classList].join(".")} (${Math.round(el.getBoundingClientRect().right)}px)`);
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, culprits };
    });
    if (overflow) report.overflow.push({ theme, width, path, ...overflow });
    if (width === 390 || width === 1440) {
      await page.addScriptTag({ content: axe });
      const result = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } })).violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 3).map(n => n.target.join(" ")) })));
      for (const v of result) { const key = `${v.id}`; (report.axe[key] ??= { impact: v.impact, help: v.help, hits: [] }).hits.push({ theme, width, path, nodes: v.nodes, targets: v.targets }); }
      if (["/app/demo/overview", `/app/demo/jobs/${jobId}/survey`, "/app/demo/clients", "/platform/tenants", "/"].includes(path)) await page.screenshot({ path: `${out}/${theme}-${width}-${path.replaceAll("/", "_") || "home"}.png` });
    }
  }
  await context.close();
}
writeFileSync(`${out}/sweep.json`, JSON.stringify(report, null, 1));
console.log("overflow cases", report.overflow.length); for (const o of report.overflow) console.log(" ", o.theme, o.width, o.path, o.scrollWidth, o.culprits.join(" | "));
console.log("axe rules"); for (const [id, v] of Object.entries(report.axe)) console.log(" ", v.impact, id, "-", v.help, "pages:", [...new Set(v.hits.map(h => h.path))].join(","), "themes:", [...new Set(v.hits.map(h => h.theme))].join(","), "eg:", v.hits[0].targets[0]);
console.log("errors", JSON.stringify(report.errors.slice(0, 10)));
await browser.close();
process.exitCode = report.overflow.length || Object.keys(report.axe).length || report.errors.length ? 1 : 0;
