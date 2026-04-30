import frappe
from frappe.model.document import Document


class AKGESSSettings(Document):
    pass


def get_settings():
    """Convenience reader. Returns a dict with the resolved settings, with
    fallbacks to site_config.json so a fresh install still works before
    the admin opens the settings page.
    """
    try:
        doc = frappe.get_cached_doc("AKG ESS Settings")
    except Exception:
        doc = None

    api_key = ""
    if doc:
        try:
            api_key = doc.get_password("anthropic_api_key", raise_exception=False) or ""
        except Exception:
            api_key = ""
    if not api_key:
        api_key = frappe.conf.get("anthropic_api_key", "") or ""

    return {
        "enable_receipt_ocr": bool(doc.enable_receipt_ocr) if doc else True,
        "model": (doc.model if doc and doc.model else "claude-haiku-4-5-20251001"),
        "anthropic_api_key": api_key,
        "monthly_call_cap": int((doc.monthly_call_cap if doc and doc.monthly_call_cap else 5000)),
        "default_radius_meters": int((doc.default_radius_meters if doc and doc.default_radius_meters else 200)),
    }
