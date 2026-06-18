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
        # Approval authority: only the employee's manager (or System/HR
        # Manager) may approve or reject — never the employee themselves.
        if not self.is_new() and self.has_value_changed("status") and self.status in ("Approved", "Rejected"):
            from akg_ess.api import _can_approve
            if not _can_approve(frappe.session.user, self.employee):
                frappe.throw("Only this employee's manager can approve or reject their off-zone request.")

    def after_insert(self):
        """Out-of-zone punch filed — nothing is posted to HR, but surface the
        day as Pending Approval in the app/report (and flip an in-progress
        'Checked In' row to held) so the state is visible while it waits."""
        try:
            from akg_ess.attendance import recompute_day
            recompute_day(self.employee, frappe.utils.getdate(self.time or self.date))
        except Exception:
            frappe.log_error(frappe.get_traceback(), "GFV after_insert: recompute_day failed")


def get_permission_query_conditions(user=None):
    """Scope the Geofence Violation list:
       - System / HR Manager: everything ("")
       - ESS Manager / anyone with reports: own rows OR their team's rows
         (direct reports + leave-approver assignments)
       - everyone else: their own rows only
    Mirrors Missed Checkout. The 'Me' tab reads own rows; the 'My team' tab
    uses the whitelisted get_team_violations (which excludes self)."""
    user = user or frappe.session.user
    if user == "Administrator":
        return ""
    roles = set(frappe.get_roles(user))
    if {"System Manager", "HR Manager"} & roles:
        return ""

    esc = lambda v: frappe.db.escape(v)[1:-1]
    own = f"`tabGeofence Violation`.`owner` = '{esc(user)}'"
    me_emp = frappe.db.get_value("Employee", {"user_id": user}, "name")
    if not me_emp:
        return own
    own_emp = f"`tabGeofence Violation`.`employee` = '{esc(me_emp)}'"

    team = frappe.get_all("Employee", filters=[["reports_to", "=", me_emp], ["status", "=", "Active"]], pluck="name")
    team += frappe.get_all("Employee", filters=[["leave_approver", "=", user], ["status", "=", "Active"]], pluck="name")
    team = list({t for t in team if t and t != me_emp})
    if not team:
        return f"({own} OR {own_emp})"
    in_clause = ",".join(f"'{esc(e)}'" for e in team)
    team_q = f"`tabGeofence Violation`.`employee` IN ({in_clause})"
    return f"({own} OR {own_emp} OR {team_q})"


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

        # The created checkin's after_insert already recomputed the day, but
        # recompute once more to be safe now that this violation is no longer
        # Pending (so the day can finalise to Present + post HR).
        _recompute(doc.employee, day)

    elif doc.status == "Rejected":
        if not doc.approver:
            doc.db_set("approver", frappe.session.user, update_modified=False)
        if not doc.approved_on:
            doc.db_set("approved_on", frappe.utils.now_datetime(), update_modified=False)
        # Rejected punch is dropped — recompute clears any stale pending
        # placeholder for the day (or holds on a remaining pending punch).
        _recompute(doc.employee, frappe.utils.getdate(doc.time or doc.date))


def _recompute(employee, day):
    try:
        from akg_ess.attendance import recompute_day
        recompute_day(employee, day)
    except Exception:
        frappe.log_error(frappe.get_traceback(), "GFV: recompute_day failed")
