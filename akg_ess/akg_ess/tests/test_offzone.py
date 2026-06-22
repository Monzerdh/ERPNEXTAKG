"""Off-zone (Geofence Violation) lifecycle tests.

The core promise of the off-zone model:
  - an off-zone punch posts NOTHING to HR; it only surfaces the day as
    Pending Approval, marked as an Outside-zone punch
  - approving the IN + OUT creates the real Employee Checkins and the day
    finalises to Present (+ HR Attendance)
  - rejecting drops the punch and clears the placeholder

A Geofence Violation is always stamped to *today* (server-authoritative time),
so these run against a throwaway synthetic employee to keep today isolated.
"""
import frappe
from frappe.tests.utils import FrappeTestCase

from akg_ess.attendance import _attendance_enabled
from .utils import make_synthetic_employee, delete_synthetic_employee, reset_day


def _ess_row(emp, d):
    return frappe.db.get_value(
        "ESS Daily Attendance", {"employee": emp, "date": str(d)},
        ["name", "status", "total_hours", "check_in_zone", "check_out_zone"],
        as_dict=True,
    )


class TestOffzoneLifecycle(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        cls.emp = make_synthetic_employee()

    @classmethod
    def tearDownClass(cls):
        delete_synthetic_employee(cls.emp)
        super().tearDownClass()

    def setUp(self):
        frappe.set_user("Administrator")
        self.today = frappe.utils.nowdate()

    def tearDown(self):
        frappe.set_user("Administrator")
        reset_day(self.emp, self.today)
        frappe.db.commit()

    def _violation(self, log_type, at_time=None):
        """Create a Pending Geofence Violation for the synthetic employee. The
        controller stamps it to today; optionally pin the time afterwards."""
        v = frappe.get_doc({
            "doctype": "Geofence Violation",
            "employee": self.emp,
            "log_type": log_type,
            "reason": "test off-zone punch",
            "status": "Pending",
            "latitude": 25.2, "longitude": 55.3, "accuracy_m": 30,
        })
        v.flags.ignore_permissions = True
        v.insert(ignore_permissions=True)
        if at_time:
            frappe.db.set_value("Geofence Violation", v.name,
                                {"time": f"{self.today} {at_time}", "date": self.today},
                                update_modified=False)
        frappe.db.commit()
        return v.name

    def _decide(self, name, status):
        gv = frappe.get_doc("Geofence Violation", name)
        gv.status = status
        gv.flags.ignore_permissions = True
        gv.save(ignore_permissions=True)
        frappe.db.commit()

    def test_pending_violation_holds_day_as_outside(self):
        self._violation("IN")
        r = _ess_row(self.emp, self.today)
        self.assertIsNotNone(r)
        self.assertEqual(r.status, "Pending Approval")
        self.assertEqual(r.check_in_zone, "Outside")
        # Nothing posts to HR while held.
        self.assertFalse(frappe.db.exists(
            "Attendance", {"employee": self.emp, "attendance_date": self.today, "docstatus": ["<", 2]}))

    def test_rejecting_clears_placeholder(self):
        name = self._violation("IN")
        self.assertIsNotNone(_ess_row(self.emp, self.today))
        self._decide(name, "Rejected")
        # No checkin was ever created, and the placeholder is gone.
        self.assertIsNone(_ess_row(self.emp, self.today))
        self.assertFalse(frappe.db.exists("Employee Checkin", {
            "employee": self.emp, "time": [">=", f"{self.today} 00:00:00"]}))

    def test_approving_in_and_out_finalises_present(self):
        in_v = self._violation("IN", at_time="08:00:00")
        out_v = self._violation("OUT", at_time="17:00:00")
        # Both pending -> held.
        self.assertEqual(_ess_row(self.emp, self.today).status, "Pending Approval")
        self._decide(in_v, "Approved")
        # IN approved, OUT still pending -> still held.
        self.assertEqual(_ess_row(self.emp, self.today).status, "Pending Approval")
        self._decide(out_v, "Approved")
        r = _ess_row(self.emp, self.today)
        self.assertEqual(r.status, "Present")
        self.assertEqual(r.total_hours, 9.0)
        self.assertEqual(r.check_in_zone, "Outside")
        self.assertEqual(r.check_out_zone, "Outside")
        if _attendance_enabled():
            self.assertTrue(frappe.db.exists(
                "Attendance",
                {"employee": self.emp, "attendance_date": self.today, "docstatus": 1}))
