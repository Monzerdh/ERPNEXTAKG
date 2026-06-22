"""Tests for the single-IN/single-OUT-per-day guard (checkin_guards).

Rules enforced on user-facing Employee Checkin inserts:
  - at most one IN and one OUT per employee per calendar day
  - no OUT before an IN on that day
  - the punch time is ALWAYS the server's time (device clock is ignored)
  - system inserts (ignore_permissions) bypass the guard and keep their time

The guard stamps the server's *now* (today) onto every user punch, so these
tests must collide on today — we use a throwaway synthetic employee so "today"
is guaranteed free of real data.
"""
import frappe
from frappe.tests.utils import FrappeTestCase

from akg_ess.checkin_guards import enforce_single_daily
from .utils import make_checkin, make_synthetic_employee, delete_synthetic_employee


class TestSinglePunchGuard(FrappeTestCase):
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
        from .utils import reset_day
        reset_day(self.emp, self.today)
        frappe.db.commit()

    def _user_punch(self, log_type, when):
        """A non-system Employee Checkin doc (not inserted) carrying a device
        time, as the PWA would submit it."""
        return frappe.get_doc({
            "doctype": "Employee Checkin",
            "employee": self.emp,
            "log_type": log_type,
            "time": str(when),
            "device_id": "ESS-MOBILE",
        })

    def test_server_authoritative_time_overrides_device(self):
        # A user punch's time is replaced with the server's now, regardless of
        # the (possibly tampered) device clock it arrived with.
        doc = self._user_punch("IN", "2099-01-01 03:00:00")  # bogus device time
        enforce_single_daily(doc)
        self.assertNotEqual(str(doc.time), "2099-01-01 03:00:00")
        self.assertEqual(frappe.utils.getdate(doc.time),
                         frappe.utils.getdate(frappe.utils.now_datetime()))

    def test_second_in_rejected(self):
        make_checkin(self.emp, "IN", f"{self.today} 08:00:00")
        with self.assertRaises(frappe.exceptions.ValidationError):
            enforce_single_daily(self._user_punch("IN", f"{self.today} 09:00:00"))

    def test_second_out_rejected(self):
        make_checkin(self.emp, "IN", f"{self.today} 08:00:00")
        make_checkin(self.emp, "OUT", f"{self.today} 17:00:00")
        with self.assertRaises(frappe.exceptions.ValidationError):
            enforce_single_daily(self._user_punch("OUT", f"{self.today} 18:00:00"))

    def test_out_before_in_rejected(self):
        # No IN exists for today -> an OUT must be refused.
        with self.assertRaises(frappe.exceptions.ValidationError):
            enforce_single_daily(self._user_punch("OUT", f"{self.today} 17:00:00"))

    def test_first_in_allowed(self):
        # A clean first IN passes the guard (no exception).
        doc = self._user_punch("IN", f"{self.today} 08:00:00")
        enforce_single_daily(doc)  # must not raise

    def test_system_insert_bypasses_guard(self):
        # Two system inserts (ignore_permissions) on the same day must NOT be
        # blocked — the geofence/correction flows rely on this.
        c1 = make_checkin(self.emp, "IN", f"{self.today} 08:00:00")
        c2 = make_checkin(self.emp, "OUT", f"{self.today} 17:00:00")
        self.assertTrue(frappe.db.exists("Employee Checkin", c1.name))
        self.assertTrue(frappe.db.exists("Employee Checkin", c2.name))
