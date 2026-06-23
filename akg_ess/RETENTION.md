# Data retention & archival policy

This documents what AKG ESS keeps, for how long, and what (if anything) is ever
deleted automatically. Core principle:

> **Retain everything with payroll or audit value. Only purge genuinely
> transient operational data — and only when an admin turns it on.**

## Retention by data category

| Data | Retention | Auto-deleted? |
|------|-----------|---------------|
| **Employee Checkin** (punches) | Indefinite | **Never** by this app |
| **ESS Daily Attendance** | Indefinite | **Never** |
| **ERPNext Attendance** (payroll) | Indefinite | **Never** |
| **Geofence Violation** (off-zone audit) | Indefinite | **Never** |
| **Missed Checkout** (audit) | Indefinite | **Never** |
| **ESS Attendance Correction** (audit) | Indefinite | **Never** |
| **ESS Notification** (UI feed) | `notification_retention_days` (default 180) | Read ones only, when enabled |
| **ESS Push Subscription** | `push_subscription_stale_days` (default 90) | Disabled/stale ones only, when enabled |

Attendance and the approval trail are payroll / compliance records (UAE labour
law expects employment records to be retained for years), so the app **does not
provide any automatic deletion path for them.** `akg_ess.retention.PROTECTED_DOCTYPES`
enumerates these, and a test asserts they are never purged.

## What the retention job actually does

`akg_ess/retention.py` — runs monthly (02:00 on the 1st), and **no-ops unless
`Enable automatic retention purge` is ticked** in AKG ESS Settings → Data
Retention. When enabled it only:

- deletes **read** ESS Notifications older than the window (unread are always
  kept), and
- deletes **disabled** push subscriptions stale beyond the window (active ones
  are always kept).

Both are leaf tables (nothing links to them), so a purge cannot cascade.

## Operating it safely

1. **Preview first** (deletes nothing):
   ```
   bench --site <site> execute akg_ess.retention.retention_report
   ```
   Returns the current windows, how many rows are *eligible*, and the protected
   list.
2. **Dry-run the job:**
   ```
   bench --site <site> execute akg_ess.retention.trigger_retention --kwargs "{'dry_run':1}"
   ```
3. **Enable** it in AKG ESS Settings and adjust the windows (set a window to
   `0` to keep that category forever). The monthly scheduler takes over.
4. Manual real run (System Manager): `trigger_retention --kwargs "{'dry_run':0}"`.

All entry points are System-Manager gated, and each run is logged.

## Archiving very old attendance (only if ever needed)

At ~22k check-ins/year the indexed tables (see DB_NOTES.md) stay fast for many
years, so attendance does **not** need pruning for performance. If you ever want
to offload very old years (e.g. ex-employees, >5 years), **export them first**
(Report view → Export, or a backup) and only then remove them deliberately —
the app will never do this for you. Keep the export with your payroll archives.
