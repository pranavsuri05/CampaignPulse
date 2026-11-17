import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

let path = "/";
vi.mock("next/navigation", () => ({ usePathname: () => path, useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
import { AppShell } from "@/components/app-shell";
import { EmailFrame } from "@/components/email-frame";

describe("AppShell navigation", () => {
  it("shows exactly the five navigation items with correct links", () => {
    path = "/";
    render(<AppShell><p>child</p></AppShell>);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Overview", "Pre-send Review", "Email Analytics", "Recipient Diagnostics", "Settings"]);
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/", "/review", "/analytics", "/diagnostics", "/settings"]);
    expect(screen.getByText("child")).toBeInTheDocument();
  });
  it("marks the active section and builds a breadcrumb", () => {
    path = "/review/3";
    render(<AppShell>x</AppShell>);
    expect(within(screen.getByRole("navigation", { name: "Primary" })).getByRole("link", { name: "Pre-send Review" })).toHaveAttribute("aria-current", "page");
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByText("Campaign review")).toBeInTheDocument();
  });
  it("always states Simulation Mode", () => {
    render(<AppShell>x</AppShell>);
    expect(screen.getAllByText(/Simulation Mode — No real emails are being sent\./).length).toBeGreaterThan(0);
  });
});

describe("EmailFrame", () => {
  it("is fully sandboxed (no scripts, no same-origin) and uses srcdoc", () => {
    render(<EmailFrame html="<p>hi</p>" />);
    const f = screen.getByTestId("email-frame");
    expect(f).toHaveAttribute("sandbox", "");
    expect(f).toHaveAttribute("srcdoc", "<p>hi</p>");
  });
  it("renders mobile mode narrower", () => {
    render(<EmailFrame html="x" mode="mobile" />);
    const f = screen.getByTestId("email-frame");
    expect(f).toHaveAttribute("data-mode", "mobile");
    expect(f.className).toContain("w-[375px]");
  });
});
