"""Tests for apply_correction — the low-level routine an approved ESS
Attendance Correction runs to fix a day's punches, then recompute.

  - a correction can CREATE missing punches (forgotten check-in/out); those
    carry device_id ESS-CORRECTION, so the day is flagged via_correction
  - a correction can UPDATE an existing punch's time/project (hours recompute)
  - a project-only correction on a day with NO punch creates nothing (there is
    no time to anchor a punch on) — the higher-level submit_correction rejects
    this case outright
"""
import frappe

from akg_ess.attendance import apply_correction
from .utils import ESSDataTestCase, PLAIN_EMP, make_checkin, day


def _row(emp, d):
    return frappe.db.get_value(
        "ESS Daily Attendance", {"employee": emp, "date": str(d)},
        ["name", "status", "total_hours", "check_out_time", "via_correction"],
        as_dict=True,
    )


def _checkins(emp, d):
    return frappe.get_all(
        "Employee Checkin",
        filters=[["employee", "=", emp], ["time", ">=", f"{d} 00:00:00"],
                 ["time", "<=", f"{d} 23:59:59"]],
        fields=["log_type", "time", "device_id"], order_by="time asc",
    )


class TestCorrections(ESSDataTestCase):
    def test_correction_creates_missing_day(self):
        d = self.touch(PLAIN_EMP, day(10))
        apply_correction(PLAIN_EMP, day(10), in_time="08:00", in_project=None,
                         out_time="17:00", out_project=None, scope=None)
        r = _row(PLAIN_EMP, day(10))
        self.assertIsNotNone(r)
        self.assertEqual(r.status, "Present")
        self.assertEqual(r.total_hours, 9.0)
        # The day is flagged because its punches were born from a correction.
        self.assertEqual(r.via_correction, 1)
        cks = _checkins(PLAIN_EMP, day(10))
        self.assertEqual(len(cks), 2)
        self.assertTrue(all(c.device_id == "ESS-CORRECTION" for c in cks))

    def test_correction_updates_existing_time(self):
        d = self.touch(PLAIN_EMP, day(11))
        make_checkin(PLAIN_EMP, "IN", f"{day(11)} 08:00:00")
        make_checkin(PLAIN_EMP, "OUT", f"{day(11)} 16:00:00")  # 8h
        self.assertEqual(_row(PLAIN_EMP, day(11)).total_hours, 8.0)
        # Manager corrects the checkout to 18:00 -> 10h.
        apply_correction(PLAIN_EMP, day(11), in_time=None, in_project=None,
                         out_time="18:00", out_project=None, scope=None)
        r = _row(PLAIN_EMP, day(11))
        self.assertEqual(r.total_hours, 10.0)
        self.assertEqual(str(r.check_out_time), f"{day(11)} 18:00:00")

    def test_project_only_correction_on_empty_day_creates_nothing(self):
        d = self.touch(PLAIN_EMP, day(12))
        # No existing punch + no time given -> nothing can be created.
        apply_correction(PLAIN_EMP, day(12), in_time=None, in_project=None,
                         out_time=None, out_project="PROJ-DOES-NOT-MATTER", scope="x")
        self.assertIsNone(_row(PLAIN_EMP, day(12)))
        self.assertEqual(len(_checkins(PLAIN_EMP, day(12))), 0)
