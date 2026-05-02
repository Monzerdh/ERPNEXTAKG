# AKG ESS — User Manual Handoff

**Audience:** end users at AKG Contracting (site engineers + office staff). Most read at a basic level; many use Arabic.
**Output:** simple, illustrated PDF, ~10–14 pages.
**Tone:** plain English. Short sentences. One action per step. No jargon (no "DocType", no "ERPNext", no "geofence" — say "site zone").
**Languages:** produce two versions, **English** and **Arabic** (RTL). Same content, same illustrations.
**Style:** AKG brand — navy `#0F1E33` headers, hi-vis safety yellow `#F2C012` for callouts, clean sans (Inter Tight in EN, IBM Plex Sans Arabic in AR).

---

## 1. Cover

- Title: **AKG Employee Self-Service — User Guide**
- Subtitle: *Attendance · Leaves · Petty Cash*
- AKG logo top-left, version + date bottom-right.

## 2. What is the app?

One short paragraph + a phone-screen mockup:

> "AKG ESS is the company app for your phone. Use it to check in at your site, request leave, and submit expense receipts. It works on Android and iPhone, and most things keep working even with no signal."

## 3. Install on your phone

Three numbered cards. Show a screenshot of each step.

1. Open `https://akg.frappe.cloud/ess` in Chrome (Android) or Safari (iPhone).
2. Sign in with the email + password HR gave you.
3. **Android:** tap the install banner that appears at the bottom. **iPhone:** tap the **Share** button → **Add to Home Screen**.

Tip box: *"Once installed, open it from your home screen — it looks and feels like a normal app."*

## 4. The four tabs

Show one screen per tab as a phone mockup with the bottom nav highlighted:

| Tab | What it's for |
|---|---|
| **Attendance** | Check in / out, see today and the week. |
| **Leaves** | Your leave balance and submit a leave request. |
| **Petty Cash** *(only visible if you have petty cash)* | Submit receipts and request top-ups. |
| **Profile** | Your personal info, language, sign out. |

## 5. Check in / Check out

Two flows — **Site engineer** and **Office worker** — both presented side-by-side.

### Site engineer

1. Open the app.
2. The top of the screen shows the nearest project site and your distance.
3. **If you're inside the site zone** — tap the green **CHECK IN** button.
4. **If you're outside any zone** — tap the same button. A pop-up will ask: *which project are you working on?* and *why are you off-zone?* Fill it in and submit. Your day will go on hold until your manager approves.
5. To finish — tap **CHECK OUT**, pick the activity (Execution, Site Survey, etc.) and the task, then confirm.

### Office worker

1. Open the app and tap **CHECK IN** once when you arrive.
2. Tap **CHECK OUT** once when you leave.
3. That's it — only one check-in and one check-out per day.

Callout box: *"You can have multiple sessions on a site (lunch break, leave the site and come back). The app pairs them automatically."*

## 6. Submit a leave request

Six steps + screenshots:

1. Go to the **Leaves** tab.
2. Tap **+ New request**.
3. Pick the leave type (Annual, Sick, Casual, Hajj).
4. Pick **From** and **To** dates.
5. Write a short reason.
6. Tap **Submit**. Your manager sees it instantly.

Show what each status looks like (Pending / Approved / Rejected).

## 7. Submit a petty-cash receipt

Seven steps with screenshots — this is the most important section.

1. Go to the **Petty Cash** tab.
2. Tap **New claim**.
3. **Step 1 — Pick a project.** Choose which site this expense belongs to. If it's not for a site (parking, courier, etc.) pick **Other (no project)**.
4. **Step 2 — Tap "Scan receipt"** and take a photo of the bill. Or tap "Upload" to pick from your gallery.
5. The app reads the receipt and fills the date, vendor, amount, and category. **Check it. Fix anything that's wrong.**
6. To add another receipt for the same project, tap **Scan receipt** again. All receipts on a claim share one project.
7. Tap **Submit**.

Tip box: *"Got a real tax invoice with a TRN (15 digits)? Toggle 'Tax invoice' on and type the TRN — your VAT will be calculated automatically."*

## 8. Request a top-up

Three steps:

1. **Petty Cash** tab → tap **Request top-up**.
2. Type the amount and the reason.
3. **Submit.** Your manager approves; the accountant posts it as an Employee Advance.

## 9. Working without signal

Box on a single page with a Wi-Fi-off icon:

> "Bad signal on site? Keep using the app normally. Anything you do (check-in, leave request, expense claim) is saved on your phone. The moment your signal comes back, everything syncs automatically."

Show the offline banner at the top of the app and the small badge counter on the Wi-Fi icon.

## 10. Notifications

One screen showing the notifications panel. List the kinds of alerts:

- Leave approved / rejected
- Expense claim approved / paid
- Top-up approved / posted
- Document expiring (Emirates ID, visa, labour card)
- For managers: new leave / claim / off-zone violation

## 11. Profile + language

Two side-by-side phone mockups: **English** and **Arabic**.

Show how to:
- Tap the globe icon (top right) to flip language.
- Tap the avatar to open Profile.
- Tap **Sign out** at the bottom of Profile.

## 12. Quick FAQ

Four to six short Q+A pairs:

- **I forgot to check out yesterday — what do I do?** Tell your manager. They can fix it from their dashboard.
- **The app shows the wrong site.** Stand outside (clearer GPS), wait 10 seconds, pull down to refresh.
- **The receipt scan got the amount wrong.** Just tap the field and type the correct amount before submitting.
- **My leave / claim is stuck on "Pending".** Your manager hasn't reviewed it yet. Notifications will tell you when it changes.
- **I lost my password.** Contact HR — they'll reset it. Don't try to create a new account.

## 13. Need help?

One contact card: *IT helpdesk · email · phone*. (User to fill in real details before printing.)

---

## Design notes for Claude Design

- **Cover, section dividers, callouts**: navy `#0F1E33` background, hi-vis `#F2C012` accent stripe (think construction signage).
- **Body**: white background, `#0F172A` text, generous line height (1.55).
- **Phone mockups**: use a clean device frame (no brand logos). Render screens at 2× so they print sharp. Real screenshots from the live app are better than generic placeholders — capture them at `https://akg.frappe.cloud/ess` after signing in as a demo user.
- **Icons**: match the in-app set (stroke-based, 24×24, rounded line caps). Don't use emoji.
- **Arabic version**: mirror layout (RTL), keep the same illustrations but flip directional arrows. Numbers stay in Western digits unless the rest of the document uses Arabic-Indic.
- **No screenshots of admin / desk views.** Everything must be from the user app at `/ess` only.
- **Page count target**: 10–14 pages each language. Two-column layouts where possible to keep it skim-friendly.

## Source assets to reuse

Available in this repo at `akg_ess/public/`:

- `assets/akg-logo.png` — wordmark for cover and footers.
- `assets/icon-512.png` — app icon (use on the cover and the install page).
- `styles.css` — full design tokens (navy/ink/hi-vis scale, type sizes) so the PDF matches the app exactly.
- `data.js` (`window.STRINGS`) — every label in EN + AR. Pull copy from there to keep wording identical to what users see in the app.

## Output

- `AKG_ESS_User_Guide_EN.pdf`
- `AKG_ESS_User_Guide_AR.pdf`

Print-ready (300 dpi, A4, embedded fonts). Also ship the editable source so HR can swap in real photos and the helpdesk contact later.
