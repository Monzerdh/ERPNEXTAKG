"""Add composite / missing indexes for the hot ESS query paths.

Why each one (see the query shapes in attendance.py, checkin_guards.py, api.py
and the report SQL):

  Employee Checkin (employee, log_type, time)
      recompute_day._one, the single-punch guard and _today_status all filter
      employee + log_type + a same-day time range and ORDER BY time. Without
      this the plan range-scans the `employee` index and does a filesort.

  Geofence Violation (employee, date, status)
      _day_has_pending_hold, _pending_violation, _zone_for and the manager
      queue filter employee + date + status — currently a FULL TABLE SCAN
      (this table had no employee/date/status index at all).

  ESS Daily Attendance (employee, date)
      The recompute upsert and the reports key on employee + date. Replaces a
      two-index rowid-filter merge with one clean lookup. (Logically unique,
      but kept non-unique to never block a write.)

  ESS Notification (is_read, creation)
      The unread feed filters is_read=0 and ORDER BY creation DESC.

  Employee (user_id) / (reports_to, status) / (leave_approver, status)
      _my_employee runs on nearly every request (user_id), and team scoping
      (_team_employee_names, permission_query_conditions, reports) filters
      reports_to/leave_approver + status=Active. All three were full scans.

Idempotent: skips indexes that already exist. A plain `ADD INDEX` on InnoDB
already runs as online DDL (ALGORITHM=INPLACE, LOCK=NONE) by default, so this
is safe to run during a production migrate without a long table lock.
"""
import frappe

# (doctype, [columns], index_name)
INDEXES = [
    ("Employee Checkin",     ["employee", "log_type", "time"], "akg_ec_emp_logtype_time"),
    ("Geofence Violation",   ["employee", "date", "status"],   "akg_gv_emp_date_status"),
    ("ESS Daily Attendance", ["employee", "date"],             "akg_esd_emp_date"),
    ("ESS Notification",     ["is_read", "creation"],          "akg_esn_isread_creation"),
    ("Employee",             ["user_id"],                      "akg_emp_user_id"),
    ("Employee",             ["reports_to", "status"],         "akg_emp_reportsto_status"),
    ("Employee",             ["leave_approver", "status"],     "akg_emp_leaveapprover_status"),
]


def _existing_index_names(table):
    try:
        return {r["Key_name"] for r in frappe.db.sql(f"SHOW INDEX FROM `{table}`", as_dict=True)}
    except Exception:
        return set()


def execute():
    for doctype, fields, index_name in INDEXES:
        if not frappe.db.table_exists(doctype):
            continue
        table = f"tab{doctype}"
        # Skip if the field/column is missing (defensive across versions).
        if index_name in _existing_index_names(table):
            continue
        cols = ", ".join(f"`{c}`" for c in fields)
        try:
            frappe.db.sql_ddl(f"ALTER TABLE `{table}` ADD INDEX `{index_name}` ({cols})")
        except Exception:
            frappe.db.rollback()
            frappe.log_error(frappe.get_traceback(), f"akg_ess: add index {index_name} failed")
