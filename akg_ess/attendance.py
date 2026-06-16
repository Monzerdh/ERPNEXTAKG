"""
Daily attendance computation for AKG ESS.

Single-session model: one IN + one OUT per employee per day. When the OUT
Employee Checkin is inserted we compute one ESS Daily Attendance row:

  - total / normal / overtime hours (overtime = hours past 10, only when
    Employee.has_overtime is ticked; otherwise those hours are degraded)
  - project split: if the check-in project differs from the check-out
    project, the counted hours are halved across both projects
  - status: Pending Approval if a geofence violation / missed-checkout for
    that day is still pending, otherwise Present

A daily scheduler (mark_absentees) backfills Absent rows for ESS-enabled
employees who had no check-in on a working day.
"""

import frappe

OVERTIME_THRESHOLD_HOURS = 10.0


def on_checkin_after_insert(doc, method=None):
    """Employee Checkin after_insert hook. Only OUT rows trigger the
    daily attendance computation."""
    try:
        if (doc.log_type or "").upper() != "OUT":
            return
        compute_daily_attendance(doc)
    except Exception:
        # Never block a check-out on attendance computation — log + move on.
        frappe.log_error(frappe.get_traceback(), "AKG ESS · on_checkin_after_insert")


def _day_has_pending_hold(employee, day):
    """True if the day is on hold (geofence violation or missed-checkout
    still pending manager review)."""
    if frappe.db.exists("DocType", "Geofence Violation"):
        if frappe.db.exists("Geofence Violation", {"employee": employee, "date": day, "status": "Pending"}):
            return True
    if frappe.db.exists("DocType", "Missed Checkout"):
        if frappe.db.exists("Missed Checkout", {"employee": employee, "date": day, "status": "Pending"}):
            return True
    return False


def compute_daily_attendance(out_doc):
    """Build / refresh the ESS Daily Attendance row for the OUT's day."""
    from frappe.utils import getdate, get_datetime

    employee = out_doc.employee
    if not employee or not out_doc.time:
        return

    day = getdate(out_doc.time)
    day_start = f"{day} 00:00:00"
    day_end = f"{day} 23:59:59"

    # Find the single IN for this employee on this day.
    in_rows = frappe.get_all(
        "Employee Checkin",
        filters=[
            ["employee", "=", employee],
            ["log_type", "=", "IN"],
            ["time", ">=", day_start],
            ["time", "<=", day_end],
        ],
        fields=["name", "time", "project"],
        order_by="time asc",
        limit=1,
    )
    if not in_rows:
        return  # OUT without IN — guard normally blocks this; nothing to compute.
    in_row = in_rows[0]

    in_dt = get_datetime(in_row["time"])
    out_dt = get_datetime(out_doc.time)
    has_ot = bool(frappe.db.get_value("Employee", employee, "has_overtime"))
    hb = _hours_breakdown(in_dt, out_dt, has_ot, in_row.get("project"), out_doc.project)

    status = "Pending Approval" if _day_has_pending_hold(employee, day) else "Present"

    values = {
        "employee": employee,
        "date": day,
        "status": status,
        "scope": getattr(out_doc, "scope_of_work", None),
        "check_in_time": in_row["time"],
        "check_out_time": out_doc.time,
        "check_in_project": in_row.get("project"),
        "check_out_project": out_doc.project,
        "has_overtime": int(has_ot),
        "in_checkin": in_row["name"],
        "out_checkin": out_doc.name,
        **hb,
    }
    _upsert_attendance(employee, day, values)


def _hours_breakdown(in_dt, out_dt, has_ot, in_proj, out_proj):
    """Total / normal / overtime hours + project A/B split. Overtime only
    counts when has_ot is True; otherwise hours past 10 are degraded."""
    gross = max(0.0, (out_dt - in_dt).total_seconds() / 3600.0)
    if gross > OVERTIME_THRESHOLD_HOURS:
        normal = OVERTIME_THRESHOLD_HOURS
        overtime = (gross - OVERTIME_THRESHOLD_HOURS) if has_ot else 0.0
    else:
        normal = gross
        overtime = 0.0
    counted = normal + overtime

    if in_proj and out_proj and in_proj != out_proj:
        project_a, project_b = in_proj, out_proj
        hours_a = round(counted / 2.0, 2)
        hours_b = round(counted - hours_a, 2)
    else:
        project_a = in_proj or out_proj
        project_b = None
        hours_a = round(counted, 2)
        hours_b = 0.0
    return {
        "total_hours": round(counted, 2),
        "normal_hours": round(normal, 2),
        "overtime_hours": round(overtime, 2),
        "project_a": project_a,
        "hours_project_a": hours_a,
        "project_b": project_b,
        "hours_project_b": hours_b,
    }


def _upsert_attendance(employee, day, values):
    existing = frappe.db.get_value(
        "ESS Daily Attendance", {"employee": employee, "date": day}, "name"
    )
    if existing:
        doc = frappe.get_doc("ESS Daily Attendance", existing)
        doc.update(values)
    else:
        doc = frappe.get_doc({"doctype": "ESS Daily Attendance", **values})
    doc.flags.ignore_permissions = True
    doc.save()
    frappe.db.commit()
    return doc.name


def upsert_missed_pending(employee, day, in_time, in_project, in_checkin,
                          proposed_out_time, out_project, scope=None):
    """Create / refresh a Pending Approval attendance row while a missed
    check-out awaits manager approval, so the day is visible in the report
    (not blank) and flips to Present only once approved.

    proposed_out_time is 'HH:MM'; the OUT timestamp is anchored on `day`.
    Hours are provisional — recomputed for real when the OUT is created on
    approval.
    """
    from frappe.utils import get_datetime
    if not (employee and day and in_time and proposed_out_time):
        return
    try:
        in_dt = get_datetime(in_time)
        out_dt = get_datetime(f"{day} {proposed_out_time}:00")
    except Exception:
        return
    has_ot = bool(frappe.db.get_value("Employee", employee, "has_overtime"))
    hb = _hours_breakdown(in_dt, out_dt, has_ot, in_project, out_project)
    values = {
        "employee": employee,
        "date": day,
        "status": "Pending Approval",
        "scope": scope or None,
        "check_in_time": in_time,
        "check_out_time": f"{day} {proposed_out_time}:00",
        "check_in_project": in_project,
        "check_out_project": out_project,
        "has_overtime": int(has_ot),
        "in_checkin": in_checkin,
        **hb,
    }
    _upsert_attendance(employee, day, values)


def refresh_attendance_status(employee, day):
    """Re-evaluate the status of an existing attendance row — called after a
    geofence violation / missed-checkout decision releases the day."""
    name = frappe.db.get_value("ESS Daily Attendance", {"employee": employee, "date": day}, "name")
    if not name:
        return
    status = "Pending Approval" if _day_has_pending_hold(employee, day) else "Present"
    frappe.db.set_value("ESS Daily Attendance", name, "status", status)


def mark_absentees():
    """Scheduler — runs daily ~01:00 site time. For yesterday, create an
    Absent ESS Daily Attendance row for each ESS-enabled active employee
    who had no check-in and no approved leave. Sundays (weekend) skipped.

    Conservative scope: only employees with a linked user_id (i.e. those
    expected to use the app). Adjust the filter if labourers without app
    accounts should also be tracked.
    """
    from frappe.utils import add_days, getdate

    today = frappe.utils.nowdate()
    yesterday = add_days(today, -1)
    day = getdate(yesterday)

    # AKG default weekend = Sunday only (weekday() == 6).
    if day.weekday() == 6:
        return {"created": 0, "skipped": "weekend", "date": str(yesterday)}

    employees = frappe.get_all(
        "Employee",
        filters=[["status", "=", "Active"], ["user_id", "is", "set"]],
        fields=["name"],
        limit_page_length=0,
    )

    created = 0
    for e in employees:
        emp = e["name"]
        if frappe.db.exists("ESS Daily Attendance", {"employee": emp, "date": yesterday}):
            continue
        # Skip if covered by an approved leave.
        on_leave = frappe.db.sql("""
            SELECT name FROM `tabLeave Application`
            WHERE employee = %s AND status = 'Approved'
              AND %s BETWEEN from_date AND to_date
            LIMIT 1
        """, (emp, yesterday))
        if on_leave:
            continue
        try:
            doc = frappe.get_doc({
                "doctype": "ESS Daily Attendance",
                "employee": emp,
                "date": yesterday,
                "status": "Absent",
                "total_hours": 0,
                "normal_hours": 0,
                "overtime_hours": 0,
                "hours_project_a": 0,
                "hours_project_b": 0,
            })
            doc.flags.ignore_permissions = True
            doc.insert()
            created += 1
        except Exception:
            frappe.log_error(frappe.get_traceback(), "AKG ESS · mark_absentees")
    if created:
        frappe.db.commit()
    return {"created": created, "date": str(yesterday)}
