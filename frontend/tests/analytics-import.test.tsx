import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { err, kpis, mockFetch, recipient } from "./helpers";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock("recharts", async (orig) => {
  const m = await orig<typeof import("recharts")>();
  return { ...m, ResponsiveContainer: ({ children }: { children: React.ReactElement }) => <div style={{ width: 400, height: 200 }}>{children}</div> };
});
import { AnalyticsView } from "@/components/analytics-view";
import { Followups } from "@/components/followups";
import { ImportDialog } from "@/components/import-dialog";

const analytics = (k: Record<string, number | null> = kpis, over = {}) => ({ kpis: k, health: { label: "Needs attention", level: "bad" }, insights: [{ level: "warning", title: "Elevated bounce rate", message: "Delivery failures are elevated (20%)." }],
  status_breakdown: [{ key: "delivered", label: "Delivered", count: k.delivered }, { key: "bounced", label: "Bounced", count: k.bounced }],
  bounce_reasons: [{ key: "hard_bounce", label: "Hard bounce", count: 12 }, { key: "soft_bounce", label: "Soft bounce", count: 8 }],
  engagement: [], timeline: [{ date: "2026-03-01", sent: 100, delivered: 80, bounced: 20, opens: 40, clicks: 8 }], registrations: null, ...over });
const campaigns = { items: [{ id: 1, name: "Spring", status: "sent" }, { id: 2, name: "Draft one", status: "draft" }] };
const zero = { attempted: 0, delivered: 0, bounced: 0, delivery_rate: null, bounce_rate: null, unique_opens: 0, open_rate: null, unique_clicks: 0, click_rate: null };

describe("AnalyticsView", () => {
  it("renders KPIs, rates and charts from API data", async () => {
    mockFetch({ "GET /api/campaigns": campaigns, "GET /api/analytics": analytics() });
    render(<AnalyticsView />);
    const kp = await screen.findByTestId("kpis");
    expect(within(kp).getByText("100")).toBeInTheDocument();
    expect(within(kp).getByText("Delivery rate 80.0%")).toBeInTheDocument();
    expect(within(kp).getByText("Bounce rate 20.0%")).toBeInTheDocument();
    expect(within(kp).getByText("Open rate 50.0%")).toBeInTheDocument();
    expect(within(kp).getByText("Click rate 10.0%")).toBeInTheDocument();
    expect(screen.getByTestId("chart-status")).toHaveTextContent("Bounced");
    expect(screen.getByTestId("chart-bounces")).toHaveTextContent("Hard bounce: 12");
    expect(screen.getByTestId("chart-timeline")).toBeInTheDocument();
    expect(screen.getByText("Elevated bounce rate")).toBeInTheDocument();
    expect(screen.getByText(/privacy proxies and security scanners/)).toBeInTheDocument();
    expect(screen.getByText(/No registration data has been imported/)).toBeInTheDocument();
  });

  it("only offers sent campaigns and refetches when filters change", async () => {
    const { calls } = mockFetch({ "GET /api/campaigns": campaigns, "GET /api/analytics": (c: { url: string }) => (c.url.includes("domain=gmail.com") ? analytics({ ...kpis, attempted: 5, delivered: 5, bounced: 0, delivery_rate: 100, bounce_rate: 0 }) : analytics()) });
    render(<AnalyticsView />);
    await screen.findByTestId("kpis");
    await userEvent.click(screen.getByRole("combobox", { name: "Campaign" }));
    expect(screen.queryByRole("option", { name: "Draft one" })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("option", { name: "Spring" }));
    await waitFor(() => expect(calls.some((c) => c.url.includes("campaign_id=1"))).toBe(true));
    await userEvent.type(screen.getByLabelText("Recipient domain"), "gmail.com");
    await waitFor(() => expect(calls.some((c) => c.url.includes("domain=gmail.com"))).toBe(true));
    expect(await screen.findByText("Delivery rate 100.0%")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Sent from"), { target: { value: "2026-03-01" } });
    await waitFor(() => expect(calls.some((c) => c.url.includes("date_from=2026-03-01"))).toBe(true));
  });

  it("handles zero denominators with an em dash and no-data charts", async () => {
    mockFetch({ "GET /api/campaigns": campaigns, "GET /api/analytics": analytics(zero, { status_breakdown: [], bounce_reasons: [], timeline: [], insights: [] }) });
    render(<AnalyticsView />);
    await screen.findByTestId("kpis");
    expect(screen.getByTestId("m-open-rate")).toHaveTextContent("—");
    expect(screen.getByTestId("m-click-rate")).toHaveTextContent("—");
    expect(screen.getAllByText("No data for the current filters").length).toBeGreaterThan(0);
  });

  it("shows an empty state when nothing has been sent, and an error state on failure", async () => {
    mockFetch({ "GET /api/campaigns": { items: [{ id: 2, name: "Draft", status: "draft" }] } });
    const { unmount } = render(<AnalyticsView />);
    expect(await screen.findByText("No sent campaigns yet")).toBeInTheDocument();
    unmount();
    mockFetch({ "GET /api/campaigns": campaigns, "GET /api/analytics": () => err(500, "Something went wrong. Please try again.") });
    render(<AnalyticsView />);
    expect(await screen.findByText("Something went wrong. Please try again.")).toBeInTheDocument();
  });

  it("offers a summary export for a selected campaign", async () => {
    mockFetch({ "GET /api/campaigns": campaigns, "GET /api/analytics": analytics() });
    render(<AnalyticsView initialCampaign="1" />);
    expect((await screen.findByRole("link", { name: /Export summary/ })).getAttribute("href")).toMatch(/\/api\/exports\/campaigns\/1\/summary$/);
  });
});

describe("Followups", () => {
  const member = (id: number, included: boolean, reason: string) => ({ ...recipient({ id, name: `P${id}`, email: `p${id}@example.com`, delivery_status: "delivered" }), included, reason });
  const seg = (key: string, label: string, members: unknown[], eligible: number) => ({ key, label, description: "d", total: members.length, eligible, excluded: members.length - eligible, members });
  const data = { segments: [seg("bounced", "Bounced recipients", [member(1, false, "Excluded: permanent failure (Hard bounce); correct the address first")], 0), seg("unopened", "Delivered, not opened", [member(2, true, "Included: delivered with no recorded open"), member(3, false, "Excluded: contact has unsubscribed")], 1), seg("opened_not_clicked", "Opened, not clicked", [], 0)] };

  it("shows inclusion/exclusion reasons, exports eligible only, and never sends", async () => {
    const { calls } = mockFetch({ "GET /api/campaigns/1/followups": data });
    render(<Followups campaignId={1} />);
    expect(await screen.findByText(/permanent failure/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("segment-unopened"));
    const t = screen.getByTestId("segment-table");
    expect(within(t).getByText("Included: delivered with no recorded open")).toBeInTheDocument();
    expect(within(t).getByText("Excluded: contact has unsubscribed")).toBeInTheDocument();
    expect(screen.getByTestId("export-segment").getAttribute("href")).toMatch(/followups\/export\?segment=unopened$/);
    expect(calls.some((c) => c.url.includes("execute"))).toBe(false);
  });

  it("creates, edits and previews a draft", async () => {
    const tpl = { id: 9, name: "n", subject: "Did you miss this?", body_html: "<p>Hi {{first_name}}</p>", segment: "unopened", campaign_id: 1 };
    const { calls } = mockFetch({ "GET /api/campaigns/1/followups": data, "POST /api/campaigns/1/followups/draft": tpl, "GET /api/templates/9/preview": { html: "<p>Hi Alex</p>", subject: "x" }, "PATCH /api/templates/9": (c: { body: Record<string, string> }) => ({ ...tpl, ...c.body }) });
    render(<Followups campaignId={1} />);
    await userEvent.click(await screen.findByTestId("segment-unopened"));
    await userEvent.click(screen.getByRole("button", { name: /Create follow-up draft/ }));
    const subject = await screen.findByLabelText("Subject");
    expect(screen.getByTitle("Follow-up preview")).toHaveAttribute("srcdoc", "<p>Hi Alex</p>");
    await userEvent.clear(subject);
    await userEvent.type(subject, "Edited");
    await userEvent.click(screen.getByRole("button", { name: /Save & refresh preview/ }));
    expect(await screen.findByText("Draft saved. Nothing has been sent.")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "PATCH")?.body).toMatchObject({ subject: "Edited" });
  });
});

describe("ImportDialog", () => {
  const result = (over = {}) => ({ dry_run: true, headers: ["contact_id", "email"], mapping: { contact_id: "contact_id", email: "email" }, missing_required: [], total_rows: 3, valid_rows: 2, imported_rows: 0, rejected_rows: 1, warning_rows: 0,
    issues: [{ row: 3, severity: "error", code: "missing_email", message: "email is required", field: "email" }], preview: [{ row: 2, status: "ok", email: "a@example.com", message: "" }, { row: 3, status: "error", email: "", message: "email is required" }], summary: {}, ...over });
  const file = () => new File(["contact_id,email\nC1,a@example.com\n"], "contacts.csv", { type: "text/csv" });

  it("previews first, reports invalid rows, offers an error report, then commits", async () => {
    const onDone = vi.fn();
    const { calls } = mockFetch({ "POST /api/import/contacts": (c: { body: FormData }) => (c.body.get("commit") === "true" ? result({ dry_run: false, imported_rows: 2 }) : result()) });
    render(<ImportDialog kind="contacts" open onOpenChange={() => {}} onDone={onDone} />);
    await userEvent.upload(screen.getByTestId("csv-input"), file());
    const sum = await screen.findByTestId("import-summary");
    expect(sum).toHaveTextContent("3");
    expect(screen.getByText("email is required", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Error report/ })).toBeInTheDocument();
    expect((calls[0].body as FormData).get("commit")).toBe("false");
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await userEvent.click(screen.getByRole("button", { name: /Error report/ }));
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    click.mockRestore();
    await userEvent.click(screen.getByRole("button", { name: "Import 2 rows" }));
    expect(await screen.findByText(/Imported 2 rows/)).toBeInTheDocument();
    expect((calls[1].body as FormData).get("commit")).toBe("true");
    expect(onDone).toHaveBeenCalled();
  });

  it("surfaces server errors for empty or malformed files", async () => {
    mockFetch({ "POST /api/import/contacts": () => err(422, "The CSV file is empty.") });
    render(<ImportDialog kind="contacts" open onOpenChange={() => {}} />);
    await userEvent.upload(screen.getByTestId("csv-input"), new File([""], "empty.csv", { type: "text/csv" }));
    expect(await screen.findByText("The CSV file is empty.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Import \d+ rows/ })).toBeDisabled();
  });

  it("asks for column mapping when required columns are missing and disables import", async () => {
    mockFetch({ "POST /api/import/contacts": result({ headers: ["ID", "Mail"], mapping: { contact_id: "ID", email: null }, missing_required: ["email"], valid_rows: 0, issues: [], preview: [] }) });
    render(<ImportDialog kind="contacts" open onOpenChange={() => {}} />);
    await userEvent.upload(screen.getByTestId("csv-input"), file());
    expect(await screen.findByText("Map the required columns")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Import 0 rows/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Re-check with this mapping/ })).toBeInTheDocument();
  });
});
