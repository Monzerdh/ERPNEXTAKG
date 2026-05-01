import json
import re

import frappe

OCR_CACHE_KEY = "akg_ess:ocr_calls"

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
            "leave_approver", "expense_approver",
        ],
        as_dict=True,
    ) or {}

    # Leave approver: prefer the direct Employee.leave_approver field; fall
    # back to the first entry in the Employee Leave Approver child table
    # (some sites use the table, some use the simple field).
    leave_approver = emp.get("leave_approver") or ""
    if emp.get("name") and not leave_approver:
        rows = frappe.get_all(
            "Employee Leave Approver",
            filters={"parent": emp["name"], "parenttype": "Employee"},
            fields=["leave_approver"],
            order_by="idx asc",
            limit_page_length=1,
        )
        if rows:
            leave_approver = rows[0].leave_approver
    leave_approver_name = (
        frappe.db.get_value("User", leave_approver, "full_name") if leave_approver else ""
    )

    expense_approver = emp.get("expense_approver") or ""
    expense_approver_name = (
        frappe.db.get_value("User", expense_approver, "full_name") if expense_approver else ""
    )

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
        "leave_approver": leave_approver or None,
        "leave_approver_name": leave_approver_name or "",
        "expense_approver": expense_approver or None,
        "expense_approver_name": expense_approver_name or "",
        "is_manager": is_manager,
        "roles": sorted(roles),
    }


@frappe.whitelist()
def get_activity_types():
    """Return all enabled Activity Types regardless of caller's role.

    Why this exists: the standard ERPNext Activity Type DocType only
    grants read permission to the "Projects User" role.  PWA users who
    have only "Employee" / "ESS User" roles would otherwise see an
    empty dropdown even though records exist.  This endpoint reads
    with ignore_permissions=True after confirming the caller is signed
    in (not Guest).
    """
    if not frappe.session.user or frappe.session.user == "Guest":
        frappe.local.response.http_status_code = 401
        return []
    return frappe.db.get_list(
        "Activity Type",
        filters={"disabled": 0},
        fields=["name", "billable", "default_costing_rate"],
        order_by="name asc",
        ignore_permissions=True,
        limit_page_length=0,
    )


@frappe.whitelist()
def get_project_tasks(project=None):
    """Return open/working Tasks, optionally scoped to one project.

    Same rationale as get_activity_types — the standard Task DocType
    requires "Projects User" role for read.  PWA users without that
    role can't populate the check-out task dropdown via REST.  Reads
    with ignore_permissions=True for signed-in users only.
    """
    if not frappe.session.user or frappe.session.user == "Guest":
        frappe.local.response.http_status_code = 401
        return []
    filters = {}
    if project:
        filters["project"] = project
    return frappe.db.get_list(
        "Task",
        filters=filters,
        fields=["name", "subject", "project", "status", "progress"],
        order_by="modified desc",
        ignore_permissions=True,
        limit_page_length=100,
    )


def _ocr_month_key():
    return f"{OCR_CACHE_KEY}:{frappe.utils.nowdate()[:7]}"


def _ocr_increment_and_check(cap):
    """Atomic-ish month-bucketed counter in Redis. Returns the new count.
    Soft cap — if exceeded we log and return the count so the caller can
    short-circuit without raising."""
    try:
        key = _ocr_month_key()
        n = frappe.cache().incrby(key, 1) or 1
        if n == 1:
            # Expire ~32 days so the bucket rolls over naturally.
            frappe.cache().expire(key, 32 * 24 * 3600)
        if cap and n > cap:
            frappe.log_error(
                f"AKG ESS · OCR monthly cap exceeded: {n} > {cap}. Raise the cap in AKG ESS Settings or wait for next month.",
                "AKG ESS · OCR cap",
            )
        return n
    except Exception:
        # Cache failure shouldn't block OCR — just skip the cap.
        return 0


@frappe.whitelist()
def extract_receipt(data_url):
    """Server-side OCR proxy. Forwards a base64 image to Anthropic's
    Claude Vision API. Settings (key, model, enable flag, monthly cap)
    are read from the AKG ESS Settings Singleton; falls back to
    site_config.json's `anthropic_api_key` for legacy installs.

    Returns the extracted JSON payload, or a safe empty default if the
    feature is disabled / the key is missing / the call fails.
    """
    if not data_url or "," not in data_url:
        return _empty_payload()

    # Lazy import — keeps api.py loadable even if the settings DocType isn't
    # registered yet during install/migrate.
    from akg_ess.akg_ess.doctype.akg_ess_settings.akg_ess_settings import get_settings

    settings = get_settings()
    if not settings["enable_receipt_ocr"]:
        return _empty_payload()

    api_key = settings["anthropic_api_key"]
    if not api_key:
        return _empty_payload()

    cap = settings["monthly_call_cap"]
    if cap:
        count = _ocr_increment_and_check(cap)
        if count and count > cap:
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
            model=settings["model"],
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
