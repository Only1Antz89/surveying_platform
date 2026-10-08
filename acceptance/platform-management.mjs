// Browser acceptance for platform management in local preview (no Clerk keys).
// Run: SURVEYNT_URL=http://127.0.0.1:3100 CHROMIUM_PATH=/path/to/chrome node acceptance/platform-management.mjs <screenshot-dir>
// Requires playwright-core (npx -p playwright-core) and a server started without Clerk keys.
import { chromium } from "playwright-core";
const base = process.env.SURVEYNT_URL ?? "http://127.0.0.1:3100"; const shots = process.argv[2] ?? ".";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const results = []; const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(ok ? "PASS" : "FAIL", name, detail); };
const watch = (page, label) => page.on("response", r => { if (r.url().includes("/api/") && r.status() >= 400) console.log(`  [${label}] ${r.request().method()} ${new URL(r.url()).pathname} -> ${r.status()}`); });
const operatorCtx = await browser.newContext(); const operator = await operatorCtx.newPage(); watch(operator, "operator");
const ownerCtx = await browser.newContext(); const owner = await ownerCtx.newPage(); watch(owner, "owner");
const stamp = Date.now().toString(36);

// 1. Tenant lifecycle persists.
await operator.goto(`${base}/platform/tenants/org_01`);
const workspace = await operator.getByRole("link", { name: "Open local demo client workspace" }).getAttribute("href");
const slug = workspace.split("/")[2]; console.log("tenant slug", slug);
const statusText = async () => (await operator.locator(".page-header, header").first().innerText());
await operator.getByRole("button", { name: "Suspend tenant" }).click();
await operator.getByLabel("Reason").fill("Acceptance check: suspension persists after reload.");
await operator.getByRole("button", { name: "Confirm suspension" }).click();
await operator.getByRole("button", { name: "Reactivate tenant" }).waitFor();
await operator.reload();
check("suspension persists after operator reload", await operator.getByRole("button", { name: "Reactivate tenant" }).isVisible());
await owner.goto(`${base}/app/${slug}/clients`);
const suspendedBody = await owner.locator("body").innerText();
check("suspended tenant workspace is blocked for the practice", suspendedBody.includes("Workspace access is suspended") && (await owner.getByRole("button", { name: "New client" }).count()) === 0);
await owner.screenshot({ path: `${shots}/01-suspended-workspace.png` });
await operator.getByRole("button", { name: "Reactivate tenant" }).click();
await operator.getByLabel("Reason").fill("Acceptance check: reactivation restores access.");
await operator.getByRole("button", { name: "Confirm reactivation" }).click();
await operator.getByRole("button", { name: "Suspend tenant" }).waitFor();
await operator.reload();
check("reactivation persists after operator reload", await operator.getByRole("button", { name: "Suspend tenant" }).isVisible());
await owner.reload();
check("reactivated workspace opens the client register", await owner.getByRole("button", { name: "New client" }).isVisible());

// 2. Write support access requires owner approval.
await operator.getByRole("button", { name: "Request support access" }).click();
await operator.getByLabel("Ticket reference").fill(`ACC-${stamp}`);
await operator.getByLabel("Permission").selectOption("write");
await operator.getByLabel("Reason").fill("Acceptance check: approved write support session.");
const [created] = await Promise.all([operator.waitForResponse(r => r.url().endsWith("/support-sessions") && r.request().method() === "POST"), operator.getByRole("button", { name: "Create support session" }).click()]);
const writeSessionId = (await created.json()).data?.id ?? (await created.json()).data?.session?.id;
console.log("write session", created.status(), writeSessionId);
await owner.goto(`${base}/app/${slug}/team`);
const row = owner.locator("tr", { hasText: `ACC-${stamp}` });
check("owner sees the pending write request", await row.isVisible());
await owner.screenshot({ path: `${shots}/02-owner-approval.png`, fullPage: true });
await operator.goto(`${base}/platform/support`);
const pendingHref = await operator.locator("tr", { hasText: `ACC-${stamp}` }).locator("a").first().getAttribute("href").catch(() => null);
console.log("pending row href", pendingHref);
check("queue shows the request as awaiting approval", (await operator.locator("tr", { hasText: `ACC-${stamp}` }).innerText()).includes("Awaiting approval"));
if (pendingHref) {
  const pendingResponse = await operator.goto(`${base}/platform/support/${writeSessionId}`);
  const canCreate = (await operator.getByRole("button", { name: "New client" }).count()) > 0 && await operator.getByRole("button", { name: "New client" }).isEnabled();
  check("unapproved write session gives no edit access", pendingResponse.status() === 404 || !canCreate, `status ${pendingResponse.status()}`);
  const pendingId = writeSessionId;
  const pendingWrite = await operator.evaluate(async ([id]) => (await fetch(`/api/platform/support/${id}/clients`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "individual", displayName: "Should fail before approval" }) })).status, [pendingId]);
  check("unapproved write session API write rejected", pendingWrite === 401 || pendingWrite === 403, String(pendingWrite));
}
const [approval] = await Promise.all([owner.waitForResponse(r => r.url().includes("/api/") && r.request().method() !== "GET"), row.getByRole("button", { name: "Approve" }).click()]);
console.log("approval", approval.status(), new URL(approval.url()).pathname);
await operator.goto(`${base}/platform/support`);
const sessionRow = operator.locator("tr", { hasText: `ACC-${stamp}` });
const href = await sessionRow.getByRole("link", { name: "Open support session" }).getAttribute("href").catch(() => null);
check("approved session is openable by the operator", Boolean(href), href ?? "");
await operator.screenshot({ path: `${shots}/03-support-queue.png`, fullPage: true });

// 3. Changes through the support session.
await operator.goto(base + href);
const name = `Acceptance Client ${stamp}`;
await operator.getByRole("button", { name: "New client" }).click();
await operator.locator("#client-name").fill(name);
await operator.locator("#client-email").fill(`acceptance-${stamp}@example.test`);
await operator.getByRole("button", { name: "Create client" }).click();
await operator.getByText(name).first().waitFor();
await operator.getByRole("row", { name: new RegExp(name) }).getByRole("button", { name: "Open" }).click();
await operator.locator("#edit-client-name").fill(`${name} Edited`);
await operator.locator("#edit-client-phone").fill("0117 000 0000");
await operator.getByRole("button", { name: "Save client details" }).click();
await operator.waitForTimeout(600);
await operator.getByText("Add a contact").click();
await operator.locator("#contact-name").fill("Acceptance Contact");
await operator.locator("#contact-email").fill(`contact-${stamp}@example.test`);
await operator.locator("input[name=primary]").check();
await operator.getByRole("button", { name: "Add contact" }).click();
await operator.getByText("Acceptance Contact").first().waitFor();
await operator.screenshot({ path: `${shots}/04-support-edit.png`, fullPage: true });

// 4. Visible in the practice's own register from a separate session, after reload.
const secondCtx = await browser.newContext(); const second = await secondCtx.newPage(); watch(second, "second");
await second.goto(`${base}/app/${slug}/clients`);
check("support-created client visible in practice register (second session)", await second.getByText(`${name} Edited`).first().isVisible());
await second.reload();
const clientRow = second.getByRole("row", { name: new RegExp(`${name} Edited`) });
check("edit persists after reload", await clientRow.isVisible());
check("phone change persisted", (await clientRow.innerText()).includes("0117 000 0000"));
await clientRow.getByRole("button", { name: "Open" }).click();
await second.getByText("Acceptance Contact").first().waitFor({ timeout: 5000 }).catch(() => {});
check("support-added primary contact visible to the practice", await second.getByText("Acceptance Contact").first().isVisible());
await second.screenshot({ path: `${shots}/05-practice-view.png`, fullPage: true });

// 5. Practice-side edit is visible back in the support session.
await second.locator("#edit-client-name").fill(`${name} Practice`);
await second.getByRole("button", { name: "Save client details" }).click();
await second.waitForTimeout(600);
await operator.reload();
check("practice edit visible in the support session", await operator.getByText(`${name} Practice`).first().isVisible());

// 6. Stale edit from the support session is rejected, not overwritten.
await operator.getByRole("row", { name: new RegExp(`${name} Practice`) }).getByRole("button", { name: "Open" }).click();
await second.reload();
await second.getByRole("row", { name: new RegExp(`${name} Practice`) }).getByRole("button", { name: "Open" }).click();
await second.locator("#edit-client-phone").fill("0117 111 1111");
await second.getByRole("button", { name: "Save client details" }).click(); await second.waitForTimeout(600);
await operator.locator("#edit-client-phone").fill("0117 222 2222");
await operator.getByRole("button", { name: "Save client details" }).click(); await operator.waitForTimeout(800);
const conflictText = await operator.locator("[role=alert], .form-error").allInnerTexts();
check("concurrent stale support edit returns a conflict", conflictText.some(t => /changed|conflict|newer|reload/i.test(t)), conflictText.join(" | "));
await second.reload();
check("newer practice edit kept", (await second.getByRole("row", { name: new RegExp(`${name} Practice`) }).innerText()).includes("0117 111 1111"));

// 7. Read-only session cannot edit; another tenant does not see the record.
await operator.goto(`${base}/platform/tenants/org_01`);
await operator.getByRole("button", { name: "Request support access" }).click();
await operator.getByLabel("Ticket reference").fill(`READ-${stamp}`);
await operator.getByLabel("Reason").fill("Acceptance check: read only session.");
await operator.getByRole("button", { name: "Create support session" }).click();
await operator.waitForTimeout(800);
await operator.goto(`${base}/platform/support`);
const readHref = await operator.locator("tr", { hasText: `READ-${stamp}` }).getByRole("link", { name: "Open support session" }).getAttribute("href").catch(() => null);
if (readHref) {
  await operator.goto(base + readHref);
  check("read-only session hides New client", (await operator.getByRole("button", { name: "New client" }).count()) === 0 || await operator.getByRole("button", { name: "New client" }).isDisabled());
  const id = readHref.split("/").pop();
  const status = await operator.evaluate(async ([id]) => (await fetch(`/api/platform/support/${id}/clients`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "individual", displayName: "Should fail" }) })).status, [id]);
  check("read-only session API write rejected", status === 401 || status === 403, String(status));
} else check("read-only session openable", false);
await operator.goto(`${base}/platform/tenants/org_02`);
const otherWorkspace = await operator.getByRole("link", { name: "Open local demo client workspace" }).getAttribute("href").catch(() => null);
if (otherWorkspace) { await second.goto(base + otherWorkspace); check("other tenant register does not show the record", (await second.getByText(name).count()) === 0, otherWorkspace); }
else check("other tenant has a local workspace", false, "no link");

const failed = results.filter(r => !r.ok).length;
console.log(JSON.stringify({ passed: results.length - failed, failed }));
process.exitCode = failed ? 1 : 0;
await browser.close();
