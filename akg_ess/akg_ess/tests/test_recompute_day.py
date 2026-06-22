"""Tests for recompute_day — the single source of truth that turns a day's
Employee Checkins (+ holds) into one ESS Daily Attendance row and, when
complete and unheld, a posted HR Attendance.

Covered here (no holds; hold/zone cases live in test_offzone.py because a
Geofence Violation is always stamped to *today*):
  - IN + OUT, no hold        -> Present, hours, in/out links, Inside zones
  - IN only                  -> Checked In, no HR Attendance
  - no punch, stale pending  -> the pending placeholder is removed
  - HR Attendance is posted (Present) when auto-create is enabled
"""
import frappe

from akg_ess.attendance import recompute_day, _attendance_enabled
from .utils import ESSDataTestCase, PLAIN_EMP, make_checkin, reset_day, day


def _row(emp, d):
    return frappe.db.get_value(
        "ESS Daily Attendance", {"employee": emp, "date": str(d)},
        ["name", "status", "total_hours", "check_in_time", "check_out_time",
         "check_in_zone", "check_out_zone", "in_checkin", "out_checkin",
         "via_correction"],
        as_dict=True,
    )


class TestRecomputeDay(ESSDataTestCase):
    def test_in_and_out_is_present(self):
        d = self.touch(PLAIN_EMP, day(3))
        make_checkin(PLAIN_EMP, "IN", f"{day(3)} 08:00:00")
        make_checkin(PLAIN_EMP, "OUT", f"{day(3)} 16:00:00")  # 8h
        r = _row(PLAIN_EMP, day(3))
        self.assertIsNotNone(r)
        self.assertEqual(r.status, "Present")
        self.assertEqual(r.total_hours, 8.0)
        self.assertTrue(r.in_checkin)
        self.assertTrue(r.out_checkin)
        # No geofence violation -> both punches count as inside the zone.
        self.assertEqual(r.check_in_zone, "Inside")
        self.assertEqual(r.check_out_zone, "Inside")

    def test_in_only_is_checked_in(self):
        d = self.touch(PLAIN_EMP, day(4))
        make_checkin(PLAIN_EMP, "IN", f"{day(4)} 08:00:00")
        r = _row(PLAIN_EMP, day(4))
        self.assertIsNotNone(r)
        self.assertEqual(r.status, "Checked In")
        self.assertIsNone(r.check_out_time)
        # In-progress days never post HR Attendance.
        self.assertFalse(frappe.db.exists(
            "Attendance", {"employee": PLAIN_EMP, "attendance_date": str(day(4)), "docstatus": ["<", 2]}))

    def test_present_posts_hr_attendance(self):
        if not _attendance_enabled():
            self.skipTest("auto_create_attendance is disabled on this site.")
        d = self.touch(PLAIN_EMP, day(5))
        make_checkin(PLAIN_EMP, "IN", f"{day(5)} 08:00:00")
        make_checkin(PLAIN_EMP, "OUT", f"{day(5)} 17:00:00")
        att = frappe.db.get_value(
            "Attendance",
            {"employee": PLAIN_EMP, "attendance_date": str(day(5)), "docstatus": ["<", 2]},
            ["name", "status"], as_dict=True,
        )
        self.assertIsNotNone(att, "HR Attendance should be posted for a Present day")
        self.assertEqual(att.status, "Present")

    def test_no_punch_no_hold_clears_stale_pending(self):
        d = self.touch(PLAIN_EMP, day(6))
        # Seed a stale Pending Approval placeholder (e.g. a since-rejected punch).
        doc = frappe.get_doc({
            "doctype": "ESS Daily Attendance",
            "employee": PLAIN_EMP, "date": str(day(6)), "status": "Pending Approval",
        })
        doc.flags.ignore_permissions = True
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        self.assertTrue(_row(PLAIN_EMP, day(6)))
        # Nothing punched, nothing held -> recompute drops the placeholder.
        recompute_day(PLAIN_EMP, day(6))
        self.assertIsNone(_row(PLAIN_EMP, day(6)))

    def test_recompute_is_idempotent(self):
        d = self.touch(PLAIN_EMP, day(7))
        make_checkin(PLAIN_EMP, "IN", f"{day(7)} 08:00:00")
        make_checkin(PLAIN_EMP, "OUT", f"{day(7)} 16:00:00")
        recompute_day(PLAIN_EMP, day(7))
        recompute_day(PLAIN_EMP, day(7))
        # Exactly one row, still Present, still 8h.
        rows = frappe.get_all("ESS Daily Attendance",
                              filters={"employee": PLAIN_EMP, "date": str(day(7))})
        self.assertEqual(len(rows), 1)
        self.assertEqual(_row(PLAIN_EMP, day(7)).total_hours, 8.0)
