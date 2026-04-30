import frappe
from frappe.model.document import Document


class ESSNotification(Document):
    pass


def _employee_for_user(user):
    return frappe.db.get_value("Employee", {"user_id": user}, "name")


def get_permission_query_conditions(user=None):
    """List filter — non-admins only see notifications addressed to them
    (or to their role / 'all')."""
    user = user or frappe.session.user
    if not user or user == "Administrator":
        return ""
    if "System Manager" in frappe.get_roles(user) or "HR Manager" in frappe.get_roles(user):
        return ""
    employee = _employee_for_user(user)
    role = "manager" if "ESS Manager" in frappe.get_roles(user) else "employee"
    parts = [f"`tabESS Notification`.for_role = 'all'", f"`tabESS Notification`.for_role = '{role}'"]
    if employee:
        parts.append(f"`tabESS Notification`.recipient = '{frappe.db.escape(employee, percent=False).strip(chr(39))}'")
    return "(" + " OR ".join(parts) + ")"


def has_permission(doc, user=None, permission_type=None):
    user = user or frappe.session.user
    if "System Manager" in frappe.get_roles(user) or "HR Manager" in frappe.get_roles(user):
        return True
    if doc.for_role == "all":
        return True
    role = "manager" if "ESS Manager" in frappe.get_roles(user) else "employee"
    if doc.for_role == role:
        return True
    employee = _employee_for_user(user)
    return bool(employee and doc.recipient == employee)
