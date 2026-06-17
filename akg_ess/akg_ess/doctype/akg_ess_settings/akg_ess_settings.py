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
        "default_vat_account": (doc.default_vat_account if doc and doc.default_vat_account else ""),
        "default_vat_rate": float((doc.default_vat_rate if doc and doc.default_vat_rate is not None else 5)),
        "default_vat_description": (doc.default_vat_description if doc and doc.default_vat_description else "VAT 5%"),
        # Default ON when the field is unset (fresh install before the
        # Singleton has been saved).
        "auto_create_attendance": (
            bool(getattr(doc, "auto_create_attendance", None))
            if doc and getattr(doc, "auto_create_attendance", None) is not None
            else True
        ),
    }
