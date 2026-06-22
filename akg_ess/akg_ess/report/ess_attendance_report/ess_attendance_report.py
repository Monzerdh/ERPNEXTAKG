"""ESS Attendance Report — detailed daily attendance with filters, KPI
summary tiles, a status chart, and built-in Excel/CSV export.

Covers the "monthly export", "per-project hours" (project filter) and
"absence" (status filter) asks from one report. Scoped to the running
user's team unless they are System / HR Manager / HR User.
"""
import frappe


def execute(filters=None):
    filters = filters or {}
    where, values = _conditions(filters)
    rows = frappe.db.sql(
        f"""
        SELECT employee, employee_name, date, status,
               check_in_time, check_out_time, check_in_zone, check_out_zone,
               check_in_project, check_out_project,
               normal_hours, overtime_hours, total_hours
        FROM `tabESS Daily Attendance`
        WHERE {where}
        ORDER BY date DESC, employee_name ASC
        """,
        values, as_dict=True,
    )
    return _columns(), rows, None, _chart(rows), _summary(rows)


def _conditions(filters):
    parts = ["1=1"]
    values = {}

    # Team scoping: HR / System Manager see all; anyone else only their
    # direct reports (+ themselves). ESS Daily Attendance's
    # permission_query_conditions doesn't apply to raw SQL, so enforce here.
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
    if filters.get("status"):
        parts.append("status = %(status)s")
        values["status"] = filters["status"]
    if filters.get("project"):
        parts.append("(check_in_project = %(project)s OR check_out_project = %(project)s)")
        values["project"] = filters["project"]
    return " AND ".join(parts), values


def _columns():
    return [
        {"label": "Employee", "fieldname": "employee", "fieldtype": "Link", "options": "Employee", "width": 110},
        {"label": "Name", "fieldname": "employee_name", "fieldtype": "Data", "width": 180},
        {"label": "Date", "fieldname": "date", "fieldtype": "Date", "width": 95},
        {"label": "Status", "fieldname": "status", "fieldtype": "Data", "width": 120},
        {"label": "In", "fieldname": "check_in_time", "fieldtype": "Datetime", "width": 140},
        {"label": "In Zone", "fieldname": "check_in_zone", "fieldtype": "Data", "width": 80},
        {"label": "Out", "fieldname": "check_out_time", "fieldtype": "Datetime", "width": 140},
        {"label": "Out Zone", "fieldname": "check_out_zone", "fieldtype": "Data", "width": 80},
        {"label": "In Project", "fieldname": "check_in_project", "fieldtype": "Link", "options": "Project", "width": 120},
        {"label": "Out Project", "fieldname": "check_out_project", "fieldtype": "Link", "options": "Project", "width": 120},
        {"label": "Normal (h)", "fieldname": "normal_hours", "fieldtype": "Float", "precision": "2", "width": 90},
        {"label": "OT (h)", "fieldname": "overtime_hours", "fieldtype": "Float", "precision": "2", "width": 80},
        {"label": "Total (h)", "fieldname": "total_hours", "fieldtype": "Float", "precision": "2", "width": 90},
    ]


def _summary(rows):
    present = sum(1 for r in rows if r.status == "Present")
    absent = sum(1 for r in rows if r.status == "Absent")
    pending = sum(1 for r in rows if r.status == "Pending Approval")
    total_h = sum((r.total_hours or 0) for r in rows)
    ot_h = sum((r.overtime_hours or 0) for r in rows)
    return [
        {"label": "Present", "value": present, "indicator": "Green"},
        {"label": "Absent", "value": absent, "indicator": "Red"},
        {"label": "Pending Approval", "value": pending, "indicator": "Orange"},
        {"label": "Total Hours", "value": round(total_h, 2), "indicator": "Blue"},
        {"label": "Overtime Hours", "value": round(ot_h, 2), "indicator": "Purple"},
    ]


def _chart(rows):
    buckets = {}
    for r in rows:
        buckets[r.status or "—"] = buckets.get(r.status or "—", 0) + 1
    labels = list(buckets.keys())
    return {
        "type": "donut",
        "data": {"labels": labels, "datasets": [{"name": "Days", "values": [buckets[k] for k in labels]}]},
        "height": 240,
    }
