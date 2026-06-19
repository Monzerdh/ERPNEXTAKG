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
    """Employee Checkin after_insert hook — recompute the whole day.

    Only in-zone or manager-approved punches ever become an Employee
    Checkin; out-of-zone punches stay as a (pending) Geofence Violation
    until approved. So any checkin that exists here is authoritative.
    """
    try:
        recompute_day(doc.employee, frappe.utils.getdate(doc.time))
    except Exception:
        # Never block a check-in/out on attendance bookkeeping — log + move on.
        frappe.log_error(frappe.get_traceback(), "AKG ESS · on_checkin_after_insert")


def recompute_day(employee, day):
    """Single source of truth for a day's ESS Daily Attendance + HR posting.

    Derives the day from the employee's *actual* Employee Checkins (in-zone
    or manager-approved) plus any pending holds (geofence / missed-checkout):

      - IN + OUT, no hold   -> Present  + standard HR Attendance posted
      - IN + OUT, held      -> Pending Approval (HR withheld)
      - IN only,  no hold   -> Checked In (in progress, no HR)
      - IN only,  held      -> Pending Approval
      - OUT only (IN still pending approval) -> Pending Approval (HR withheld)
      - no real punch, hold -> Pending Approval placeholder (from violation)
      - no real punch, clear-> remove any stale pending placeholder

    HR "Present" is posted only when both an IN and an OUT exist and the day
    is not on hold — i.e. on (effective) check-out. Absent is posted by the
    daily scheduler (mark_absentees) for days with no entry.
    """
    from frappe.utils import getdate, get_datetime
    if not employee or not day:
        return
    day = getdate(day)
    day_start = f"{day} 00:00:00"
    day_end = f"{day} 23:59:59"

    def _one(lt, order):
        rows = frappe.get_all(
            "Employee Checkin",
            filters=[
                ["employee", "=", employee],
                ["log_type", "=", lt],
                ["time", ">=", day_start],
                ["time", "<=", day_end],
            ],
            fields=["name", "time", "project", "scope_of_work"],
            order_by=f"time {order}",
            limit=1,
        )
        return rows[0] if rows else None

    in_row = _one("IN", "asc")
    out_row = _one("OUT", "desc")
    pending = _day_has_pending_hold(employee, day)

    # No real punch yet.
    if not in_row and not out_row:
        if pending:
            _upsert_pending_from_violation(employee, day)
        else:
            # Nothing punched, nothing pending — drop a stale placeholder row
            # (e.g. a rejected off-zone punch). Never touch Present/Absent.
            nm = frappe.db.get_value(
                "ESS Daily Attendance",
                {"employee": employee, "date": day, "status": "Pending Approval"}, "name",
            )
            if nm:
                frappe.delete_doc("ESS Daily Attendance", nm, force=1, ignore_permissions=True)
                frappe.db.commit()
        return

    has_ot = bool(frappe.db.get_value("Employee", employee, "has_overtime"))

    # Completed day — both punches present.
    if in_row and out_row:
        in_dt = get_datetime(in_row["time"])
        out_dt = get_datetime(out_row["time"])
        hb = _hours_breakdown(in_dt, out_dt, has_ot, in_row.get("project"), out_row.get("project"))
        status = "Pending Approval" if pending else "Present"
        values = {
            "employee": employee, "date": day, "status": status,
            "scope": out_row.get("scope_of_work") or in_row.get("scope_of_work"),
            "check_in_time": in_row["time"], "check_out_time": out_row["time"],
            "check_in_project": in_row.get("project"), "check_out_project": out_row.get("project"),
            "check_in_zone": _zone_for(employee, day, "IN"),
            "check_out_zone": _zone_for(employee, day, "OUT"),
            "has_overtime": int(has_ot),
            "in_checkin": in_row["name"], "out_checkin": out_row["name"],
            **hb,
        }
        _upsert_attendance(employee, day, values)
        if status == "Present":
            _sync_standard_attendance(
                employee, day, "Present", in_row["time"], out_row["time"], hb["total_hours"],
                link_checkins=[in_row["name"], out_row["name"]],
            )
        return

    # IN only — in progress. Never Present, never HR.
    if in_row and not out_row:
        status = "Pending Approval" if pending else "Checked In"
        values = {
            "employee": employee, "date": day, "status": status,
            "scope": in_row.get("scope_of_work"),
            "check_in_time": in_row["time"], "check_in_project": in_row.get("project"),
            "check_in_zone": _zone_for(employee, day, "IN"),
            "in_checkin": in_row["name"],
        }
        # A pending off-zone OUT (no check-in row yet) — surface it so the day
        # shows the attempted check-out + its zone while it awaits approval.
        vout = _pending_violation(employee, day, "OUT")
        if vout:
            values["check_out_time"] = vout.time
            values["check_out_project"] = vout.selected_project
            values["check_out_zone"] = "Outside"
            if vout.scope_of_work:
                values["scope"] = vout.scope_of_work
        _upsert_attendance(employee, day, values)
        return

    # OUT only — the IN is still a pending off-zone violation. Hold the day
    # (no HR) until the IN is approved, then this recomputes to Present.
    values = {
        "employee": employee, "date": day, "status": "Pending Approval",
        "scope": out_row.get("scope_of_work"),
        "check_out_time": out_row["time"], "check_out_project": out_row.get("project"),
        "check_out_zone": _zone_for(employee, day, "OUT"),
        "out_checkin": out_row["name"],
    }
    vin = _pending_violation(employee, day, "IN")
    if vin:
        values["check_in_time"] = vin.time
        values["check_in_project"] = vin.selected_project
        values["check_in_zone"] = "Outside"
    _upsert_attendance(employee, day, values)


def _upsert_pending_from_violation(employee, day):
    """Surface an out-of-zone punch that has no Employee Checkin yet as a
    Pending Approval row, so the day shows in the app/report while it waits
    for the manager. Nothing posts to HR until the punch is approved."""
    vs = frappe.get_all(
        "Geofence Violation",
        filters=[["employee", "=", employee], ["date", "=", day], ["status", "=", "Pending"]],
        fields=["log_type", "time", "selected_project", "scope_of_work"],
        order_by="time asc",
    )
    if not vs:
        return
    vin = next((v for v in vs if (v.log_type or "").upper() == "IN"), None)
    vout = next((v for v in vs if (v.log_type or "").upper() == "OUT"), None)
    values = {"employee": employee, "date": day, "status": "Pending Approval"}
    if vin:
        values["check_in_time"] = vin.time
        values["check_in_project"] = vin.selected_project
        values["check_in_zone"] = "Outside"  # a pending violation is by definition off-zone
    if vout:
        values["check_out_time"] = vout.time
        values["check_out_project"] = vout.selected_project
        values["check_out_zone"] = "Outside"
        values["scope"] = vout.scope_of_work
    _upsert_attendance(employee, day, values)


def _zone_for(employee, day, log_type):
    """'Outside' if this punch came through a Geofence Violation (off-zone,
    needed approval); 'Inside' otherwise (a direct in-zone check-in)."""
    if frappe.db.exists("DocType", "Geofence Violation") and frappe.db.exists(
        "Geofence Violation",
        {"employee": employee, "date": day, "log_type": (log_type or "").upper(),
         "status": ["in", ["Pending", "Approved"]]},
    ):
        return "Outside"
    return "Inside"


def _pending_violation(employee, day, log_type):
    """The pending off-zone violation for a punch (no check-in row yet), or
    None — used to surface the attempted punch + zone while it awaits review."""
    if not frappe.db.exists("DocType", "Geofence Violation"):
        return None
    rows = frappe.get_all(
        "Geofence Violation",
        filters={"employee": employee, "date": day, "log_type": (log_type or "").upper(), "status": "Pending"},
        fields=["time", "selected_project", "scope_of_work"],
        order_by="time asc", limit=1,
    )
    return rows[0] if rows else None


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
    """Back-compat shim — re-evaluate a day after a geofence / missed-checkout
    decision. Delegates to recompute_day (the single source of truth)."""
    recompute_day(employee, day)


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


def mark_absentees(for_date=None):
    """Scheduler — runs daily ~01:00 site time. For the target day (default
    yesterday), create an Absent ESS Daily Attendance row AND post a standard
    HR Attendance 'Absent' for each ESS-enabled active employee who had no
    entry and no approved leave. Sundays (weekend) skipped.

    A day is treated as "has an entry" if any of these exist for it: an
    ESS Daily Attendance row, an Employee Checkin, or a pending hold
    (geofence / missed checkout). Only then is Absent skipped.

    Pass for_date ('YYYY-MM-DD') to backfill a specific day, e.g.:
        bench --site <site> execute akg_ess.attendance.mark_absentees \
              --kwargs "{'for_date':'2026-06-17'}"
    """
    from frappe.utils import add_days, getdate

    target = for_date or add_days(frappe.utils.nowdate(), -1)
    day = getdate(target)
    target = str(day)
    day_start = f"{target} 00:00:00"
    day_end = f"{target} 23:59:59"

    # AKG default weekend = Sunday only (weekday() == 6).
    if day.weekday() == 6:
        return {"created": 0, "skipped": "weekend", "date": target}

    employees = frappe.get_all(
        "Employee",
        filters=[["status", "=", "Active"], ["user_id", "is", "set"]],
        fields=["name"],
        limit_page_length=0,
    )

    created = 0
    for e in employees:
        emp = e["name"]
        # Has an ESS row already (Present / Checked In / Pending / Absent)?
        if frappe.db.exists("ESS Daily Attendance", {"employee": emp, "date": target}):
            continue
        # Has any real punch for the day?
        if frappe.db.exists("Employee Checkin", [
            ["employee", "=", emp], ["time", ">=", day_start], ["time", "<=", day_end],
        ]):
            continue
        # Day on hold (out-of-zone punch awaiting approval)?
        if _day_has_pending_hold(emp, day):
            continue
        # Skip if covered by an approved leave.
        on_leave = frappe.db.sql("""
            SELECT name FROM `tabLeave Application`
            WHERE employee = %s AND status = 'Approved'
              AND %s BETWEEN from_date AND to_date
            LIMIT 1
        """, (emp, target))
        if on_leave:
            continue
        try:
            doc = frappe.get_doc({
                "doctype": "ESS Daily Attendance",
                "employee": emp,
                "date": target,
                "status": "Absent",
                "total_hours": 0,
                "normal_hours": 0,
                "overtime_hours": 0,
                "hours_project_a": 0,
                "hours_project_b": 0,
            })
            doc.flags.ignore_permissions = True
            doc.insert()
            _sync_standard_attendance(emp, target, "Absent")
            created += 1
        except Exception:
            frappe.log_error(frappe.get_traceback(), "AKG ESS · mark_absentees")
    if created:
        frappe.db.commit()
    return {"created": created, "date": target}


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
