# Database notes — performance, scale & expandability

A review of how the akg_ess data layer is built, how it behaves as data grows,
and how to extend it safely.

## Indexes on the hot paths

`patches/add_performance_indexes.py` adds these (idempotent; plain `ADD INDEX`,
which InnoDB runs as online DDL so it's safe during a production migrate):

| Table | Index (`akg_…`) | Serves |
|-------|-----------------|--------|
| Employee Checkin | (employee, log_type, time) | recompute_day, single-punch guard, `_today_status` — the hottest query, runs on every punch |
| Geofence Violation | (employee, date, status) | hold checks, zone lookup, manager queue (was a full scan) |
| ESS Daily Attendance | (employee, date) | recompute upsert + reports |
| ESS Notification | (is_read, creation) | unread feed ordering |
| Employee | (user_id) | `_my_employee` — runs on nearly every request |
| Employee | (reports_to, status) | team scoping / permission queries |
| Employee | (leave_approver, status) | team scoping / permission queries |

These names are `akg_`-prefixed so Frappe's schema sync never touches them
(it only manages indexes for `search_index` fields).

### Measured impact (6,000-row scale test)

| Query | Before | After |
|-------|--------|-------|
| checkin by employee+log_type+time | range on `employee` + **filesort** | `akg_ec_emp_logtype_time`, **rows=1, no filesort** |
| checkin by employee+time range | full scan | **covering** index scan (`Using index`) |
| Geofence Violation pending | **full scan** | indexed lookup |
| Employee by user_id / reports_to | **full scan** | indexed equality lookup |

> Note: with only a few dozen rows the optimizer may still choose a full scan
> (it's cheaper than an index for tiny tables) — that is correct. The indexes
> kick in automatically as the tables grow, which is what the scale test above
> confirms.

## Is it built to handle scale?

Growth is dominated by **Employee Checkin** and **ESS Daily Attendance** —
roughly `employees × 2` and `employees × 1` rows per working day (≈22k and ≈11k
per year at 45 employees). With the indexes above, the per-request queries are
all bounded index lookups regardless of table size, so day-to-day operations
(punch, recompute, today card, approvals) stay O(log n), not O(n).

Things to keep an eye on as the company grows:

- **`mark_absentees` scheduler** loops over active employees doing a few
  indexed `exists()` checks each — O(employees) per night. Fine for hundreds;
  if it ever reaches many thousands, batch it into set-based queries.
- **Report exports** (ESS Attendance / Overtime) use `limit_page_length=0`
  (no row cap) but are always **date-range + team scoped** and now indexed.
  Keep report ranges bounded (a month/quarter) rather than "all time".
- **Notifications / checkins accumulate forever** — this is what the archival /
  retention plan (item #10) is for: move rows older than N months to an archive
  table or purge them, so the hot tables stay lean.

## Is it built to be extended?

- **Schema is normalised and link-driven.** Custom DocTypes use proper `Link`
  fields (Employee, Project, Scope of Work), naming series / expression naming,
  and `recompute_day` as a single source of truth — so new states or fields can
  be derived in one place.
- **Adding a field:** add it to the DocType JSON (or a Custom Field fixture) and
  `bench migrate`. Mark it `search_index: 1` if it will be filtered on.
- **Adding an index:** append a row to the `INDEXES` list in
  `patches/add_performance_indexes.py` (composite indexes can't be expressed in
  DocType JSON). The patch is idempotent, so re-running migrate only adds what's
  missing. (If a site already ran the patch, bump it to a new patch file to add
  more — patches run once per name.)
- **Behaviour is covered by tests** (`bench run-tests --app akg_ess`), so schema
  / logic changes are caught before they reach production. See TESTING.md.

## Referential integrity & delete safety

Short version: **you cannot wipe related data by deleting a category/tag/master
record.** Three independent layers protect the data:

1. **Link integrity (app-layer).** Frappe refuses to delete any record that
   another record points to, with a clear "linked with …" error. Verified live
   against this DB — deleting a referenced Project, Scope of Work, Employee,
   Leave Type or Department is **blocked**. There are **no raw-SQL foreign keys
   with `ON DELETE CASCADE`**, so a delete never fans out.

2. **Flat schema, no cascade.** Every ESS DocType (ESS Daily Attendance,
   Geofence Violation, Missed Checkout, ESS Notification, ESS Attendance
   Correction, ESS Push Subscription, Scope of Work, AKG ESS Settings) is flat
   (no child tables) and non-submittable — so there is no parent→child cascade.
   A test (`tests/test_integrity.py`) fails if anyone later adds a child table,
   a submittable flag, or an `on_trash`/`before_delete` cascade hook.

3. **Delete permissions are locked down.** On ESS Daily Attendance and Geofence
   Violation, only **System Manager** has `delete`; HR Manager, ESS Manager,
   ESS User and Employee cannot delete these rows at all. So an ordinary user
   adjusting filters/tags can't remove attendance data even by accident.

What *can* legitimately remove data, and why it's safe:
- A user deleting **their own** push subscription (single row).
- `recompute_day` dropping **one** stale "Pending Approval" placeholder when a
  punch was rejected (single row, re-derivable).
- `reset_day` — a **System-Manager-only, manual** test helper scoped to one
  employee + one day.

None of these are triggered by editing a filter, tag, or category. Deleting a
single Employee Checkin is also safe: `recompute_day` simply re-derives that
day from whatever punches remain (single source of truth).

> Tags and saved filters are Frappe metadata (`_user_tags`, list settings) —
> deleting them never touches business data. Changing a Select field's options
> edits the schema, it does not delete rows.

## Maintenance

MariaDB auto-updates index statistics, but after a large bulk import you can
force a refresh: `ANALYZE TABLE \`tabEmployee Checkin\`;`.
