import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { err, mockFetch } from "./helpers";

const push = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push }), useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
import SettingsPage from "@/app/settings/page";
import { CampaignWizard } from "@/components/campaign-wizard";
import OverviewPage from "@/app/page";

describe("Settings sender form", () => {
  it("shows validation errors and does not call the API when invalid", async () => {
    const { calls } = mockFetch({ "GET /api/settings/senders": [] });
    render(<SettingsPage />);
    await screen.findByText(/No senders yet/);
    await userEvent.click(screen.getByRole("button", { name: "Add sender" }));
    expect(await screen.findByText("Sender name is required")).toBeInTheDocument();
    expect(screen.getByText("Sender email is required")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Sender name"), "Team");
    await userEvent.type(screen.getByLabelText("Sender email"), "not-an-email");
    await userEvent.click(screen.getByRole("button", { name: "Add sender" }));
    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });
  it("posts a valid sender and reloads", async () => {
    let list: unknown[] = [];
    const { calls } = mockFetch({ "GET /api/settings/senders": () => list, "POST /api/settings/senders": () => { list = [{ id: 1, name: "Team", email: "team@example.com", is_default: true }]; return {}; } });
    render(<SettingsPage />);
    await screen.findByText(/No senders yet/);
    await userEvent.type(screen.getByLabelText("Sender name"), "Team");
    await userEvent.type(screen.getByLabelText("Sender email"), "team@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Add sender" }));
    expect(await screen.findByText("team@example.com")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ name: "Team", email: "team@example.com", is_default: true });
  });
  it("shows a server error", async () => {
    mockFetch({ "GET /api/settings/senders": [], "POST /api/settings/senders": () => err(409, "A sender with this email already exists.") });
    render(<SettingsPage />);
    await screen.findByText(/No senders yet/);
    await userEvent.type(screen.getByLabelText("Sender name"), "T");
    await userEvent.type(screen.getByLabelText("Sender email"), "t@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Add sender" }));
    expect(await screen.findByText("A sender with this email already exists.")).toBeInTheDocument();
  });
  it("asks for confirmation before deleting a sender", async () => {
    const { calls } = mockFetch({ "GET /api/settings/senders": [{ id: 5, name: "T", email: "t@example.com", is_default: false }], "DELETE /api/settings/senders/5": new Response(null, { status: 204 }) });
    render(<SettingsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Delete t@example.com" }));
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(await screen.findByText("Delete sender?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
  });
});

describe("Campaign wizard", () => {
  it("validates step 1 and creates the campaign on continue", async () => {
    const { calls } = mockFetch({
      "GET /api/settings/senders": [], "GET /api/audiences": { items: [] },
      "POST /api/campaigns": { id: 7, name: "Spring" },
    });
    render(<CampaignWizard />);
    await userEvent.click(screen.getByRole("button", { name: /Save & continue/ }));
    expect(await screen.findByText("Campaign name is required")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    await userEvent.type(screen.getByLabelText("Campaign name"), "Spring");
    await userEvent.click(screen.getByRole("button", { name: /Save & continue/ }));
    expect(await screen.findByText(/Step 2: Sender/)).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ name: "Spring", campaign_type: "invitation" });
  });
  it("validates sender email and subject on later steps", async () => {
    mockFetch({ "GET /api/settings/senders": [], "GET /api/audiences": { items: [] }, "POST /api/campaigns": { id: 7 }, "PATCH /api/campaigns/7": { id: 7 } });
    render(<CampaignWizard />);
    await userEvent.type(screen.getByLabelText("Campaign name"), "X");
    await userEvent.click(screen.getByRole("button", { name: /Save & continue/ }));
    await screen.findByText(/Step 2/);
    await userEvent.type(screen.getByLabelText("Sender name"), "Team");
    await userEvent.type(screen.getByLabelText("Sender email"), "nope");
    await userEvent.click(screen.getByRole("button", { name: /Save & continue/ }));
    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Sender email"));
    await userEvent.type(screen.getByLabelText("Sender email"), "ok@example.com");
    await userEvent.click(screen.getByRole("button", { name: /Save & continue/ }));
    await screen.findByText(/Step 3/);
    await userEvent.click(screen.getByRole("button", { name: /Save & continue/ }));
    expect(await screen.findByText("Subject line is required")).toBeInTheDocument();
  });
  it("shows an empty state when there are no audiences, and a save error", async () => {
    mockFetch({ "GET /api/settings/senders": [], "GET /api/audiences": { items: [] }, "POST /api/campaigns": () => err(422, "Request validation failed.") });
    render(<CampaignWizard />);
    await userEvent.type(screen.getByLabelText("Campaign name"), "X");
    await userEvent.click(screen.getByRole("button", { name: /Save & continue/ }));
    expect(await screen.findByText("Request validation failed.")).toBeInTheDocument();
  });
  it("refuses to edit a sent campaign", async () => {
    mockFetch({ "GET /api/campaigns/3": { id: 3, name: "Done", status: "sent" }, "GET /api/settings/senders": [], "GET /api/audiences": { items: [] } });
    render(<CampaignWizard campaignId={3} />);
    expect(await screen.findByText("This campaign has been sent")).toBeInTheDocument();
  });
});

describe("Overview", () => {
  it("shows the onboarding empty state with no data", async () => {
    mockFetch({ "GET /api/overview": { contacts: 0, campaign_count: 0, kpis: {}, insights: [], health: {} }, "GET /api/campaigns": { items: [] } });
    render(<OverviewPage />);
    expect(await screen.findByText("Your workspace is empty")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Import contacts/ })).toBeInTheDocument();
  });
  it("shows an error state with retry when the API is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fail"); }));
    render(<OverviewPage />);
    expect(await screen.findByText(/Cannot reach the Campaign Pulse API/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
  it("lists campaigns with metrics derived from the API", async () => {
    const k = { attempted: 10, delivered: 9, bounced: 1, delivery_rate: 90, bounce_rate: 10, unique_opens: 3, open_rate: 33.3, unique_clicks: 1, click_rate: 11.1 };
    mockFetch({ "GET /api/overview": { contacts: 5, campaign_count: 1, kpis: k, insights: [{ level: "info", title: "T", message: "M" }], health: { label: "Healthy", level: "good" } },
      "GET /api/campaigns": { items: [{ id: 1, name: "Spring", status: "sent", audience_name: "A", kpis: k, health: { label: "Needs attention", level: "bad" }, updated_at: "2026-03-01T00:00:00Z" }] } });
    render(<OverviewPage />);
    expect(await screen.findByRole("link", { name: "Spring" })).toHaveAttribute("href", "/review/1");
    expect(screen.getAllByText("90.0%").length).toBeGreaterThan(0);
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Analytics/ })).toHaveAttribute("href", "/analytics?campaign=1");
  });
});
