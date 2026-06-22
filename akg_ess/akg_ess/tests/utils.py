"""Shared helpers for the akg_ess test suite.

This is NOT a test module (no `test_*` name) — it holds fixtures and a base
TestCase that guarantees cleanup.

Isolation strategy
------------------
This suite runs against the live dev site (which holds restored data), and the
code under test commits (recompute_day -> _upsert_attendance -> db.commit). So
we do NOT rely on transaction rollback for isolation — every test explicitly
wipes the (employee, day) pairs it touches in tearDown via reset_day.

Two data sources:
  * Existing employees on FAR-FUTURE dates (year 2099) — used by tests that
    create Employee Checkins directly (their time is honoured, so the day is
    ours alone and reset_day removes it).
  * A throwaway synthetic Employee — used by off-zone (Geofence Violation)
    tests, because GeofenceViolation.before_insert stamps the punch to *today*;
    a dedicated employee keeps even "today" free of real data.
"""
import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import getdate

from akg_ess.attendance import reset_day as _reset_day

# A plain existing employee (ESS User only) that carries the standard HRMS
# Employee User Permission (employee = self) — used by permission-scoping tests.
PLAIN_EMP = "HR-EMP-00015"        # ali.m@akg.ae
PLAIN_USER = "ali.m@akg.ae"
OTHER_EMP = "HR-EMP-00021"        # a.moeen@akg.ae — unrelated plain employee
OTHER_USER = "a.moeen@akg.ae"

# A far-future month no real data lives in. Each test picks a distinct day.
YEAR = 2099


def day(n):
    """A unique far-future YYYY-MM-DD (n = 1..28)."""
    return f"{YEAR}-01-{n:02d}"


def reset_day(employee, d):
    """Defensive cleanup as Administrator — wipe a day's checkins / attendance
    / holds. Safe to call repeatedly (idempotent)."""
    frappe.set_user("Administrator")
    _reset_day(employee=employee, date=str(getdate(d)))


def make_checkin(employee, log_type, when, project=None, scope=None,
                 device_id="ESS-TEST", system=True):
    """Insert an Employee Checkin. `system=True` sets ignore_permissions so the
    single-daily guard is bypassed and the provided `time` is kept (mirrors the
    geofence/correction system inserts). The after_insert hook still runs, so
    the day is recomputed naturally."""
    doc = frappe.get_doc({
        "doctype": "Employee Checkin",
        "employee": employee,
        "log_type": log_type,
        "time": str(when),
        "project": project or None,
        "scope_of_work": scope or None,
        "device_id": device_id,
        "skip_auto_attendance": 1,
    })
    if system:
        doc.flags.ignore_permissions = True
        doc.insert(ignore_permissions=True)
    else:
        doc.insert()
    return doc


def make_synthetic_employee(has_overtime=0):
    """Create a throwaway Active Employee for fully-isolated tests. Returns its
    name. Delete with delete_synthetic_employee()."""
    company = (frappe.db.get_value("Employee", {"status": "Active"}, "company")
               or frappe.defaults.get_global_default("company"))
    emp = frappe.get_doc({
        "doctype": "Employee",
        "first_name": "ZZ-ESS-TEST",
        "gender": "Male",
        "date_of_birth": "1990-01-01",
        "date_of_joining": "2020-01-01",
        "company": company,
        "status": "Active",
        "has_overtime": int(has_overtime),
    })
    emp.flags.ignore_permissions = True
    emp.insert(ignore_permissions=True, ignore_mandatory=True)
    frappe.db.commit()
    return emp.name


def delete_synthetic_employee(name, days=()):
    """Best-effort teardown: wipe any attendance days, then hard-delete the
    employee. Never raises — leftover test rows on a dev site are harmless."""
    frappe.set_user("Administrator")
    for d in days:
        try:
            _reset_day(employee=name, date=str(getdate(d)))
        except Exception:
            pass
    # Also clear anything stamped to today (off-zone violations land on today).
    try:
        _reset_day(employee=name, date=str(getdate(frappe.utils.nowdate())))
    except Exception:
        pass
    try:
        frappe.delete_doc("Employee", name, force=1, ignore_permissions=True,
                          delete_permanently=True)
        frappe.db.commit()
    except Exception:
        frappe.db.rollback()


class ESSDataTestCase(frappe.tests.utils.FrappeTestCase if hasattr(frappe, "tests") else object):
    """Base for tests that create attendance data on existing employees at
    far-future dates. tearDown wipes every (employee, day) the test touched."""

    def setUp(self):
        frappe.set_user("Administrator")
        self._touched = set()

    def touch(self, employee, d):
        self._touched.add((employee, str(getdate(d))))
        return d

    def tearDown(self):
        frappe.set_user("Administrator")
        for emp, d in self._touched:
            try:
                reset_day(emp, d)
            except Exception:
                pass
        frappe.db.commit()
