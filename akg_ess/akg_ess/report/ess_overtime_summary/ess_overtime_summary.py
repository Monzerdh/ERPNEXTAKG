"""ESS Overtime Summary — per-employee totals over a period: present /
absent days and normal / overtime / total hours. Sorted by overtime (the
payroll view). Same team-scoping + Excel export as the detail report."""
import frappe


def execute(filters=None):
    filters = filters or {}
    where, values = _conditions(filters)
    rows = frappe.db.sql(
        f"""
        SELECT employee, employee_name,
               SUM(CASE WHEN status='Present' THEN 1 ELSE 0 END) AS present_days,
               SUM(CASE WHEN status='Absent' THEN 1 ELSE 0 END) AS absent_days,
               SUM(CASE WHEN status='Pending Approval' THEN 1 ELSE 0 END) AS pending_days,
               ROUND(SUM(normal_hours), 2) AS normal_hours,
               ROUND(SUM(overtime_hours), 2) AS overtime_hours,
               ROUND(SUM(total_hours), 2) AS total_hours
        FROM `tabESS Daily Attendance`
        WHERE {where}
        GROUP BY employee, employee_name
        ORDER BY overtime_hours DESC, employee_name ASC
        """,
        values, as_dict=True,
    )
    return _columns(), rows, None, _chart(rows), _summary(rows)


def _conditions(filters):
    parts = ["1=1"]
    values = {}
    roles = set(frappe.get_roles(frappe.session.user))
    if not ({"System Manager", "HR Manager", "HR User"} & roles):
        me = frappe.db.get_value("Employee", {"user_id": frappe.session.user}, "name")
        team = frappe.get_all(
            "Employee", filters=[["reports_to", "=", me], ["status", "=", "Active"]], pluck="name"
        ) if me else []
        if me:
            team.append(me)
        team = list({t for t in team if t})
        if not team:
            parts.append("1=0")
        else:
            parts.append("employee IN %(team)s")
            values["team"] = tuple(team)
    if filters.get("employee"):
        parts.append("employee = %(employee)s")
        values["employee"] = filters["employee"]
    if filters.get("from_date"):
        parts.append("date >= %(from_date)s")
        values["from_date"] = filters["from_date"]
    if filters.get("to_date"):
        parts.append("date <= %(to_date)s")
        values["to_date"] = filters["to_date"]
    if filters.get("project"):
        parts.append("(check_in_project = %(project)s OR check_out_project = %(project)s)")
        values["project"] = filters["project"]
    return " AND ".join(parts), values


def _columns():
    return [
        {"label": "Employee", "fieldname": "employee", "fieldtype": "Link", "options": "Employee", "width": 110},
        {"label": "Name", "fieldname": "employee_name", "fieldtype": "Data", "width": 200},
        {"label": "Present", "fieldname": "present_days", "fieldtype": "Int", "width": 90},
        {"label": "Absent", "fieldname": "absent_days", "fieldtype": "Int", "width": 90},
        {"label": "Pending", "fieldname": "pending_days", "fieldtype": "Int", "width": 90},
        {"label": "Normal (h)", "fieldname": "normal_hours", "fieldtype": "Float", "precision": "2", "width": 100},
        {"label": "Overtime (h)", "fieldname": "overtime_hours", "fieldtype": "Float", "precision": "2", "width": 110},
        {"label": "Total (h)", "fieldname": "total_hours", "fieldtype": "Float", "precision": "2", "width": 100},
    ]


def _summary(rows):
    return [
        {"label": "Employees", "value": len(rows), "indicator": "Blue"},
        {"label": "Total Overtime (h)", "value": round(sum((r.overtime_hours or 0) for r in rows), 2), "indicator": "Purple"},
        {"label": "Total Hours", "value": round(sum((r.total_hours or 0) for r in rows), 2), "indicator": "Green"},
        {"label": "Absent Days", "value": sum((r.absent_days or 0) for r in rows), "indicator": "Red"},
    ]


def _chart(rows):
    top = rows[:10]
    return {
        "type": "bar",
        "data": {
            "labels": [(r.employee_name or r.employee or "")[:18] for r in top],
            "datasets": [{"name": "Overtime (h)", "values": [r.overtime_hours or 0 for r in top]}],
        },
        "height": 260,
    }
