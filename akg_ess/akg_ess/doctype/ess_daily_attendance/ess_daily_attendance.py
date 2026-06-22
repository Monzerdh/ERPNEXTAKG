import frappe
from frappe.model.document import Document


class ESSDailyAttendance(Document):
    pass


def get_permission_query_conditions(user=None):
    """Scope the list by the EMPLOYEE the row is for (not by who created it —
    these rows are system-created, so owner is unreliable):
       - System / HR Manager / HR User: everything ("")
       - ESS Manager: own attendance + direct reports + leave_approver team
       - ESS User / Employee: own attendance only
    """
    user = user or frappe.session.user
    if user == "Administrator":
        return ""
    roles = set(frappe.get_roles(user))
    if {"System Manager", "HR Manager", "HR User"} & roles:
        return ""

    esc = lambda v: frappe.db.escape(v)[1:-1]
    me_emp = frappe.db.get_value("Employee", {"user_id": user}, "name")
    if not me_emp:
        # No linked Employee — fall back to rows they personally created.
        return f"`tabESS Daily Attendance`.`owner` = '{esc(user)}'"

    allowed = {me_emp}
    if "ESS Manager" in roles:
        allowed |= set(frappe.get_all(
            "Employee", filters=[["reports_to", "=", me_emp], ["status", "=", "Active"]], pluck="name"))
        allowed |= set(frappe.get_all(
            "Employee", filters=[["leave_approver", "=", user], ["status", "=", "Active"]], pluck="name"))
    in_clause = ",".join(f"'{esc(e)}'" for e in allowed if e)
    return f"`tabESS Daily Attendance`.`employee` IN ({in_clause})"
