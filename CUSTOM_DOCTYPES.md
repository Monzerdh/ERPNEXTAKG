# Custom DocTypes & Custom Fields — manual creation reference

> **You normally don't need this.** When the AKG ESS app is installed via `bench install-app akg_ess`, fixtures import every DocType and Custom Field listed below automatically. Use this doc only as:
> - a reference if you want to create them by hand on a site where fixtures didn't auto-install,
> - a sanity check after a migration,
> - a starting point if you want to extend the schema.

All DocTypes belong to the module **AKG ESS**.

---

## 1. Custom DocTypes

### 1.1 `Geofence Violation`

Holds outside-zone check-ins awaiting manager review. When `status` flips to `Approved`, a server-side hook creates the matching `Employee Checkin`.

| Fieldname           | Type        | Options / Notes                                                |
|---------------------|-------------|----------------------------------------------------------------|
| `employee`          | Link        | → Employee. Required.                                          |
| `employee_name`     | Data        | Fetched from `employee.employee_name`. Read-only.              |
| `log_type`          | Select      | `IN` / `OUT`. Required.                                        |
| `time`              | Datetime    | Required.                                                      |
| `date`              | Date        | Auto-filled from `time` on insert.                             |
| `linked_checkin`    | Link        | → Employee Checkin. Read-only. Set automatically on Approval.  |
| `latitude`          | Float       | Precision 8.                                                   |
| `longitude`         | Float       | Precision 8.                                                   |
| `accuracy_m`        | Int         | GPS accuracy in metres.                                        |
| `distance_m`        | Int         | Distance from nearest assigned site (m).                       |
| `nearest_site`      | Link        | → Project.                                                     |
| `selected_project`  | Link        | → Project. The site the employee said they were on.            |
| `reason`            | Small Text  | Required.                                                      |
| `status`            | Select      | `Pending` / `Approved` / `Rejected`. Default `Pending`.        |
| `manager_notes`     | Small Text  |                                                                |
| `approver`          | Link        | → User. Read-only.                                             |
| `approved_on`       | Datetime    | Read-only.                                                     |
| `local_id`          | Data        | Unique. Idempotency key for offline queue.                     |

**Naming:** `format:GFV-{YYYY}-{#####}`
**Permissions:** System Manager (RWCD), HR Manager (RWC), Projects Manager (RW), Employee (RC, if_owner).

---

### 1.2 `ESS Notification`

In-app notifications. Filtered server-side by `permission_query_conditions` so each user sees only what's addressed to them, their role, or `all`.

| Fieldname     | Type       | Options / Notes                                                          |
|---------------|------------|--------------------------------------------------------------------------|
| `recipient`   | Link       | → Employee. Standard filter.                                             |
| `for_role`    | Select     | (blank) / `employee` / `manager` / `all`. Default `employee`.            |
| `kind`        | Select     | `info` / `approval` / `sync` / `alert` / `reminder`. Default `info`.     |
| `title`       | Data       |                                                                          |
| `body`        | Small Text |                                                                          |
| `target_tab`  | Select     | (blank) / `attendance` / `leaves` / `petty` / `profile`.                 |
| `target_id`   | Data       | Document name to focus when the user taps the notification.              |
| `is_read`     | Check      | Default `0`.                                                             |
| `read_on`     | Datetime   | Read-only.                                                               |
| `payload`     | Long Text  | Optional structured JSON payload for the client.                         |

**Naming:** `format:NOTIF-{YYYY}-{#####}`
**Permissions:** System Manager (RWCD), Employee (RW).

---

### 1.3 `AKG ESS Settings` *(Singleton)*

App-wide settings. Created once on install; admins edit at `/app/akg-ess-settings`.

| Fieldname               | Type     | Options / Notes                                                                          |
|-------------------------|----------|------------------------------------------------------------------------------------------|
| `enable_receipt_ocr`    | Check    | Default `1`. When off, the OCR endpoint returns empty defaults without calling the API.  |
| `model`                 | Select   | `claude-haiku-4-5-20251001` (default) / `claude-sonnet-4-6`.                             |
| `anthropic_api_key`     | Password | Encrypted at rest. Read server-side via `get_password()`. Never sent to the client.      |
| `monthly_call_cap`      | Int      | Default `5000`. Soft cap — exceeding it logs an Error Log entry and OCR returns empty.   |
| `default_radius_meters` | Int      | Default `200`. Used when a Project has site coords set but no explicit radius.           |
| `settings_version`      | Data     | Read-only. Bump on schema changes.                                                       |

**Permissions:** System Manager only (R/W).

---

### 1.4 `Petty Cash Top-up Request`

Routed to the reporting manager. After approval, an Accounts user posts an `Employee Advance` against the petty cash account.

| Fieldname           | Type      | Options / Notes                                              |
|---------------------|-----------|--------------------------------------------------------------|
| `employee`          | Link      | → Employee. Required.                                        |
| `employee_name`     | Data      | Fetched from `employee.employee_name`. Read-only.            |
| `request_date`      | Date      | Default Today. Required.                                     |
| `amount`            | Currency  | Required. Currency from the `currency` field.                |
| `currency`          | Link      | → Currency. Default `AED`.                                   |
| `status`            | Select    | `Pending` / `Approved` / `Rejected` / `Disbursed`. Default `Pending`. |
| `reason`            | Small Text|                                                              |
| `approver`          | Link      | → User. Read-only.                                           |
| `approver_comment`  | Small Text|                                                              |
| `approved_on`       | Date      | Read-only.                                                   |

**Naming:** `format:PCT-{YYYY}-{#####}`
**Permissions:** System Manager (RWCD), Accounts Manager (RWC), Employee (RC, if_owner).

---

## 2. Custom Fields on standard DocTypes

These are added by the `custom_field.json` fixture. Manual creation: *Setup → Customize → Custom Field*.

### 2.1 `Project` — site geofence

| Fieldname              | Type          | Insert After          | Notes                                       |
|------------------------|---------------|-----------------------|---------------------------------------------|
| `akg_geofence_section` | Section Break | `department`          | Collapsible. Label: *Site Geofence*.        |
| `site_latitude`        | Float (p=8)   | `akg_geofence_section`| Site centre latitude.                       |
| `site_longitude`       | Float (p=8)   | `site_latitude`       | Site centre longitude.                      |
| `site_radius_meters`   | Int           | `site_longitude`      | Default `200`. Geofence radius in metres.   |

### 2.2 `Employee Checkin` — location + idempotency

| Fieldname               | Type           | Insert After             | Notes                                |
|-------------------------|----------------|--------------------------|--------------------------------------|
| `akg_location_section`  | Section Break  | `device_id`              | Collapsible. Label: *Location*.      |
| `latitude`              | Float (p=8)    | `akg_location_section`   |                                      |
| `longitude`             | Float (p=8)    | `latitude`               |                                      |
| `accuracy_m`            | Int            | `longitude`              |                                      |
| `project`               | Link → Project | `accuracy_m`             |                                      |
| `local_id`              | Data, Unique   | `project`                | Offline outbox idempotency key.      |

### 2.3 `Leave Application`

| Fieldname  | Type         | Insert After | Notes                          |
|------------|--------------|--------------|--------------------------------|
| `local_id` | Data, Unique | `company`    | Offline outbox idempotency key.|

### 2.4 `Expense Claim`

| Fieldname  | Type         | Insert After | Notes                          |
|------------|--------------|--------------|--------------------------------|
| `local_id` | Data, Unique | `company`    | Offline outbox idempotency key.|

---

## 3. Roles

| Role         | desk_access | Notes                                                             |
|--------------|-------------|-------------------------------------------------------------------|
| `ESS User`   | 0           | Field-staff role for the PWA.                                     |
| `ESS Manager`| 0           | Approver role. Surfaces approval queues even without HR Manager.  |

---

## 4. Server-side hook (auto-Checkin on Approval)

Already wired by `hooks.py`:

```python
doc_events = {
    "Geofence Violation": {
        "on_update": "akg_ess.akg_ess.doctype.geofence_violation.geofence_violation.on_status_change",
    },
}
```

The handler creates an `Employee Checkin` with the violation's coordinates + selected project when status flips to `Approved`, and stores the new Checkin's name back in `linked_checkin` for traceability. Idempotent — guarded by the `linked_checkin` field so a re-save doesn't duplicate.

---

If you spot a discrepancy between this doc and the JSON / fixture files, **the JSON is the source of truth**. Update this file to match.
