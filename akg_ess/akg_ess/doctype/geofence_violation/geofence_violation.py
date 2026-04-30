import frappe
from frappe.model.document import Document


class GeofenceViolation(Document):
    def before_insert(self):
        if not self.date and self.time:
            self.date = frappe.utils.getdate(self.time)
        if not self.status:
            self.status = "Pending"

    def validate(self):
        if not self.date and self.time:
            self.date = frappe.utils.getdate(self.time)


def on_status_change(doc, method=None):
    """Called via doc_events. When the violation flips to Approved we
    create the matching Employee Checkin so attendance posts only after
    manager OK. When Rejected we just stamp approver + decision time.

    Idempotent — guarded by `linked_checkin` so a re-save doesn't create
    duplicate checkins.
    """
    # has_value_changed returns truthy on a real change. Bail early so we
    # don't re-run on every save (it'd still be idempotent thanks to the
    # linked_checkin guard, but it'd waste a query).
    if not doc.has_value_changed("status"):
        return

    if doc.status == "Approved" and not doc.linked_checkin:
        if not frappe.session.user or frappe.session.user == "Guest":
            return
        doc.approver = frappe.session.user
        doc.approved_on = frappe.utils.now_datetime()

        checkin = frappe.get_doc({
            "doctype": "Employee Checkin",
            "employee": doc.employee,
            "log_type": doc.log_type,
            "time": doc.time,
            "latitude": doc.latitude,
            "longitude": doc.longitude,
            "accuracy_m": doc.accuracy_m,
            "project": doc.selected_project or doc.nearest_site,
            "device_id": "ESS-MOBILE",
            "local_id": f"GFV:{doc.name}",
        })
        checkin.flags.ignore_permissions = True
        checkin.insert(ignore_permissions=True)

        doc.linked_checkin = checkin.name
        doc.db_set("linked_checkin", checkin.name, update_modified=False)
        doc.db_set("approver", doc.approver, update_modified=False)
        doc.db_set("approved_on", doc.approved_on, update_modified=False)

    elif doc.status == "Rejected":
        if not doc.approver:
            doc.db_set("approver", frappe.session.user, update_modified=False)
        if not doc.approved_on:
            doc.db_set("approved_on", frappe.utils.now_datetime(), update_modified=False)
