import base64
import json
import re

import frappe
from frappe import _

OCR_PROMPT = """You are an OCR assistant for a UAE petty-cash app aligned to ERPNext Expense Claim. The user uploaded a receipt or invoice image. Extract these fields and return ONLY JSON:
{
  "vendor": "supplier/vendor name (string)",
  "amount": "total amount in AED (number)",
  "date": "YYYY-MM-DD",
  "expense_type": "one of: Fuel, Materials, Food, Travel, Accommodation, Telephone, Other",
  "description": "short ≤60 chars",
  "vat_included": "true if VAT/TRN is shown",
  "is_tax_invoice": "true if document is titled 'Tax Invoice' or shows VAT registration / TRN",
  "trn": "15-digit Tax Registration Number if visible, else empty string",
  "invoice_number": "invoice/receipt number if visible, else empty string",
  "vat_amount": "VAT amount as a separate number if printed, else 0"
}
If you can't see the image return all-empty/zero values with expense_type='Other'."""


def _empty_payload():
    return {
        "vendor": "",
        "amount": 0,
        "date": frappe.utils.nowdate(),
        "expense_type": "Other",
        "description": "",
        "vat_included": False,
        "is_tax_invoice": False,
        "trn": "",
        "invoice_number": "",
        "vat_amount": 0,
    }


def _parse_json_block(text):
    if not text:
        return None
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


@frappe.whitelist()
def get_session_profile():
    """One-shot bootstrap: returns everything the PWA needs to populate the
    home screen — current user, linked Employee, manager flag.

    Doing this server-side avoids querying the `Has Role` child table over
    REST (which is awkward) and saves a couple of round-trips on app boot.
    """
    user = frappe.session.user
    if not user or user == "Guest":
        frappe.local.response.http_status_code = 401
        return {"signed_in": False}

    user_doc = frappe.db.get_value(
        "User", user,
        ["full_name", "user_image"],
        as_dict=True,
    ) or {}

    emp = frappe.db.get_value(
        "Employee", {"user_id": user},
        [
            "name", "employee_name", "designation", "department", "image",
            "company", "cell_number", "date_of_joining", "reports_to",
        ],
        as_dict=True,
    ) or {}

    roles = set(frappe.get_roles(user))
    manager_roles = {"HR Manager", "Projects Manager", "ESS Manager", "Accounts Manager", "System Manager"}
    is_manager = bool(roles & manager_roles)
    if not is_manager and emp.get("name"):
        # Falls back to "anyone reports to me" so even users without an
        # explicit manager role still see their team's queues.
        is_manager = bool(frappe.db.exists("Employee", {"reports_to": emp["name"], "status": "Active"}))

    return {
        "signed_in": True,
        "user": user,
        "full_name": user_doc.get("full_name") or emp.get("employee_name") or user,
        "user_image": user_doc.get("user_image") or emp.get("image") or "",
        "employee": emp.get("name"),
        "employee_name": emp.get("employee_name"),
        "designation": emp.get("designation"),
        "department": emp.get("department"),
        "company": emp.get("company"),
        "cell_number": emp.get("cell_number"),
        "date_of_joining": emp.get("date_of_joining"),
        "reports_to": emp.get("reports_to"),
        "is_manager": is_manager,
        "roles": sorted(roles),
    }


@frappe.whitelist()
def extract_receipt(data_url):
    """Server-side OCR proxy. Forwards a base64 image to Anthropic's
    Claude Vision API. The Anthropic key is read from site_config.json
    (`anthropic_api_key`) so it never ships in the bundle.

    Returns the extracted JSON payload, or a safe empty default if the
    key isn't configured / the call fails.
    """
    if not data_url or "," not in data_url:
        return _empty_payload()

    api_key = frappe.conf.get("anthropic_api_key")
    if not api_key:
        # Caller will get the safe defaults; the form still works, just no autofill.
        return _empty_payload()

    header, b64 = data_url.split(",", 1)
    media_type = "image/jpeg"
    m = re.match(r"data:([^;]+);base64", header)
    if m:
        media_type = m.group(1)

    try:
        # Lazy import so the app can be installed on benches without anthropic.
        try:
            from anthropic import Anthropic
        except ImportError:
            frappe.log_error(
                "anthropic SDK not installed. Run `bench pip install anthropic` to enable receipt OCR.",
                "AKG ESS · OCR",
            )
            return _empty_payload()

        client = Anthropic(api_key=api_key)
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=512,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": OCR_PROMPT},
                        {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}},
                    ],
                }
            ],
        )
        text = "".join(getattr(b, "text", "") for b in (msg.content or []))
        parsed = _parse_json_block(text)
        if not parsed:
            return _empty_payload()

        out = _empty_payload()
        for k in out:
            if k in parsed:
                out[k] = parsed[k]
        try:
            out["amount"] = float(out.get("amount") or 0)
        except (TypeError, ValueError):
            out["amount"] = 0
        try:
            out["vat_amount"] = float(out.get("vat_amount") or 0)
        except (TypeError, ValueError):
            out["vat_amount"] = 0
        return out
    except Exception:
        frappe.log_error(frappe.get_traceback(), "AKG ESS · OCR failure")
        return _empty_payload()
