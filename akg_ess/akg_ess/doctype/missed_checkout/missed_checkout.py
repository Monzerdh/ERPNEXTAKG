"""
Missed Checkout — controller + permission scope + approve→OUT hook.

Lifecycle:
  1. Scheduler at 00:30 finds unmatched IN > 12h old → creates a row in
     status='Unsubmitted' (no employee proposal yet, no day held).
  2. Employee opens the app → modal collects proposed_out_time + reason
     → server moves status to 'Pending' via api.submit_missed_checkout.
  3. Manager Approve → status='Approved', creates Employee Checkin OUT
     using edited_out_time (or proposed_out_time if not overridden) and
     stamps the link in `out_checkin`.
  4. Manager Reject → status='Rejected'; the next employee modal opens
     with the rejection callout pre-filled.
"""

import frappe
from frappe.model.document import Document


class MissedCheckout(Document):
    pass


def get_permission_query_conditions(user=None):
    """Scope the list:
       - System / HR Manager: see everything (returns "")
       - ESS Manager: rows where the row's employee reports_to me OR
         the row's employee's leave_approver = me
       - ESS User / Employee: only my own rows (owner-based)
    """
    user = user or frappe.session.user
    if user == "Administrator":
        return ""
    roles = set(frappe.get_roles(user))
    if {"System Manager", "HR Manager"} & roles:
        return ""

    me_emp = frappe.db.get_value("Employee", {"user_id": user}, "name")
    if "ESS Manager" in roles and me_emp:
        # Direct reports OR explicit leave-approver assignment
        team = frappe.get_all(
            "Employee",
            filters=[["reports_to", "=", me_emp], ["status", "=", "Active"]],
            pluck="name",
        )
        approver_team = frappe.get_all(
            "Employee",
            filters=[["leave_approver", "=", user], ["status", "=", "Active"]],
            pluck="name",
        )
        team = list({*team, *approver_team})
        if not team:
            return f"`tabMissed Checkout`.`owner` = '{frappe.db.escape(user)[1:-1]}'"
        in_clause = ",".join(f"'{frappe.db.escape(e)[1:-1]}'" for e in team)
        own = f"`tabMissed Checkout`.`owner` = '{frappe.db.escape(user)[1:-1]}'"
        team_q = f"`tabMissed Checkout`.`employee` IN ({in_clause})"
        return f"({own} OR {team_q})"

    return f"`tabMissed Checkout`.`owner` = '{frappe.db.escape(user)[1:-1]}'"


def on_status_change(doc, method=None):
    """When a Missed Checkout flips to Approved, create the matching
    Employee Checkin OUT row so the day's hours land on the timesheet.
    Idempotent — never creates a second OUT for the same row."""
    if doc.status != "Approved" or doc.out_checkin:
        return
    out_time = (doc.edited_out_time or doc.proposed_out_time or "").strip()
    if not out_time or not doc.date:
        return
    # Build a 'YYYY-MM-DD HH:MM:SS' timestamp anchored on the missed day.
    if len(out_time) == 5:
        out_time = out_time + ":00"
    timestamp = f"{doc.date} {out_time}"

    co = frappe.get_doc({
        "doctype": "Employee Checkin",
        "employee": doc.employee,
        "log_type": "OUT",
        "time": timestamp,
        "project": doc.site_name or None,
        "device_id": "ESS-MISSED-RECTIFY",
    })
    co.flags.ignore_permissions = True
    co.insert()
    frappe.db.set_value("Missed Checkout", doc.name, "out_checkin", co.name)
