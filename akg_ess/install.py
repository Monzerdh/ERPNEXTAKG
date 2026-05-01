"""
AKG ESS — install / setup helpers.

Runs once on `bench install-app akg_ess` (via after_install hook in hooks.py).
Also exposes a whitelisted setup_defaults() method so admins can re-run
seeding on existing sites without uninstalling/reinstalling.
"""

import frappe


# Default Activity Types relevant to AKG Contracting field operations.
# Created only if the standard ERPNext Activity Type list is empty for the
# given names — never overwrites existing rows.
DEFAULT_ACTIVITY_TYPES = [
    {"name": "Execution",       "billable": 1},
    {"name": "Site Survey",     "billable": 1},
    {"name": "Supervision",     "billable": 1},
    {"name": "Documentation",   "billable": 1},
    {"name": "Travel",          "billable": 0},
    {"name": "Material Pickup", "billable": 0},
    {"name": "Meeting",         "billable": 0},
]


def after_install():
    """Frappe lifecycle hook — runs at the end of `bench install-app akg_ess`."""
    seed_activity_types()
    frappe.db.commit()


def seed_activity_types():
    """Insert default Activity Types if they don't already exist."""
    created = []
    for at in DEFAULT_ACTIVITY_TYPES:
        if frappe.db.exists("Activity Type", at["name"]):
            continue
        doc = frappe.get_doc({
            "doctype": "Activity Type",
            "activity_type": at["name"],
            "billable": at["billable"],
            "default_costing_rate": 0,
        })
        doc.insert(ignore_permissions=True, ignore_if_duplicate=True)
        created.append(at["name"])
    return created


@frappe.whitelist()
def setup_defaults():
    """Manual re-trigger of after_install seeding.  Returns the list of
    Activity Types created on this run (empty list = nothing new)."""
    if "System Manager" not in frappe.get_roles(frappe.session.user):
        frappe.throw("System Manager role required to seed defaults.")
    created = seed_activity_types()
    frappe.db.commit()
    return {"created_activity_types": created}
