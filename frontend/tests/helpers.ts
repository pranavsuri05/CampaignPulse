import { vi } from "vitest";

export type Call = { method: string; url: string; body: unknown };
type Handler = (call: Call) => unknown;

/** Route-based fetch mock. Keys look like "GET /api/campaigns/1" (path without query) or "GET /api/x?exact". */
export function mockFetch(routes: Record<string, unknown | Handler>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const full = String(input).replace(/^https?:\/\/[^/]+/, "");
    const path = full.split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown = init?.body ?? null;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { /* keep */ } }
    const call = { method, url: full, body };
    calls.push(call);
    const key = [`${method} ${full}`, `${method} ${path}`].find((k) => k in routes);
    if (!key) return new Response(JSON.stringify({ error: { code: "not_found", message: `No mock for ${method} ${full}` } }), { status: 404 });
    const r = routes[key];
    const out = typeof r === "function" ? (r as Handler)(call) : r;
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return { calls, fn };
}

export const err = (status: number, message: string) => new Response(JSON.stringify({ error: { code: "x", message } }), { status });

export const kpis = { attempted: 100, delivered: 80, bounced: 20, delivery_rate: 80, bounce_rate: 20, unique_opens: 40, open_rate: 50, unique_clicks: 8, click_rate: 10 };
export const recipient = (over: Record<string, unknown> = {}) => ({
  id: 1, contact_id: 1, name: "Ada Lovelace", email: "ada@example.com", campaign_id: 1, campaign_name: "Spring", delivery_status: "bounced",
  bounce_type: "hard_bounce", bounce_label: "Hard bounce", bounce_reason: "550 5.1.1 user unknown", eligibility: "eligible", exclusion_reason: null,
  contact_status: "active", opened: false, clicked: false, opened_at: null, clicked_at: null, sent_at: "2026-03-01T09:00:00Z", last_activity: "2026-03-01T09:00:00Z", ...over,
});
