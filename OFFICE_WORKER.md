# Office Worker mode — Attendance for non-site staff

AKG ESS has two attendance flows. Each employee uses one or the other based on a single checkbox on their Employee record.

| Flow | For whom | What they see |
|---|---|---|
| **Site Worker** *(default)* | Field staff who work on construction projects | Map with project geofences, GPS-validated check-in, project / Activity Type / Task pickers, end-of-day Timesheet preview |
| **Office Worker** | HQ admins, finance, HR, IT, anyone who never works on a site | One big Check In / Check Out button, today's hours + session count, no map, no project, no activity, no task |

Both flows write to the same `Employee Checkin` DocType and feed the same Monthly Attendance Report — so HR sees a unified view either way.

---

## How to flag an employee as Office Worker

1. Open the employee record at `https://<your-site>/app/employee/<EMPLOYEE-ID>`
2. Find the **Office Worker (no site)** checkbox (added by the AKG ESS app, sits right after **Department**)
3. Tick it → Save
4. Have the employee refresh the PWA — they'll immediately see the simplified attendance screen

**To revert:** untick the box and save. No data migration. No Employee Checkin records are deleted or changed — the flag only affects what the PWA shows from the next refresh onwards.

### Bulk enable

If you have many office staff to flag at once:

1. Go to `https://<your-site>/app/employee/view/list`
2. Filter / select the employees you want
3. **Actions → Edit** → set `Is Office Worker` to `1` → Update

Or use **Data Import** with a sheet listing `name` and `is_office_worker` columns.

---

## What office workers see

```
┌─────────────────────────────┐
│  Good morning               │
│  Ammar                      │
│                             │
│  ┌───────────────────────┐  │
│  │ 09:42:18              │  │   live clock
│  │ Friday, May 1         │  │
│  ├───────────────────────┤  │
│  │ TODAY  SESSIONS   ●   │  │
│  │ 03:42    2    Active  │  │
│  └───────────────────────┘  │
│                             │
│  ┌───────────────────────┐  │
│  │   ✓  Check In         │  │   green
│  └───────────────────────┘  │
│                             │
│  Today's sessions           │
│  ⏱ 09:00 → 12:30  Reviewed  │
│  ⏱ 13:30 → Active now  Live │
│                             │
│  📅 Monthly report   →      │
└─────────────────────────────┘
```

The big button adapts to state:
- **Green "Check In"** when not currently checked in
- **Red "Check Out"** when currently checked in

The Leaves, Petty Cash, and Profile tabs are unchanged from the site-worker flow.

---

## What site workers see (unchanged)

```
┌─────────────────────────────┐
│  Good morning               │
│  Faisal                     │
│                             │
│  📍 AKG-SIT Office · 1608  │
│      [Inside project zone]  │
│                             │
│  [   real OSM map   ]       │
│                             │
│  ┌───────────────────────┐  │
│  │   ✓  Check In         │  │
│  └───────────────────────┘  │
│                             │
│  Today's sessions           │
│  ⏱ 09:00 → 12:30  Execution │
│        AKG-SIT · TASK-...   │
│                             │
│  End-of-day timesheet  →    │
│  Monthly report        →    │
└─────────────────────────────┘
```

Plus the Check Out modal asking for **Activity Type + Task** when they tap "Check Out".

---

## Comparison table

| Behaviour | Site Worker | Office Worker |
|---|---|---|
| Map | Real OSM, shows assigned project geofences | Hidden |
| GPS read | Live, every 30 s | Not used |
| Project picker | Auto-matched to nearest geofenced site | Not asked |
| Activity Type | Required on check-out | Not asked |
| Task | Required on check-out | Not asked |
| Geofence Violation | Triggered if checking in outside any project zone | Cannot trigger |
| Employee Checkin row | `project`, `latitude`, `longitude`, `accuracy_m` set | All these are `null` |
| Offline queue | Same — payload differs | Same |
| Monthly attendance | Same calculation, same report | Same |
| Leaves tab | Same | Same |
| Petty Cash tab | Same | Same |
| Manager view | Sees their team's check-ins | Sees their team's check-ins |

---

## Technical reference

### Custom Field installed

| Field | Type | DocType | Default | Description |
|---|---|---|---|---|
| `is_office_worker` | Check | Employee | 0 | When checked, the AKG ESS PWA serves the simplified office attendance flow. |

Inserted after the standard `department` field. Shipped via `akg_ess/fixtures/custom_field.json` and re-applied on every `bench install-app akg_ess` / `bench migrate`.

### Server endpoint

`GET /api/method/akg_ess.api.get_session_profile` returns this in the JSON response when called by a signed-in user:

```json
{
  "signed_in": true,
  "user": "ammar@akg.ae",
  "employee": "HR-EMP-00012",
  "is_office_worker": true,
  "..."
}
```

### Client routing

`AttendanceScreen` in `akg_ess/public/attendance.jsx` is a thin router:

```jsx
function AttendanceScreen(props) {
  if (window.CURRENT_USER && window.CURRENT_USER.is_office_worker) {
    return <OfficeAttendanceScreen {...props} />;
  }
  return <SiteAttendanceScreen {...props} />;
}
```

`window.CURRENT_USER.is_office_worker` is hydrated once after login from `get_session_profile`. The flag is not re-fetched on tab switches — the user has to refresh the PWA after HR flips the checkbox.

### Where data lands

Both flows insert rows into the standard `Employee Checkin` DocType. Office Worker inserts have:

| Field | Office Worker | Site Worker |
|---|---|---|
| `employee` | Set | Set |
| `log_type` | Set (IN / OUT) | Set |
| `time` | Set | Set |
| `device_id` | `"ESS-MOBILE"` | `"ESS-MOBILE"` |
| `local_id` | Set (idempotency) | Set (idempotency) |
| `project` | `null` | Project ID |
| `latitude` | `null` | Float |
| `longitude` | `null` | Float |
| `accuracy_m` | `null` | Int |

Reports, payroll, attendance summaries — all read `Employee Checkin` directly, so they Just Work for both modes.

---

## Edge cases & FAQ

**Q: An employee sometimes works at the office, sometimes on a site. What do I do?**
Today: leave them flagged as Site Worker (the default). The map still works at the office — they just check in with no geofence match, which routes through the violation queue. A manager approves it once and the check-in is created.

If this becomes common, we can add a per-day "today I'm at office" toggle on the home screen — ping us.

**Q: Can a manager flagged as Office Worker still see their team's geofence violations?**
Yes. The Manager tab on the Profile screen and the Leaves / Petty Cash approval queues all work regardless of the manager's own attendance mode.

**Q: Will Frappe's standard ERPNext UI show the new field?**
Yes. The Employee form has a new checkbox under the Department field. The List View and Reports can filter / group by it.

**Q: Do I need to set up Activity Types or Tasks for office workers?**
No. Office workers never see those pickers. Only configure Activity Types / Tasks for site projects.

**Q: Does the offline outbox work for office workers?**
Yes — identical mechanism. If their phone is offline when they tap Check In / Out, the action queues with `project=null` and syncs when they reconnect.

**Q: What if the API rejects a check-in with `project=null`?**
It won't — the `project` Custom Field on `Employee Checkin` is non-mandatory. The standard `latitude` / `longitude` fields are also nullable in v15+. Verified in production.

**Q: Can I rename the checkbox label?**
Yes — *Setup → Customize Form → Employee → is_office_worker*. The label is purely cosmetic; the fieldname `is_office_worker` is what `get_session_profile` reads, so don't rename the fieldname itself.

---

## Roadmap (not implemented)

These are noted for future versions if the need comes up — say the word and we'll add them:

- **Hybrid daily toggle** — let an employee choose "office today" / "site today" each morning, instead of a fixed flag
- **Time clock kiosk mode** — for shared office tablets, a single PWA instance that lets multiple employees check in/out by tapping their face / scanning a QR badge
- **Department-based default** — auto-flag employees as office workers based on their department (e.g. anyone in "Administration") rather than per-employee toggling
- **Auto-checkout reminder** — gentle notification at 18:00 if the office worker is still checked in
