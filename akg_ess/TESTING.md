# Automated tests

The akg_ess test suite (`FrappeTestCase`) locks down the business rules that
are easy to break by accident: hours/overtime math, approval authority, the
single-punch guard, recompute_day, corrections, the off-zone lifecycle, and
permission scoping.

## Running

```bash
# whole suite
bench --site <site> run-tests --app akg_ess

# one module
bench --site <site> run-tests --module akg_ess.akg_ess.tests.test_recompute_day
```

The runner requires the site flag `allow_tests`:

```bash
bench --site <site> set-config allow_tests true
```

> ⚠️ **Only enable `allow_tests` on a dev / test site — NEVER on production.**
> It is off by default on production, which is the safety gate that prevents
> the suite from running against live data.

## What's covered (42 tests)

| Module | What it pins down |
|--------|-------------------|
| `test_hours` | overtime past 10h only when eligible; otherwise degraded; 50/50 project split |
| `test_approval_authority` | never self-approve; manager / leave-approver / System+HR Manager rules |
| `test_single_punch_guard` | one IN + one OUT per day; OUT-before-IN blocked; server-authoritative time; system inserts bypass |
| `test_recompute_day` | IN+OUT → Present (+HR); IN-only → Checked In; stale pending cleared; idempotent |
| `test_corrections` | correction creates missing punches (flagged `via_correction`); updates times; no-time-on-empty-day is a no-op |
| `test_offzone` | off-zone punch holds the day (Outside, no HR); approve IN+OUT → Present; reject clears |
| `test_permissions` | employee sees only their own punches (even system-created); ESS Daily list scoped by `employee`, not `owner` |

## How isolation works (important)

These run against a site that may hold real data, and the code under test
commits (`recompute_day` → `db.commit`). So the suite does **not** rely on
transaction rollback. Instead:

- Tests that create attendance use **far-future dates (year 2099)** on existing
  employees, and wipe every `(employee, day)` they touch in `tearDown` via
  `reset_day` (see `tests/utils.py`).
- Off-zone and guard tests use a **throwaway synthetic employee** (created in
  `setUpClass`, hard-deleted in `tearDownClass`) because those punches are
  stamped to *today* by the server — the synthetic employee keeps "today" free
  of real data.

After a full run, there should be zero residue (no synthetic employees, no 2099
rows, no test-marked checkins).
