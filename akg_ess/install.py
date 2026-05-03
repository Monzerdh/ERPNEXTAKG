"""
AKG ESS — install / setup helpers.

Runs on `bench install-app akg_ess` via the after_install hook in hooks.py.
Also exposes a whitelisted setup_defaults() method that admins can hit
manually (POST /api/method/akg_ess.install.setup_defaults) to:

  - seed default Activity Types (idempotent)
  - heal the Module Def + DocType.module pointers for our custom
    DocTypes if a partial install left them dangling

Heal scenario: after a half-completed install, the Module Def 'AKG ESS'
may be missing or each custom DocType's `module` field may be pointing
to 'Core' (Frappe's default).  Symptom: any operation on the DocType
errors with `No module named 'frappe.core.doctype.<doctype>'` because
Frappe resolves the wrong app for the controller path.  Calling
setup_defaults() re-applies the correct values.
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

OUR_MODULE = "AKG ESS"
OUR_APP = "akg_ess"
OUR_DOCTYPES = [
    "Geofence Violation",
    "ESS Notification",
    "Petty Cash Top-up Request",
    "Missed Checkout",
    "AKG ESS Settings",
]


def after_install():
    """Frappe lifecycle hook — runs at the end of `bench install-app akg_ess`."""
    ensure_module_def()
    fix_doctype_modules()
    seed_activity_types()
    frappe.db.commit()


def after_migrate():
    """Frappe lifecycle hook — runs at the end of every `bench migrate`.

    Re-applies the Module Def + DocType.module pointers so a site whose
    install previously half-completed self-heals on the next deploy.
    Both calls are idempotent: when the values are already correct the
    pass is a no-op (no DB writes, no log noise). We deliberately skip
    seed_activity_types here — admins customise the list and we never
    overwrite their work after the first install.
    """
    try:
        ensure_module_def()
        fix_doctype_modules()
        frappe.db.commit()
    except Exception:
        # Never block a migrate on a healing pass — log and continue.
        frappe.log_error(
            frappe.get_traceback(),
            "AKG ESS · after_migrate heal failed",
        )


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


def ensure_module_def():
    """Make sure the Module Def 'AKG ESS' exists and points to the akg_ess
    app.  Without this, Frappe resolves DocType.module = 'AKG ESS' to the
    wrong app and tries to import controllers from frappe.core.doctype.*"""
    if not frappe.db.exists("Module Def", OUR_MODULE):
        frappe.get_doc({
            "doctype": "Module Def",
            "module_name": OUR_MODULE,
            "app_name": OUR_APP,
            "custom": 0,
        }).insert(ignore_permissions=True)
        return "created"
    # Module Def exists but might be pointing at the wrong app
    current_app = frappe.db.get_value("Module Def", OUR_MODULE, "app_name")
    if current_app != OUR_APP:
        frappe.db.set_value("Module Def", OUR_MODULE, "app_name", OUR_APP)
        return "rebound"
    return "ok"


def fix_doctype_modules():
    """Re-apply DocType.module = 'AKG ESS' for each of our custom DocTypes.
    Symptom this fixes: 'No module named frappe.core.doctype.<doctype>'
    when inserting / saving a row.  Cause: a previous install ended with
    the DocType row's `module` set to a Core-resolving value."""
    fixed = []
    for dt in OUR_DOCTYPES:
        if not frappe.db.exists("DocType", dt):
            continue
        current = frappe.db.get_value("DocType", dt, "module")
        if current != OUR_MODULE:
            frappe.db.set_value("DocType", dt, "module", OUR_MODULE)
            fixed.append({"doctype": dt, "from": current, "to": OUR_MODULE})
    if fixed:
        # Drop the in-process module/doctype caches so subsequent calls
        # in the same request resolve against the new value.
        frappe.clear_cache()
    return fixed


@frappe.whitelist()
def setup_defaults():
    """Manual re-trigger of the install seeding + heal pass.

    Safe to call any time — every step is idempotent.

    Returns a small report so the admin can see what changed:
      - module_def: 'created' | 'rebound' | 'ok'
      - doctype_modules_fixed: [{doctype, from, to}, ...]  (empty if fine)
      - created_activity_types: [name, ...]                (empty if fine)
    """
    if "System Manager" not in frappe.get_roles(frappe.session.user):
        frappe.throw("System Manager role required to seed defaults.")
    module_status = ensure_module_def()
    doctypes_fixed = fix_doctype_modules()
    activity_types = seed_activity_types()
    frappe.db.commit()
    return {
        "module_def": module_status,
        "doctype_modules_fixed": doctypes_fixed,
        "created_activity_types": activity_types,
    }
