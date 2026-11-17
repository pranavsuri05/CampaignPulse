import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { err, kpis, mockFetch } from "./helpers";

const push = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push }), useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
import { ReviewView } from "@/components/review-view";

const camp = (status = "draft") => ({ id: 1, name: "Spring Invite", campaign_type: "invitation", status, approved_at: status === "approved" ? "2026-03-01T00:00:00Z" : null, executed_at: null });
const aud = { total: 7, eligible: 3, invalid: 1, duplicate: 1, unsubscribed: 1, suppressed: 1 };
const preview = { campaign_id: 1, status: "draft", name: "Spring Invite", sender: { name: "Events Team", email: "events@example.com" }, subject: "Hi Ada", preview_text: "Join us", audience: { name: "Webinar", ...aud }, html: "<p>Hello Ada</p>", sample_recipient: { id: 1, name: "Ada Lovelace", email: "ada@example.com" } };
const check = (id: string, severity: string, status = "fail") => ({ id, label: `Label ${id}`, status, severity, message: `Message ${id}`, suggestion: status === "fail" ? `Fix ${id}` : null });
const validation = (over = {}) => ({ campaign_id: 1, checks: [check("invalid", "warning"), check("duplicates", "information"), check("sender_name", "blocking", "pass")], audience: aud, blocking_count: 0, warning_count: 1, info_count: 1, can_approve: true, requires_acknowledgement: true, readiness_score: 90, score_rules: "100 − 25 per blocking issue − 10 per warning (min 0).", ...over });

function setup(c = camp(), v = validation(), extra: Record<string, unknown> = {}) {
  return mockFetch({ "GET /api/campaigns/1": c, "GET /api/campaigns/1/preview": preview, "POST /api/campaigns/1/validate": v, ...extra });
}

describe("ReviewView (pre-send review)", () => {
  it("shows sender, subject, preview text and audience counts", async () => {
    setup();
    render(<ReviewView campaignId={1} />);
    expect(await screen.findByTestId("review-sender-name")).toHaveTextContent("Events Team");
    expect(screen.getByTestId("review-sender-email")).toHaveTextContent("events@example.com");
    expect(screen.getByTestId("review-subject")).toHaveTextContent("Hi Ada");
    expect(screen.getByTestId("review-preview-text")).toHaveTextContent("Join us");
    for (const [k, n] of Object.entries(aud)) expect(screen.getByTestId(`aud-${k}`)).toHaveTextContent(String(n));
    expect(screen.getByTestId("readiness-score")).toHaveTextContent("90");
    expect(screen.getByText(/Score rules:/)).toBeInTheDocument();
  });

  it("is read-only: only GETs and the side-effect-free validate POST happen, and Edit is a separate link", async () => {
    const { calls } = setup();
    render(<ReviewView campaignId={1} />);
    await screen.findByTestId("review-subject");
    expect(calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.url}`)).toEqual(["POST /api/campaigns/1/validate"]);
    expect(screen.getByRole("link", { name: /Edit campaign/ })).toHaveAttribute("href", "/campaigns/1/edit");
    expect(screen.getByTestId("readonly-banner")).toHaveTextContent(/never modifies the campaign/);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument(); // no editable fields on the review page
  });

  it("switches between desktop and mobile previews of the rendered HTML", async () => {
    setup();
    render(<ReviewView campaignId={1} />);
    const frame = await screen.findByTestId("email-frame");
    expect(frame).toHaveAttribute("data-mode", "desktop");
    expect(frame).toHaveAttribute("srcdoc", "<p>Hello Ada</p>");
    await userEvent.click(screen.getByRole("tab", { name: /Mobile/ }));
    expect(screen.getByTestId("email-frame")).toHaveAttribute("data-mode", "mobile");
    expect(screen.getByTestId("inbox-from")).toHaveTextContent("Events Team <events@example.com>");
  });

  it("groups issues by severity with a suggestion for each", async () => {
    setup();
    render(<ReviewView campaignId={1} />);
    const w = await screen.findByTestId("check-invalid");
    expect(w).toHaveAttribute("data-severity", "warning");
    expect(within(w).getByText(/Suggestion: Fix invalid/)).toBeInTheDocument();
    expect(screen.getByTestId("check-duplicates")).toHaveAttribute("data-severity", "information");
    expect(screen.getByText("Warning (1)")).toBeInTheDocument();
  });

  it("requires acknowledging warnings before approval, then approves", async () => {
    let status = "draft";
    const { calls } = setup(camp(), validation(), { "GET /api/campaigns/1": () => camp(status), "POST /api/campaigns/1/approve": () => { status = "approved"; return {}; } });
    render(<ReviewView campaignId={1} />);
    const btn = await screen.findByRole("button", { name: /Approve campaign/ });
    expect(btn).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: "Acknowledge warnings" }));
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    await waitFor(() => expect(calls.find((c) => c.url.endsWith("/approve"))?.body).toEqual({ acknowledge_warnings: true }));
    expect(await screen.findByRole("button", { name: /Execute in Simulation Mode/ })).toBeInTheDocument();
  });

  it("blocks approval when there are blocking issues", async () => {
    setup(camp(), validation({ checks: [check("subject", "blocking")], blocking_count: 1, warning_count: 0, can_approve: false, requires_acknowledgement: false, readiness_score: 75 }));
    render(<ReviewView campaignId={1} />);
    expect(await screen.findByRole("button", { name: /Approve campaign/ })).toBeDisabled();
    expect(screen.getByText("Blocking issues")).toBeInTheDocument();
    expect(screen.getByTestId("check-subject")).toHaveAttribute("data-severity", "blocking");
  });

  it("asks for confirmation before executing and reports simulation", async () => {
    let status = "approved";
    const { calls } = setup(camp("approved"), validation(), {
      "GET /api/campaigns/1": () => camp(status),
      "POST /api/campaigns/1/execute": () => { status = "sent"; return { already_executed: false, kpis: { attempted: 3, delivered: 3, bounced: 0 } }; },
    });
    render(<ReviewView campaignId={1} />);
    await userEvent.click(await screen.findByRole("button", { name: /Execute in Simulation Mode/ }));
    expect(await screen.findByText("Execute in Simulation Mode?")).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith("/execute"))).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Run simulation" }));
    expect(await screen.findByText("Executed in Simulation Mode")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View analytics/ })).toHaveAttribute("href", "/analytics?campaign=1");
    expect(screen.queryByRole("button", { name: /Approve campaign/ })).not.toBeInTheDocument();
  });

  it("confirms deletion", async () => {
    const { calls } = setup(camp(), validation(), { "DELETE /api/campaigns/1": new Response(null, { status: 204 }) });
    render(<ReviewView campaignId={1} />);
    await userEvent.click(await screen.findByRole("button", { name: /Delete/ }));
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await userEvent.click(await screen.findByRole("button", { name: "Delete campaign" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/review"));
  });

  it("shows an error state when the API fails", async () => {
    mockFetch({ "GET /api/campaigns/1": () => err(404, "Campaign 1 not found"), "GET /api/campaigns/1/preview": () => err(404, "Campaign 1 not found"), "POST /api/campaigns/1/validate": () => err(404, "Campaign 1 not found") });
    render(<ReviewView campaignId={1} />);
    expect(await screen.findByText("Campaign 1 not found")).toBeInTheDocument();
  });
});
void kpis;
