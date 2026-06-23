"""Data retention / archival for AKG ESS.

PRINCIPLE: retain everything with payroll or audit value; only PURGE genuinely
transient operational data, and only when explicitly enabled.

NEVER auto-deleted by this module (payroll / compliance / audit records):
    Employee Checkin, ESS Daily Attendance, Attendance,
    Geofence Violation, Missed Checkout, ESS Attendance Correction
At ~22k check-ins/year these stay fast with the indexes in place (see
DB_NOTES.md). If you ever need to offload very old years, EXPORT them first —
this module will not delete them. See RETENTION.md.

Only ever purged (both leaf tables — nothing links to them, so no cascade):
    - ESS Notification rows that are READ and older than N days (pure UI feed)
    - ESS Push Subscription rows that are DISABLED and stale > N days

Off by default. The monthly scheduler entry no-ops unless `enable_retention`
is ticked in AKG ESS Settings. Everything is logged and System-Manager gated.
"""
import frappe
from frappe.utils import add_to_date, now_datetime

DEFAULTS = {
    "enable_retention": 0,
    "notification_retention_days": 180,
    "push_subscription_stale_days": 90,
}

# Hard guarantee, asserted by tests: this module must never touch these.
PROTECTED_DOCTYPES = (
    "Employee Checkin", "ESS Daily Attendance", "Attendance",
    "Geofence Violation", "Missed Checkout", "ESS Attendance Correction",
)


def _settings():
    out = dict(DEFAULTS)
    for k in DEFAULTS:
        try:
            v = frappe.db.get_single_value("AKG ESS Settings", k)
        except Exception:
            v = None
        if v not in (None, ""):
            out[k] = v
    return out


def _cutoff(days):
    """Datetime `days` before now, or None when days<=0 (= keep forever)."""
    days = int(days or 0)
    if days <= 0:
        return None
    return add_to_date(now_datetime(), days=-days)


def _count_old_read_notifications(days):
    cutoff = _cutoff(days)
    if not cutoff:
        return 0
    return frappe.db.sql(
        "SELECT COUNT(*) FROM `tabESS Notification` WHERE is_read=1 AND creation < %s",
        (cutoff,))[0][0]


def _count_stale_push(days):
    cutoff = _cutoff(days)
    if not cutoff:
        return 0
    return frappe.db.sql(
        "SELECT COUNT(*) FROM `tabESS Push Subscription` WHERE IFNULL(enabled,0)=0 AND modified < %s",
        (cutoff,))[0][0]


def purge_old_notifications(days, dry_run=True):
    """Delete READ notifications older than `days`. Unread are always kept."""
    cutoff = _cutoff(days)
    if not cutoff:
        return 0
    n = _count_old_read_notifications(days)
    if n and not dry_run:
        frappe.db.sql(
            "DELETE FROM `tabESS Notification` WHERE is_read=1 AND creation < %s", (cutoff,))
        frappe.db.commit()
    return n


def purge_stale_push_subscriptions(days, dry_run=True):
    """Delete DISABLED push subscriptions untouched for `days`. Active kept."""
    cutoff = _cutoff(days)
    if not cutoff:
        return 0
    n = _count_stale_push(days)
    if n and not dry_run:
        frappe.db.sql(
            "DELETE FROM `tabESS Push Subscription` WHERE IFNULL(enabled,0)=0 AND modified < %s",
            (cutoff,))
        frappe.db.commit()
    return n


def run_retention(dry_run=False):
    """Scheduler entry (monthly). No-op unless retention is enabled. Only ever
    purges the two transient tables; protected payroll/audit data is untouched."""
    s = _settings()
    if not int(s.get("enable_retention") or 0):
        return {"enabled": False, "purged": {}}
    result = {
        "enabled": True,
        "dry_run": bool(dry_run),
        "purged": {
            "notifications": purge_old_notifications(s["notification_retention_days"], dry_run),
            "push_subscriptions": purge_stale_push_subscriptions(s["push_subscription_stale_days"], dry_run),
        },
    }
    try:
        frappe.logger("akg_ess").info(f"retention run: {result}")
    except Exception:
        pass
    return result


def _require_system_manager():
    if "System Manager" not in frappe.get_roles(frappe.session.user):
        frappe.throw("System Manager role required.")


@frappe.whitelist()
def retention_report():
    """Preview only — counts what WOULD be purged, deletes nothing.
    System Manager only."""
    _require_system_manager()
    s = _settings()
    return {
        "enabled": bool(int(s.get("enable_retention") or 0)),
        "windows": {
            "notification_retention_days": int(s.get("notification_retention_days") or 0),
            "push_subscription_stale_days": int(s.get("push_subscription_stale_days") or 0),
        },
        "eligible_to_purge": {
            "read_notifications": _count_old_read_notifications(s["notification_retention_days"]),
            "stale_push_subscriptions": _count_stale_push(s["push_subscription_stale_days"]),
        },
        "protected_never_purged": list(PROTECTED_DOCTYPES),
    }


@frappe.whitelist()
def trigger_retention(dry_run=1):
    """Manually run retention now (defaults to a safe dry run). System Manager
    only. Pass dry_run=0 to actually purge."""
    _require_system_manager()
    return run_retention(dry_run=bool(int(dry_run)))
