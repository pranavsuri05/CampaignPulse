import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const DB = path.join(ROOT, "backend/data/e2e.db");
const API = "http://localhost:8100";
const SAMPLE = path.join(ROOT, "sample-data");

const sql = (q: string) => execFileSync("sqlite3", [DB, q], { encoding: "utf8" }).trim();
const n = (q: string) => Number(sql(q));
const csvRows = (file: string) => {
  const [head, ...rows] = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  const cols = head.split(",");
  return rows.map((r) => Object.fromEntries(r.split(",").map((v, i) => [cols[i], v])));
};

test.describe.configure({ mode: "serial" });

test("complete organizer journey: import → create → review → approve → simulate → analyze → diagnose → follow up → export", async ({ page, request }) => {
  const consoleErrors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  let campaignId = 0;

  await test.step("1-2. Start the app and open the dashboard (empty database, onboarding state)", async () => {
    expect(n("select count(*) from contacts")).toBe(0);
    expect(n("select count(*) from campaigns")).toBe(0);
    await page.goto("/");
    await expect(page.getByText("Your workspace is empty")).toBeVisible();
    await expect(page.getByTestId("sim-banner")).toContainText("Simulation Mode — No real emails are being sent.");
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("link")).toHaveText(["Overview", "Pre-send Review", "Email Analytics", "Recipient Diagnostics", "Settings"]);
  });

  await test.step("3. Import contacts.csv (preview, then commit)", async () => {
    await page.getByRole("button", { name: /Import contacts/ }).first().click();
    await page.getByTestId("csv-input").setInputFiles(path.join(SAMPLE, "contacts.csv"));
    await expect(page.getByTestId("import-summary")).toContainText("260");
    expect(n("select count(*) from contacts")).toBe(0); // preview wrote nothing
    await page.getByRole("button", { name: "Import 260 rows" }).click();
    await expect(page.getByText(/Imported 260 rows/)).toBeVisible();
    expect(n("select count(*) from contacts")).toBe(260);
    expect(n("select count(*) from suppressions where kind='unsubscribed'")).toBe(15);
    expect(n("select count(*) from suppressions where kind='suppressed'")).toBe(10);
    await page.getByRole("button", { name: "Close" }).last().click();
  });

  await test.step("4. Import campaign_recipients.csv", async () => {
    await page.getByRole("button", { name: /Import recipients/ }).click();
    await page.getByTestId("csv-input").setInputFiles(path.join(SAMPLE, "campaign_recipients.csv"));
    await expect(page.getByTestId("import-summary")).toContainText("360");
    await page.getByRole("button", { name: "Import 360 rows" }).click();
    await expect(page.getByText(/Imported 360 rows/)).toBeVisible();
    const rows = csvRows(path.join(SAMPLE, "campaign_recipients.csv"));
    expect(n("select count(*) from campaigns where source='import'")).toBe(3);
    expect(n("select count(*) from campaign_recipients")).toBe(360);
    expect(n("select count(*) from email_deliveries")).toBe(rows.filter((r) => r.delivery_status !== "not_sent").length);
    expect(n("select count(*) from email_deliveries where status='bounced'")).toBe(rows.filter((r) => r.delivery_status === "bounced").length);
    await page.getByRole("button", { name: "Close" }).last().click();
    await expect(page.getByRole("link", { name: "Spring Summit — Save the Date" })).toBeVisible();
  });

  await test.step("5-6. Configure a sender in Settings", async () => {
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Settings" }).click();
    await page.getByLabel("Sender name").fill("Summit Events Team");
    await page.getByLabel("Sender email").fill("not-an-email");
    await page.getByRole("button", { name: "Add sender" }).click();
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
    await page.getByLabel("Sender email").fill("events@example.com");
    await page.getByRole("button", { name: "Add sender" }).click();
    await expect(page.getByRole("cell", { name: "events@example.com", exact: true })).toBeVisible();
    expect(sql("select email from sender_configurations")).toBe("events@example.com");
  });

  await test.step("5-9. Create a campaign through the wizard (with a deliberate blocking problem)", async () => {
    await page.goto("/campaigns/new");
    await page.getByRole("button", { name: /Save & continue/ }).click();
    await expect(page.getByText("Campaign name is required")).toBeVisible();
    await page.getByLabel("Campaign name").fill("E2E Autumn Invite");
    await page.getByLabel("Event name").fill("Autumn Summit");
    await page.getByRole("button", { name: /Save & continue/ }).click();
    await expect(page.getByText("Step 2: Sender")).toBeVisible();
    expect(sql("select name from campaigns where name='E2E Autumn Invite'")).toBe("E2E Autumn Invite");
    await page.getByLabel("Saved sender").click();
    await page.getByRole("option", { name: /Summit Events Team/ }).click();
    await expect(page.getByLabel("Sender email")).toHaveValue("events@example.com");
    await page.getByRole("button", { name: /Save & continue/ }).click();
    await expect(page.getByText("Step 3: Subject")).toBeVisible();
    await page.getByLabel("Subject line").fill("Join us for {{event_name}}, {{first_name}}");
    await page.getByRole("button", { name: /Save & continue/ }).click(); // preview text intentionally empty → warning later
    await expect(page.getByText("Step 4: Audience")).toBeVisible();
    await page.getByRole("radio", { name: /Newsletter Subscribers/ }).check();
    await page.getByRole("button", { name: /Save & continue/ }).click();
    await expect(page.getByText("Step 5: Content")).toBeVisible();
    await page.getByLabel("Email HTML").fill('<h1>Hello {{first_name}}</h1><p>Welcome to {{event_name}} at {{company}}.</p><a href="https://example.com/register">Register</a><script>window.parent.document.title="pwned"</script>');
    await expect(page.frameLocator('iframe[title="Email preview"]').getByRole("heading", { name: /Hello/ })).toBeVisible();
    await page.getByRole("button", { name: /Save & go to review/ }).click();
    await expect(page).toHaveURL(/\/review\/\d+$/);
    campaignId = Number(page.url().split("/").pop());
    expect(n(`select count(*) from campaigns where id=${campaignId} and status='draft'`)).toBe(1);
  });

  const audiences = (await (await request.get(`${API}/api/audiences`)).json()).items as { name: string; total: number; eligible: number; invalid: number; duplicate: number; unsubscribed: number; suppressed: number }[];
  const aud = audiences.find((a) => a.name === "Newsletter Subscribers")!;

  await test.step("10-12. Pre-send review shows sender, subject, audience and a safe HTML preview", async () => {
    await expect(page.getByTestId("readonly-banner")).toBeVisible();
    await expect(page.getByTestId("review-sender-name")).toHaveText("Summit Events Team");
    await expect(page.getByTestId("review-sender-email")).toHaveText("events@example.com");
    await expect(page.getByTestId("review-subject")).toContainText("Join us for Autumn Summit,");
    for (const k of ["total", "eligible", "invalid", "duplicate", "suppressed", "unsubscribed"] as const) {
      await expect(page.getByTestId(`aud-${k}`)).toHaveText(String((aud as Record<string, number>)[k]));
    }
    const frame = page.frameLocator('iframe[data-mode="desktop"]');
    await expect(frame.getByRole("heading", { name: /^Hello / })).toBeVisible();
    await expect(frame.locator("script")).toHaveCount(0);
    expect(await page.title()).not.toBe("pwned");
    await expect(page.locator('iframe[data-mode="desktop"]')).toHaveAttribute("sandbox", "");
  });

  await test.step("12. Desktop and mobile previews", async () => {
    const desktop = await page.locator('iframe[data-mode="desktop"]').boundingBox();
    await page.getByRole("tab", { name: /Mobile/ }).click();
    const mobileFrame = page.locator('iframe[data-mode="mobile"]');
    await expect(mobileFrame).toBeVisible();
    const mobile = await mobileFrame.boundingBox();
    expect(mobile!.width).toBeLessThanOrEqual(376);
    expect(mobile!.width).toBeLessThan(desktop!.width);
    await expect(page.frameLocator('iframe[data-mode="mobile"]').getByRole("heading", { name: /^Hello / })).toBeVisible();
  });

  await test.step("13. Previewing does not modify the campaign", async () => {
    const before = sql(`select updated_at||'|'||status||'|'||subject||'|'||body_html from campaigns where id=${campaignId}`);
    const apiBefore = await (await request.get(`${API}/api/campaigns/${campaignId}`)).json();
    for (let i = 0; i < 3; i++) { await page.reload(); await expect(page.getByTestId("review-subject")).toBeVisible(); await page.getByRole("tab", { name: /Mobile/ }).click(); }
    await request.get(`${API}/api/campaigns/${campaignId}/preview`);
    expect(sql(`select updated_at||'|'||status||'|'||subject||'|'||body_html from campaigns where id=${campaignId}`)).toBe(before);
    expect(await (await request.get(`${API}/api/campaigns/${campaignId}`)).json()).toEqual(apiBefore);
    expect(n("select count(*) from email_deliveries where campaign_recipient_id in (select id from campaign_recipients where campaign_id=" + campaignId + ")")).toBe(0);
  });

  await test.step("14. Validation shows blocking and warning issues; approval is blocked", async () => {
    await expect(page.getByTestId("check-variables")).toHaveAttribute("data-severity", "blocking");
    await expect(page.getByTestId("check-variables")).toContainText("{{company}}");
    await expect(page.getByTestId("check-preview_text")).toHaveAttribute("data-severity", "warning");
    await expect(page.getByTestId("check-invalid")).toHaveAttribute("data-severity", "warning");
    await expect(page.getByRole("button", { name: /Approve campaign/ })).toBeDisabled();
    const r = await request.post(`${API}/api/campaigns/${campaignId}/approve`, { data: { acknowledge_warnings: true } });
    expect(r.status()).toBe(422);
    const x = await request.post(`${API}/api/campaigns/${campaignId}/execute`);
    expect(x.status()).toBe(409);
  });

  await test.step("15. Fix the blocking issue via the separate Edit flow", async () => {
    await page.getByRole("link", { name: /Edit campaign/ }).click();
    await page.getByRole("button", { name: /^5 Content$/ }).click();
    await page.getByLabel("Email HTML").fill('<h1>Hello {{first_name}}</h1><p>Welcome to {{event_name}}.</p><p><a href="https://example.com/register">Register</a></p><p><a href="{{unsubscribe_url}}">Unsubscribe</a></p>');
    await page.getByRole("button", { name: /Save & go to review/ }).click();
    await expect(page).toHaveURL(new RegExp(`/review/${campaignId}$`));
    await expect(page.getByTestId("check-variables")).toHaveCount(0);
    await expect(page.getByTestId("check-preview_text")).toBeVisible(); // warning remains
  });

  await test.step("16. Approve (warnings must be acknowledged)", async () => {
    const approve = page.getByRole("button", { name: /Approve campaign/ });
    await expect(approve).toBeDisabled();
    await page.getByRole("checkbox", { name: "Acknowledge warnings" }).click();
    await approve.click();
    await expect(page.getByRole("button", { name: /Execute in Simulation Mode/ })).toBeVisible();
    expect(sql(`select status from campaigns where id=${campaignId}`)).toBe("approved");
  });

  await test.step("17-18. Execute in simulation mode and verify delivery records", async () => {
    await page.getByRole("button", { name: /Execute in Simulation Mode/ }).click();
    await expect(page.getByText("Execute in Simulation Mode?")).toBeVisible();
    await page.getByRole("button", { name: "Run simulation" }).click();
    await expect(page.getByText("Executed in Simulation Mode")).toBeVisible();
    expect(sql(`select status from campaigns where id=${campaignId}`)).toBe("sent");
    const deliveries = n(`select count(*) from email_deliveries d join campaign_recipients r on r.id=d.campaign_recipient_id where r.campaign_id=${campaignId}`);
    expect(deliveries).toBe(aud.eligible);
    expect(n(`select count(*) from campaign_recipients where campaign_id=${campaignId}`)).toBe(aud.total);
    expect(n(`select count(*) from campaign_recipients where campaign_id=${campaignId} and eligibility='eligible'`)).toBe(aud.eligible);
    // excluded recipients never got a delivery
    expect(n(`select count(*) from email_deliveries d join campaign_recipients r on r.id=d.campaign_recipient_id where r.campaign_id=${campaignId} and r.eligibility!='eligible'`)).toBe(0);
    // no unsubscribed / suppressed address received a send
    expect(n(`select count(*) from email_deliveries d join campaign_recipients r on r.id=d.campaign_recipient_id join contacts c on c.id=r.contact_id where r.campaign_id=${campaignId} and c.email_normalized in (select email_normalized from suppressions)`)).toBe(0);
    expect(n(`select count(*) from email_deliveries d join campaign_recipients r on r.id=d.campaign_recipient_id where r.campaign_id=${campaignId} and d.provider='simulation'`)).toBe(deliveries);
    expect(n(`select count(*) from email_deliveries d join campaign_recipients r on r.id=d.campaign_recipient_id where r.campaign_id=${campaignId} and d.status='bounced' and d.bounce_type is null`)).toBe(0);
    // duplicate execution is prevented
    const events = n("select count(*) from communication_events");
    for (let i = 0; i < 3; i++) {
      const again = await request.post(`${API}/api/campaigns/${campaignId}/execute`);
      expect(again.status()).toBe(200);
      expect((await again.json()).already_executed).toBe(true);
    }
    expect(n(`select count(*) from email_deliveries d join campaign_recipients r on r.id=d.campaign_recipient_id where r.campaign_id=${campaignId}`)).toBe(deliveries);
    expect(n("select count(*) from communication_events")).toBe(events);
    await expect(page.getByRole("button", { name: /Execute in Simulation Mode/ })).toHaveCount(0);
  });

  await test.step("19-20. Analytics match database records", async () => {
    await page.getByRole("link", { name: /View analytics/ }).click();
    await expect(page.getByTestId("kpis")).toBeVisible();
    const q = (extra: string) => n(`select count(*) from email_deliveries d join campaign_recipients r on r.id=d.campaign_recipient_id where r.campaign_id=${campaignId} ${extra}`);
    const attempted = q(""), delivered = q("and d.status='delivered'"), bounced = q("and d.status='bounced'");
    const opens = n(`select count(distinct e.delivery_id) from communication_events e join email_deliveries d on d.id=e.delivery_id join campaign_recipients r on r.id=d.campaign_recipient_id where r.campaign_id=${campaignId} and e.event_type='open'`);
    const clicks = n(`select count(distinct e.delivery_id) from communication_events e join email_deliveries d on d.id=e.delivery_id join campaign_recipients r on r.id=d.campaign_recipient_id where r.campaign_id=${campaignId} and e.event_type='click'`);
    const kp = page.getByTestId("kpis");
    await expect(kp).toContainText(`Delivery rate ${(delivered / attempted * 100).toFixed(1)}%`);
    await expect(kp).toContainText(`Bounce rate ${(bounced / attempted * 100).toFixed(1)}%`);
    await expect(kp).toContainText(`Open rate ${(opens / delivered * 100).toFixed(1)}%`);
    await expect(kp).toContainText(`Click rate ${(clicks / delivered * 100).toFixed(1)}%`);
    await expect(kp.getByText(String(attempted), { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("chart-status")).toContainText(`${bounced}`);
    // filters change data
    await page.getByLabel("Recipient domain").fill("no-such-domain.org");
    await expect(page.getByTestId("m-delivery-rate")).toHaveText("—");
    await page.getByLabel("Recipient domain").fill("");
    await expect(page.getByTestId("m-delivery-rate")).toHaveText(`${(delivered / attempted * 100).toFixed(1)}%`);
  });

  let bouncedEmail = "";
  await test.step("21-24. Recipient diagnostics: search, filter hard bounces, inspect", async () => {
    bouncedEmail = sql(`select c.email from email_deliveries d join campaign_recipients r on r.id=d.campaign_recipient_id join contacts c on c.id=r.contact_id where r.campaign_id=${campaignId} and d.bounce_type='hard_bounce' order by c.id limit 1`);
    expect(bouncedEmail).toContain("@");
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Recipient Diagnostics" }).click();
    await page.getByLabel("Search recipients").fill(bouncedEmail);
    await expect(page.getByTestId("result-count")).toContainText(/^[1-9]\d* recipients/);
    await expect(page.getByRole("cell", { name: bouncedEmail }).first()).toBeVisible();
    await page.getByLabel("Search recipients").fill("");
    await page.getByRole("combobox", { name: "Bounce type filter" }).click();
    await page.getByRole("option", { name: "Hard bounce" }).click();
    const hard = n("select count(*) from email_deliveries where bounce_type='hard_bounce'");
    await expect(page.getByTestId("result-count")).toContainText(`${hard} recipients`);
    const rows = page.locator('[data-testid="recipient-table"] tbody tr');
    for (const t of await rows.allTextContents()) expect(t).toContain("Hard bounce");
    await page.getByLabel("Search recipients").fill(bouncedEmail);
    await page.getByRole("button", { name: `Inspect ${bouncedEmail}` }).first().click();
    const drawer = page.getByTestId("recipient-drawer");
    await expect(drawer).toContainText(bouncedEmail);
    await expect(drawer).toContainText("Hard bounce");
    const reason = sql(`select d.bounce_reason from email_deliveries d join campaign_recipients r on r.id=d.campaign_recipient_id join contacts c on c.id=r.contact_id where c.email='${bouncedEmail}' and r.campaign_id=${campaignId}`);
    if (reason) await expect(drawer).toContainText(reason);
    await page.keyboard.press("Escape");
  });

  await test.step("25. Generate a follow-up draft", async () => {
    await page.goto(`/analytics?campaign=${campaignId}`);
    await page.getByRole("tab", { name: "Follow-ups" }).click();
    await page.getByTestId("segment-unopened").click();
    await page.getByRole("button", { name: /Create follow-up draft/ }).click();
    await expect(page.getByLabel("Subject")).toHaveValue(/Did you miss this\?/);
    await expect(page.frameLocator('iframe[title="Follow-up preview"]').getByText(/Autumn Summit/)).toBeVisible();
    await page.getByLabel("Subject").fill("Edited follow-up subject");
    await page.getByRole("button", { name: /Save & refresh preview/ }).click();
    await expect(page.getByText("Draft saved. Nothing has been sent.")).toBeVisible();
    expect(sql(`select subject from email_templates where campaign_id=${campaignId} and segment='unopened'`)).toBe("Edited follow-up subject");
    expect(sql(`select status from campaigns where id=${campaignId}`)).toBe("sent");
  });

  await test.step("26. Export the affected recipient segment (suppression-safe)", async () => {
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-segment").click()]);
    const file = await download.path();
    const lines = fs.readFileSync(file!, "utf8").trim().split(/\r?\n/);
    const header = lines[0].split(",");
    expect(header).toContain("email");
    const emails = lines.slice(1).map((l) => l.split(",")[header.indexOf("email")]);
    const expected = sql(`select lower(c.email) from email_deliveries d join campaign_recipients r on r.id=d.campaign_recipient_id join contacts c on c.id=r.contact_id where r.campaign_id=${campaignId} and d.status='delivered' and not exists (select 1 from communication_events e where e.delivery_id=d.id and e.event_type='open') and c.email_normalized not in (select email_normalized from suppressions) order by lower(c.email)`).split("\n").filter(Boolean);
    expect(emails.map((e) => e.toLowerCase())).toEqual(expected);
    const supp = sql("select group_concat(email_normalized,'|') from suppressions").split("|");
    for (const e of emails) expect(supp).not.toContain(e.toLowerCase());
  });

  await test.step("No critical console errors", async () => {
    // Playwright's own frame instrumentation is blocked by the intentionally script-less email sandbox
    // ("allow-scripts" is never granted). The same page logs no errors in a normal browser session.
    const ignorable = /favicon|Download the React DevTools|Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed/;
    expect(consoleErrors.filter((e) => !ignorable.test(e))).toEqual([]);
  });
});
