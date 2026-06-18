app_name = "akg_ess"
app_title = "AKG ESS"
app_publisher = "AKG Contracting"
app_description = "Employee Self-Service PWA for AKG Contracting (attendance, leaves, petty cash)."
app_email = "it@akg.ae"
app_license = "MIT"

# Static asset bundles — Frappe copies these into the bench's sites/assets/<app>/ directory
# during `bench build`. They are then served at /assets/akg_ess/...
# We keep the PWA files in akg_ess/public/akg_ess/ so the URL is /assets/akg_ess/<file>.

# Web pages — anything under akg_ess/www/<route>/ becomes accessible at /<route>.
# The PWA index lives at akg_ess/www/ess/index.html and is reachable at /ess.

# ──────────────────────────────────────────────────────────────────────
# Install + migrate hooks.
#   - after_install: seeds default Activity Types on first install.
#   - after_migrate: re-runs the Module Def + DocType.module healing
#     pass on every `bench migrate`. Symptom this prevents:
#     "No module named 'frappe.core.doctype.<...>'" when saving a row
#     on a site whose stale install left those pointers wrong.
#     The pass is idempotent — when nothing's broken it's a no-op.
# ──────────────────────────────────────────────────────────────────────
after_install = "akg_ess.install.after_install"
after_migrate = ["akg_ess.install.after_migrate"]

# ──────────────────────────────────────────────────────────────────────
# Document Events
# ──────────────────────────────────────────────────────────────────────
# When a Geofence Violation is approved, auto-create the matching
# Employee Checkin so attendance posts to ERPNext only after manager OK.
doc_events = {
    "Geofence Violation": {
        "on_update": "akg_ess.akg_ess.doctype.geofence_violation.geofence_violation.on_status_change",
    },
    # When a Missed Checkout flips to Approved, the controller writes
    # the matching Employee Checkin OUT so the day's hours land on the
    # timesheet. Idempotent — re-saves don't double-write.
    "Missed Checkout": {
        "on_update": "akg_ess.akg_ess.doctype.missed_checkout.missed_checkout.on_status_change",
    },
    # ALL employees are limited to exactly one IN and one OUT per calendar
    # day (single-session model). before_insert rejects duplicates so
    # retries / the offline outbox can't create a second clock-in.
    # after_insert computes the daily attendance record on OUT.
    "Employee Checkin": {
        "before_insert": "akg_ess.checkin_guards.enforce_single_daily",
        "after_insert": "akg_ess.attendance.on_checkin_after_insert",
    },
}

# ──────────────────────────────────────────────────────────────────────
# Fixtures — exported with the app, imported on `bench install-app`.
# ──────────────────────────────────────────────────────────────────────
fixtures = [
    # Custom fields on standard DocTypes (Project geofence + Employee Checkin idempotency)
    {
        "doctype": "Custom Field",
        "filters": [
            ["name", "in", [
                "Employee-is_office_worker",
                "Employee-has_petty_cash",
                "Employee-default_scope_of_work",
                "Employee-has_overtime",
                "Project-akg_geofence_section",
                "Project-site_latitude",
                "Project-site_longitude",
                "Project-site_radius_meters",
                "Employee Checkin-accuracy_m",
                "Employee Checkin-project",
                "Employee Checkin-activity_type",
                "Employee Checkin-scope_of_work",
                "Employee Checkin-local_id",
                "Leave Application-local_id",
                "Expense Claim-local_id",
            ]],
        ],
    },
    # Frappe Realtime fan-out roles for ESS
    {
        "doctype": "Role",
        "filters": [["role_name", "in", ["ESS User", "ESS Manager"]]],
    },
    # Permissions for ESS roles on standard ERPNext DocTypes (Project,
    # Employee Checkin, Leave Application, Expense Claim, etc).
    # Permissions on custom DocTypes (Geofence Violation, Petty Cash
    # Top-up Request, ESS Notification) live in their JSON definitions.
    {
        "doctype": "Custom DocPerm",
        "filters": [["role", "in", ["ESS User", "ESS Manager"]]],
    },
]

# ──────────────────────────────────────────────────────────────────────
# Permissions
# ──────────────────────────────────────────────────────────────────────
# Filter the ESS Notification list so users only ever see their own.
permission_query_conditions = {
    "ESS Notification": "akg_ess.akg_ess.doctype.ess_notification.ess_notification.get_permission_query_conditions",
    "Missed Checkout":  "akg_ess.akg_ess.doctype.missed_checkout.missed_checkout.get_permission_query_conditions",
    "ESS Daily Attendance": "akg_ess.akg_ess.doctype.ess_daily_attendance.ess_daily_attendance.get_permission_query_conditions",
    "Geofence Violation": "akg_ess.akg_ess.doctype.geofence_violation.geofence_violation.get_permission_query_conditions",
}

# ──────────────────────────────────────────────────────────────────────
# Scheduler
#   00:30 — flag yesterday's missed check-outs
#   01:00 — mark absentees (no check-in on a working day)
# ──────────────────────────────────────────────────────────────────────
scheduler_events = {
    "cron": {
        "30 0 * * *": [
            "akg_ess.api.scan_missed_checkouts",
        ],
        "0 1 * * *": [
            "akg_ess.attendance.mark_absentees",
        ],
    },
}

has_permission = {
    "ESS Notification": "akg_ess.akg_ess.doctype.ess_notification.ess_notification.has_permission",
}
