// Keyboard, 200% enlargement and offline acceptance in local preview.
// Run: SURVEYNT_URL=http://127.0.0.1:3100 CHROMIUM_PATH=/path/to/chrome node acceptance/device-offline.mjs <screenshot-dir>
import { chromium } from "playwright-core";
const base = process.env.SURVEYNT_URL ?? "http://127.0.0.1:3100"; const shots = process.argv[2] ?? ".";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const results = []; const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(ok ? "PASS" : "FAIL", name, detail); };
const pages = ["/", "/start", "/app/demo/overview", "/app/demo/jobs", "/app/demo/jobs/job_01", "/app/demo/jobs/job_01/survey", "/app/demo/clients", "/app/demo/properties", "/app/demo/calendar", "/app/demo/routes", "/app/demo/finance", "/app/demo/documents", "/app/demo/team", "/app/demo/settings", "/platform/tenants"];
const overflowOf = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// Keyboard: skip link, dialog focus containment, Escape and focus return, visible focus.
{
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await page.goto(`${base}/app/demo/clients`, { waitUntil: "networkidle" });
  await page.keyboard.press("Tab");
  const skip = await page.evaluate(() => { const el = document.activeElement; const r = el.getBoundingClientRect(); return { text: el.textContent.trim(), visible: r.top >= 0 && r.bottom <= innerHeight && r.width > 0 }; });
  check("first Tab reaches a visible skip link", /skip/i.test(skip.text) && skip.visible, JSON.stringify(skip));
  await page.keyboard.press("Enter");
  check("skip link moves focus to the content region containing main", await page.evaluate(() => Boolean(document.activeElement.closest("main") || document.activeElement.querySelector?.(":scope > main, :scope main"))), await page.evaluate(() => document.activeElement.id));
  const trigger = page.getByRole("button", { name: "New client", exact: true });
  await trigger.focus(); await page.keyboard.press("Enter");
  await page.locator("#client-name").waitFor();
  check("dialog opens with focus inside it", await page.evaluate(() => Boolean(document.activeElement.closest("[role=dialog], dialog"))));
  let escaped = false;
  for (let i = 0; i < 15; i++) { await page.keyboard.press("Tab"); if (!(await page.evaluate(() => Boolean(document.activeElement.closest("[role=dialog], dialog"))))) escaped = true; }
  check("Tab stays inside the open dialog", !escaped);
  await page.keyboard.press("Escape");
  check("Escape closes the dialog", (await page.locator("#client-name").count()) === 0);
  check("focus returns to the trigger", await trigger.evaluate(el => el === document.activeElement));
  await page.goto(`${base}/app/demo/overview`, { waitUntil: "networkidle" });
  const invisible = [];
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => { const el = document.activeElement; if (el === document.body) return { label: "body", outline: true, shadow: true }; const s = getComputedStyle(el); return { label: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 30), outline: s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0, shadow: s.boxShadow !== "none" }; });
    if (!info.outline && !info.shadow) invisible.push(info.label);
  }
  check("first 30 tab stops on Overview show a focus indicator", invisible.length === 0, invisible.join(", "));
  await page.screenshot({ path: `${shots}/keyboard-focus.png` });
}
// Phone navigation by keyboard.
{
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await page.goto(`${base}/app/demo/overview`, { waitUntil: "networkidle" });
  const menu = page.locator(".menu-button");
  await menu.focus(); await page.keyboard.press("Enter");
  check("phone menu opens from the keyboard", await page.locator(".sidebar.open").count() === 1);
  await page.screenshot({ path: `${shots}/phone-menu.png` });
  await page.keyboard.press("Escape");
  check("Escape closes the phone menu", await page.locator(".sidebar.open").count() === 0);
}
// 200% enlargement: browser zoom (1280 CSS px window at 200% = 640 CSS px) and text-only 200%.
{
  const zoomed = await (await browser.newContext({ viewport: { width: 640, height: 450 }, deviceScaleFactor: 2 })).newPage();
  const text = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const zoomFail = [], textFail = [];
  for (const path of pages) {
    await zoomed.goto(base + path, { waitUntil: "networkidle" }); const z = await overflowOf(zoomed); if (z > 1) zoomFail.push(`${path} +${z}px`);
    await text.goto(base + path, { waitUntil: "networkidle" }); await text.addStyleTag({ content: "html{font-size:200%!important}" }); await text.waitForTimeout(100);
    const t = await overflowOf(text); if (t > 1) textFail.push(`${path} +${t}px`);
  }
  check("no page-level horizontal scrolling at 200% zoom (15 pages)", zoomFail.length === 0, zoomFail.join(", "));
  check("no page-level horizontal scrolling with 200% text (15 pages)", textFail.length === 0, textFail.join(", "));
  await zoomed.goto(`${base}/app/demo/jobs/job_01/survey`, { waitUntil: "networkidle" }); await zoomed.screenshot({ path: `${shots}/zoom200-survey.png` });
}
// Offline: service worker shell, device copy, permission gate kept, queued operation surfaced, copy removal.
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${base}/app/demo/jobs/job_01/survey`, { waitUntil: "networkidle" });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Device copy saved").waitFor();
  const local = await page.evaluate(async () => {
    const name = (await indexedDB.databases()).map(d => d.name).find(n => n?.startsWith("surveynt-offline-"));
    const db = await new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const packs = await new Promise(res => { const r = db.transaction("packs").objectStore("packs").getAll(); r.onsuccess = () => res(r.result); });
    return { name, surveyId: packs[0]?.surveyId, pack: packs[0]?.pack };
  });
  check("device copy is stored per user and practice", Boolean(local.name && local.surveyId), local.name);
  const fieldPath = local.pack.template.sections[0].elements[0].fields?.[0] ? `${local.pack.template.sections[0].key}.${local.pack.template.sections[0].elements[0].key}.${local.pack.template.sections[0].elements[0].fields[0].key}` : "about.inspection.surveyor_name";
  await context.setOffline(true);
  await page.evaluate(async ({ name, surveyId, fieldPath }) => {
    const db = await new Promise(res => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); });
    await new Promise(res => { const tx = db.transaction("outbox", "readwrite"); tx.objectStore("outbox").put({ operationId: "op_acceptance_offline_1", surveyId, operation: { type: "set_field", operationId: "op_acceptance_offline_1", fieldPath, value: { state: "provided", value: "Queued offline" }, baseValueId: null }, createdAt: new Date().toISOString(), status: "pending" }); tx.oncomplete = res; });
  }, { name: local.name, surveyId: local.surveyId, fieldPath });
  const offlineLoad = await page.reload().then(r => r?.status() ?? "served by service worker").catch(e => `failed: ${e.message.slice(0, 60)}`);
  await page.waitForTimeout(800);
  const offlineText = await page.locator("main").innerText().catch(() => "");
  check("survey reopens offline from the cached shell and device copy", offlineText.includes("18 Royal York Crescent"), String(offlineLoad));
  const bar = await page.locator(".sync-bar").innerText().catch(() => "");
  check("offline state and the waiting change are shown", /offline/i.test(bar) && /1/.test(bar), bar.replace(/\s+/g, " "));
  check("recording stays disabled offline (permission is not bypassed)", (await page.locator("main input:not([disabled]), main select:not([disabled]), main textarea:not([disabled])").count()) <= 2);
  await page.screenshot({ path: `${shots}/offline-survey.png` });
  await context.setOffline(false);
  const [sync] = await Promise.all([page.waitForResponse(r => /\/api\/v1\/surveys\/[^/]+\/sync$/.test(new URL(r.url()).pathname), { timeout: 15000 }).catch(() => null), page.evaluate(() => window.dispatchEvent(new Event("online")))]);
  await page.waitForTimeout(1500);
  const after = await page.locator(".sync-bar, .outbox, main").first().innerText();
  const entry = await page.evaluate(async ({ name }) => { const db = await new Promise(res => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); }); return await new Promise(res => { const r = db.transaction("outbox").objectStore("outbox").get("op_acceptance_offline_1"); r.onsuccess = () => res(r.result ?? null); }); }, { name: local.name });
  check("queued change is sent when back online", Boolean(sync), sync ? `${sync.status()} ${JSON.stringify(await sync.json().catch(() => null)).slice(0, 200)}` : "no sync request");
  check("a refused change is kept and shown, not silently dropped", entry === null ? false : entry.status !== "pending" || /rejected|could not|permission|not saved/i.test(after), entry ? `${entry.status}: ${entry.message ?? ""}` : "entry removed");
  await page.screenshot({ path: `${shots}/after-sync.png` });
  page.once("dialog", d => d.accept());
  await page.getByRole("button", { name: "Remove offline copy" }).click();
  await page.waitForTimeout(800);
  const remaining = await page.evaluate(async ({ name, surveyId }) => { const db = await new Promise(res => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); }); const get = s => new Promise(res => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result.filter(v => v.surveyId === surveyId).length); }); return { packs: await get("packs"), outbox: await get("outbox") }; }, local);
  check("Remove offline copy clears the device copy", remaining.packs === 0 && remaining.outbox === 0, JSON.stringify(remaining));
  const apiCached = await page.evaluate(async () => { for (const key of await caches.keys()) { const cache = await caches.open(key); if ((await cache.keys()).some(r => new URL(r.url).pathname.startsWith("/api/"))) return true; } return false; });
  check("service worker caches no API responses", !apiCached);
}
const failed = results.filter(r => !r.ok).length;
console.log(JSON.stringify({ passed: results.length - failed, failed }));
process.exitCode = failed ? 1 : 0;
await browser.close();
