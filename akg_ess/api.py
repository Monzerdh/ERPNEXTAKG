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
def get_csrf_token():
    """Return (and lazily generate + save) this session's CSRF token so the
    PWA can send it on POST/PUT/DELETE. Frappe enforces CSRF only when the
    session has a token, and the static /ess page doesn't inject one — so
    the client fetches it here and echoes it in X-Frappe-CSRF-Token."""
    return frappe.sessions.get_csrf_token()


@frappe.whitelist()
def add_punch_selfie(reference_doctype, reference_name, image):
    """Attach a selfie (data URL) to the current employee's own punch — an
    Employee Checkin or a Geofence Violation. Stored as a PRIVATE file on the
    record so only users who can read that record (the employee + their
    manager) can view it. Ownership-checked; never trusts the caller."""
    import re
    if reference_doctype not in ("Employee Checkin", "Geofence Violation"):
        frappe.throw("Invalid reference type.")
    emp = _my_employee()
    row_emp = frappe.db.get_value(reference_doctype, reference_name, "employee")
    if not emp or row_emp != emp:
        frappe.throw("You can only attach a selfie to your own punch.")
    m = re.match(r"^data:image/(\w+);base64,(.+)$", image or "", re.S)
    if not m:
        frappe.throw("Invalid image data.")
    ext = (m.group(1) or "jpeg").lower()
    ext = "jpg" if ext == "jpeg" else ext
    from frappe.utils.file_manager import save_file
    f = save_file(f"selfie-{reference_name}.{ext}", m.group(2), reference_doctype, reference_name, decode=True, is_private=1)
    frappe.db.set_value(reference_doctype, reference_name, "selfie", f.file_url, update_modified=False)
    return f.file_url


# ──────────────────────────────────────────────────────────────────────
# Web Push (VAPID) — subscription management + payload for the SW.
# ──────────────────────────────────────────────────────────────────────
@frappe.whitelist()
def get_vapid_public_key():
    from akg_ess.webpush import get_keys
    return (get_keys() or {}).get("public_key", "")


@frappe.whitelist()
def save_push_subscription(subscription, user_agent=None):
    sub = frappe.parse_json(subscription) if isinstance(subscription, str) else (subscription or {})
    endpoint = sub.get("endpoint")
    if not endpoint:
        frappe.throw("Invalid push subscription.")
    keys = sub.get("keys") or {}
    values = {
        "user": frappe.session.user, "endpoint": endpoint,
        "p256dh": keys.get("p256dh"), "auth": keys.get("auth"),
        "user_agent": (user_agent or "")[:140], "enabled": 1,
    }
    existing = frappe.db.get_value("ESS Push Subscription", {"endpoint": endpoint}, "name")
    if existing:
        d = frappe.get_doc("ESS Push Subscription", existing)
        d.update(values)
    else:
        d = frappe.get_doc({"doctype": "ESS Push Subscription", **values})
    d.flags.ignore_permissions = True
    d.save(ignore_permissions=True)
    frappe.db.commit()
    return {"ok": True}


@frappe.whitelist()
def delete_push_subscription(endpoint):
    for name in frappe.get_all(
        "ESS Push Subscription",
        filters={"endpoint": endpoint, "user": frappe.session.user}, pluck="name",
    ):
        frappe.delete_doc("ESS Push Subscription", name, force=1, ignore_permissions=True)
    frappe.db.commit()
    return {"ok": True}


@frappe.whitelist()
def get_push_payload():
    """Called by the service worker on a data-less push: returns the latest
    unread notification for the current user (cookie-authed) to display."""
    emp = _my_employee()
    roles = set(frappe.get_roles(frappe.session.user))
    role = "manager" if "ESS Manager" in roles else "employee"
    params = {"role": role}
    or_parts = ["for_role = 'all'", "for_role = %(role)s"]
    if emp:
        or_parts.append("recipient = %(emp)s")
        params["emp"] = emp
    where = "is_read = 0 AND (" + " OR ".join(or_parts) + ")"
    rows = frappe.db.sql(
        f"SELECT title, body, target_tab, target_id FROM `tabESS Notification` WHERE {where} ORDER BY creation DESC LIMIT 1",
        params, as_dict=True,
    )
    count = frappe.db.sql(f"SELECT COUNT(*) FROM `tabESS Notification` WHERE {where}", params)[0][0]
    if rows:
        r = rows[0]
        return {"title": r.title or "AKG ESS", "body": r.body or "", "tab": r.target_tab or "", "id": r.target_id or "", "count": count}
    return {"title": "AKG ESS", "body": "You have a new notification.", "tab": "", "count": count}


def _approver_users(employee):
    """User ids who may approve for `employee`: their leave_approver + their
    reports_to manager's login. Used to push pending-review alerts."""
    users = set()
    if not employee:
        return users
    emp = frappe.db.get_value("Employee", employee, ["reports_to", "leave_approver"], as_dict=True) or {}
    if emp.get("leave_approver"):
        users.add(emp["leave_approver"])
    if emp.get("reports_to"):
        u = frappe.db.get_value("Employee", emp["reports_to"], "user_id")
        if u:
            users.add(u)
    users.discard(None)
    users.discard("")
    return users


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
            "is_office_worker", "has_petty_cash", "default_scope_of_work",
            "has_overtime", "require_selfie",
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
        "has_overtime": bool(emp.get("has_overtime")),
        "require_selfie": bool(emp.get("require_selfie")),
        "default_scope_of_work": emp.get("default_scope_of_work") or "",
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
def get_scopes_of_work():
    """Return all enabled Scopes of Work for the check-out picker.

    Read with ignore_permissions=True for signed-in users so ESS staff
    (who only hold the Employee / ESS User role) still get the list."""
    if not frappe.session.user or frappe.session.user == "Guest":
        frappe.local.response.http_status_code = 401
        return []
    if not frappe.db.exists("DocType", "Scope of Work"):
        return []
    return frappe.db.get_list(
        "Scope of Work",
        filters={"disabled": 0},
        fields=["name", "scope_name", "description"],
        order_by="scope_name asc",
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
def get_petty_defaults():
    """Read petty-cash defaults so the client can build Expense Claim
    rows with the right VAT account head + rate. The account doctype
    isn't visible to most ESS users by default, hence the wrapper."""
    from akg_ess.akg_ess.doctype.akg_ess_settings.akg_ess_settings import get_settings
    s = get_settings()
    return {
        "vat_account": s.get("default_vat_account") or "",
        "vat_rate": float(s.get("default_vat_rate") or 5),
        "vat_description": s.get("default_vat_description") or "VAT 5%",
    }


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


# ──────────────────────────────────────────────────────────────────────
# Missed Check-out (Option B — self-rectify)
# ──────────────────────────────────────────────────────────────────────

def _hours_between(in_time, ref_dt):
    """Best-effort elapsed hours between an Employee Checkin time string
    (either 'YYYY-MM-DD HH:MM:SS' or a datetime) and a reference datetime."""
    from frappe.utils import get_datetime
    try:
        in_dt = get_datetime(in_time)
        return max(0, int((ref_dt - in_dt).total_seconds() // 3600))
    except Exception:
        return 0


def _serialize_mc(row):
    """Shape a Missed Checkout row for the client. Mirrors what the
    designer's prototype expected: { name, date, in_time, site, status,
    employee_name, avatar_initials, proposed_out_time, ... }"""
    site = None
    if row.get("site_name"):
        site = {
            "name": row["site_name"],
            "project_name": row.get("site_project_name") or row["site_name"],
            "kind": "office" if row.get("is_office_worker") else "site",
        }
    rejection = None
    if row.get("status") == "Rejected" and row.get("approver_comment"):
        rejection = {
            "manager": frappe.db.get_value("User", row.get("approver"), "full_name") or row.get("approver"),
            "note": row.get("approver_comment") or "",
            "last_time": row.get("proposed_out_time") or "",
        }
    avatar = ""
    if row.get("employee_name"):
        parts = [p for p in row["employee_name"].split() if p]
        avatar = (parts[0][0] + (parts[1][0] if len(parts) > 1 else "")).upper() if parts else ""
    return {
        "name": row["name"],
        "date": str(row["date"]) if row.get("date") else "",
        "in_time": row.get("in_time") or "",
        "site": site,
        "site_name": (site["project_name"] if site else ""),
        "status": row.get("status") or "Pending",
        "employee": row.get("employee"),
        "employee_name": row.get("employee_name") or row.get("employee"),
        "avatar_initials": avatar,
        "is_office_worker": bool(row.get("is_office_worker")),
        "proposed_out_time": row.get("proposed_out_time") or "",
        "edited_out_time": row.get("edited_out_time") or "",
        "reason": row.get("reason") or "",
        "elapsed_h": row.get("elapsed_h") or 0,
        "approver": row.get("approver") or "",
        "approver_comment": row.get("approver_comment") or "",
        "submitted_on": str(row.get("submitted_on") or ""),
        "rejection": rejection,
        "last_proposed_out_time": row.get("proposed_out_time") or "",
    }


@frappe.whitelist()
def get_my_pending_missed_checkouts():
    """Rows the current employee still has to fix (Unsubmitted or
    Rejected). The modal opens one at a time, oldest first.
    Pending rows (already submitted) are NOT returned — they're waiting
    on the manager and only surface as a hold-strip banner."""
    user = frappe.session.user
    emp = frappe.db.get_value("Employee", {"user_id": user}, "name")
    if not emp:
        return []
    rows = frappe.get_all(
        "Missed Checkout",
        filters=[["employee", "=", emp], ["status", "in", ["Unsubmitted", "Rejected"]]],
        fields=[
            "name", "date", "in_time", "site_name", "site_project_name",
            "is_office_worker", "status", "employee", "employee_name",
            "proposed_out_time", "edited_out_time", "reason", "elapsed_h",
            "approver", "approver_comment", "submitted_on",
        ],
        order_by="date asc",
        limit_page_length=0,
        ignore_permissions=True,
    )
    return [_serialize_mc(r) for r in rows]


@frappe.whitelist()
def get_my_missed_checkout_hold():
    """Most recent Pending or just-Approved (within 24h) row for the
    current employee. Drives the hold-strip banner under the hero."""
    from frappe.utils import now_datetime, get_datetime
    user = frappe.session.user
    emp = frappe.db.get_value("Employee", {"user_id": user}, "name")
    if not emp:
        return None
    rows = frappe.get_all(
        "Missed Checkout",
        filters=[["employee", "=", emp], ["status", "in", ["Pending", "Approved"]]],
        fields=["name", "date", "status", "approved_on"],
        order_by="modified desc",
        limit_page_length=1,
        ignore_permissions=True,
    )
    if not rows:
        return None
    row = rows[0]
    if row["status"] == "Approved":
        # Only show the green pill for 24h post-approval.
        try:
            decided = get_datetime(row.get("approved_on"))
            if decided and (now_datetime() - decided).total_seconds() > 24 * 3600:
                return None
        except Exception:
            pass
        return {"name": row["name"], "status": "approved", "date": str(row["date"])}
    return {"name": row["name"], "status": "pending", "date": str(row["date"])}


# ──────────────────────────────────────────────────────────────────────
# Approval authority — who may approve/reject whose requests.
#   * Never your own request (no self-approval).
#   * System / HR Manager may approve anyone.
#   * Otherwise you must be the employee's manager (reports_to) or their
#     leave approver.
# ──────────────────────────────────────────────────────────────────────
def _my_employee(user=None):
    user = user or frappe.session.user
    return frappe.db.get_value("Employee", {"user_id": user}, "name")


def _team_employee_names(user=None):
    """Active employees `user` manages: direct reports OR where the user is
    the configured leave approver. Excludes the user's own employee."""
    user = user or frappe.session.user
    me = _my_employee(user)
    names = set()
    if me:
        names |= set(frappe.get_all(
            "Employee", filters=[["reports_to", "=", me], ["status", "=", "Active"]], pluck="name"))
    names |= set(frappe.get_all(
        "Employee", filters=[["leave_approver", "=", user], ["status", "=", "Active"]], pluck="name"))
    names.discard(me)
    return names


def _can_approve(user, employee):
    """True if `user` may approve/reject a request belonging to `employee`."""
    if not employee:
        return False
    if employee == _my_employee(user):
        return False  # never approve your own
    roles = set(frappe.get_roles(user))
    if {"System Manager", "HR Manager"} & roles:
        return True
    return employee in _team_employee_names(user)


def _today_status(employee, day):
    """Live attendance state for a day (single-session model):
       'out'  — checked out (recorded OR pending off-zone OUT) → day done
       'in'   — checked in, still on the clock (recorded OR pending IN)
       'none' — no check-in yet
    Pending off-zone punches count, since the person did punch (it's just
    awaiting approval)."""
    ds, de = f"{day} 00:00:00", f"{day} 23:59:59"

    def has_ck(lt):
        return bool(frappe.db.exists("Employee Checkin", [
            ["employee", "=", employee], ["log_type", "=", lt], ["time", ">=", ds], ["time", "<=", de]]))

    def has_pending(lt):
        return (frappe.db.exists("DocType", "Geofence Violation")
                and bool(frappe.db.exists("Geofence Violation",
                    {"employee": employee, "date": day, "log_type": lt, "status": "Pending"})))

    if has_ck("OUT") or has_pending("OUT"):
        return "out"
    if has_ck("IN") or has_pending("IN"):
        return "in"
    return "none"


@frappe.whitelist()
def get_team():
    """Direct reports of the current user, each with today's live attendance
    status (in / out / none) for the manager's team card."""
    me = _my_employee()
    if not me:
        return []
    members = frappe.get_all(
        "Employee",
        filters=[["reports_to", "=", me], ["status", "=", "Active"]],
        fields=["name", "employee_name", "designation", "department", "image", "cell_number", "user_id"],
        order_by="employee_name asc",
        limit_page_length=100,
    )
    today = frappe.utils.nowdate()
    for m in members:
        m["today_status"] = _today_status(m["name"], today)
        parts = (m.get("employee_name") or "").split()
        m["avatar_initials"] = ((parts[0][:1] if parts else "") + (parts[-1][:1] if len(parts) > 1 else "")).upper()
    return members


def _team_scope_filters(employee=None):
    """Filters scoping a team queue to the current user's reports (or all-but-
    self for System/HR Manager), with an optional single-employee filter.
    Returns the filter list, or None when there's nothing the user can see."""
    roles = set(frappe.get_roles(frappe.session.user))
    me = _my_employee()
    filters = []
    if {"System Manager", "HR Manager"} & roles:
        if me:
            filters.append(["employee", "!=", me])
    else:
        team = _team_employee_names()
        if not team:
            return None
        filters.append(["employee", "in", list(team)])
    if employee:
        filters.append(["employee", "=", employee])  # AND — narrows within team
    return filters


@frappe.whitelist()
def get_team_violations(employee=None, from_date=None, to_date=None, project=None, limit=200, start=0):
    """Manager queue for off-zone (geofence) requests — the current user's
    team only, NEVER their own. Supports employee / date-range / project
    filters and a configurable page size (load-more beyond the default)."""
    filters = _team_scope_filters(employee)
    if filters is None:
        return []
    filters.append(["status", "in", ["Pending", "Approved", "Rejected"]])
    if from_date:
        filters.append(["date", ">=", from_date])
    if to_date:
        filters.append(["date", "<=", to_date])
    if project:
        filters.append(["selected_project", "=", project])
    return frappe.get_all(
        "Geofence Violation",
        filters=filters,
        fields=[
            "name", "employee", "employee_name", "log_type", "time", "date",
            "latitude", "longitude", "accuracy_m",
            "distance_m", "nearest_site", "selected_project", "scope_of_work", "selfie",
            "reason", "status", "manager_notes", "approver", "approved_on", "linked_checkin",
        ],
        order_by="modified desc",
        limit_page_length=int(limit or 200),
        limit_start=int(start or 0),
        ignore_permissions=True,
    )


@frappe.whitelist()
def decide_violations(names, action, comment=None):
    """Bulk approve/reject geofence violations. Enforces _can_approve per row
    (never self; only the employee's manager). Uses a savepoint per row so a
    single failure doesn't roll back the rest."""
    names = frappe.parse_json(names) if isinstance(names, str) else (names or [])
    target = "Approved" if action == "approve" else "Rejected"
    done, failed = [], []
    for i, name in enumerate(names):
        sp = f"gfv_{i}"
        frappe.db.savepoint(sp)
        try:
            doc = frappe.get_doc("Geofence Violation", name)
            if doc.status != "Pending" or not _can_approve(frappe.session.user, doc.employee):
                failed.append(name)
                continue
            doc.status = target
            if comment:
                doc.manager_notes = comment
            doc.flags.ignore_permissions = True
            doc.save(ignore_permissions=True)
            done.append(name)
        except Exception:
            frappe.db.rollback(save_point=sp)
            failed.append(name)
    frappe.db.commit()
    return {"done": done, "failed": failed}


@frappe.whitelist()
def get_my_missed_checkouts():
    """The current employee's own missed-checkouts (all statuses) for the
    'Me' tab — read-only; only the manager can approve/reject."""
    emp = _my_employee()
    if not emp:
        return []
    rows = frappe.get_all(
        "Missed Checkout",
        filters=[["employee", "=", emp], ["status", "in", ["Pending", "Approved", "Rejected"]]],
        fields=[
            "name", "date", "in_time", "site_name", "site_project_name",
            "is_office_worker", "status", "employee", "employee_name",
            "proposed_out_time", "edited_out_time", "reason", "elapsed_h",
            "approver", "approver_comment", "submitted_on",
        ],
        order_by="modified desc",
        limit_page_length=100,
        ignore_permissions=True,
    )
    return [_serialize_mc(r) for r in rows]


@frappe.whitelist()
def get_team_missed_checkouts(employee=None, from_date=None, to_date=None, project=None, limit=200, start=0):
    """Manager queue — the current user's team only, NEVER their own.
    Supports employee / date-range / project filters + configurable page size."""
    filters = _team_scope_filters(employee)
    if filters is None:
        return []
    filters.append(["status", "in", ["Pending", "Approved", "Rejected"]])
    if from_date:
        filters.append(["date", ">=", from_date])
    if to_date:
        filters.append(["date", "<=", to_date])
    if project:
        filters.append(["site_name", "=", project])
    rows = frappe.get_all(
        "Missed Checkout",
        filters=filters,
        fields=[
            "name", "date", "in_time", "site_name", "site_project_name",
            "is_office_worker", "status", "employee", "employee_name",
            "proposed_out_time", "edited_out_time", "reason", "elapsed_h",
            "approver", "approver_comment", "submitted_on",
        ],
        order_by="modified desc",
        limit_page_length=int(limit or 200),
        limit_start=int(start or 0),
        ignore_permissions=True,
    )
    return [_serialize_mc(r) for r in rows]


@frappe.whitelist()
def decide_missed_checkouts(names, action, comment=None):
    """Bulk approve/reject missed check-outs — reuses the single-row methods
    (which enforce _can_approve), with a savepoint per row."""
    names = frappe.parse_json(names) if isinstance(names, str) else (names or [])
    done, failed = [], []
    for i, name in enumerate(names):
        sp = f"mco_{i}"
        frappe.db.savepoint(sp)
        try:
            if action == "approve":
                approve_missed_checkout(name)
            else:
                reject_missed_checkout(name, comment or "")
            done.append(name)
        except Exception:
            frappe.db.rollback(save_point=sp)
            failed.append(name)
    return {"done": done, "failed": failed}


@frappe.whitelist()
def submit_missed_checkout(name, proposed_out_time, reason=""):
    """Employee submits the modal → flips Unsubmitted/Rejected → Pending.
    The owner check enforces self-only."""
    from frappe.utils import now_datetime
    doc = frappe.get_doc("Missed Checkout", name)
    user = frappe.session.user
    me_emp = frappe.db.get_value("Employee", {"user_id": user}, "name")
    if doc.employee != me_emp:
        frappe.throw("Not your row.")
    if doc.status not in ("Unsubmitted", "Rejected"):
        frappe.throw("This missed-checkout has already been submitted.")
    doc.proposed_out_time = (proposed_out_time or "").strip()
    doc.reason = (reason or "").strip()
    doc.status = "Pending"
    doc.submitted_on = now_datetime()
    doc.flags.ignore_permissions = True
    doc.save()

    # Surface the day in the attendance report as Pending Approval while it
    # awaits the manager. It flips to Present only once approved (the OUT
    # check-in is created then and recomputes the row).
    try:
        from akg_ess.attendance import upsert_missed_pending
        in_checkin = doc.in_checkin
        in_time = frappe.db.get_value("Employee Checkin", in_checkin, "time") if in_checkin else None
        upsert_missed_pending(
            employee=doc.employee,
            day=doc.date,
            in_time=in_time,
            in_project=doc.site_name,
            in_checkin=in_checkin,
            proposed_out_time=doc.proposed_out_time,
            out_project=doc.site_name,
        )
    except Exception:
        frappe.log_error(frappe.get_traceback(), "AKG ESS · missed pending attendance")

    # Notify the approver(s) that a missed check-out is awaiting review.
    try:
        from akg_ess.webpush import notify_user
        for u in _approver_users(doc.employee):
            notify_user(u, "Missed check-out",
                        f"{doc.employee_name or doc.employee} submitted a missed check-out for review.",
                        target_tab="profile", kind="approval", for_role="manager")
    except Exception:
        frappe.log_error(frappe.get_traceback(), "MC notify approvers")

    return _serialize_mc(doc.as_dict())


def _notify_mc_employee(doc, decision):
    try:
        from akg_ess.webpush import notify_user
        u = frappe.db.get_value("Employee", doc.employee, "user_id")
        if u:
            notify_user(u, "Missed check-out " + decision,
                        f"Your missed check-out was {decision}.",
                        target_tab="attendance", kind="approval")
    except Exception:
        frappe.log_error(frappe.get_traceback(), "MC notify employee")


@frappe.whitelist()
def approve_missed_checkout(name, edited_out_time="", comment=""):
    """Manager approves → on_status_change creates the matching OUT
    Employee Checkin so the day's hours land on the timesheet."""
    from frappe.utils import now_datetime
    doc = frappe.get_doc("Missed Checkout", name)
    if doc.status != "Pending":
        frappe.throw("Only Pending rows can be approved.")
    if not _can_approve(frappe.session.user, doc.employee):
        frappe.throw("You can only approve missed check-outs for your own team members.")
    if edited_out_time:
        doc.edited_out_time = edited_out_time.strip()
    doc.approver = frappe.session.user
    doc.approver_comment = (comment or "").strip()
    doc.approved_on = now_datetime()
    doc.status = "Approved"
    doc.flags.ignore_permissions = True
    doc.save()
    _notify_mc_employee(doc, "approved")
    return _serialize_mc(doc.as_dict())


@frappe.whitelist()
def reject_missed_checkout(name, comment=""):
    from frappe.utils import now_datetime
    doc = frappe.get_doc("Missed Checkout", name)
    if doc.status != "Pending":
        frappe.throw("Only Pending rows can be rejected.")
    if not _can_approve(frappe.session.user, doc.employee):
        frappe.throw("You can only reject missed check-outs for your own team members.")
    doc.approver = frappe.session.user
    doc.approver_comment = (comment or "Rejected — please re-submit.").strip()
    doc.approved_on = now_datetime()
    doc.status = "Rejected"
    doc.flags.ignore_permissions = True
    doc.save()
    _notify_mc_employee(doc, "rejected")
    return _serialize_mc(doc.as_dict())


def scan_missed_checkouts():
    """Scheduler — runs daily ~00:30 site time. For every Employee
    Checkin from yesterday with log_type='IN' and no matching OUT, create
    a Missed Checkout row in status='Unsubmitted'. Idempotent — never
    creates duplicates for the same employee+date."""
    from frappe.utils import now_datetime, add_days
    today = frappe.utils.nowdate()
    yesterday = add_days(today, -1)
    ref_dt = now_datetime()

    rows = frappe.db.sql("""
        SELECT name, employee, log_type, time, project
        FROM `tabEmployee Checkin`
        WHERE DATE(time) = %s
        ORDER BY employee, time
    """, (yesterday,), as_dict=True)

    by_emp = {}
    for r in rows:
        by_emp.setdefault(r["employee"], []).append(r)

    created = 0
    for emp, events in by_emp.items():
        events.sort(key=lambda x: x["time"])
        unmatched = None
        for e in events:
            if e["log_type"] == "IN":
                unmatched = e
            elif e["log_type"] == "OUT" and unmatched:
                unmatched = None
        if not unmatched:
            continue
        if frappe.db.exists("Missed Checkout", {"employee": emp, "date": yesterday}):
            continue
        emp_doc = frappe.db.get_value(
            "Employee", emp,
            ["employee_name", "is_office_worker"],
            as_dict=True,
        ) or {}
        in_time_str = str(unmatched["time"])
        try:
            hhmm = in_time_str.split(" ")[1][:5]
        except Exception:
            hhmm = ""
        elapsed_h = _hours_between(unmatched["time"], ref_dt)
        if elapsed_h < 12:
            continue
        try:
            doc = frappe.get_doc({
                "doctype": "Missed Checkout",
                "employee": emp,
                "employee_name": emp_doc.get("employee_name") or emp,
                "is_office_worker": int(bool(emp_doc.get("is_office_worker"))),
                "date": yesterday,
                "site_name": unmatched.get("project") or None,
                "in_time": hhmm,
                "in_checkin": unmatched["name"],
                "elapsed_h": elapsed_h,
                "status": "Unsubmitted",
            })
            doc.flags.ignore_permissions = True
            doc.insert()
            # Flag the day's ESS Daily Attendance row (opened on check-in)
            # as Missed Checkout so the monthly report shows it as such.
            att = frappe.db.get_value(
                "ESS Daily Attendance", {"employee": emp, "date": yesterday}, "name"
            )
            if att:
                frappe.db.set_value("ESS Daily Attendance", att, "status", "Missed Checkout")
            created += 1
        except Exception:
            frappe.log_error(frappe.get_traceback(), "AKG ESS · scan_missed_checkouts")
    if created:
        frappe.db.commit()
    return {"created": created, "date": str(yesterday)}

