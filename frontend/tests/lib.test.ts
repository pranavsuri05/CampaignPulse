import { describe, expect, it } from "vitest";
import { csvSafe, toCsv } from "@/lib/csv";
import { campaignSchema, senderSchema } from "@/lib/schemas";
import { fmtDate, num, pct } from "@/lib/utils";
import { qs } from "@/lib/api";

describe("csv safety", () => {
  it.each(["=SUM(1)", "+1", "-1", "@x", "\tx"])("neutralises formula %j", (v) => expect(csvSafe(v).replace(/^"/, "")).toMatch(/^'/));
  it("quotes commas and quotes", () => { expect(csvSafe('a,"b"')).toBe('"a,""b"""'); });
  it("builds rows", () => { expect(toCsv(["a", "b"], [[1, "=x"]])).toBe("a,b\r\n1,'=x\r\n"); });
});

describe("formatting", () => {
  it("handles null rates", () => { expect(pct(null)).toBe("—"); expect(pct(12.345)).toBe("12.3%"); expect(num(1234)).toBe("1,234"); expect(num(undefined)).toBe("—"); });
  it("formats dates safely", () => { expect(fmtDate(null)).toBe("—"); expect(fmtDate("nope")).toBe("—"); expect(fmtDate("2026-03-01T09:00:00Z", false)).toContain("2026"); });
  it("builds query strings skipping empty and 'all'", () => { expect(qs({ a: "x", b: "all", c: "", d: 2, e: undefined })).toBe("?a=x&d=2"); expect(qs({})).toBe(""); });
});

describe("campaign schema", () => {
  const ok = { name: "N", campaign_type: "invitation", sender_name: "S", sender_email: "s@example.com", subject: "Sub", audience_name: "A", body_html: "<p>x</p>" };
  it("accepts a complete campaign", () => expect(campaignSchema.safeParse(ok).success).toBe(true));
  it.each([["name", ""], ["sender_name", ""], ["sender_email", "bad"], ["subject", ""], ["audience_name", ""], ["body_html", "  "]])("rejects invalid %s", (f, v) => {
    expect(campaignSchema.safeParse({ ...ok, [f]: v }).success).toBe(false);
  });
  it("validates senders", () => { expect(senderSchema.safeParse({ name: "a", email: "b" }).success).toBe(false); expect(senderSchema.safeParse({ name: "a", email: "b@c.io" }).success).toBe(true); });
});
