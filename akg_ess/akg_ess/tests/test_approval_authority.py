"""Approval-authority tests for `_can_approve` — the security gate that decides
who may approve/reject another employee's off-zone punch, missed checkout, or
attendance correction.

The invariants (most security-critical first):
  1. NEVER self-approve — not even a manager approving their own request.
  2. A direct manager (reports_to) may approve their report.
  3. A leave_approver may approve the employees assigned to them.
  4. System / HR Manager may approve anyone (but still not themselves).
  5. An unrelated, non-privileged user may approve no one.

These read the live reporting structure; nothing is written, so no cleanup.
The (manager, report) pair is discovered at runtime so the test stays valid as
data changes — it skips loudly if the site has no usable structure.
"""
import frappe
from frappe.tests.utils import FrappeTestCase

from akg_ess.api import _can_approve, _my_employee, _team_employee_names

PRIV = {"System Manager", "HR Manager"}


class TestApprovalAuthority(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        edges = frappe.db.sql(
            """
            SELECT r.name AS rep, r.user_id AS rep_user,
                   m.name AS mgr, m.user_id AS mgr_user
            FROM `tabEmployee` r
            JOIN `tabEmployee` m ON r.reports_to = m.name
            WHERE r.status = 'Active' AND m.status = 'Active'
              AND IFNULL(r.user_id, '') != '' AND IFNULL(m.user_id, '') != ''
            """,
            as_dict=True,
        )
        # Pick an edge whose manager is NOT a System/HR Manager, so team
        # membership (not the privileged-role shortcut) is what's under test.
        cls.edge = None
        for e in edges:
            if not (PRIV & set(frappe.get_roles(e.mgr_user))):
                cls.edge = e
                break

    def setUp(self):
        if not self.edge:
            self.skipTest("No (manager, report) pair with a non-privileged manager on this site.")
        frappe.set_user("Administrator")

    # 1. The cornerstone rule.
    def test_manager_cannot_self_approve(self):
        self.assertFalse(_can_approve(self.edge.mgr_user, self.edge.mgr))

    def test_report_cannot_self_approve(self):
        self.assertFalse(_can_approve(self.edge.rep_user, self.edge.rep))

    # 2. Direct-report path.
    def test_manager_approves_direct_report(self):
        self.assertTrue(_can_approve(self.edge.mgr_user, self.edge.rep))
        self.assertIn(self.edge.rep, _team_employee_names(self.edge.mgr_user))

    def test_report_cannot_approve_manager(self):
        # A leaf employee does not manage their own manager.
        self.assertFalse(_can_approve(self.edge.rep_user, self.edge.mgr))

    # 4. Privileged role can approve anyone — but Administrator has no linked
    # Employee, so this also confirms the self-check doesn't misfire on None.
    def test_system_manager_approves_anyone(self):
        self.assertTrue(_can_approve("Administrator", self.edge.rep))
        self.assertTrue(_can_approve("Administrator", self.edge.mgr))

    # 5. An unrelated, non-privileged user approves no one.
    def test_unrelated_user_cannot_approve(self):
        team = _team_employee_names(self.edge.mgr_user) | {self.edge.mgr}
        unrelated = frappe.db.sql(
            """
            SELECT name FROM `tabEmployee`
            WHERE status = 'Active' AND IFNULL(user_id, '') != ''
            """,
        )
        target = next((n[0] for n in unrelated if n[0] not in team), None)
        if not target:
            self.skipTest("No unrelated employee available.")
        self.assertFalse(_can_approve(self.edge.rep_user, target))

    # Defensive: empty/None employee is never approvable.
    def test_empty_employee_is_false(self):
        self.assertFalse(_can_approve(self.edge.mgr_user, None))
        self.assertFalse(_can_approve(self.edge.mgr_user, ""))

    # 3. Leave-approver path — set a transient assignment, assert, restore.
    # (No commit: the change is rolled back; we also restore explicitly.)
    def test_leave_approver_can_approve(self):
        rep, rep_user, mgr_user = self.edge.rep, self.edge.rep_user, self.edge.mgr_user
        # Use the report's own user as a stand-in "approver" for a DIFFERENT
        # employee to isolate the leave_approver branch from reports_to.
        victim = frappe.db.sql(
            """
            SELECT name, leave_approver FROM `tabEmployee`
            WHERE status = 'Active' AND name != %s AND name != %s
            LIMIT 1
            """,
            (rep, self.edge.mgr), as_dict=True,
        )
        if not victim:
            self.skipTest("No spare employee for leave_approver test.")
        v = victim[0]
        original = v.leave_approver
        try:
            frappe.db.set_value("Employee", v.name, "leave_approver", rep_user,
                                update_modified=False)
            # rep_user is the configured leave_approver for v -> may approve v,
            # even though v does not report to rep.
            self.assertTrue(_can_approve(rep_user, v.name))
        finally:
            frappe.db.set_value("Employee", v.name, "leave_approver", original,
                                update_modified=False)
