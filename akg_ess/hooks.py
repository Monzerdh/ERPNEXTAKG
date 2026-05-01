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
# Install hook — seeds default Activity Types so the Check-out modal
# isn't empty on a fresh install.  Idempotent — safe to re-run.
# ──────────────────────────────────────────────────────────────────────
after_install = "akg_ess.install.after_install"

# ──────────────────────────────────────────────────────────────────────
# Document Events
# ──────────────────────────────────────────────────────────────────────
# When a Geofence Violation is approved, auto-create the matching
# Employee Checkin so attendance posts to ERPNext only after manager OK.
doc_events = {
    "Geofence Violation": {
        "on_update": "akg_ess.akg_ess.doctype.geofence_violation.geofence_violation.on_status_change",
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
                "Project-akg_geofence_section",
                "Project-site_latitude",
                "Project-site_longitude",
                "Project-site_radius_meters",
                "Employee Checkin-accuracy_m",
                "Employee Checkin-project",
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
]

# ──────────────────────────────────────────────────────────────────────
# Permissions
# ──────────────────────────────────────────────────────────────────────
# Filter the ESS Notification list so users only ever see their own.
permission_query_conditions = {
    "ESS Notification": "akg_ess.akg_ess.doctype.ess_notification.ess_notification.get_permission_query_conditions",
}

has_permission = {
    "ESS Notification": "akg_ess.akg_ess.doctype.ess_notification.ess_notification.has_permission",
}
