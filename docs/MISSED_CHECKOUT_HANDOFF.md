# Missed Check-out — UI Handoff

**Audience:** Claude Design (mock up the screens for engineering to implement).
**Scope:** the UI surface for "employee forgot to check out yesterday." Backend wiring is described only as much as the designer needs to know what each control does.
**Languages:** EN + AR (RTL). Same illustrations.
**Brand:** AKG ESS — navy `#0F1E33`, hi-vis safety yellow `#F2C012`, ok-green `#15803D`, warn `#D97706`, bad `#DC2626`. Typeface: Inter Tight (EN) / IBM Plex Sans Arabic (AR). Token reference is `akg_ess/public/styles.css` in this repo.

---

## 1. Problem in one sentence

If an engineer or office worker checks in but forgets to check out, the day's hours silently land as **zero**. There's no signal, no recovery. We need a UX that catches this and lets the employee correct it, with manager oversight.

## 2. Flow at a glance

```
midnight scheduler                next app open                    manager queue
─────────────────                  ─────────────                    ────────────
finds open IN > 12h old   ───►    "Missed Check-out" modal   ───►   pending review
flags day "on hold"                employee enters real OUT          approve / edit time
no fake OUT written                + reason                          → posts to timesheet
                                   submits for review                 day released
```

The employee can use the rest of the app normally **after** they've handled the missed check-out — the modal blocks the Attendance tab only, not Leaves / Petty Cash. Hard rule.

## 3. Trigger conditions

Show the modal when **all** of these are true on app launch:
- The current user has an `Employee Checkin` row with `log_type='IN'` from any prior day.
- That row has no matching `OUT` after it.
- More than **12 hours** have passed since that IN (so a session that wraps across midnight without missing isn't flagged).
- It hasn't already been rectified or rejected.

If multiple days are missed (vacation, signal blackout) show them one at a time, oldest first. Each submission dismisses the current modal and re-checks for another.

---

## 4. Screens to design

### 4.1 — Detection toast (subtle, before modal opens)

A 2.5-second toast slides in from the top while the missed-checkout data loads:

> ⚠ We noticed you didn't check out yesterday — opening it for you…

Use the existing `.toast.toast-warn` style. After it dismisses, the modal slides up.

### 4.2 — Missed Check-out Modal (the main surface)

Full-screen sheet, can't be dismissed by tapping outside. Same shell as `OutsideZonePopup` (used today for off-zone violations). Reuse `.modal-backdrop` + `.modal-sheet`.

**Header:**
- Warn-tinted icon tile (40 × 40, `--warn-100` background, `--warn` icon) with a `clock` icon.
- Title: **You forgot to check out**
- Sub: *Date · Site name* — e.g. *Sun 03 May · AKG-SIT Office (PRJ-1608)*

**Read-out card** (same look as the "Distance / nearest" card in OutsideZonePopup):
- Left col: "Checked in" with the actual IN time, big tabular numerals.
- Right col: "Hours since check-in" with elapsed time in **red** if > 18h.

**The picker — the heart of the screen:**
- Label: **What time did you actually leave?** *
- A time-picker input (HTML `<input type="time">`).
- Default value: **end of typical shift** = 18:00. Hint text under the input: *"Default: 18:00. Adjust if you left earlier or later."*
- Below the picker, three quick-pick chips for the most common cases:
  - `End of shift (18:00)` ← active by default
  - `Site closing (20:00)`
  - `I worked late — pick custom`
- Tapping a chip writes that time into the input. "Custom" just focuses the input.

**Reason field:**
- Label: **Why didn't you check out?** *
- Textarea, 3 rows, placeholder: *"e.g. Phone died, signal dropped, ran to catch a flight…"*
- Min 8 chars, char counter on the right (mirrors OutsideZonePopup).

**Impact preview** (same `.violation-impact` block already in the codebase):
- Icon: `user`
- Title: **Day will be held until manager approves**
- Sub: *Manager review:* **<leave-approver name>** (pulled from `CURRENT_USER.leave_approver_name`)
- Right side: warn pill `Pending review`

**Actions row** (same grid as OutsideZonePopup, `1fr 1.4fr`):
- **Cancel** (ghost) — closes the modal, but the toast re-fires on next launch. Disable for the first 3 seconds so it can't be dismissed accidentally.
- **Submit for review** (primary) — disabled until time + reason both valid.

### 4.3 — Submitted state (replaces modal contents in place, ~1.5s)

Big green check + heading:
- ✓ **Sent for review**
- Sub: *Your manager will see this in their queue. We'll notify you once it's approved.*

Auto-dismisses, returns to the Attendance tab. The day shows the hold pill `On hold · Pending review` (already styled).

### 4.4 — Attendance hero — reflects the hold state

While there's a missed-checkout pending review, the Site Hero / Office Hero shows:

- Status pill: ⚠ `On hold · awaiting review` (warn-yellow dot)
- Sub: *Yesterday's check-out is being reviewed by your manager.*

Once approved, the pill flips to `Approved · auto-posted` for 24h then disappears.

### 4.5 — Manager review queue (existing surface, new tab)

Currently the manager's Notifications + petty/leaves manager view shows Geofence Violations. Add a sibling tab:

> **Missed Check-outs** (count badge)

Each row is a list-row card:
- Avatar + employee name
- Body: *"didn't check out · Tue 02 May · AKG-SIT Office"*
- Right meta: their proposed OUT time + a chip `Pending review`

Tap to open a manager review sheet:
- Same layout as the employee's modal but read-only on the time, with a small "Edit time" pencil affordance for the manager to override.
- Two action buttons at the bottom:
  - **Approve** (primary, `--ok`) — posts the OUT, releases the day.
  - **Reject** (ghost, `--bad`) — sends it back; the employee gets a notification with the manager's note.

### 4.6 — Notifications copy

Three new notification kinds, follow the existing notification card style:

| Recipient | Trigger | Title | Body |
|---|---|---|---|
| Employee | Modal triggered overnight | **Missed check-out** | *We didn't see you check out from <site> on <date>. Open the app to fix it.* |
| Manager | Employee submitted | **Missed check-out to review** | *<name> didn't check out from <site> on <date>. Tap to review.* |
| Employee | Manager approved | **Check-out approved** | *Your missed check-out for <date> has been posted. <hours>h logged.* |
| Employee | Manager rejected | **Check-out rejected** | *Your missed check-out for <date> was rejected. Reason: "<note>". Tap to retry.* |

---

## 5. Edge cases & states the designer needs to draw

1. **Multiple missed days.** After submitting day 1, the toast + modal fires again for day 2. Show a small chip *"1 of 3 to fix"* in the modal header so the user knows there's more queued.
2. **Office worker missed check-out.** Same flow, but the picker doesn't show "Site closing" chip — replace with "End of office hours (17:30)".
3. **Already rejected once, employee retries.** Modal opens with the manager's rejection note shown above the time picker in a `--bad-100` tinted callout: *"Manager said: 'Time seems off — you left at noon.'"* The picker pre-fills with the manager's last-edited time if any.
4. **Employee genuinely doesn't know.** Add a small "I don't remember" link below the time picker. Tapping it sets the picker to the start-of-IN time + 8h and writes "Don't remember exact time" into the reason field. Chips disappear.
5. **Server can't reach the DB at midnight.** Detection happens client-side too on app open as a fallback (read own checkins, look for unmatched IN > 12h). Drawing-wise, this is invisible — same UI either way.

---

## 6. Copy table — EN + AR

| Key | EN | AR |
|---|---|---|
| `missed_co_toast` | "We noticed you didn't check out yesterday — opening it for you…" | "لاحظنا أنك لم تسجل خروجاً أمس — جاري فتح النموذج…" |
| `missed_co_title` | "You forgot to check out" | "نسيت تسجيل الخروج" |
| `missed_co_sub` | "{date} · {site}" | "{date} · {site}" |
| `missed_co_picker_label` | "What time did you actually leave?" | "متى غادرت فعلياً؟" |
| `missed_co_picker_hint` | "Default: 18:00. Adjust if you left earlier or later." | "الافتراضي: 18:00. عدّل الوقت إن كان مختلفاً." |
| `missed_co_chip_shift_end` | "End of shift (18:00)" | "نهاية الدوام (18:00)" |
| `missed_co_chip_site_close` | "Site closing (20:00)" | "إغلاق الموقع (20:00)" |
| `missed_co_chip_custom` | "I worked late — pick custom" | "عملت لوقت متأخر — أدخل وقتاً" |
| `missed_co_reason_label` | "Why didn't you check out?" | "لماذا لم تسجل الخروج؟" |
| `missed_co_reason_ph` | "e.g. Phone died, signal dropped, ran to catch a flight…" | "مثلاً: انطفأ الهاتف، انقطعت الشبكة، خرجت مستعجلاً…" |
| `missed_co_dont_remember` | "I don't remember the exact time" | "لا أتذكر الوقت بالضبط" |
| `missed_co_submitted_title` | "Sent for review" | "تم الإرسال للمراجعة" |
| `missed_co_submitted_sub` | "Your manager will see this in their queue." | "سيظهر لمديرك في قائمة المراجعة." |
| `missed_co_hold_pill` | "On hold · awaiting review" | "موقوف · بانتظار المراجعة" |
| `missed_co_count_chip` | "{n} of {total} to fix" | "{n} من {total} للتصحيح" |
| `missed_co_one_of_n_chip` | "{n} of {total}" | "{n} من {total}" |

(Engineering will add these to `data.js` STRINGS once the screens are approved.)

---

## 7. Reuse — components already in the app

To keep the screens visually consistent with the rest of ESS, reuse these:

| Component / class | Where it lives | Use for |
|---|---|---|
| `OutsideZonePopup` shell | `attendance.jsx` | Same modal pattern — header tile + read-out card + reason + impact + 2-button row |
| `.violation-impact*` | `styles.css` | "Day will be held" block under the picker |
| `.modal-backdrop` / `.modal-sheet` | `styles.css` | Modal container |
| `.checkout-summary*` | `styles.css` | Two-row "Checked in / Hours since" read-out card |
| `.field-textarea` + counter pattern | `petty.jsx` New Claim sheet | Reason field + char counter |
| `.chip` `.chip-warn` `.chip-ok` | `styles.css` | Status pills (Pending review, Approved) |
| `.toast-warn` / `.toast-ok` | `styles.css` | The detection toast and the success toast |
| `Icon` set | `ui.jsx` (`window.Icon`) | All icons — `clock`, `warn`, `user`, `check`, `x` |

---

## 8. Out of scope for this handoff

- Backend DocType design — engineering will mirror Geofence Violation. Doesn't change the UI.
- Auto-close-at-midnight (Option A) — explicitly rejected; designer should not show any "auto-closed" state.
- Bulk-fix UI for HR to clear backlogs — separate ticket.
- Push notifications styling — already shipped; only the new copy strings are new.

## 9. Deliverable

- Figma frames (or PNG mockups) for **screens 4.1, 4.2, 4.3, 4.4, 4.5** in EN.
- Same screens mirrored in AR (RTL).
- States: idle picker, picker with rejection callout, "1 of 3 to fix" header chip, "I don't remember" mode, manager review sheet (approve / reject / edit time).
- Brand tokens already defined — no new colours.

That's it — keep it tight, mirror the visual language already in the app, and we'll be ready to implement off your screens.
