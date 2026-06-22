"""ESS Attendance Correction — an employee proposes fixes to a day's punch
(in/out time, in/out project, scope) with a reason. On manager approval the
day's Employee Checkins are updated and the day is recomputed (ESS Daily +
HR Attendance re-posted).

Class name must be ESSAttendanceCorrection — get_controller derives it from
the doctype by stripping spaces/hyphens (no title-casing).
"""
import frappe
from frappe.model.document import Document


class ESSAttendanceCorrection(Document):
    def validate(self):
        # Approval authority: only the employee's manager (or System/HR
        # Manager) may approve/reject — never the employee themselves.
        if not self.is_new() and self.has_value_changed("status") and self.status in ("Approved", "Rejected"):
            from akg_ess.api import _can_approve
            if not _can_approve(frappe.session.user, self.employee):
                frappe.throw("Only this employee's manager can approve or reject a correction.")


def get_permission_query_conditions(user=None):
    """Own rows + (for managers) their team's rows. Mirrors Missed Checkout."""
    user = user or frappe.session.user
    if user == "Administrator":
        return ""
    roles = set(frappe.get_roles(user))
    if {"System Manager", "HR Manager"} & roles:
        return ""
    esc = lambda v: frappe.db.escape(v)[1:-1]
    own = f"`tabESS Attendance Correction`.`owner` = '{esc(user)}'"
    me = frappe.db.get_value("Employee", {"user_id": user}, "name")
    if not me:
        return own
    own_emp = f"`tabESS Attendance Correction`.`employee` = '{esc(me)}'"
    team = frappe.get_all("Employee", filters=[["reports_to", "=", me], ["status", "=", "Active"]], pluck="name")
    team += frappe.get_all("Employee", filters=[["leave_approver", "=", user], ["status", "=", "Active"]], pluck="name")
    team = list({t for t in team if t and t != me})
    if not team:
        return f"({own} OR {own_emp})"
    in_clause = ",".join(f"'{esc(e)}'" for e in team)
    return f"({own} OR {own_emp} OR `tabESS Attendance Correction`.`employee` IN ({in_clause}))"


def on_status_change(doc, method=None):
    if not doc.has_value_changed("status"):
        return
    if doc.status == "Approved" and not doc.applied:
        if not frappe.session.user or frappe.session.user == "Guest":
            return
        try:
            from akg_ess.attendance import apply_correction
            apply_correction(
                doc.employee, doc.date,
                in_time=doc.in_time, in_project=doc.in_project,
                out_time=doc.out_time, out_project=doc.out_project, scope=doc.scope_of_work,
            )
            doc.db_set("applied", 1, update_modified=False)
            doc.db_set("applied_on", frappe.utils.now_datetime(), update_modified=False)
        except Exception:
            frappe.log_error(frappe.get_traceback(), "ESS correction: apply failed")
        if not doc.approver:
            doc.db_set("approver", frappe.session.user, update_modified=False)
        if not doc.approved_on:
            doc.db_set("approved_on", frappe.utils.now_datetime(), update_modified=False)
        _notify(doc, "approved")
    elif doc.status == "Rejected":
        if not doc.approver:
            doc.db_set("approver", frappe.session.user, update_modified=False)
        if not doc.approved_on:
            doc.db_set("approved_on", frappe.utils.now_datetime(), update_modified=False)
        _notify(doc, "rejected")


def _notify(doc, decision):
    try:
        from akg_ess.webpush import notify_user
        user = frappe.db.get_value("Employee", doc.employee, "user_id")
        if user:
            notify_user(user, "Correction " + decision,
                        f"Your attendance correction for {doc.date} was {decision}.",
                        target_tab="attendance", kind="approval")
    except Exception:
        frappe.log_error(frappe.get_traceback(), "ESS correction: notify employee")
