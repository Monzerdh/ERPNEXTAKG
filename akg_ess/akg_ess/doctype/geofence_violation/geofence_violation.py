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

        # Single-session model: the client already created the IN/OUT
        # Employee Checkin at submit time. Reuse it rather than inserting a
        # duplicate (which the single-daily guard would also reject).
        day = frappe.utils.getdate(doc.time)
        existing = frappe.get_all(
            "Employee Checkin",
            filters=[
                ["employee", "=", doc.employee],
                ["log_type", "=", doc.log_type],
                ["time", ">=", f"{day} 00:00:00"],
                ["time", "<=", f"{day} 23:59:59"],
            ],
            fields=["name"],
            limit=1,
        )
        if existing:
            checkin_name = existing[0]["name"]
        else:
            # Off-zone model: nothing was posted at submit. Create the
            # Employee Checkin now — its after_insert hook populates ESS
            # Daily Attendance (IN -> Checked In, OUT -> Present + HR
            # Attendance). scope_of_work is carried for OUT rows.
            checkin = frappe.get_doc({
                "doctype": "Employee Checkin",
                "employee": doc.employee,
                "log_type": doc.log_type,
                "time": doc.time,
                "latitude": doc.latitude,
                "longitude": doc.longitude,
                "accuracy_m": doc.accuracy_m,
                "project": doc.selected_project or doc.nearest_site,
                "scope_of_work": doc.get("scope_of_work") or None,
                "device_id": "ESS-MOBILE",
                "skip_auto_attendance": 1,
                "local_id": f"GFV:{doc.name}",
            })
            checkin.flags.ignore_permissions = True
            checkin.insert(ignore_permissions=True)
            checkin_name = checkin.name

        doc.linked_checkin = checkin_name
        doc.db_set("linked_checkin", checkin_name, update_modified=False)
        doc.db_set("approver", doc.approver, update_modified=False)
        doc.db_set("approved_on", doc.approved_on, update_modified=False)

        # Release the day: now that the punch is approved, re-evaluate the
        # ESS Daily Attendance row. If nothing else holds the day it flips to
        # Present and the standard HR Attendance is posted/linked.
        try:
            from akg_ess.attendance import refresh_attendance_status
            refresh_attendance_status(doc.employee, day)
        except Exception:
            frappe.log_error(frappe.get_traceback(), "GFV approve: refresh_attendance_status failed")

    elif doc.status == "Rejected":
        if not doc.approver:
            doc.db_set("approver", frappe.session.user, update_modified=False)
        if not doc.approved_on:
            doc.db_set("approved_on", frappe.utils.now_datetime(), update_modified=False)
