"""Metric formulas. Rates return None when the denominator is zero (UI shows an em dash)."""


def rate(numerator: int, denominator: int) -> float | None:
    if not denominator:
        return None
    return round(numerator / denominator * 100, 1)


def compute_kpis(attempted: int, delivered: int, bounced: int, opens: int, clicks: int) -> dict:
    return {
        "attempted": attempted,
        "delivered": delivered,
        "bounced": bounced,
        "delivery_rate": rate(delivered, attempted),
        "bounce_rate": rate(bounced, attempted),
        "unique_opens": opens,
        "open_rate": rate(opens, delivered),
        "unique_clicks": clicks,
        "click_rate": rate(clicks, delivered),
    }


def campaign_health(kpis: dict) -> dict:
    """Documented thresholds: bounce >=10% -> attention, >=5% -> watch, else healthy."""
    if not kpis["attempted"]:
        return {"label": "No data", "level": "neutral"}
    b = kpis["bounce_rate"] or 0
    if b >= 10:
        return {"label": "Needs attention", "level": "bad"}
    if b >= 5:
        return {"label": "Watch", "level": "warn"}
    return {"label": "Healthy", "level": "good"}


def build_insights(kpis: dict, permanent_bounces: int = 0) -> list[dict]:
    out: list[dict] = []
    if not kpis["attempted"]:
        return [{"level": "info", "title": "No sent emails yet", "message": "Insights appear once a campaign has delivery records."}]
    b, delivered = kpis["bounce_rate"] or 0, kpis["delivered"]
    if b >= 5:
        out.append({
            "level": "warning", "title": "Elevated bounce rate",
            "message": f"Delivery failures are elevated ({b}% — {kpis['bounced']} of {kpis['attempted']}). "
                       f"Review the affected addresses before your next campaign."
                       + (f" {permanent_bounces} are permanent failures." if permanent_bounces else ""),
        })
    if delivered >= 10:
        unopened = delivered - kpis["unique_opens"]
        if unopened / delivered > 0.6:
            out.append({
                "level": "suggestion", "title": "Many delivered emails are unopened",
                "message": f"{unopened} of {delivered} delivered emails have no recorded open. "
                           f"Consider testing a different subject line or reviewing the invitation timing.",
            })
        opens = kpis["unique_opens"]
        if opens >= 10 and kpis["unique_clicks"] / opens < 0.25:
            out.append({
                "level": "suggestion", "title": "Opened but not clicked",
                "message": f"{opens - kpis['unique_clicks']} of {opens} openers did not click. "
                           f"Consider reviewing the email content and call to action.",
            })
    if not out:
        out.append({"level": "success", "title": "Within healthy ranges",
                    "message": "Bounce, open and click metrics are within the thresholds used by Campaign Pulse."})
    out.append({"level": "info", "title": "About open and click data",
                "message": "Opens and clicks are approximations: privacy proxies and security scanners can inflate or hide them."})
    return out
