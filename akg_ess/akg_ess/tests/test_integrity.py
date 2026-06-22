"""Referential-integrity / delete-safety regression tests.

The guarantee these protect: deleting a *master* record (an Employee, Project,
Scope of Work, ...) that other rows reference must be REFUSED by Frappe's link
check — nothing cascades, so you can never wipe related data by removing a
category/tag/filter record. And the ESS DocTypes stay FLAT (no child tables),
so there is no parent->child cascade either.

If someone later adds a child table to an ESS DocType, or weakens link
integrity, these tests fail loudly.
"""
import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.model.delete_doc import check_if_doc_is_linked

from .utils import make_synthetic_employee, delete_synthetic_employee, make_checkin, reset_day

FLAT_DOCTYPES = [
    "ESS Daily Attendance", "Geofence Violation", "Missed Checkout",
    "ESS Notification", "ESS Attendance Correction", "ESS Push Subscription",
    "Scope of Work", "AKG ESS Settings",
]


class TestReferentialIntegrity(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        cls.emp = make_synthetic_employee()
        cls.today = frappe.utils.nowdate()

    @classmethod
    def tearDownClass(cls):
        delete_synthetic_employee(cls.emp, days=[cls.today])
        super().tearDownClass()

    def test_referenced_employee_cannot_be_deleted(self):
        # A checkin references the employee -> deleting the employee must be
        # blocked (no cascade that would wipe the checkin).
        make_checkin(self.emp, "IN", f"{self.today} 08:00:00")
        emp_doc = frappe.get_doc("Employee", self.emp)
        with self.assertRaises(frappe.LinkExistsError):
            check_if_doc_is_linked(emp_doc)
        reset_day(self.emp, self.today)

    def test_custom_doctypes_are_flat_no_cascade(self):
        # Guard: none of the ESS DocTypes may carry a child table (which would
        # cascade-delete with its parent) or be submittable.
        for dt in FLAT_DOCTYPES:
            if not frappe.db.exists("DocType", dt):
                continue
            meta = frappe.get_meta(dt)
            child = [f.fieldname for f in meta.fields
                     if f.fieldtype in ("Table", "Table MultiSelect")]
            self.assertEqual(child, [], f"{dt} unexpectedly has child table(s): {child}")
            self.assertFalse(meta.is_submittable, f"{dt} unexpectedly became submittable")

    def test_no_cascade_delete_hooks_registered(self):
        # Defensive: our doc_events must not wire any on_trash/after_delete
        # cascade behaviour onto these DocTypes.
        from akg_ess import hooks
        events = getattr(hooks, "doc_events", {})
        for dt, handlers in events.items():
            for ev in ("on_trash", "after_delete", "before_delete"):
                self.assertNotIn(ev, handlers,
                                 f"{dt} has a {ev} hook — review for cascade risk")
