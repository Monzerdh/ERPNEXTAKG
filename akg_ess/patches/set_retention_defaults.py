"""Seed the documented retention windows onto the existing AKG ESS Settings
single. Field defaults (180 / 90) only apply when a Single is first created, so
an install that predates these fields would otherwise read 0 (keep-forever).

Idempotent + non-destructive: only fills a window that is currently empty/0, so
an admin who deliberately sets 0 (keep-forever) is never overwritten.
`enable_retention` is intentionally left untouched (stays off by default).
"""
import frappe

DEFAULTS = {"notification_retention_days": 180, "push_subscription_stale_days": 90}


def execute():
    if not frappe.db.exists("DocType", "AKG ESS Settings"):
        return
    for key, value in DEFAULTS.items():
        current = frappe.db.get_single_value("AKG ESS Settings", key)
        if not current:  # None / 0 / "" -> field freshly added
            frappe.db.set_single_value("AKG ESS Settings", key, value)
    frappe.db.commit()
