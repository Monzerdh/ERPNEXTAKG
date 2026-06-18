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
    """Employee Checkin after_insert hook.
       IN  -> populate ESS Daily Attendance as 'Checked In' (no HR yet).
       OUT -> compute Present + post HR Attendance.
    Off-zone check-ins never reach here until approved (they're held in a
    Geofence Violation), so any checkin that exists is in-zone or approved.
    """
    try:
        lt = (doc.log_type or "").upper()
        if lt == "IN":
            record_checkin_in(doc)
        elif lt == "OUT":
            compute_daily_attendance(doc)
    except Exception:
        # Never block a check-in/out on attendance bookkeeping — log + move on.
        frappe.log_error(frappe.get_traceback(), "AKG ESS · on_checkin_after_insert")


def record_checkin_in(in_doc):
    """On check-IN, open the day's ESS Daily Attendance row as 'Checked In'
    (in progress). No HR Attendance yet — that waits for check-out."""
    from frappe.utils import getdate
    if not in_doc.employee or not in_doc.time:
        return
    day = getdate(in_doc.time)
    existing = frappe.db.get_value(
        "ESS Daily Attendance", {"employee": in_doc.employee, "date": day},
        ["name", "status"], as_dict=True,
    )
    # Don't downgrade a day that already has a check-out / decision.
    if existing and existing.status in ("Present", "Pending Approval", "Missed Checkout"):
        return
    # Off-zone check-in (a violation was already filed for the day) opens the
    # row as Pending Approval; an in-zone check-in is simply Checked In.
    status = "Pending Approval" if _day_has_pending_hold(in_doc.employee, day) else "Checked In"
    values = {
        "employee": in_doc.employee,
        "date": day,
        "status": status,
        "check_in_time": in_doc.time,
        "check_in_project": in_doc.project,
        "in_checkin": in_doc.name,
    }
    _upsert_attendance(in_doc.employee, day, values)


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

    # Post the standard ERPNext Attendance only when the day is final
    # (Present). If the day is on hold for an off-zone review, HR Attendance
    # is withheld — it gets posted when the manager approves (see
    # refresh_attendance_status, called from the geofence approval hook).
    if status == "Present":
        _sync_standard_attendance(
            employee, day, "Present", in_row["time"], out_doc.time, hb["total_hours"],
            link_checkins=[in_row["name"], out_doc.name],
        )


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
    # Day released → ensure the standard Attendance is posted/linked.
    if status == "Present":
        row = frappe.db.get_value(
            "ESS Daily Attendance", name,
            ["check_in_time", "check_out_time", "total_hours", "in_checkin", "out_checkin"], as_dict=True,
        ) or {}
        _sync_standard_attendance(
            employee, day, "Present",
            row.get("check_in_time"), row.get("check_out_time"), row.get("total_hours") or 0,
            link_checkins=[row.get("in_checkin"), row.get("out_checkin")],
        )


def _attendance_enabled():
    try:
        from akg_ess.akg_ess.doctype.akg_ess_settings.akg_ess_settings import get_settings
        return bool(get_settings().get("auto_create_attendance", True))
    except Exception:
        return True


def _link_checkins(names, attendance_name):
    """Point Employee Checkin.attendance at the created Attendance so the
    'will not be considered for attendance' shift banner clears."""
    for n in (names or []):
        if not n:
            continue
        try:
            frappe.db.set_value("Employee Checkin", n, "attendance", attendance_name, update_modified=False)
        except Exception:
            pass


def _sync_standard_attendance(employee, day, status, in_time=None, out_time=None, working_hours=0, link_checkins=None):
    """Create + submit a standard ERPNext Attendance record so the day
    shows in HR -> Attendance and feeds payroll. Shift-independent.
    Idempotent: when a non-cancelled Attendance already exists for
    (employee, date) we just (re)link the checkins and return."""
    if status not in ("Present", "Absent"):
        return
    if not _attendance_enabled():
        return
    if not frappe.db.exists("DocType", "Attendance"):
        return

    existing = frappe.db.get_value(
        "Attendance", {"employee": employee, "attendance_date": str(day), "docstatus": ["<", 2]}, "name"
    )
    if existing:
        _link_checkins(link_checkins, existing)
        return existing

    company = frappe.db.get_value("Employee", employee, "company")
    try:
        att = frappe.get_doc({
            "doctype": "Attendance",
            "employee": employee,
            "attendance_date": str(day),
            "status": status,
            "company": company,
            "working_hours": working_hours or 0,
            "in_time": in_time or None,
            "out_time": out_time or None,
        })
        att.flags.ignore_permissions = True
        att.insert()
        att.submit()
        _link_checkins(link_checkins, att.name)
        frappe.db.commit()
        return att.name
    except Exception:
        frappe.log_error(frappe.get_traceback(), "AKG ESS · sync standard attendance")


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
            _sync_standard_attendance(emp, yesterday, "Absent")
            created += 1
        except Exception:
            frappe.log_error(frappe.get_traceback(), "AKG ESS · mark_absentees")
    if created:
        frappe.db.commit()
    return {"created": created, "date": str(yesterday)}


@frappe.whitelist()
def backfill_attendance():
    """One-off: post a standard ERPNext Attendance for every existing ESS
    Daily Attendance row (Present / Absent) that doesn't have one yet.
    Run from the desk after enabling the feature to catch days recorded
    before it was switched on:
        bench --site <site> execute akg_ess.attendance.backfill_attendance
    or POST /api/method/akg_ess.attendance.backfill_attendance
    """
    if "System Manager" not in frappe.get_roles(frappe.session.user):
        frappe.throw("System Manager role required.")
    rows = frappe.get_all(
        "ESS Daily Attendance",
        filters=[["status", "in", ["Present", "Absent"]]],
        fields=["employee", "date", "status", "check_in_time", "check_out_time",
                "total_hours", "in_checkin", "out_checkin"],
        order_by="date asc",
        limit_page_length=0,
    )
    posted = 0
    for r in rows:
        already = frappe.db.exists(
            "Attendance", {"employee": r.employee, "attendance_date": str(r.date), "docstatus": ["<", 2]}
        )
        _sync_standard_attendance(
            r.employee, r.date, r.status,
            r.check_in_time, r.check_out_time, r.total_hours or 0,
            link_checkins=[r.in_checkin, r.out_checkin],
        )
        if not already and frappe.db.exists(
            "Attendance", {"employee": r.employee, "attendance_date": str(r.date), "docstatus": ["<", 2]}
        ):
            posted += 1
    frappe.db.commit()
    return {"posted": posted, "scanned": len(rows)}


@frappe.whitelist()
def reset_day(employee, date):
    """TESTING HELPER — wipe all of an employee's attendance records for a
    day so the check-in/out flow can be re-tested:

      - cancels + deletes the standard HR Attendance
      - deletes the ESS Daily Attendance row
      - deletes any Missed Checkout / Geofence Violation for the day
      - deletes the Employee Checkin IN/OUT rows

    System Manager only. Call from the desk Awesomebar (API) or bench:
        bench --site <site> execute akg_ess.attendance.reset_day \
              --kwargs "{'employee':'HR-EMP-00015','date':'2026-06-17'}"
    """
    if "System Manager" not in frappe.get_roles(frappe.session.user):
        frappe.throw("System Manager role required.")

    day = frappe.utils.getdate(date)
    deleted = {"attendance": 0, "ess_daily": 0, "missed_checkout": 0, "violation": 0, "checkin": 0}

    # 1. Standard HR Attendance (submitted → cancel first).
    for name in frappe.get_all("Attendance", filters={"employee": employee, "attendance_date": day}, pluck="name"):
        doc = frappe.get_doc("Attendance", name)
        if doc.docstatus == 1:
            doc.flags.ignore_permissions = True
            doc.cancel()
        frappe.delete_doc("Attendance", name, force=1, ignore_permissions=True)
        deleted["attendance"] += 1

    # 2. ESS Daily Attendance.
    for name in frappe.get_all("ESS Daily Attendance", filters={"employee": employee, "date": day}, pluck="name"):
        frappe.delete_doc("ESS Daily Attendance", name, force=1, ignore_permissions=True)
        deleted["ess_daily"] += 1

    # 3. Missed Checkout.
    if frappe.db.exists("DocType", "Missed Checkout"):
        for name in frappe.get_all("Missed Checkout", filters={"employee": employee, "date": day}, pluck="name"):
            frappe.delete_doc("Missed Checkout", name, force=1, ignore_permissions=True)
            deleted["missed_checkout"] += 1

    # 4. Geofence Violation.
    if frappe.db.exists("DocType", "Geofence Violation"):
        for name in frappe.get_all("Geofence Violation", filters={"employee": employee, "date": day}, pluck="name"):
            frappe.delete_doc("Geofence Violation", name, force=1, ignore_permissions=True)
            deleted["violation"] += 1

    # 5. Employee Checkin (IN + OUT) for the day.
    for name in frappe.get_all(
        "Employee Checkin",
        filters=[["employee", "=", employee], ["time", ">=", f"{day} 00:00:00"], ["time", "<=", f"{day} 23:59:59"]],
        pluck="name",
    ):
        frappe.delete_doc("Employee Checkin", name, force=1, ignore_permissions=True)
        deleted["checkin"] += 1

    frappe.db.commit()
    return {"employee": employee, "date": str(day), "deleted": deleted}
