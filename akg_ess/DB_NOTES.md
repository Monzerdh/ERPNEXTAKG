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

## Maintenance

MariaDB auto-updates index statistics, but after a large bulk import you can
force a refresh: `ANALYZE TABLE \`tabEmployee Checkin\`;`.
