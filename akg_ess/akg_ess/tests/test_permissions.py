"""Permission-scoping tests.

Two things are pinned here:

1. Employee Checkin row visibility — an employee sees punches where they are
   the `employee` (even ones created by a manager / the system, i.e. owned by
   someone else), and NEVER another employee's punches. This is enforced by the
   standard HRMS Employee User Permission, and these tests are the regression
   guard for issue #6.

2. ESS Daily Attendance's get_permission_query_conditions scopes the LIST by
   the `employee` field (own + team for managers), NOT by `owner`.
"""
import frappe
from frappe.tests.utils import FrappeTestCase

from akg_ess.akg_ess.doctype.ess_daily_attendance.ess_daily_attendance import (
    get_permission_query_conditions as ess_daily_pqc,
)
from .utils import (
    ESSDataTestCase, PLAIN_EMP, PLAIN_USER, OTHER_EMP, OTHER_USER, make_checkin, day,
)


def _sees(user, name):
    """Whether `user` can see checkin `name` through the FULL permission layer
    (list query match-conditions + single-doc has_permission)."""
    frappe.set_user(user)
    try:
        in_list = bool(frappe.get_list(
            "Employee Checkin", filters={"name": name}, fields=["name"],
            ignore_permissions=False))
        can_read = frappe.has_permission("Employee Checkin", "read", doc=name, user=user)
    finally:
        frappe.set_user("Administrator")
    return in_list and can_read


class TestCheckinVisibility(ESSDataTestCase):
    def test_employee_sees_own_punch_owned_by_someone_else(self):
        d = self.touch(PLAIN_EMP, day(13))
        # Owned by Administrator (current user), but FOR the plain employee.
        c = make_checkin(PLAIN_EMP, "IN", f"{day(13)} 08:00:00")
        self.assertEqual(c.owner, "Administrator")
        self.assertTrue(_sees(PLAIN_USER, c.name),
                        "Employee must see their own punch even when owned by someone else")

    def test_employee_cannot_see_another_employees_punch(self):
        self.touch(OTHER_EMP, day(13))
        c = make_checkin(OTHER_EMP, "IN", f"{day(13)} 08:05:00")
        self.assertFalse(_sees(PLAIN_USER, c.name),
                         "Employee must NOT see another employee's punch")

    def test_visible_employee_set_is_self_only(self):
        # Create punches for both A and B, then confirm A's entire visible set
        # contains only A.
        self.touch(PLAIN_EMP, day(14))
        self.touch(OTHER_EMP, day(14))
        make_checkin(PLAIN_EMP, "IN", f"{day(14)} 08:00:00")
        make_checkin(OTHER_EMP, "IN", f"{day(14)} 08:05:00")
        frappe.set_user(PLAIN_USER)
        try:
            rows = frappe.get_list("Employee Checkin", fields=["employee"],
                                   limit_page_length=0, ignore_permissions=False)
        finally:
            frappe.set_user("Administrator")
        seen = {r.employee for r in rows}
        self.assertTrue(seen.issubset({PLAIN_EMP}),
                        f"Plain employee should only see their own rows, saw: {seen}")


class TestEssDailyQueryScoping(frappe.tests.utils.FrappeTestCase):
    def setUp(self):
        frappe.set_user("Administrator")

    def test_administrator_unrestricted(self):
        self.assertEqual(ess_daily_pqc("Administrator"), "")

    def test_plain_employee_scoped_by_employee_not_owner(self):
        cond = ess_daily_pqc(PLAIN_USER)
        self.assertIn(PLAIN_EMP, cond)
        self.assertIn("`employee`", cond)
        # Must be an employee-scoped clause, not an owner-scoped one.
        self.assertNotRegex(cond, r"`owner`\s*=")

    def test_manager_includes_team(self):
        # ammar (ESS Manager) manages HR-EMP-00015; his clause must include
        # both himself and at least one report.
        mgr_user = "ammar.a@akg.ae"
        if not frappe.db.exists("Employee", {"user_id": mgr_user}):
            self.skipTest("manager fixture not present")
        cond = ess_daily_pqc(mgr_user)
        self.assertIn("HR-EMP-00001", cond)   # self
        self.assertIn("HR-EMP-00015", cond)   # a direct report
