"""Email address validation, HTML sanitisation, personalisation and link checks."""
import html as htmllib
import re
from urllib.parse import urlparse

import bleach
from bleach.css_sanitizer import CSSSanitizer

EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-']+@(?:[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$")
VAR_RE = re.compile(r"\{\{\s*([A-Za-z0-9_]+)\s*\}\}")
HREF_RE = re.compile(r"""href\s*=\s*(?:"([^"]*)"|'([^']*)')""", re.I)

ALLOWED_VARIABLES = ("first_name", "last_name", "full_name", "email", "event_name", "campaign_name", "unsubscribe_url")


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def is_valid_email(email: str | None) -> bool:
    e = (email or "").strip()
    return bool(e) and len(e) <= 320 and ".." not in e and bool(EMAIL_RE.match(e))


def find_variables(text: str | None) -> list[str]:
    return VAR_RE.findall(text or "")


def unsupported_variables(*texts: str | None) -> list[str]:
    bad: list[str] = []
    for t in texts:
        for v in find_variables(t):
            if v not in ALLOWED_VARIABLES and v not in bad:
                bad.append(v)
    return bad


_TAGS = [
    "a", "abbr", "b", "blockquote", "br", "center", "div", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i",
    "img", "li", "ol", "p", "span", "strong", "small", "table", "tbody", "thead", "tfoot", "td", "th", "tr",
    "u", "ul", "sup", "sub", "pre", "code",
]
_ATTRS = {
    "a": ["href", "title", "target", "style"],
    "img": ["src", "alt", "width", "height", "style"],
    "table": ["width", "align", "border", "cellpadding", "cellspacing", "bgcolor", "style"],
    "td": ["width", "align", "valign", "colspan", "rowspan", "bgcolor", "style"],
    "th": ["width", "align", "valign", "colspan", "rowspan", "bgcolor", "style"],
    "*": ["style", "align"],
}
_CSS = CSSSanitizer(
    allowed_css_properties=[
        "color", "background-color", "font-size", "font-weight", "font-family", "font-style", "text-align",
        "text-decoration", "line-height", "margin", "margin-top", "margin-bottom", "margin-left", "margin-right",
        "padding", "padding-top", "padding-bottom", "padding-left", "padding-right", "border", "border-radius",
        "border-collapse", "border-top", "border-bottom", "width", "max-width", "height", "display", "letter-spacing",
    ]
)
_DANGEROUS_BLOCKS = re.compile(r"<\s*(script|style|iframe|object|embed|noscript|template)\b.*?<\s*/\s*\1\s*>", re.I | re.S)
_DANGEROUS_OPEN = re.compile(r"<\s*/?\s*(script|style|iframe|object|embed|noscript|template|link|meta|base|form|input)\b[^>]*>", re.I)


def sanitize_html(raw: str | None) -> str:
    text = raw or ""
    text = _DANGEROUS_BLOCKS.sub("", text)
    text = _DANGEROUS_OPEN.sub("", text)
    return bleach.clean(
        text, tags=_TAGS, attributes=_ATTRS, protocols=["http", "https", "mailto", "tel"],
        strip=True, strip_comments=True, css_sanitizer=_CSS,
    )


def personalize(text: str, values: dict[str, str], escape: bool = True) -> str:
    def sub(m: re.Match) -> str:
        key = m.group(1)
        if key not in values:
            return m.group(0)
        v = values[key]
        return htmllib.escape(v, quote=True) if escape else v

    return VAR_RE.sub(sub, text)


_DOC = (
    "<!doctype html><html><head><meta charset=\"utf-8\">"
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src https: http:; style-src 'unsafe-inline'\">"
    "<style>body{margin:0;padding:16px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;"
    "color:#1f2430;line-height:1.5;font-size:15px}img{max-width:100%;height:auto}a{color:#2563eb}</style>"
    "</head><body>__BODY__</body></html>"
)


def render_document(body_html: str | None, values: dict[str, str]) -> str:
    """Sanitise first, then substitute escaped variables, then wrap in an isolated document."""
    safe = sanitize_html(body_html)
    return _DOC.replace("__BODY__", personalize(safe, values))


def extract_links(html: str | None) -> list[str]:
    return [a or b for a, b in HREF_RE.findall(html or "")]


def invalid_links(html: str | None) -> list[str]:
    bad = []
    for link in extract_links(html):
        target = link.strip()
        if VAR_RE.fullmatch(target) and VAR_RE.fullmatch(target).group(1) in ALLOWED_VARIABLES:  # type: ignore[union-attr]
            continue
        try:
            u = urlparse(target)
        except ValueError:
            bad.append(link)
            continue
        if u.scheme in ("http", "https"):
            if not u.netloc or "." not in u.netloc.split(":")[0]:
                bad.append(link)
        elif u.scheme in ("mailto", "tel"):
            if not u.path:
                bad.append(link)
        else:
            bad.append(link)  # '', '#', javascript:, relative etc.
    return bad


def csv_safe(value: object) -> str:
    """Neutralise spreadsheet formula injection."""
    s = "" if value is None else str(value)
    if s and s[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + s
    return s
