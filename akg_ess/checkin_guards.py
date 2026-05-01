"""
Server-side guards for Employee Checkin inserts.

Office workers (Employee.is_office_worker = 1) are limited to exactly one
IN and one OUT per calendar day.  This module hooks into the standard
Employee Checkin DocType's before_insert event and rejects:

  - a second IN  for the same employee on the same date
  - a second OUT for the same employee on the same date
  - an OUT before any IN on that date (would corrupt the Today card)

Site workers (the default) are unaffected — they keep multi-session
behaviour for split shifts, supplier pickups, etc.

The frontend already enforces this UX-wise (the big button is replaced
with a 'Day complete' card after OUT), but the server has to mirror the
rule because:

  - the offline outbox may retry a queued IN/OUT after the user already
    submitted a fresh one online;
  - admins / scripts could insert via the REST API directly;
  - the geofence approval hook also creates Employee Checkin rows.
"""

import frappe
from frappe import _


def enforce_office_worker_single_daily(doc, method=None):
    if not doc or not doc.employee:
        return

    is_office = frappe.db.get_value("Employee", doc.employee, "is_office_worker")
    if not is_office:
        return  # site worker — multi-session attendance is allowed

    # Determine the calendar date to scope by.  We use the date portion of
    # the row's `time` field (Datetime) — that's how the PWA filters the
    # 'today' list and how the Monthly Report aggregates rows.
    if not doc.time:
        # Frappe normally fills `time` with now; if missing, default to it
        # so this guard still runs against the correct date.
        doc.time = frappe.utils.now_datetime()
    day = frappe.utils.getdate(doc.time)
    day_start = f"{day} 00:00:00"
    day_end = f"{day} 23:59:59"

    log_type = (doc.log_type or "").upper()
    if log_type not in ("IN", "OUT"):
        return  # unknown log_type — let Frappe's own validation handle it

    # Look for an existing same-type row on the same date for this
    # employee.  Skipping the current doc itself (which has no name yet on
    # before_insert, but we keep the guard explicit anyway).
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
                _("You've already checked in today at {0}. Office workers can only check in once per day — wait until tomorrow.").format(existing_time),
                title=_("Already checked in"),
            )
        else:
            frappe.throw(
                _("You've already checked out today at {0}. Office workers can only check out once per day.").format(existing_time),
                title=_("Already checked out"),
            )

    # Reject OUT before any IN on the same date — that would leave the
    # 'pending check-out' card permanently empty.
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
        if not in_today:
            frappe.throw(
                _("Check in first before checking out."),
                title=_("Not checked in"),
            )
