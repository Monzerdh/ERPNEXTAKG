"""
Server-side guards for Employee Checkin inserts.

ALL AKG employees are limited to exactly one IN and one OUT per calendar
day.  This module hooks into the standard Employee Checkin DocType's
before_insert event and rejects:

  - a second IN  for the same employee on the same date
  - a second OUT for the same employee on the same date
  - an OUT before any IN on that date (would corrupt the Today card)

This is the single-session attendance model: one check-in, one check-out,
one daily attendance record per employee per day.

The frontend already enforces this UX-wise (the big button is replaced
with a 'Day complete' card after OUT), but the server has to mirror the
rule because:

  - the offline outbox may retry a queued IN/OUT after the user already
    submitted a fresh one online;
  - admins / scripts could insert via the REST API directly;
  - the geofence + missed-checkout approval hooks also create rows.

Exception: the missed-checkout rectify flow inserts a back-dated OUT
with device_id 'ESS-MISSED-RECTIFY'.  That OUT is the *only* OUT for its
day (the whole point is the day had none), so it passes the duplicate
guard naturally — we don't special-case it.
"""

import frappe
from frappe import _


def enforce_single_daily(doc, method=None):
    if not doc or not doc.employee:
        return

    # System-generated inserts bypass the guard: the geofence-approval and
    # missed-checkout-rectify hooks create rows with ignore_permissions set,
    # and they do their own idempotency checks. Only user-facing REST
    # inserts (no ignore_permissions) are enforced here.
    if getattr(doc, "flags", None) and doc.flags.get("ignore_permissions"):
        return

    # Date to scope by — the date portion of the row's `time` field.
    if not doc.time:
        doc.time = frappe.utils.now_datetime()
    day = frappe.utils.getdate(doc.time)
    day_start = f"{day} 00:00:00"
    day_end = f"{day} 23:59:59"

    log_type = (doc.log_type or "").upper()
    if log_type not in ("IN", "OUT"):
        return  # unknown log_type — let Frappe's own validation handle it

    existing = frappe.get_all(
        "Employee Checkin",
        filters=[
            ["employee", "=", doc.employee],
            ["log_type", "=", log_type],
            ["time", ">=", day_start],
            ["time", "<=", day_end],
        ],
        fields=["name", "time"],
        limit=1,
    )
    if existing:
        existing_time = frappe.utils.format_datetime(existing[0]["time"], "HH:mm")
        if log_type == "IN":
            frappe.throw(
                _("You've already checked in today at {0}. You can only check in once per day.").format(existing_time),
                title=_("Already checked in"),
            )
        else:
            frappe.throw(
                _("You've already checked out today at {0}. You can only check out once per day.").format(existing_time),
                title=_("Already checked out"),
            )

    # Also block a punch that duplicates a still-pending out-of-zone one
    # (recorded as a Geofence Violation, not yet an Employee Checkin).
    if _has_pending_violation(doc.employee, day, log_type):
        if log_type == "IN":
            frappe.throw(
                _("You already have a check-in awaiting approval for today."),
                title=_("Already checked in"),
            )
        else:
            frappe.throw(
                _("You already have a check-out awaiting approval for today."),
                title=_("Already checked out"),
            )

    # Reject OUT before any IN on the same date — unless the IN is an
    # out-of-zone punch awaiting approval (the employee did check in; the
    # punch is just pending). Never block a check-out.
    if log_type == "OUT":
        in_today = frappe.get_all(
            "Employee Checkin",
            filters=[
                ["employee", "=", doc.employee],
                ["log_type", "=", "IN"],
                ["time", ">=", day_start],
                ["time", "<=", day_end],
            ],
            fields=["name"],
            limit=1,
        )
        if not in_today and not _has_pending_violation(doc.employee, day, "IN"):
            frappe.throw(
                _("Check in first before checking out."),
                title=_("Not checked in"),
            )


def _has_pending_violation(employee, day, log_type):
    """True if there's a pending out-of-zone Geofence Violation of this
    log_type for the day (a punch recorded but not yet approved)."""
    if not frappe.db.exists("DocType", "Geofence Violation"):
        return False
    return bool(frappe.db.exists("Geofence Violation", {
        "employee": employee, "date": day,
        "log_type": (log_type or "").upper(), "status": "Pending",
    }))


# Back-compat alias — hooks.py referenced the old office-only name.
enforce_office_worker_single_daily = enforce_single_daily
