import frappe
from frappe.model.document import Document


class ESSDailyAttendance(Document):
    pass


def get_permission_query_conditions(user=None):
    """Scope the list:
       - System / HR Manager / HR User: everything ("")
       - ESS Manager: own rows + direct reports + leave_approver team
       - ESS User / Employee: own rows only (owner-based)
    """
    user = user or frappe.session.user
    if user == "Administrator":
        return ""
    roles = set(frappe.get_roles(user))
    if {"System Manager", "HR Manager", "HR User"} & roles:
        return ""

    esc_user = frappe.db.escape(user)[1:-1]
    me_emp = frappe.db.get_value("Employee", {"user_id": user}, "name")
    if "ESS Manager" in roles and me_emp:
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
        own = f"`tabESS Daily Attendance`.`owner` = '{esc_user}'"
        if not team:
            return own
        in_clause = ",".join(f"'{frappe.db.escape(e)[1:-1]}'" for e in team)
        return f"({own} OR `tabESS Daily Attendance`.`employee` IN ({in_clause}))"

    return f"`tabESS Daily Attendance`.`owner` = '{esc_user}'"
