import json
import re

import frappe

OCR_CACHE_KEY = "akg_ess:ocr_calls"


def _get_expense_claim_types():
    """Return the live list of Expense Claim Type names from this ERPNext
    site, sorted alphabetically. Bypasses permissions because the
    Projects/HR roles aren't always granted to ESS users."""
    try:
        rows = frappe.get_all(
            "Expense Claim Type",
            fields=["name"],
            order_by="name asc",
            limit_page_length=0,
            ignore_permissions=True,
        )
        return [r["name"] for r in rows if r.get("name")]
    except Exception:
        return []


def _normalize_expense_type(raw, allowed):
    """Snap whatever the model returned to one of the allowed types.

    Order of preference:
      1. exact match (case-insensitive)
      2. substring match either way (case-insensitive) — e.g. 'Fuel' ⇄ 'Fuel & Petrol'
      3. first allowed entry (engineer can rectify in the UI)
    """
    if not allowed:
        return raw or ""
    if not raw:
        return allowed[0]
    raw_l = str(raw).strip().lower()
    by_l = {a.lower(): a for a in allowed}
    if raw_l in by_l:
        return by_l[raw_l]
    for a_l, a in by_l.items():
        if raw_l in a_l or a_l in raw_l:
            return a
    return allowed[0]


def _build_ocr_prompt(allowed):
    """Inject the real Expense Claim Type list into the prompt so the
    model can't hallucinate a category that doesn't exist on this site."""
    types_clause = (
        ", ".join(f'"{a}"' for a in allowed) if allowed else
        '"Fuel", "Materials", "Food", "Travel", "Accommodation", "Telephone", "Other"'
    )
    fallback = allowed[0] if allowed else "Other"
    return f"""You are an OCR assistant for a UAE petty-cash app aligned to ERPNext Expense Claim. The user uploaded a receipt or invoice image. Extract these fields and return ONLY JSON:
{{
  "vendor": "supplier/vendor name (string)",
  "amount": "total amount in AED (number)",
  "date": "YYYY-MM-DD",
  "expense_type": "MUST be exactly one of: {types_clause}. Pick the closest match. If none fits, pick {fallback!r}.",
  "description": "short ≤60 chars",
  "vat_included": "true if VAT/TRN is shown",
  "is_tax_invoice": "true if document is titled 'Tax Invoice' or shows VAT registration / TRN",
  "trn": "15-digit Tax Registration Number if visible, else empty string",
  "invoice_number": "invoice/receipt number if visible, else empty string",
  "vat_amount": "VAT amount as a separate number if printed, else 0"
}}
If you can't see the image return all-empty/zero values with expense_type={fallback!r}."""


def _empty_payload(allowed=None):
    return {
        "vendor": "",
        "amount": 0,
        "date": frappe.utils.nowdate(),
        "expense_type": (allowed[0] if allowed else "Other"),
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
            "is_office_worker", "has_petty_cash",
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

    # Manager / reports-to: resolve the linked Employee's display name
    # so the profile screen can show "Reports to: <name>" instead of the raw ID.
    reports_to_name = ""
    if emp.get("reports_to"):
        reports_to_name = frappe.db.get_value("Employee", emp["reports_to"], "employee_name") or ""

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
        "reports_to_name": reports_to_name or "",
        "is_office_worker": bool(emp.get("is_office_worker")),
        "has_petty_cash": bool(emp.get("has_petty_cash")),
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

    The Expense Claim Type list is fetched live from this site and
    injected into the prompt, so the model can only return categories
    that actually exist. If it slips, we snap server-side to the nearest
    real type — engineers can rectify in the UI.
    """
    allowed = _get_expense_claim_types()

    if not data_url or "," not in data_url:
        return _empty_payload(allowed)

    # Lazy import — keeps api.py loadable even if the settings DocType isn't
    # registered yet during install/migrate.
    from akg_ess.akg_ess.doctype.akg_ess_settings.akg_ess_settings import get_settings

    settings = get_settings()
    if not settings["enable_receipt_ocr"]:
        return _empty_payload(allowed)

    api_key = settings["anthropic_api_key"]
    if not api_key:
        return _empty_payload(allowed)

    cap = settings["monthly_call_cap"]
    if cap:
        count = _ocr_increment_and_check(cap)
        if count and count > cap:
            return _empty_payload(allowed)

    header, b64 = data_url.split(",", 1)
    media_type = "image/jpeg"
    m = re.match(r"data:([^;]+);base64", header)
    if m:
        media_type = m.group(1)

    # Anthropic only accepts image/jpeg, image/png, image/gif, image/webp.
    if media_type not in ("image/jpeg", "image/png", "image/gif", "image/webp"):
        frappe.log_error(
            f"Anthropic vision rejects media_type={media_type}. Convert to jpg/png before upload.",
            "AKG ESS · OCR media",
        )
        return _empty_payload(allowed)

    prompt = _build_ocr_prompt(allowed)

    # Use the HTTP API directly via requests (a Frappe runtime dep — no
    # extra `bench pip install anthropic` step needed on Frappe Cloud).
    import requests
    try:
        resp = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": settings["model"],
                "max_tokens": 512,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}},
                        ],
                    }
                ],
            },
            timeout=45,
        )
    except requests.exceptions.RequestException as e:
        frappe.log_error(
            f"Anthropic request failed at network layer: {e!r}",
            "AKG ESS · OCR network",
        )
        return _empty_payload(allowed)

    if resp.status_code != 200:
        # Most common causes: 401 (bad key), 404 (bad model name), 400
        # (malformed image), 429 (rate limit), 529 (overloaded).
        snippet = (resp.text or "")[:1500]
        frappe.log_error(
            f"Anthropic HTTP {resp.status_code} on /v1/messages\n\n"
            f"Model: {settings['model']}\n"
            f"Response body:\n{snippet}",
            "AKG ESS · OCR HTTP",
        )
        return _empty_payload(allowed)

    try:
        data = resp.json()
    except ValueError:
        frappe.log_error(
            f"Anthropic response not JSON: {resp.text[:1500]}",
            "AKG ESS · OCR JSON",
        )
        return _empty_payload(allowed)

    blocks = data.get("content") or []
    text = "".join(b.get("text", "") for b in blocks if isinstance(b, dict) and b.get("type") == "text")
    parsed = _parse_json_block(text)
    if not parsed:
        frappe.log_error(
            f"Anthropic returned no parseable JSON object.\n\n"
            f"Raw text from model:\n{text[:1500]}",
            "AKG ESS · OCR parse",
        )
        return _empty_payload(allowed)

    out = _empty_payload(allowed)
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
    out["expense_type"] = _normalize_expense_type(out.get("expense_type"), allowed)
    return out
