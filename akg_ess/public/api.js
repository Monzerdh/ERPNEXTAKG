// AKG ESS — Frappe REST client.
// All calls are same-origin (the PWA is served from the Frappe site itself
// at /ess, so /api/... resolves to the same host). The session cookie set by
// /api/method/login carries through automatically with `credentials: 'include'`.
//
// Every method below maps 1:1 to a Frappe DocType / whitelisted method.
// Custom DocTypes used:
//   - Geofence Violation        (akg_ess)
//   - ESS Notification          (akg_ess)
//   - Petty Cash Top-up Request (akg_ess)
// Custom fields on standard DocTypes:
//   - Project: site_latitude, site_longitude, site_radius_meters
//   - Employee Checkin: latitude, longitude, accuracy_m, project, local_id
//   - Leave Application / Expense Claim: local_id (idempotency)

(function () {
  // ───────────────────────────────────────────────────────────────────
  // HTTP helpers
  // ───────────────────────────────────────────────────────────────────
  function getCsrfToken() {
    if (window.csrf_token) return window.csrf_token;
    const m = document.cookie.match(/csrf_token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  async function http(method, path, { body, params, isForm } = {}) {
    let url = path;
    if (params && Object.keys(params).length) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null) continue;
        qs.append(k, typeof v === 'string' ? v : JSON.stringify(v));
      }
      url += (url.includes('?') ? '&' : '?') + qs.toString();
    }

    const headers = { 'X-Frappe-CSRF-Token': getCsrfToken() || '', 'Accept': 'application/json' };
    let payload;
    if (body !== undefined) {
      if (isForm) {
        payload = body;
      } else {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      }
    }

    const res = await fetch(url, { method, headers, credentials: 'include', body: payload });

    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) data = await res.json().catch(() => null);
    else data = await res.text().catch(() => null);

    if (!res.ok) {
      const msg = (data && (data._server_messages || data.exception || data.message)) || res.statusText;
      const err = new Error(typeof msg === 'string' ? msg : `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  const get = (path, params) => http('GET', path, { params });
  const post = (path, body) => http('POST', path, { body });
  const put = (path, body) => http('PUT', path, { body });

  function listResource(doctype, { filters, fields, orderBy, limit, start } = {}) {
    const params = {};
    if (filters) params.filters = filters;
    if (fields) params.fields = fields;
    if (orderBy) params.order_by = orderBy;
    if (limit !== undefined) params.limit_page_length = limit;
    if (start !== undefined) params.limit_start = start;
    return get(`/api/resource/${encodeURIComponent(doctype)}`, params).then((r) => (r && r.data) || []);
  }
  function insertResource(doctype, doc) {
    return post(`/api/resource/${encodeURIComponent(doctype)}`, doc).then((r) => r && r.data);
  }
  function updateResource(doctype, name, patch) {
    return put(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`, patch).then((r) => r && r.data);
  }
  function callMethod(method, args) {
    return post(`/api/method/${method}`, args || {}).then((r) => (r && 'message' in r ? r.message : r));
  }

  // ───────────────────────────────────────────────────────────────────
  // Misc helpers
  // ───────────────────────────────────────────────────────────────────
  function dataUrlToFile(dataUrl, filename) {
    const idx = dataUrl.indexOf(',');
    if (idx < 0) throw new Error('not a data URL');
    const header = dataUrl.slice(0, idx);
    const b64 = dataUrl.slice(idx + 1);
    const m = /data:([^;]+);base64/i.exec(header);
    const mime = m ? m[1] : 'image/jpeg';
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], filename || 'receipt.jpg', { type: mime });
  }

  let _pettyDefaultsCache = null;
  async function loadPettyDefaults() {
    if (_pettyDefaultsCache) return _pettyDefaultsCache;
    try {
      const r = await callMethod('akg_ess.api.get_petty_defaults');
      _pettyDefaultsCache = r || {};
    } catch (e) {
      _pettyDefaultsCache = { vat_account: '', vat_rate: 5, vat_description: 'VAT 5%' };
    }
    return _pettyDefaultsCache;
  }

  // ───────────────────────────────────────────────────────────────────
  // Cached lookups
  // ───────────────────────────────────────────────────────────────────
  let _currentUserCache = null;

  async function loadCurrentUser() {
    if (_currentUserCache) return _currentUserCache;
    // Single-shot bootstrap on the server — avoids querying Has Role
    // (a child table) over REST and saves round-trips.
    // Probe the session. IMPORTANT: only a real 401/403 means "not signed
    // in". A network blip / timeout / 5xx (e.g. a cold Frappe Cloud worker)
    // must NOT be treated as a logout — rethrow it with its real status so
    // the bootstrap can retry instead of bouncing a valid session to login.
    let profile;
    try {
      profile = await callMethod('akg_ess.api.get_session_profile');
    } catch (e) {
      const err = new Error('session probe failed');
      err.status = (e && typeof e.status === 'number') ? e.status : 0; // 0 = network/unknown
      err.transient = err.status === 0 || err.status >= 500;
      throw err;
    }
    if (!profile || !profile.signed_in) {
      const err = new Error('Not signed in');
      err.status = 401;
      throw err;
    }

    const initials = (profile.employee_name || profile.full_name || profile.user || 'U')
      .split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase();

    _currentUserCache = {
      employee: profile.employee || null,
      employee_name: profile.employee_name || profile.full_name || profile.user,
      designation: profile.designation || '',
      department: profile.department || '',
      company: profile.company || '',
      user_id: profile.user,
      is_manager: !!profile.is_manager,
      reports_to: profile.reports_to || null,
      reports_to_name: profile.reports_to_name || '',
      is_office_worker: !!profile.is_office_worker,
      has_petty_cash: !!profile.has_petty_cash,
      default_scope_of_work: profile.default_scope_of_work || '',
      cell_number: profile.cell_number || '',
      date_of_joining: profile.date_of_joining || '',
      avatar_initials: initials || 'U',
      image: profile.user_image || '',
      roles: profile.roles || [],
      leave_approver: profile.leave_approver || null,
      leave_approver_name: profile.leave_approver_name || '',
      expense_approver: profile.expense_approver || null,
      expense_approver_name: profile.expense_approver_name || '',
    };
    window.CURRENT_USER = _currentUserCache;
    return _currentUserCache;
  }

  // IMPORTANT: stamp times in LOCAL (device) time, not UTC. The ERPNext
  // site runs in Asia/Dubai and stores naive local datetimes; sending
  // toISOString() (UTC) made check-ins and violations land 4h apart and
  // broke event ordering + hours. getHours()/getDate() use the device tz,
  // which for AKG matches the site.
  const _pad = (n) => String(n).padStart(2, '0');
  const nowDatetime = () => {
    const d = new Date();
    return `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())} ${_pad(d.getHours())}:${_pad(d.getMinutes())}:${_pad(d.getSeconds())}`;
  };
  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}`;
  };
  const localId = () => `LID-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Stable per-leave-type accent.  Standard names (Annual / Sick / Casual /
  // Hajj / Maternity / Compensatory / LWP) get hand-picked colours that
  // match the AKG ESS palette.  Anything else is hashed into a 7-colour
  // fallback so similar names always get the same swatch.
  function leaveTypeColor(name) {
    const lower = (name || '').toLowerCase();
    if (lower.includes('annual'))                                  return '#1E40AF'; // blue
    if (lower.includes('sick'))                                    return '#B91C1C'; // red
    if (lower.includes('casual'))                                  return '#15803D'; // green
    if (lower.includes('hajj') || lower.includes('umrah'))         return '#7C3AED'; // purple
    if (lower.includes('matern') || lower.includes('patern'))      return '#DB2777'; // pink
    if (lower.includes('compensatory') || lower.includes('comp '))  return '#EA580C'; // orange
    if (lower.includes('lwp') || lower.includes('without pay'))    return '#64748B'; // slate
    if (lower.includes('study') || lower.includes('education'))    return '#0E7490'; // teal
    let h = 0;
    for (const ch of name || '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const palette = ['#1E40AF', '#B91C1C', '#15803D', '#7C3AED', '#DB2777', '#EA580C', '#0E7490'];
    return palette[h % palette.length];
  }

  // ───────────────────────────────────────────────────────────────────
  // window.frappe (1:1 with the prototype's surface)
  // ───────────────────────────────────────────────────────────────────
  window.frappe = {
    // ─── Auth ────────────────────────────────────────────────────────
    async login(usr, pwd) {
      const r = await post('/api/method/login', { usr, pwd });
      _currentUserCache = null;
      const u = await loadCurrentUser().catch(() => null);
      return { full_name: (r && r.full_name) || (u && u.employee_name), user: usr };
    },

    async logout() {
      try { await get('/api/method/logout'); } catch (e) {}
      _currentUserCache = null;
      window.CURRENT_USER = null;
    },

    async getCurrentUser() { return loadCurrentUser(); },

    // ─── Sites / Projects ────────────────────────────────────────────
    async getActiveSites() {
      const u = await loadCurrentUser();
      let rows = [];
      if (u.employee) {
        rows = await listResource('Project', {
          filters: [['Project Employee', 'employee', '=', u.employee]],
          fields: ['name', 'project_name', 'customer', 'site_latitude', 'site_longitude', 'site_radius_meters', 'cost_center'],
          limit: 0,
        }).catch(() => []);
      }
      if (!rows.length) {
        rows = await listResource('Project', {
          filters: [['status', '=', 'Open'], ['site_latitude', 'is', 'set']],
          fields: ['name', 'project_name', 'customer', 'site_latitude', 'site_longitude', 'site_radius_meters', 'cost_center'],
          limit: 50,
        }).catch(() => []);
      }
      return rows.map((p) => ({
        name: p.name,
        project_name: p.project_name || p.name,
        client: p.customer || '',
        site_address: '',
        site_latitude: p.site_latitude, site_longitude: p.site_longitude,
        site_radius_meters: p.site_radius_meters || 200,
        lat: p.site_latitude, lng: p.site_longitude, radius_m: p.site_radius_meters || 200,
        cost_center: p.cost_center || '',
        color: '#475569',
      }));
    },

    // Every active Project, regardless of whether it has GPS/geofence
    // configured. Powers the petty-cash project picker — engineers may
    // need to file expenses against admin/back-office projects too.
    async getAllActiveProjects() {
      const rows = await listResource('Project', {
        filters: [['status', '=', 'Open']],
        fields: ['name', 'project_name', 'customer', 'cost_center'],
        orderBy: 'project_name asc',
        limit: 0,
      }).catch(() => []);
      return rows.map((p) => ({
        name: p.name,
        project_name: p.project_name || p.name,
        client: p.customer || '',
        cost_center: p.cost_center || '',
      }));
    },

    // ─── Attendance / Checkin ────────────────────────────────────────
    async getMyCheckins({ fromDate, toDate, limit = 30 } = {}) {
      const u = await loadCurrentUser();
      if (!u.employee) return [];
      const filters = [['employee', '=', u.employee]];
      if (fromDate) filters.push(['time', '>=', fromDate]);
      if (toDate)   filters.push(['time', '<=', toDate]);
      return listResource('Employee Checkin', {
        filters,
        fields: ['name', 'log_type', 'time', 'latitude', 'longitude', 'accuracy_m', 'project', 'activity_type', 'scope_of_work', 'device_id'],
        orderBy: 'time desc',
        limit,
      });
    },

    async createCheckin({ log_type, latitude, longitude, project, accuracy, time, activity_type, scope_of_work, _localId }) {
      const u = await loadCurrentUser();
      return insertResource('Employee Checkin', {
        employee: u.employee,
        log_type,
        time: time || nowDatetime(),
        latitude, longitude,
        accuracy_m: accuracy,
        project: project || null,
        // OUT rows carry the engineer's check-out selections. Persisted
        // via custom fields on Employee Checkin (see fixtures).
        activity_type: activity_type || null,
        scope_of_work: scope_of_work || null,
        device_id: 'ESS-MOBILE',
        // Exclude from HRMS shift auto-attendance — ESS posts Attendance
        // itself on check-out, with no shift dependency.
        skip_auto_attendance: 1,
        local_id: _localId || localId(),
      });
    },

    async getActivityTypes() {
      // Standard ERPNext Activity Type only grants read perm to "Projects User".
      // Route through the whitelisted server method so PWA users without that
      // role still see the list.
      const r = await callMethod('akg_ess.api.get_activity_types').catch(() => []);
      return Array.isArray(r) ? r : [];
    },

    async getProjectTasks(project) {
      // Same rationale as getActivityTypes — Task requires Projects User.
      const r = await callMethod('akg_ess.api.get_project_tasks', { project: project || null }).catch(() => []);
      return Array.isArray(r) ? r : [];
    },

    async getScopesOfWork() {
      // Custom 'Scope of Work' master — read via whitelisted method so
      // ESS-only users (no desk role) get the list at check-out.
      const r = await callMethod('akg_ess.api.get_scopes_of_work').catch(() => []);
      return Array.isArray(r) ? r : [];
    },

    // ─── Geofence violations ─────────────────────────────────────────
    async getGeofenceViolations() {
      return listResource('Geofence Violation', {
        fields: ['name', 'employee', 'employee_name', 'log_type', 'time', 'date', 'latitude', 'longitude',
                 'accuracy_m', 'distance_m', 'nearest_site', 'selected_project', 'reason', 'status',
                 'manager_notes', 'approver', 'approved_on', 'linked_checkin'],
        orderBy: 'time desc',
        limit: 100,
      }).catch(() => []);
    },

    async getPendingViolations() {
      return listResource('Geofence Violation', {
        filters: [['status', '=', 'Pending']],
        fields: ['name', 'employee', 'employee_name', 'log_type', 'time', 'date', 'latitude', 'longitude',
                 'accuracy_m', 'distance_m', 'nearest_site', 'selected_project', 'reason'],
        orderBy: 'time desc',
        limit: 100,
      }).catch(() => []);
    },

    async getMyViolations() {
      const u = await loadCurrentUser();
      if (!u.employee) return [];
      return listResource('Geofence Violation', {
        filters: [['employee', '=', u.employee]],
        fields: ['name', 'employee', 'employee_name', 'log_type', 'time', 'date', 'distance_m', 'nearest_site',
                 'selected_project', 'scope_of_work', 'reason', 'status', 'manager_notes', 'approver',
                 'approved_on', 'linked_checkin'],
        orderBy: 'time desc',
        limit: 50,
      }).catch(() => []);
    },

    // Manager queue — my team's off-zone requests only (never my own).
    async getTeamViolations() {
      const r = await callMethod('akg_ess.api.get_team_violations').catch(() => []);
      return Array.isArray(r) ? r : [];
    },

    async createViolation({ log_type, distance_m, nearest_site, selected_project, scope_of_work, reason, actual_lat, actual_lng, accuracy, linked_checkin, _localId }) {
      const u = await loadCurrentUser();
      return insertResource('Geofence Violation', {
        employee: u.employee,
        log_type,
        time: nowDatetime(),
        date: todayISO(),
        latitude: actual_lat,
        longitude: actual_lng,
        accuracy_m: accuracy,
        distance_m,
        nearest_site, selected_project,
        scope_of_work: scope_of_work || null,
        reason,
        status: 'Pending',
        linked_checkin: linked_checkin || null,
        local_id: _localId || localId(),
      });
    },

    async approveViolation(name, comment) {
      return updateResource('Geofence Violation', name, { status: 'Approved', manager_notes: comment || '' });
    },

    async rejectViolation(name, comment) {
      return updateResource('Geofence Violation', name, { status: 'Rejected', manager_notes: comment || 'Rejected' });
    },

    async getDayHoldStatus(employee, date) {
      const rows = await listResource('Geofence Violation', {
        filters: [['employee', '=', employee], ['date', '=', date]],
        fields: ['status'],
        limit: 0,
      }).catch(() => []);
      if (!rows.length) return 'clear';
      if (rows.some((v) => v.status === 'Pending'))   return 'pending';
      if (rows.every((v) => v.status === 'Approved')) return 'approved';
      if (rows.some((v) => v.status === 'Rejected'))  return 'rejected';
      return 'clear';
    },

    // ─── Leaves ──────────────────────────────────────────────────────
    async getLeavePeriod() {
      try {
        const rows = await listResource('Leave Period', {
          filters: [['is_active', '=', 1]],
          fields: ['name', 'from_date', 'to_date'],
          orderBy: 'from_date desc',
          limit: 1,
        });
        if (rows.length) return { from_date: rows[0].from_date, to_date: rows[0].to_date, label: rows[0].name };
      } catch (e) {}
      const y = new Date().getFullYear();
      return { from_date: `${y}-01-01`, to_date: `${y}-12-31`, label: `Jan – Dec ${y}` };
    },

    async getLeaveBalances() {
      const u = await loadCurrentUser();
      if (!u.employee) return [];
      const today = todayISO();
      const allocs = await listResource('Leave Allocation', {
        filters: [['employee', '=', u.employee], ['from_date', '<=', today], ['to_date', '>=', today], ['docstatus', '=', 1]],
        fields: ['leave_type', 'total_leaves_allocated', 'unused_leaves', 'from_date', 'to_date'],
        limit: 0,
      }).catch(() => []);
      const out = [];
      for (const a of allocs) {
        let bal = a.total_leaves_allocated;
        try {
          const r = await callMethod('hrms.hr.doctype.leave_application.leave_application.get_leave_balance_on', {
            employee: u.employee, leave_type: a.leave_type, date: today,
          });
          if (typeof r === 'number') bal = r;
          else if (r && typeof r.leave_balance === 'number') bal = r.leave_balance;
        } catch (e) {}
        const pending = await listResource('Leave Application', {
          filters: [['employee', '=', u.employee], ['leave_type', '=', a.leave_type], ['status', '=', 'Open']],
          fields: ['total_leave_days'],
          limit: 0,
        }).catch(() => []);
        const leaves_pending_approval = pending.reduce((s, r) => s + (parseFloat(r.total_leave_days) || 0), 0);
        const taken = await listResource('Leave Application', {
          filters: [['employee', '=', u.employee], ['leave_type', '=', a.leave_type], ['status', '=', 'Approved'], ['docstatus', '=', 1]],
          fields: ['total_leave_days'],
          limit: 0,
        }).catch(() => []);
        const leaves_taken = taken.reduce((s, r) => s + (parseFloat(r.total_leave_days) || 0), 0);
        out.push({
          leave_type: a.leave_type,
          total_leaves_allocated: a.total_leaves_allocated,
          leaves_taken,
          leaves_pending_approval,
          leave_balance: bal,
          // Visual metadata used by the BalanceCard component:
          //  - color is a stable per-leave-type accent driving the left
          //    strip, the big-number colour, and the progress-bar fill.
          //  - carry_forward is the Leave Allocation's unused_leaves count
          //    rolled over from the previous period.  Renders as '+N CF'.
          //  - allow_half_day toggles the '½-day' chip; we always show it
          //    because Leave Application supports half-day on every type.
          color: leaveTypeColor(a.leave_type),
          carry_forward: parseFloat(a.unused_leaves) || 0,
          allow_half_day: true,
        });
      }
      return out;
    },

    async getMyLeaves() {
      const u = await loadCurrentUser();
      if (!u.employee) return [];
      return listResource('Leave Application', {
        filters: [['employee', '=', u.employee]],
        fields: ['name', 'leave_type', 'from_date', 'to_date', 'half_day', 'half_day_date',
                 'total_leave_days', 'status', 'posting_date', 'leave_approver', 'leave_approver_name',
                 'leave_balance', 'description'],
        orderBy: 'posting_date desc',
        limit: 50,
      }).catch(() => []);
    },

    async getTeamLeaves() {
      const u = await loadCurrentUser();
      return listResource('Leave Application', {
        filters: [['leave_approver', '=', u.user_id], ['status', '=', 'Open']],
        fields: ['name', 'employee', 'employee_name', 'leave_type', 'from_date', 'to_date',
                 'half_day', 'total_leave_days', 'status', 'posting_date', 'description'],
        orderBy: 'posting_date desc',
        limit: 100,
      }).catch(() => []);
    },

    async submitLeave({ leave_type, from_date, to_date, half_day, half_day_date, description, _localId }) {
      const u = await loadCurrentUser();
      const doc = {
        employee: u.employee,
        leave_type, from_date, to_date,
        half_day: half_day ? 1 : 0,
        half_day_date: half_day ? half_day_date : null,
        status: 'Open',
        description: description || '',
        company: u.company,
        local_id: _localId || localId(),
      };
      // Attach the approver from the Employee record so the request actually
      // routes to a person in HRMS (otherwise the field is empty and the
      // approval queue never sees it).
      if (u.leave_approver) {
        doc.leave_approver = u.leave_approver;
        if (u.leave_approver_name) doc.leave_approver_name = u.leave_approver_name;
      }
      return insertResource('Leave Application', doc);
    },

    async approveLeave(name, comment) {
      const updated = await updateResource('Leave Application', name, { status: 'Approved', docstatus: 1 });
      if (comment) {
        await callMethod('frappe.client.insert', {
          doc: { doctype: 'Comment', comment_type: 'Comment', reference_doctype: 'Leave Application', reference_name: name, content: comment },
        }).catch(() => {});
      }
      return updated;
    },

    async rejectLeave(name, comment) {
      const updated = await updateResource('Leave Application', name, { status: 'Rejected', docstatus: 1 });
      if (comment) {
        await callMethod('frappe.client.insert', {
          doc: { doctype: 'Comment', comment_type: 'Comment', reference_doctype: 'Leave Application', reference_name: name, content: comment },
        }).catch(() => {});
      }
      return updated;
    },

    // ─── Petty Cash / Expense Claim ──────────────────────────────────
    async getPettyBalance() {
      const u = await loadCurrentUser();
      if (!u.employee) return { advance: 0, spent: 0, available: 0, currency: 'AED' };
      const advances = await listResource('Employee Advance', {
        filters: [['employee', '=', u.employee], ['docstatus', '=', 1], ['status', 'in', ['Paid', 'Unpaid', 'Partly Claimed']]],
        fields: ['advance_amount', 'paid_amount', 'claimed_amount', 'currency'],
        limit: 0,
      }).catch(() => []);
      let advance = 0, spent = 0, currency = 'AED';
      for (const a of advances) {
        advance += parseFloat(a.advance_amount) || 0;
        spent += parseFloat(a.claimed_amount) || 0;
        if (a.currency) currency = a.currency;
      }
      return { advance, spent, available: Math.max(0, advance - spent), currency };
    },

    async getMyClaims() {
      const u = await loadCurrentUser();
      if (!u.employee) return [];
      return listResource('Expense Claim', {
        filters: [['employee', '=', u.employee]],
        fields: ['name', 'employee', 'employee_name', 'posting_date', 'cost_center',
                 'total_claimed_amount', 'total_sanctioned_amount', 'currency',
                 'approval_status', 'status'],
        orderBy: 'posting_date desc',
        limit: 50,
      }).catch(() => []);
    },

    async getTeamClaims() {
      const u = await loadCurrentUser();
      return listResource('Expense Claim', {
        filters: [['expense_approver', '=', u.user_id], ['approval_status', '=', 'Draft']],
        fields: ['name', 'employee', 'employee_name', 'posting_date',
                 'total_claimed_amount', 'currency', 'approval_status'],
        orderBy: 'posting_date desc',
        limit: 100,
      }).catch(() => []);
    },

    async getExpenseClaimTypes() {
      return listResource('Expense Claim Type', { fields: ['name'], limit: 0 }).catch(() => []);
    },

    // ─── Missed Check-out ────────────────────────────────────────────
    // Server-side scheduler creates a 'Missed Checkout' row at midnight
    // for any unmatched IN > 12h old. The employee resolves it via the
    // self-rectify modal; the manager approves/rejects from Profile.
    async getMyMissedCheckoutHold() {
      try {
        return await callMethod('akg_ess.api.get_my_missed_checkout_hold');
      } catch (e) { return null; }
    },
    async getMyPendingMissedCheckouts() {
      const u = await loadCurrentUser();
      if (!u.employee) return [];
      try {
        const r = await callMethod('akg_ess.api.get_my_pending_missed_checkouts');
        return Array.isArray(r) ? r : [];
      } catch (e) { return []; }
    },
    async getMissedCheckouts() {
      try {
        const r = await callMethod('akg_ess.api.get_team_missed_checkouts');
        return Array.isArray(r) ? r : [];
      } catch (e) { return []; }
    },
    async getMyMissedCheckouts() {
      try {
        const r = await callMethod('akg_ess.api.get_my_missed_checkouts');
        return Array.isArray(r) ? r : [];
      } catch (e) { return []; }
    },
    async submitMissedCheckout(name, { proposed_out_time, reason } = {}) {
      return callMethod('akg_ess.api.submit_missed_checkout', {
        name, proposed_out_time, reason: reason || '',
      });
    },
    async approveMissedCheckout(name, { edited_out_time, comment } = {}) {
      return callMethod('akg_ess.api.approve_missed_checkout', {
        name, edited_out_time: edited_out_time || '', comment: comment || '',
      });
    },
    async rejectMissedCheckout(name, comment) {
      return callMethod('akg_ess.api.reject_missed_checkout', {
        name, comment: comment || '',
      });
    },

    async submitClaim(claim) {
      const u = await loadCurrentUser();
      const rawRows = claim.expenses || [];

      // Parent.project: only when every row agrees on a single project.
      // Mixed claims (or any '__other__' row) leave the parent blank.
      const projects = rawRows.map((e) => e.project).filter((p) => p && p !== '__other__');
      const uniqueProjects = [...new Set(projects)];
      const hasOther = rawRows.some((e) => e.project === '__other__');
      const parentProject = (uniqueProjects.length === 1 && !hasOther) ? uniqueProjects[0] : null;

      const expenses = rawRows.map((e) => ({
        expense_date: e.expense_date || claim.posting_date || todayISO(),
        expense_type: e.expense_type,
        description: e.description || '',
        amount: parseFloat(e.amount) || 0,
        sanctioned_amount: parseFloat(e.amount) || 0,
        cost_center: e.cost_center || claim.cost_center,
        // Per-row project. '__other__' is a UI sentinel for unlinked
        // expenses (parking, courier, fuel between sites) — sent as null.
        project: (e.project && e.project !== '__other__') ? e.project : null,
      }));
      const total = expenses.reduce((s, e) => s + (e.amount || 0), 0);

      // Build Expense Taxes & Charges from VAT-included rows. Requires
      // an admin to set "Default VAT Account" in AKG ESS Settings.
      const defaults = await loadPettyDefaults();
      const taxes = [];
      if (defaults.vat_account) {
        const rate = defaults.vat_rate || 5;
        const vatAmount = rawRows
          .filter((e) => e.vat_included)
          .reduce((s, e) => s + ((parseFloat(e.amount) || 0) * rate / (100 + rate)), 0);
        if (vatAmount > 0) {
          taxes.push({
            account_head: defaults.vat_account,
            description: defaults.vat_description || `VAT ${rate}%`,
            rate,
            tax_amount: Math.round(vatAmount * 100) / 100,
          });
        }
      }

      const doc = {
        employee: u.employee,
        posting_date: claim.posting_date || todayISO(),
        company: u.company,
        cost_center: claim.cost_center || null,
        project: parentProject,
        approval_status: 'Draft',
        total_claimed_amount: total,
        total_sanctioned_amount: total,
        expenses,
        local_id: claim._localId || localId(),
      };
      if (u.expense_approver) doc.expense_approver = u.expense_approver;
      if (taxes.length) doc.taxes = taxes;

      const created = await insertResource('Expense Claim', doc);

      // Upload each row's receipt image as an attachment on the Expense
      // Claim. Rows carry their bill as a base64 data URL (so the offline
      // outbox can hold them without a server round-trip).
      for (const e of rawRows) {
        if (e.attachment_url && typeof e.attachment_url === 'string' && e.attachment_url.startsWith('data:')) {
          try {
            const file = dataUrlToFile(e.attachment_url, e.attachment || 'receipt.jpg');
            await window.frappe.uploadFile(file, {
              isPrivate: true,
              doctype: 'Expense Claim',
              docname: created.name,
            });
          } catch (err) {
            // Don't fail the whole claim if one attachment upload fails;
            // the row data is already saved and admins can attach manually.
          }
        }
      }

      return created;
    },

    async uploadFile(file, { isPrivate = true, doctype, docname } = {}) {
      const fd = new FormData();
      fd.append('file', file, file.name || 'upload');
      fd.append('is_private', isPrivate ? '1' : '0');
      if (doctype) fd.append('doctype', doctype);
      if (docname) fd.append('docname', docname);
      fd.append('folder', 'Home/Attachments');
      const r = await http('POST', '/api/method/upload_file', { body: fd, isForm: true });
      return (r && r.message) || null;
    },

    async approveClaim(name, comment) {
      const updated = await updateResource('Expense Claim', name, { approval_status: 'Approved', docstatus: 1 });
      if (comment) {
        await callMethod('frappe.client.insert', {
          doc: { doctype: 'Comment', comment_type: 'Comment', reference_doctype: 'Expense Claim', reference_name: name, content: comment },
        }).catch(() => {});
      }
      return updated;
    },

    async rejectClaim(name, comment) {
      const updated = await updateResource('Expense Claim', name, { approval_status: 'Rejected', docstatus: 1 });
      if (comment) {
        await callMethod('frappe.client.insert', {
          doc: { doctype: 'Comment', comment_type: 'Comment', reference_doctype: 'Expense Claim', reference_name: name, content: comment },
        }).catch(() => {});
      }
      return updated;
    },

    async requestTopup(amount, reason) {
      const u = await loadCurrentUser();
      return insertResource('Petty Cash Top-up Request', {
        employee: u.employee,
        request_date: todayISO(),
        amount: parseFloat(amount) || 0,
        currency: 'AED',
        reason: reason || '',
        status: 'Pending',
      });
    },

    async getMyTopups() {
      const u = await loadCurrentUser();
      if (!u.employee) return [];
      return listResource('Petty Cash Top-up Request', {
        filters: [['employee', '=', u.employee]],
        fields: ['name', 'employee', 'employee_name', 'request_date', 'amount', 'currency', 'reason', 'status', 'approver_comment', 'approved_on'],
        orderBy: 'request_date desc',
        limit: 50,
      }).catch(() => []);
    },

    async getTeamTopups() {
      return listResource('Petty Cash Top-up Request', {
        filters: [['status', '=', 'Pending']],
        fields: ['name', 'employee', 'employee_name', 'request_date', 'amount', 'currency', 'reason', 'status'],
        orderBy: 'request_date asc',
        limit: 100,
      }).catch(() => []);
    },

    async approveTopup(name, comment) {
      const u = await loadCurrentUser();
      return updateResource('Petty Cash Top-up Request', name, {
        status: 'Approved',
        approver: u.user_id,
        approver_comment: comment || '',
        approved_on: todayISO(),
      });
    },

    async rejectTopup(name, comment) {
      const u = await loadCurrentUser();
      return updateResource('Petty Cash Top-up Request', name, {
        status: 'Rejected',
        approver: u.user_id,
        approver_comment: comment || 'Rejected',
        approved_on: todayISO(),
      });
    },

    // ─── OCR (server-side proxy to Anthropic) ────────────────────────
    async extractReceipt(dataUrl) {
      try {
        const r = await callMethod('akg_ess.api.extract_receipt', { data_url: dataUrl });
        if (r && r.vendor) return r;
      } catch (e) { /* fall through */ }
      return {
        vendor: '', amount: 0, date: todayISO(),
        expense_type: 'Other', description: '',
        vat_included: false, is_tax_invoice: false,
        trn: '', invoice_number: '', vat_amount: 0,
      };
    },

    // ─── Monthly Attendance Report ───────────────────────────────────
    async getMonthlyAttendance(employee, year, month) {
      const from = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      const checkins = await listResource('Employee Checkin', {
        filters: [['employee', '=', employee], ['time', '>=', `${from} 00:00:00`], ['time', '<=', `${to} 23:59:59`]],
        fields: ['log_type', 'time', 'project'],
        orderBy: 'time asc',
        limit: 0,
      }).catch(() => []);
      const leaves = await listResource('Leave Application', {
        filters: [['employee', '=', employee], ['status', '=', 'Approved'],
                  ['from_date', '<=', to], ['to_date', '>=', from]],
        fields: ['from_date', 'to_date', 'half_day', 'half_day_date'],
        limit: 0,
      }).catch(() => []);
      const violations = await listResource('Geofence Violation', {
        filters: [['employee', '=', employee], ['date', '>=', from], ['date', '<=', to]],
        fields: ['date', 'status'],
        limit: 0,
      }).catch(() => []);
      // Authoritative per-day status (Present / Pending Approval / Absent),
      // computed server-side on check-out. When a row exists for a day, its
      // status wins over the raw checkin/violation re-derivation below.
      const attendance = await listResource('ESS Daily Attendance', {
        filters: [['employee', '=', employee], ['date', '>=', from], ['date', '<=', to]],
        fields: ['date', 'status', 'total_hours', 'check_in_time'],
        limit: 0,
      }).catch(() => []);
      return _buildMonthlyReport(employee, year, month, { checkins, leaves, violations, attendance });
    },

    // ─── Team / Org ──────────────────────────────────────────────────
    async getTeam() {
      // Whitelisted — returns direct reports + today's live status
      // (today_status: 'in' | 'out' | 'none') + avatar_initials.
      const r = await callMethod('akg_ess.api.get_team').catch(() => []);
      return Array.isArray(r) ? r : [];
    },

    // ─── Notifications ───────────────────────────────────────────────
    async getNotifications(role = 'employee') {
      const rows = await listResource('ESS Notification', {
        fields: ['name', 'kind', 'title', 'body', 'target_tab', 'target_id', 'is_read', 'creation', 'for_role'],
        orderBy: 'creation desc',
        limit: 50,
      }).catch(() => []);
      return rows.map((n) => ({
        name: n.name,
        kind: n.kind || 'info',
        title_key: n.title,
        body: n.body,
        target: { tab: n.target_tab, id: n.target_id },
        time: (n.creation || '').replace('T', ' ').slice(0, 19),
        read: !!n.is_read,
        for_role: n.for_role,
      }));
    },

    async markNotificationRead(name) {
      return updateResource('ESS Notification', name, { is_read: 1, read_on: nowDatetime() }).catch(() => null);
    },

    async markAllNotificationsRead() {
      const rows = await listResource('ESS Notification', {
        filters: [['is_read', '=', 0]], fields: ['name'], limit: 0,
      }).catch(() => []);
      await Promise.all(rows.map((r) => updateResource('ESS Notification', r.name, { is_read: 1, read_on: nowDatetime() }).catch(() => null)));
    },

    async pushNotification({ kind, title_key, body, target }) {
      const u = await loadCurrentUser();
      return insertResource('ESS Notification', {
        recipient: u.employee,
        for_role: u.is_manager ? 'manager' : 'employee',
        kind: kind || 'info',
        title: title_key || '',
        body: body || '',
        target_tab: (target && target.tab) || '',
        target_id: (target && target.id) || '',
        is_read: 0,
      }).catch(() => null);
    },

    // ─── Hydrate legacy globals ──────────────────────────────────────
    // Several JSX components still read window.SITES / window.LEAVE_BALANCES
    // / window.EXPENSE_CLAIM_TYPES / window.ACTIVITY_TYPES synchronously.
    // The app shell calls this once after login so those reads see real
    // data. Components that need fresh values still call frappe.* directly.
    async hydrateLegacyGlobals() {
      const [sites, projects, claimTypes, leaveBalances, activityTypes] = await Promise.all([
        window.frappe.getActiveSites().catch(() => []),
        window.frappe.getAllActiveProjects().catch(() => []),
        window.frappe.getExpenseClaimTypes().catch(() => []),
        window.frappe.getLeaveBalances().catch(() => []),
        window.frappe.getActivityTypes().catch(() => []),
      ]);
      window.SITES = sites;
      // PROJECTS = all active Projects (GPS-equipped or not). Used by
      // petty.jsx for the claim project picker. SITES stays attendance-
      // specific because it requires geofence coordinates.
      window.PROJECTS = projects;
      window.EXPENSE_CLAIM_TYPES = claimTypes;
      window.LEAVE_BALANCES = leaveBalances;
      window.ACTIVITY_TYPES = activityTypes;
      // Pre-warm OSM tiles around each assigned site so the map renders
      // correctly on the user's first visit to a no-signal location.
      // Fire-and-forget — the SW caches each tile via its existing OSM
      // cache-first strategy.
      try { window.frappe.prewarmSiteTiles(sites); } catch (e) {}
      return { sites, projects, claimTypes, leaveBalances, activityTypes };
    },

    // ─── Offline helpers ─────────────────────────────────────────────
    // Tell a network-layer error (no signal / DNS / CORS) apart from a
    // server-layer error (HTTP 4xx/5xx with a response body).  Auto-queue
    // logic uses this to decide whether to drop the action into the
    // outbox vs. surface a real error to the user.
    isNetworkError(err) {
      if (!err) return false;
      if (typeof err.status === 'number') return err.status === 0;
      if (err.name === 'TypeError') return true;        // browser fetch() rejects with TypeError
      if (err.name === 'NetworkError') return true;
      if (typeof err.message === 'string') {
        return /failed to fetch|network|load failed|offline|no internet/i.test(err.message);
      }
      return false;
    },

    // Pre-fetch OSM tiles around each project geofence so the embedded
    // map in SiteHero works on first visit even if the user has no
    // signal there yet.  Strategy: 5x5 tile grid at zoom 14/15/16 around
    // each site (~75 tiles per site, ~1MB).  The browser SW caches each
    // response automatically (see sw.js OSM tile cache-first rule).
    prewarmSiteTiles(sites) {
      if (!Array.isArray(sites) || !sites.length) return;
      const lat2tile = (lat, z) => Math.floor(
        (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z)
      );
      const lon2tile = (lon, z) => Math.floor((lon + 180) / 360 * Math.pow(2, z));
      const subdomains = ['a', 'b', 'c'];
      let i = 0;
      for (const s of sites) {
        const lat = s.lat ?? s.site_latitude;
        const lng = s.lng ?? s.site_longitude;
        if (lat == null || lng == null) continue;
        for (const z of [14, 15, 16]) {
          const cx = lon2tile(lng, z);
          const cy = lat2tile(lat, z);
          for (let dx = -2; dx <= 2; dx++) {
            for (let dy = -2; dy <= 2; dy++) {
              const sub = subdomains[(i++) % 3];
              const url = `https://${sub}.tile.openstreetmap.org/${z}/${cx + dx}/${cy + dy}.png`;
              // Stagger fetches slightly to avoid hammering the OSM rate-limit.
              setTimeout(() => {
                fetch(url, { mode: 'cors', credentials: 'omit' }).catch(() => {});
              }, Math.min(15000, i * 8));
            }
          }
        }
      }
    },
  };

  // ─── Geo helpers ────────────────────────────────────────────────────
  window.geo = {
    distance(a, b) {
      const R = 6371000;
      const toRad = (d) => (d * Math.PI) / 180;
      const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
      const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
      return Math.round(2 * R * Math.asin(Math.sqrt(h)));
    },
    matchSite(userPos, sites) {
      let nearest = null, nearestDist = Infinity;
      for (const s of sites) {
        const d = this.distance(userPos, { lat: s.lat || s.site_latitude, lng: s.lng || s.site_longitude });
        const radius = s.radius_m || s.site_radius_meters || 200;
        if (d <= radius) return { site: s, distance: d, inside: true };
        if (d < nearestDist) { nearest = s; nearestDist = d; }
      }
      return { site: nearest, distance: nearestDist, inside: false };
    },

    async getCurrentPosition({ timeout = 10000 } = {}) {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) { reject(new Error('Geolocation not available')); return; }
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) }),
          (err) => reject(err),
          { enableHighAccuracy: true, timeout, maximumAge: 30000 },
        );
      });
    },

    _buildMonthlyAttendance(employee, year, month) {
      return _buildMonthlyReport(employee, year, month, { checkins: [], leaves: [], violations: [] });
    },
  };

  function _buildMonthlyReport(employee, year, month, { checkins, leaves, violations, attendance }) {
    const todayStr = new Date().toISOString().slice(0, 10);
    const last = new Date(year, month, 0).getDate();
    const days = [];
    let workDays = 0, presentDays = 0, totalMin = 0, lateDays = 0, pendingDays = 0, missedDays = 0;

    const violationByDate = {};
    for (const v of violations) {
      const k = (v.date || '').slice(0, 10);
      (violationByDate[k] = violationByDate[k] || []).push(v);
    }
    // Authoritative attendance rows keyed by date. Maps the DocType status
    // to the calendar's status vocabulary.
    const STATUS_MAP = {
      'Present': 'present', 'Pending Approval': 'pending', 'Absent': 'absent',
      'Checked In': 'present', 'Missed Checkout': 'missed',
    };
    const attByDate = {};
    for (const a of (attendance || [])) {
      const k = (a.date || '').slice(0, 10);
      if (k) attByDate[k] = a;
    }
    const leaveDays = new Set();
    for (const l of leaves) {
      const start = new Date(l.from_date), end = new Date(l.to_date);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        leaveDays.add(d.toISOString().slice(0, 10));
      }
    }
    const byDate = {};
    for (const c of checkins) {
      const k = (c.time || '').slice(0, 10);
      (byDate[k] = byDate[k] || []).push(c);
    }

    for (let d = 1; d <= last; d++) {
      const dt = new Date(year, month - 1, d);
      const iso = dt.toISOString().slice(0, 10);
      const dow = dt.getDay();
      // AKG default: Sunday is the only weekend day. Employees may still
      // work on Sundays — that path falls through to the IN/OUT logic
      // below and gets logged as 'present', no overtime calc here.
      const isWeekend = dow === 0;
      const isFuture = iso > todayStr;
      let status = 'absent', hours = 0, sessions = 0, inTime = null;

      const dayCheckins = (byDate[iso] || []).slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''));
      const hasViolation = (violationByDate[iso] || []).some((v) => v.status === 'Pending');
      const hasLeave = leaveDays.has(iso);
      const att = attByDate[iso];

      if (isFuture) status = 'future';
      else if (att) {
        // Authoritative server-computed status wins. 'Checked In' means an
        // open day: still in progress today, but a missed check-out once
        // the day is in the past.
        status = STATUS_MAP[att.status] || 'present';
        if (att.status === 'Checked In' && iso < todayStr) status = 'missed';
        hours = Math.round((parseFloat(att.total_hours) || 0) * 10) / 10;
        if (att.check_in_time) inTime = String(att.check_in_time).slice(11, 16);
        if (status === 'absent') {
          workDays++;
        } else if (status === 'missed') {
          workDays++;
          missedDays++;
        } else {
          presentDays++;
          workDays++;
          totalMin += (parseFloat(att.total_hours) || 0) * 60;
          if (status === 'pending') pendingDays++;
          if (inTime && inTime > '08:30') lateDays++;
        }
      }
      else if (isWeekend && !dayCheckins.length) status = 'weekend';
      else if (hasLeave) status = 'leave';
      else if (dayCheckins.length) {
        let sumMin = 0, sess = 0, lastIn = null;
        for (const c of dayCheckins) {
          if (c.log_type === 'IN') lastIn = new Date((c.time || '').replace(' ', 'T'));
          else if (c.log_type === 'OUT' && lastIn) {
            sumMin += Math.max(0, (new Date((c.time || '').replace(' ', 'T')) - lastIn) / 60000);
            sess++; lastIn = null;
          }
        }
        if (lastIn && iso === todayStr) {
          sumMin += Math.max(0, (Date.now() - lastIn) / 60000);
          sess++;
        }
        sessions = sess;
        hours = Math.round((sumMin / 60) * 10) / 10;
        const firstIn = dayCheckins.find((c) => c.log_type === 'IN');
        if (firstIn) inTime = (firstIn.time || '').slice(11, 16);
        if (firstIn && firstIn.time && firstIn.time.slice(11, 16) > '08:30') lateDays++;
        status = hasViolation ? 'pending' : 'present';
        if (hasViolation) pendingDays++;
        totalMin += sumMin;
        presentDays++;
        workDays++;
      } else if (hasViolation) {
        status = 'pending'; pendingDays++; workDays++;
      } else if (!isWeekend) {
        status = 'absent'; workDays++;
      }
      days.push({ date: iso, day: d, dow, status, hours, sessions, inTime });
    }

    return {
      employee, year, month, days,
      summary: {
        work_days: workDays,
        present_days: presentDays,
        absent_days: days.filter((x) => x.status === 'absent').length,
        leave_days: days.filter((x) => x.status === 'leave').length,
        late_days: lateDays,
        pending_days: pendingDays,
        missed_days: missedDays,
        total_hours: Math.round((totalMin / 60) * 10) / 10,
        avg_hours: presentDays ? Math.round((totalMin / 60 / presentDays) * 10) / 10 : 0,
        attendance_pct: workDays ? Math.round((presentDays / workDays) * 100) : 0,
      },
    };
  }
})();
