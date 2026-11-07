"""Pick the data node type for a scraped or extracted fact from its field name and value."""

from datetime import datetime, timezone
import re
from urllib.parse import urlsplit

_USERNAME = re.compile(
    r"(?:^|[^a-z])(?:user ?name|login|handle|screen ?name|nick ?name|alias|uid ?name)$"
)
_EMAIL_KEY = re.compile(r"(?:^|[^a-z])e-?mail(?: address)?$")
_PHONE_KEY = re.compile(r"(?:^|[^a-z])(?:phone|mobile|telephone|tel)(?: number)?$")
_DATE_KEY = re.compile(
    r"(?:date|time|created|modified|updated|joined|registered|birthday|seen|timestamp)"
    r"|(?:^|[^a-z])(?:dob|born)(?:[^a-z]|$)"
)
_EMAIL = re.compile(r"^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$")
_PHONE = re.compile(r"^\+?[\d\s().-]{7,20}$")
_USERNAME_VALUE = re.compile(r"^@?[\w.\-]{1,64}$")
_EXIF_DATE = re.compile(r"^(\d{4}):(\d{2}):(\d{2})([ T].*)?$")


def _words(key):
    """'CreateDate' / 'created_at' / 'Profile · user-name' → 'create date' etc."""
    last = re.split(r"[·:.]", str(key))[-1]
    last = re.sub(r"([a-z])([A-Z])", r"\1 \2", last)
    return re.sub(r"[^a-z0-9]+", " ", last.casefold()).strip()


def parse_moment(value):
    """Date/time node data for ISO, ExifTool and Unix-epoch values, or None."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) or re.fullmatch(r"\d{10}(?:\.\d+)?", str(value)):
        try:
            seconds = float(value)
        except ValueError:
            return None
        if not 946684800 <= seconds <= 4102444800:  # 2000–2100
            return None
        moment = datetime.fromtimestamp(seconds, timezone.utc)
    else:
        text = str(value).strip()
        exif = _EXIF_DATE.match(text)
        if exif:
            text = "-".join(exif.groups()[:3]) + (exif.group(4) or "")
        text = re.sub(r"Z$", "+00:00", text.replace(" ", "T", 1))
        if not re.match(r"^\d{4}-\d{2}-\d{2}", text) or text.startswith("0000"):
            return None
        try:
            moment = datetime.fromisoformat(text)
        except ValueError:
            return None
        if len(text) == 10:
            return {"date": moment.date().isoformat(), "time": "", "timezone": "UTC"}
    if moment.tzinfo is not None:
        moment = moment.astimezone(timezone.utc)
        zone = "UTC"
    else:
        zone = "UTC"
    return {
        "date": moment.date().isoformat(),
        "time": moment.strftime("%H:%M:%S" if moment.second else "%H:%M"),
        "timezone": zone,
    }


def typed_fact(key, value):
    """(node type, data) for a fact; falls back to a custom value."""
    text = str(value).strip()
    words = _words(key)
    url = urlsplit(text)
    if url.scheme in ("http", "https") and url.hostname:
        return "url", {"value": text}
    if _EMAIL.match(text) and (_EMAIL_KEY.search(words) or "@" in text):
        return "email", {"value": text}
    if _USERNAME.search(words) and _USERNAME_VALUE.match(text):
        return "username", {"value": text.lstrip("@")}
    if (
        _PHONE_KEY.search(words)
        and _PHONE.match(text)
        and sum(c.isdigit() for c in text) >= 7
    ):
        return "phone", {"value": text}
    if _DATE_KEY.search(words):
        moment = parse_moment(value)
        if moment:
            return "datetime", moment
    return "value", {"value": text}
