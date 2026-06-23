"""Tests for the data-retention module.

Guarantees:
  - off by default -> no-op
  - dry run counts but deletes nothing
  - only READ notifications past the window are purged; unread are kept
  - a 0 window means keep forever
  - attendance / payroll data is NEVER purged
"""
import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_to_date, now_datetime

from akg_ess import retention
from .utils import make_synthetic_employee, delete_synthetic_employee, make_checkin, reset_day

SETTING_KEYS = ["enable_retention", "notification_retention_days", "push_subscription_stale_days"]


def _set(key, val):
    frappe.db.set_single_value("AKG ESS Settings", key, val)
    frappe.db.commit()
    frappe.clear_document_cache("AKG ESS Settings", "AKG ESS Settings")


class TestRetention(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        cls._snapshot = {k: frappe.db.get_single_value("AKG ESS Settings", k) for k in SETTING_KEYS}

    @classmethod
    def tearDownClass(cls):
        for k, v in cls._snapshot.items():
            frappe.db.set_single_value("AKG ESS Settings", k, v)
        frappe.db.commit()
        frappe.clear_document_cache("AKG ESS Settings", "AKG ESS Settings")
        super().tearDownClass()

    def setUp(self):
        frappe.set_user("Administrator")
        self._notifs = []

    def tearDown(self):
        for n in self._notifs:
            if frappe.db.exists("ESS Notification", n):
                frappe.delete_doc("ESS Notification", n, force=1, ignore_permissions=True)
        frappe.db.commit()

    def _notif(self, title, is_read, age_days):
        doc = frappe.get_doc({
            "doctype": "ESS Notification", "title": title, "body": "test",
            "for_role": "all", "is_read": is_read,
        })
        doc.flags.ignore_permissions = True
        doc.insert(ignore_permissions=True)
        frappe.db.set_value("ESS Notification", doc.name, "creation",
                            add_to_date(now_datetime(), days=-age_days), update_modified=False)
        frappe.db.commit()
        self._notifs.append(doc.name)
        return doc.name

    def test_disabled_is_noop(self):
        _set("enable_retention", 0)
        n = self._notif("ZZ-RET old read", is_read=1, age_days=999)
        res = retention.run_retention(dry_run=False)
        self.assertFalse(res["enabled"])
        self.assertTrue(frappe.db.exists("ESS Notification", n))

    def test_dry_run_counts_but_keeps(self):
        _set("enable_retention", 1)
        _set("notification_retention_days", 30)
        n = self._notif("ZZ-RET old read", is_read=1, age_days=400)
        res = retention.run_retention(dry_run=True)
        self.assertTrue(res["enabled"])
        self.assertGreaterEqual(res["purged"]["notifications"], 1)
        self.assertTrue(frappe.db.exists("ESS Notification", n))  # not deleted

    def test_purges_old_read_notification(self):
        _set("enable_retention", 1)
        _set("notification_retention_days", 30)
        n = self._notif("ZZ-RET old read", is_read=1, age_days=400)
        retention.run_retention(dry_run=False)
        self.assertFalse(frappe.db.exists("ESS Notification", n))
        self._notifs.remove(n)  # already purged

    def test_unread_notification_preserved(self):
        _set("enable_retention", 1)
        _set("notification_retention_days", 30)
        n = self._notif("ZZ-RET old UNREAD", is_read=0, age_days=400)
        retention.run_retention(dry_run=False)
        self.assertTrue(frappe.db.exists("ESS Notification", n))  # unread always kept

    def test_zero_window_keeps_forever(self):
        _set("enable_retention", 1)
        _set("notification_retention_days", 0)
        n = self._notif("ZZ-RET ancient read", is_read=1, age_days=9999)
        retention.run_retention(dry_run=False)
        self.assertTrue(frappe.db.exists("ESS Notification", n))

    def test_attendance_is_never_purged(self):
        emp = make_synthetic_employee()
        today = frappe.utils.nowdate()
        try:
            _set("enable_retention", 1)
            _set("notification_retention_days", 1)
            c = make_checkin(emp, "IN", f"{today} 08:00:00")
            retention.run_retention(dry_run=False)
            self.assertTrue(frappe.db.exists("Employee Checkin", c.name),
                            "retention must NEVER delete attendance check-ins")
        finally:
            reset_day(emp, today)
            delete_synthetic_employee(emp, days=[today])

    def test_protected_list_covers_payroll_tables(self):
        for dt in ("Employee Checkin", "ESS Daily Attendance", "Attendance",
                   "Geofence Violation", "Missed Checkout", "ESS Attendance Correction"):
            self.assertIn(dt, retention.PROTECTED_DOCTYPES)
