"""Unit tests for the hours / overtime / project-split math.

`_hours_breakdown` is pure (no DB), so these are fast and isolated. It is the
heart of payroll-relevant numbers, so every branch is pinned down here:

  - overtime only counts past 10h AND only when the employee is OT-eligible;
    otherwise hours beyond 10 are *degraded* (dropped), never paid
  - when the check-in and check-out projects differ, counted hours split 50/50
"""
from datetime import datetime, timedelta

from frappe.tests.utils import FrappeTestCase

from akg_ess.attendance import _hours_breakdown, OVERTIME_THRESHOLD_HOURS

P1 = "PROJ-TEST-A"
P2 = "PROJ-TEST-B"


def _span(hours):
    """A start/end datetime pair `hours` apart (same arbitrary day)."""
    start = datetime(2099, 1, 5, 8, 0, 0)
    return start, start + timedelta(hours=hours)


class TestHoursBreakdown(FrappeTestCase):
    def test_threshold_constant(self):
        # Guard the business rule itself — overtime kicks in after 10h.
        self.assertEqual(OVERTIME_THRESHOLD_HOURS, 10.0)

    def test_normal_day_under_threshold(self):
        a, b = _span(8)
        hb = _hours_breakdown(a, b, True, P1, P1)
        self.assertEqual(hb["total_hours"], 8.0)
        self.assertEqual(hb["normal_hours"], 8.0)
        self.assertEqual(hb["overtime_hours"], 0.0)

    def test_under_threshold_ignores_ot_flag(self):
        # Below 10h, has_overtime makes no difference.
        a, b = _span(8)
        on = _hours_breakdown(a, b, True, P1, P1)
        off = _hours_breakdown(a, b, False, P1, P1)
        self.assertEqual(on["total_hours"], off["total_hours"])
        self.assertEqual(off["overtime_hours"], 0.0)

    def test_exactly_ten_hours_is_all_normal(self):
        a, b = _span(10)
        hb = _hours_breakdown(a, b, True, P1, P1)
        self.assertEqual(hb["normal_hours"], 10.0)
        self.assertEqual(hb["overtime_hours"], 0.0)
        self.assertEqual(hb["total_hours"], 10.0)

    def test_overtime_eligible_counts_extra(self):
        a, b = _span(12)
        hb = _hours_breakdown(a, b, True, P1, P1)
        self.assertEqual(hb["normal_hours"], 10.0)
        self.assertEqual(hb["overtime_hours"], 2.0)
        self.assertEqual(hb["total_hours"], 12.0)

    def test_overtime_ineligible_degrades_extra(self):
        # Not OT-eligible: hours past 10 are dropped, not paid.
        a, b = _span(12)
        hb = _hours_breakdown(a, b, False, P1, P1)
        self.assertEqual(hb["normal_hours"], 10.0)
        self.assertEqual(hb["overtime_hours"], 0.0)
        self.assertEqual(hb["total_hours"], 10.0)

    def test_single_project_no_split(self):
        a, b = _span(8)
        hb = _hours_breakdown(a, b, True, P1, P1)
        self.assertEqual(hb["project_a"], P1)
        self.assertEqual(hb["hours_project_a"], 8.0)
        self.assertIsNone(hb["project_b"])
        self.assertEqual(hb["hours_project_b"], 0.0)

    def test_two_projects_split_50_50(self):
        a, b = _span(8)
        hb = _hours_breakdown(a, b, True, P1, P2)
        self.assertEqual(hb["project_a"], P1)
        self.assertEqual(hb["project_b"], P2)
        self.assertEqual(hb["hours_project_a"], 4.0)
        self.assertEqual(hb["hours_project_b"], 4.0)
        # Split halves are of the *counted* hours and sum back to the total.
        self.assertEqual(hb["hours_project_a"] + hb["hours_project_b"], hb["total_hours"])

    def test_split_with_overtime(self):
        a, b = _span(12)  # counted = 12 when OT-eligible
        hb = _hours_breakdown(a, b, True, P1, P2)
        self.assertEqual(hb["hours_project_a"], 6.0)
        self.assertEqual(hb["hours_project_b"], 6.0)

    def test_missing_in_project_uses_out_project_no_split(self):
        a, b = _span(8)
        hb = _hours_breakdown(a, b, True, None, P2)
        self.assertEqual(hb["project_a"], P2)
        self.assertIsNone(hb["project_b"])
        self.assertEqual(hb["hours_project_a"], 8.0)

    def test_negative_span_clamps_to_zero(self):
        # OUT before IN must never produce negative hours.
        a, b = _span(8)
        hb = _hours_breakdown(b, a, True, P1, P1)  # reversed
        self.assertEqual(hb["total_hours"], 0.0)
        self.assertEqual(hb["normal_hours"], 0.0)
        self.assertEqual(hb["overtime_hours"], 0.0)
