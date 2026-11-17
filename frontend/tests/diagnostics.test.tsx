import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { err, mockFetch, recipient } from "./helpers";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
import { DEFAULT_FILTERS, RecipientTable, type Filters } from "@/components/recipient-table";
import { RecipientDrawer } from "@/components/recipient-drawer";

const page = (items: unknown[], over = {}) => ({ items, total: items.length, page: 1, page_size: 15, pages: 1, ...over });
function Harness({ onSelect = () => {} }: { onSelect?: (id: number) => void }) {
  const [f, setF] = useState<Filters>(DEFAULT_FILTERS);
  return <RecipientTable filters={f} onFilters={setF} campaigns={[{ id: 1, name: "Spring" }]} onSelect={onSelect} />;
}
const lastRecipientsCall = (calls: { url: string }[]) => [...calls].reverse().find((c) => c.url.startsWith("/api/recipients"))!.url;

describe("RecipientTable", () => {
  it("renders recipient rows with delivery, bounce reason, open and click columns", async () => {
    mockFetch({ "GET /api/recipients": page([recipient(), recipient({ id: 2, name: "Bob", email: "bob@example.com", delivery_status: "delivered", bounce_type: null, bounce_label: null, opened: true, clicked: true })]) });
    render(<Harness />);
    expect(await screen.findByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByText("Hard bounce")).toBeInTheDocument();
    const bobRow = screen.getByText("bob@example.com").closest("tr")!;
    expect(within(bobRow).getByText("Opened")).toBeInTheDocument();
    expect(within(bobRow).getByText("Clicked")).toBeInTheDocument();
    expect(screen.getByTestId("result-count")).toHaveTextContent("2 recipients");
  });

  it("searches (debounced) by sending q to the API", async () => {
    const { calls } = mockFetch({ "GET /api/recipients": page([recipient()]) });
    render(<Harness />);
    await screen.findByText("ada@example.com");
    await userEvent.type(screen.getByLabelText("Search recipients"), "ada@");
    await waitFor(() => expect(lastRecipientsCall(calls)).toContain("q=ada%40"));
  });

  it("applies delivery-status and bounce-type filters", async () => {
    const { calls } = mockFetch({ "GET /api/recipients": page([recipient()]) });
    render(<Harness />);
    await screen.findByText("ada@example.com");
    await userEvent.click(screen.getByRole("combobox", { name: "Delivery status filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Bounced" }));
    await waitFor(() => expect(lastRecipientsCall(calls)).toContain("delivery_status=bounced"));
    await userEvent.click(screen.getByRole("combobox", { name: "Bounce type filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Hard bounce" }));
    await waitFor(() => expect(lastRecipientsCall(calls)).toMatch(/bounce_type=hard_bounce/));
    expect(screen.getByTestId("export-recipients").getAttribute("href")).toMatch(/delivery_status=bounced.*bounce_type=hard_bounce/);
  });

  it("does not lose a filter chosen while a search debounce is pending", async () => {
    const { calls } = mockFetch({ "GET /api/recipients": page([recipient()]) });
    render(<Harness />);
    await screen.findByText("ada@example.com");
    await userEvent.type(screen.getByLabelText("Search recipients"), "x");
    await userEvent.clear(screen.getByLabelText("Search recipients"));
    await userEvent.click(screen.getByRole("combobox", { name: "Bounce type filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Hard bounce" }));
    await new Promise((r) => setTimeout(r, 450));
    expect(lastRecipientsCall(calls)).toContain("bounce_type=hard_bounce");
  });

  it("sorts by column, toggling direction", async () => {
    const { calls } = mockFetch({ "GET /api/recipients": page([recipient()]) });
    render(<Harness />);
    await screen.findByText("ada@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Sort by Email" }));
    await waitFor(() => expect(lastRecipientsCall(calls)).toContain("sort=email&order=asc"));
    await userEvent.click(screen.getByRole("button", { name: "Sort by Email" }));
    await waitFor(() => expect(lastRecipientsCall(calls)).toContain("sort=email&order=desc"));
    expect(screen.getByRole("columnheader", { name: /Email/ })).toHaveAttribute("aria-sort", "descending");
  });

  it("paginates", async () => {
    const { calls } = mockFetch({ "GET /api/recipients": (c: { url: string }) => page([recipient()], { total: 40, pages: 3, page: Number(new URL("http://x" + c.url).searchParams.get("page") ?? 1) }) });
    render(<Harness />);
    await screen.findByText("ada@example.com");
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(lastRecipientsCall(calls)).toContain("page=2"));
    expect(await screen.findByText(/page 2 of 3/)).toBeInTheDocument();
  });

  it("shows empty states for no data and for no filter matches", async () => {
    mockFetch({ "GET /api/recipients": page([]) });
    render(<Harness />);
    expect(await screen.findByText("No recipient records yet")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Search recipients"), "zzz");
    expect(await screen.findByText("No recipients match these filters")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(await screen.findByText("No recipient records yet")).toBeInTheDocument();
  });

  it("shows an error state and retries", async () => {
    let fail = true;
    mockFetch({ "GET /api/recipients": () => (fail ? err(500, "Something went wrong. Please try again.") : page([recipient()])) });
    render(<Harness />);
    expect(await screen.findByText("Something went wrong. Please try again.")).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("ada@example.com")).toBeInTheDocument();
  });

  it("opens the inspector for a recipient and truncates very long names", async () => {
    const long = "L".repeat(255);
    const onSelect = vi.fn();
    mockFetch({ "GET /api/recipients": page([recipient({ name: long })]) });
    render(<Harness onSelect={onSelect} />);
    const cell = await screen.findByTitle(long);
    expect(cell.className).toContain("truncate");
    await userEvent.click(screen.getByRole("button", { name: "Inspect ada@example.com" }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });
});

describe("RecipientDrawer", () => {
  it("shows bounce diagnostics and activity", async () => {
    mockFetch({ "GET /api/recipients/1": { ...recipient(), audience: "Webinar", is_valid_email: true, suppressions: [{ kind: "suppressed", reason: "Spam complaint" }], events: [], other_campaigns: [{ id: 9, campaign_name: "Other", delivery_status: "delivered" }] } });
    render(<RecipientDrawer id={1} onClose={() => {}} />);
    const d = await screen.findByTestId("recipient-drawer");
    expect(within(d).getByText("550 5.1.1 user unknown")).toBeInTheDocument();
    expect(within(d).getByText("Hard bounce")).toBeInTheDocument();
    expect(within(d).getByText(/Spam complaint/)).toBeInTheDocument();
    expect(within(d).getByText("No opens or clicks recorded.")).toBeInTheDocument();
    expect(within(d).getByText("Other")).toBeInTheDocument();
  });
  it("does not invent a bounce reason when the source has none", async () => {
    mockFetch({ "GET /api/recipients/1": { ...recipient({ bounce_reason: null, bounce_type: "unknown", bounce_label: "Other / unknown" }), audience: null, is_valid_email: true, suppressions: [], events: [], other_campaigns: [] } });
    render(<RecipientDrawer id={1} onClose={() => {}} />);
    expect(await screen.findByText("No bounce reason was supplied by the source data.")).toBeInTheDocument();
  });
});
