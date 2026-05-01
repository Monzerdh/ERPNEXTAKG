// Attendance — multi-session check-in/out with geofence + check-out popup (Activity / Task)
// + end-of-day Timesheet preview (gap-split equally across sessions, posted at 11:30 PM).

function AttendanceScreen({ geofenceMode, offlineQueue, setOfflineQueue, isOffline, setIsOffline, onOpenMonthlyReport }) {
  const t = useT();
  const toast = useToast();
  const greeting = useGreeting();
  const [sites, setSites] = React.useState([]);
  const [checkins, setCheckins] = React.useState([]);
  const [activityTypes, setActivityTypes] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [acting, setActing] = React.useState(false);
  const [checkoutModal, setCheckoutModal] = React.useState(null); // { project, openSession }
  const [outsideZoneModal, setOutsideZoneModal] = React.useState(null); // { type: 'IN'|'OUT', payload, distance, nearest, onConfirm }
  const [holdStatus, setHoldStatus] = React.useState('clear'); // 'clear'|'pending'|'approved'|'rejected'

  React.useEffect(() => {
    Promise.all([
      window.frappe.getActiveSites(),
      window.frappe.getMyCheckins(),
      window.frappe.getActivityTypes(),
    ]).then(([s, c, a]) => { setSites(s); setCheckins(c); setActivityTypes(a); setLoading(false); });
  }, []);

  // Refresh hold status whenever checkins change
  React.useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    window.frappe.getDayHoldStatus(window.CURRENT_USER.employee, today).then(setHoldStatus);
  }, [checkins]);

  // Today's events
  const today = new Date().toISOString().slice(0, 10);
  const todays = checkins
    .filter((c) => c.time.startsWith(today))
    .sort((a, b) => a.time.localeCompare(b.time));
  // Pair into sessions
  const sessions = pairSessions(todays, sites);
  const openSession = sessions.find((s) => !s.out);
  const isCheckedIn = !!openSession;

  // Live GPS — refresh on mount and every 30s. Components render a neutral
  // "locating…" state while myPos is null.
  const [myPos, setMyPos] = React.useState({ lat: null, lng: null, accuracy: null });
  React.useEffect(() => {
    let cancelled = false;
    const tick = () => {
      window.geo.getCurrentPosition({ timeout: 12000 })
        .then((p) => { if (!cancelled) setMyPos(p); })
        .catch(() => { /* keep last known */ });
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
  const match = (myPos.lat != null && sites.length)
    ? window.geo.matchSite(myPos, sites)
    : { site: null, distance: 0, inside: false };

  const onCheckIn = async () => {
    // Outside any zone → open the violation popup first to gather project + reason
    if (!match.inside) {
      setOutsideZoneModal({
        type: 'IN',
        distance: match.distance,
        nearest: match.site,
      });
      return;
    }
    setActing(true);
    const payload = {
      log_type: 'IN',
      latitude: myPos.lat, longitude: myPos.lng,
      project: match.site.name, accuracy: myPos.accuracy,
    };
    if (isOffline) {
      setOfflineQueue((q) => [...q, { ...payload, queued_at: new Date().toISOString() }]);
      toast(`${t.check_in} — ${t.queued}`, 'warn');
      setActing(false);
      return;
    }
    try {
      const row = await window.frappe.createCheckin(payload);
      setCheckins((c) => [row, ...c]);
      toast(`${t.check_in} ✓ ${match.site.project_name}`, 'ok');
    } catch (e) {
      toast(e.message || 'Failed', 'bad');
    } finally {
      setActing(false);
    }
  };

  const onRequestCheckOut = () => {
    // Open popup with Activity Type + Task dropdowns
    setCheckoutModal({ project: openSession.project, session: openSession });
  };

  const onConfirmCheckOut = async ({ activity_type, task }) => {
    setActing(true);
    const payload = {
      log_type: 'OUT',
      latitude: myPos.lat, longitude: myPos.lng,
      project: openSession.project, accuracy: myPos.accuracy,
      activity_type, task,
    };
    if (isOffline) {
      setOfflineQueue((q) => [...q, { ...payload, queued_at: new Date().toISOString() }]);
      toast(`${t.check_out} — ${t.queued}`, 'warn');
      setCheckoutModal(null);
      setActing(false);
      return;
    }
    try {
      const row = await window.frappe.createCheckin(payload);
      setCheckins((c) => [row, ...c]);
      setCheckoutModal(null);
      // If we're outside any zone, immediately open the violation popup to log it
      if (!match.inside) {
        setActing(false);
        setOutsideZoneModal({
          type: 'OUT',
          distance: match.distance,
          nearest: match.site,
          checkin: row.name,
          // pre-fill project with whatever the open session had
          defaultProject: openSession?.project || match.site?.name,
        });
        toast(`${t.check_out} ✓`, 'ok');
        return;
      }
      toast(`${t.check_out} ✓`, 'ok');
    } catch (e) {
      toast(e.message || 'Failed', 'bad');
    } finally {
      setActing(false);
    }
  };

  // Submit a geofence violation tied to the just-created (or about-to-create) check-in.
  const onSubmitViolation = async ({ selected_project, reason }) => {
    setActing(true);
    const ctx = outsideZoneModal;
    try {
      let checkinName = ctx.checkin;
      // For check-IN flow we still need to create the checkin row first (no project)
      if (ctx.type === 'IN') {
        const payload = {
          log_type: 'IN',
          latitude: myPos.lat, longitude: myPos.lng,
          project: selected_project, accuracy: myPos.accuracy,
        };
        const row = await window.frappe.createCheckin(payload);
        setCheckins((c) => [row, ...c]);
        checkinName = row.name;
      }
      await window.frappe.createViolation({
        log_type: ctx.type,
        distance_m: ctx.distance,
        nearest_site: ctx.nearest?.name,
        selected_project, reason,
        actual_lat: myPos.lat, actual_lng: myPos.lng,
        checkin: checkinName,
      });
      // refresh hold-status
      const today = new Date().toISOString().slice(0, 10);
      const hs = await window.frappe.getDayHoldStatus(window.CURRENT_USER.employee, today);
      setHoldStatus(hs);
      toast(ctx.type === 'IN' ? `${t.check_in} ✓ · ${t.pending_review}` : t.pending_review, 'warn');
      setOutsideZoneModal(null);
    } catch (e) {
      toast(e.message || 'Failed', 'bad');
    } finally {
      setActing(false);
    }
  };

  const syncQueue = async () => {
    if (!offlineQueue.length) return;
    setIsOffline(false);
    const checkins = offlineQueue.filter((p) => !p._kind || p._kind === 'checkin');
    const others = offlineQueue.filter((p) => p._kind && p._kind !== 'checkin');
    for (const p of checkins) {
      const row = await window.frappe.createCheckin(p);
      setCheckins((c) => [row, ...c]);
    }
    for (const p of others) {
      try {
        if (p._kind === 'leave') await window.frappe.submitLeave(p);
        else if (p._kind === 'claim') await window.frappe.submitClaim(p);
      } catch (e) {}
    }
    const total = offlineQueue.length;
    setOfflineQueue([]);
    if (total > 0) {
      await window.frappe.pushNotification({
        kind: 'sync', title_key: 'sync_complete',
        body: `${total} ${total === 1 ? 'item' : 'items'} synced from your outbox.`,
        target: { tab: 'profile' },
      });
      window.dispatchEvent(new Event('akg:notifs-changed'));
    }
    toast(`${total} ${t.synced}`, 'ok');
  };

  if (loading) return <div style={{ padding: 16 }}><Skeleton h={84} mb={12} /><Skeleton h={180} mb={12} /><Skeleton h={120} /></div>;

  const firstIn = sessions[0]?.in;
  const lastOut = [...sessions].reverse().find((s) => s.out)?.out;
  const totalRaw = sessions.reduce((a, s) => a + (s.duration_min || 0), 0);

  return (
    <>
      <div style={{ marginBottom: 14, display: 'flex', alignItems: 'flex-end', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{greeting},</div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>{window.CURRENT_USER.employee_name.split(' ')[0]}</div>
        </div>
        <LiveClock />
      </div>

      {/* Offline banner */}
      {isOffline && (
        <div className="card" style={{ background: 'var(--warn-100)', borderColor: 'var(--warn)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="wifiOff" size={20} style={{ color: 'var(--warn)' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--warn)' }}>{t.offline_mode}</div>
            <div style={{ fontSize: 12, color: 'var(--warn)' }}>{offlineQueue.length} {t.queued}</div>
          </div>
          {offlineQueue.length > 0 && (
            <button className="btn btn-sm btn-primary" onClick={syncQueue}>
              <Icon name="refresh" size={14} /> {t.sync_now}
            </button>
          )}
        </div>
      )}

      {/* GPS / geofence card */}
      <div className="card card-flush">
        <div style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="pin" size={18} style={{ color: match.inside ? 'var(--ok)' : 'var(--warn)' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }} className="truncate">
              {match.inside ? match.site.project_name : t.no_site_matched}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {match.inside ? `${match.site.client} · ${match.distance}${t.from_center}` :
                `${t.distance_to_nearest}: ${match.site?.project_name || ''} · ${match.distance}${t.meters_away}`}
            </div>
          </div>
          <span className={`chip chip-dot ${match.inside ? 'chip-ok' : 'chip-warn'}`}>
            {match.inside ? t.inside_zone : t.outside_zone}
          </span>
        </div>
        <MiniMap sites={sites} myPos={myPos} match={match} />
      </div>

      {/* Big check-in/out button */}
      <div style={{ marginTop: 14 }}>
        <button
          className={`checkin-button ${isCheckedIn ? 'out' : 'in'}`}
          onClick={isCheckedIn ? onRequestCheckOut : onCheckIn}
          disabled={acting}
        >
          {acting ? <span className="spinner" /> : <Icon name={isCheckedIn ? 'logout' : 'check'} size={26} />}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            <span className="lt">
              {isCheckedIn
                ? `${t.checked_in_at} ${fmtTime(openSession.in.time)} · ${sessions.find((s) => s.project === openSession.project)?.siteName || ''}`
                : (firstIn ? `${t.checked_out_at} ${fmtTime(lastOut?.time)}` : t.today)}
            </span>
            <span>{isCheckedIn ? t.check_out : t.check_in}</span>
          </div>
        </button>
      </div>

      {/* Today summary */}
      <div className="stat-grid stat-grid-3" style={{ marginTop: 14 }}>
        <div className="stat">
          <div className="stat-label">{t.today}</div>
          <div className="stat-value">{firstIn ? fmtTime(firstIn.time) : '—'}</div>
          <div className="stat-sub">{t.first_in}</div>
        </div>
        <div className="stat">
          <div className="stat-label">{t.sessions}</div>
          <div className="stat-value">{sessions.length}</div>
          <div className="stat-sub">{sessions.filter((s) => s.project).length} {t.matched}</div>
        </div>
        <div className="stat">
          <div className="stat-label">{t.today}</div>
          <div className="stat-value">{(totalRaw / 60).toFixed(1)}h</div>
          <div className="stat-sub">{t.hours_worked}</div>
        </div>
      </div>

      {/* Monthly report entry */}
      <button
        className="card monthly-cta"
        onClick={onOpenMonthlyReport}
        style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'inherit', cursor: 'pointer', font: 'inherit', color: 'inherit' }}
      >
        <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--navy-100)', color: 'var(--navy-700)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name="calendar" size={20} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{t.monthly_report_title}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.monthly_report_sub}</div>
        </div>
        <Icon name="chevron" size={18} style={{ color: 'var(--text-muted)' }} />
      </button>

      {/* Today's sessions */}
      {sessions.length > 0 && <TodaySessions sessions={sessions} />}

      {/* End-of-day Timesheet preview (gap-split equally) */}
      {sessions.length > 0 && <TimesheetPreview sessions={sessions} sites={sites} holdStatus={holdStatus} />}

      {/* Weekly bars */}
      <WeeklyTimesheet checkins={checkins} sites={sites} />

      {/* History */}
      <div className="section-label">{t.history}</div>
      <div className="card card-flush">
        {checkins.slice(0, 8).map((c) => {
          const site = sites.find((s) => s.name === c.project);
          return (
            <div key={c.name} className="list-row">
              <div className="list-row-icon" style={{ background: c.log_type === 'IN' ? 'var(--ok-100)' : 'var(--ink-100)', color: c.log_type === 'IN' ? 'var(--ok)' : 'var(--text-muted)' }}>
                <Icon name={c.log_type === 'IN' ? 'check' : 'logout'} size={16} />
              </div>
              <div className="list-row-body">
                <div className="list-row-title">{c.log_type === 'IN' ? t.check_in : t.check_out}</div>
                <div className="list-row-sub truncate">{site?.project_name || t.no_site_matched}</div>
              </div>
              <div className="list-row-meta">
                <div className="list-row-amount tabular">{fmtTime(c.time)}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtDateShort(c.time.slice(0, 10))}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Check-out popup */}
      {checkoutModal && (
        <CheckoutModal
          project={checkoutModal.project}
          activityTypes={activityTypes}
          sites={sites}
          onCancel={() => setCheckoutModal(null)}
          onConfirm={onConfirmCheckOut}
          loading={acting}
        />
      )}

      {/* Outside-zone violation popup */}
      {outsideZoneModal && (
        <OutsideZonePopup
          ctx={outsideZoneModal}
          sites={sites}
          onCancel={() => setOutsideZoneModal(null)}
          onSubmit={onSubmitViolation}
          loading={acting}
        />
      )}
    </>
  );
}

// ─── Live clock — weekday, date, time-with-seconds ─────────────────────
function LiveClock() {
  const [now, setNow] = React.useState(new Date());
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const { lang } = useLang ? useLang() : { lang: 'en' };
  const locale = lang === 'ar' ? 'ar-AE' : 'en-GB';
  const weekday = now.toLocaleDateString(locale, { weekday: 'long' });
  const date = now.toLocaleDateString(locale, { day: '2-digit', month: 'short' });
  const time = now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  return (
    <div style={{ textAlign: 'right', flexShrink: 0 }}>
      <div className="tabular" style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)', lineHeight: 1.1 }}>{time}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{weekday} · {date}</div>
    </div>
  );
}

// ─── Pair raw IN/OUT events into sessions ──────────────────────────────
function pairSessions(events, sites) {
  const sessions = [];
  let cur = null;
  for (const e of events) {
    if (e.log_type === 'IN') {
      if (cur) sessions.push(cur);
      cur = { in: e, out: null, project: e.project, activity_type: null, task: null };
    } else if (e.log_type === 'OUT' && cur) {
      cur.out = e;
      cur.activity_type = e.activity_type;
      cur.task = e.task;
      cur.duration_min = Math.max(0, Math.round((+new Date(e.time.replace(' ', 'T')) - +new Date(cur.in.time.replace(' ', 'T'))) / 60000));
      sessions.push(cur);
      cur = null;
    }
  }
  if (cur) sessions.push(cur);
  return sessions.map((s) => ({ ...s, siteName: sites.find((x) => x.name === s.project)?.project_name }));
}

// ─── Today's sessions list ─────────────────────────────────────────────
function TodaySessions({ sessions }) {
  const t = useT();
  return (
    <div style={{ marginTop: 14 }}>
      <div className="section-label">{t.todays_sessions}</div>
      <div className="card card-flush">
        {sessions.map((s, i) => (
          <div key={i} className="list-row">
            <div className="list-row-icon" style={{ background: 'var(--navy-100)', color: 'var(--navy-700)', fontWeight: 700, fontSize: 12 }}>
              {i + 1}
            </div>
            <div className="list-row-body">
              <div className="list-row-title truncate">{s.siteName || t.unassigned_outside_short}</div>
              <div className="list-row-sub">
                {fmtTime(s.in.time)} → {s.out ? fmtTime(s.out.time) : <span style={{ color: 'var(--ok)', fontWeight: 600 }}>● {t.active_now}</span>}
                {s.activity_type && ` · ${s.activity_type}`}
              </div>
            </div>
            <div className="list-row-meta">
              <div className="list-row-amount tabular">{s.out ? `${(s.duration_min / 60).toFixed(1)}h` : '—'}</div>
              {s.task && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{s.task}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── End-of-day Timesheet preview (matches the 11:30 PM auto-post) ─────
function TimesheetPreview({ sessions, sites, holdStatus }) {
  const t = useT();
  const closed = sessions.filter((s) => s.out);
  if (!closed.length) return null;

  // Sort by check-in
  const sorted = [...closed].sort((a, b) => a.in.time.localeCompare(b.in.time));
  // Calculate gap minutes between sessions
  let gapMin = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prevOut = +new Date(sorted[i - 1].out.time.replace(' ', 'T'));
    const nextIn = +new Date(sorted[i].in.time.replace(' ', 'T'));
    gapMin += Math.max(0, (nextIn - prevOut) / 60000);
  }
  const share = sorted.length ? gapMin / sorted.length : 0;
  const rows = sorted.map((s) => ({
    ...s,
    raw_min: s.duration_min,
    adjusted_min: s.duration_min + share,
    travel_min: share,
  }));
  const totalAdj = rows.reduce((a, r) => a + r.adjusted_min, 0);

  const onHold = holdStatus === 'pending';
  const cardStyle = onHold
    ? { marginTop: 14, borderColor: 'var(--warn)', background: 'var(--warn-100)' }
    : { marginTop: 14, borderColor: 'var(--navy-200)' };

  return (
    <div className="card" style={cardStyle}>
      <div className="row-between" style={{ marginBottom: 10 }}>
        <div>
          <div className="card-title" style={{ marginBottom: 2 }}>{t.end_of_day_timesheet}</div>
          <div className="muted" style={{ fontSize: 11 }}>
            {onHold ? t.hold_reason : t.auto_post_hint}
          </div>
        </div>
        {onHold ? (
          <span className="chip chip-warn chip-dot">
            <Icon name="warn" size={12} /> {t.on_hold}
          </span>
        ) : (
          <span className="chip chip-info">{t.preview}</span>
        )}
      </div>
      <div className="ts-table">
        <div className="ts-row ts-head">
          <div>#</div>
          <div>{t.project_task}</div>
          <div className="r">{t.from}</div>
          <div className="r">{t.to}</div>
          <div className="r">{t.hrs}</div>
        </div>
        {rows.map((r, i) => (
          <div key={i} className="ts-row">
            <div className="tabular muted">{i + 1}</div>
            <div style={{ minWidth: 0 }}>
              <div className="truncate" style={{ fontSize: 12, fontWeight: 600 }}>
                {r.siteName || <span style={{ color: 'var(--warn)' }}>{t.unassigned_outside}</span>}
              </div>
              <div className="truncate" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {[r.activity_type, r.task].filter(Boolean).join(' · ')}
                {r.travel_min > 0 && <span style={{ color: 'var(--navy-700)' }}> · +{Math.round(r.travel_min)}{t.travel_minutes}</span>}
              </div>
            </div>
            <div className="r tabular" style={{ fontSize: 11 }}>{fmtTime(r.in.time)}</div>
            <div className="r tabular" style={{ fontSize: 11 }}>{fmtTime(r.out.time)}</div>
            <div className="r tabular" style={{ fontWeight: 700, fontSize: 12 }}>{(r.adjusted_min / 60).toFixed(2)}</div>
          </div>
        ))}
        <div className="ts-row ts-foot">
          <div></div>
          <div className="muted" style={{ fontSize: 11 }}>{Math.round(gapMin)}{t.travel_split} {rows.length} {rows.length === 1 ? t.session : t.sessions}</div>
          <div></div>
          <div className="r muted" style={{ fontSize: 11 }}>{t.total}</div>
          <div className="r tabular" style={{ fontWeight: 800 }}>{(totalAdj / 60).toFixed(2)}h</div>
        </div>
      </div>
    </div>
  );
}

// ─── Check-out popup with Activity Type + Task ─────────────────────────
function CheckoutModal({ project, activityTypes, sites, onCancel, onConfirm, loading }) {
  const t = useT();
  const site = sites.find((s) => s.name === project);
  const [tasks, setTasks] = React.useState([]);
  const [activity, setActivity] = React.useState('Execution');
  const [task, setTask] = React.useState('');

  React.useEffect(() => {
    if (!project) { setTasks([]); return; }
    window.frappe.getProjectTasks(project).then((rows) => {
      setTasks(rows);
      setTask(rows[0]?.name || '');
    });
  }, [project]);

  // Close on Escape
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return ReactDOM.createPortal(
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '20px 20px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 10,
              background: 'var(--warn-100)', color: 'var(--warn)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name="logout" size={18} />
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>{t.check_out}</div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {site ? site.project_name : t.unassigned_outside}
          </div>

          <div style={{ marginTop: 18 }}>
            <label className="field-label">{t.activity_type}</label>
            {activityTypes.length === 0 ? (
              <div className="empty-inline" style={{ fontSize: 12, color: 'var(--text-muted)', padding: '10px 12px', background: 'var(--ink-50)', borderRadius: 8, lineHeight: 1.4 }}>
                No activity types configured yet. Ask an admin to add some at
                {' '}<a href="/app/activity-type" target="_blank" rel="noopener" style={{ color: 'var(--brand)', textDecoration: 'underline' }}>Setup → Activity Type</a>.
                You can still check out — activity will be left blank.
              </div>
            ) : (
              <>
                <div className="seg" role="tablist">
                  {activityTypes.slice(0, 4).map((a) => (
                    <button
                      key={a.name}
                      type="button"
                      className={`seg-btn ${activity === a.name ? 'active' : ''}`}
                      onClick={() => setActivity(a.name)}
                    >
                      {a.name}
                    </button>
                  ))}
                </div>
                <select
                  className="select"
                  value={activity}
                  onChange={(e) => setActivity(e.target.value)}
                  style={{ marginTop: 8 }}
                >
                  <option value="">— Select activity —</option>
                  {activityTypes.map((a) => <option key={a.name} value={a.name}>{a.name}{a.billable ? ' · billable' : ''}</option>)}
                </select>
              </>
            )}
          </div>

          <div style={{ marginTop: 14 }}>
            <label className="field-label">{t.task}</label>
            {tasks.length === 0 ? (
              <div className="empty-inline">{t.no_tasks}</div>
            ) : (
              <select className="select" value={task} onChange={(e) => setTask(e.target.value)}>
                {tasks.map((tk) => (
                  <option key={tk.name} value={tk.name}>
                    {tk.subject} · {tk.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: 10, marginTop: 22 }}>
            <button className="btn btn-ghost" onClick={onCancel} disabled={loading}>{t.cancel}</button>
            <button className="btn btn-primary" onClick={() => onConfirm({ activity_type: activity, task })} disabled={loading}>
              {loading ? <span className="spinner" /> : <Icon name="logout" size={16} />}
              {t.confirm_check_out}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Mini map ──────────────────────────────────────────────────────────
// Real OSM tiles via Leaflet (see LeafletMap in ui.jsx). The previous
// hand-drawn SVG schematic is gone — it looked decorative but didn't show
// real geography, which surprised users who didn't know which way was north.
function MiniMap({ sites, myPos, match }) {
  const t = useT();
  // Centre the map on the matched site if we're inside one, else on the
  // user's current position, else let LeafletMap fit bounds across all sites.
  const center = match.inside && match.site
    ? { lat: match.site.lat ?? match.site.site_latitude, lng: match.site.lng ?? match.site.site_longitude }
    : (myPos && myPos.lat != null ? { lat: myPos.lat, lng: myPos.lng } : null);
  return (
    <LeafletMap
      sites={sites}
      userPos={myPos && myPos.lat != null ? myPos : null}
      userLabel={t.location}
      center={center}
      zoom={15}
      height={220}
      interactive={false}
      highlight={match.inside ? match.site?.name : null}
    />
  );
}

function WeeklyTimesheet({ checkins, sites }) {
  const t = useT();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const dayEvents = checkins.filter((c) => c.time.startsWith(key)).sort((a, b) => a.time.localeCompare(b.time));
    const sessions = pairSessions(dayEvents, sites);
    const hrs = sessions.reduce((a, s) => a + (s.duration_min || 0), 0) / 60;
    const site = sessions[0] ? sites.find((s) => s.name === sessions[0].project) : null;
    days.push({ d, key, hrs: Math.round(hrs * 10) / 10, site });
  }
  const max = Math.max(10, ...days.map((x) => x.hrs));

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="row-between" style={{ marginBottom: 10 }}>
        <div className="card-title">{t.weekly_timesheet}</div>
        <div className="muted" style={{ fontSize: 11 }}>{days.reduce((a, b) => a + b.hrs, 0).toFixed(1)}h</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, alignItems: 'end', height: 88 }}>
        {days.map((x) => (
          <div key={x.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%' }}>
            <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
              <div style={{
                width: '100%',
                height: `${(x.hrs / max) * 100}%`,
                minHeight: x.hrs > 0 ? 4 : 0,
                background: x.site?.color || 'var(--ink-300)',
                borderRadius: '4px 4px 0 0',
                opacity: x.hrs > 0 ? 1 : 0.3,
              }} title={`${x.hrs}h`} />
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{x.d.toLocaleDateString([], { weekday: 'narrow' })}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Outside-zone violation popup ──────────────────────────────────────
// Triggered whenever an employee tries to check in or check out while outside
// every project geofence. Captures the project they intend to log against and
// a free-text reason; submits a Geofence Violation row that puts the day on
// hold until a manager approves.
function OutsideZonePopup({ ctx, sites, onCancel, onSubmit, loading }) {
  const t = useT();
  const isIn = ctx.type === 'IN';
  const [project, setProject] = React.useState(ctx.defaultProject || ctx.nearest?.name || sites[0]?.name || '');
  const [reason, setReason] = React.useState('');

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !loading) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, loading]);

  const distLabel = ctx.distance >= 1000 ? `${(ctx.distance / 1000).toFixed(1)} km` : `${ctx.distance} m`;
  const canSubmit = project && reason.trim().length >= 8 && !loading;

  return ReactDOM.createPortal(
    <div className="modal-backdrop" onClick={loading ? undefined : onCancel}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '20px 20px 18px' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 6 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              background: 'var(--warn-100)', color: 'var(--warn)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Icon name="warn" size={22} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em', textWrap: 'pretty' }}>
                {t.outside_zone_title}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.45, textWrap: 'pretty' }}>
                {t.outside_zone_body.replace('{type}', isIn ? t.check_in.toLowerCase() : t.check_out.toLowerCase())}
              </div>
            </div>
          </div>

          {/* Distance / nearest readout */}
          <div style={{
            marginTop: 14, padding: '10px 12px',
            background: 'var(--ink-50)', border: '1px solid var(--ink-200)',
            borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <Icon name="pin" size={16} style={{ color: 'var(--warn)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.nearest}</div>
              <div className="truncate" style={{ fontSize: 13, fontWeight: 600 }}>
                {ctx.nearest?.project_name || '—'}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="tabular" style={{ fontSize: 15, fontWeight: 700, color: 'var(--warn)' }}>{distLabel}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{t.away_from}</div>
            </div>
          </div>

          {/* Project picker */}
          <div style={{ marginTop: 16 }}>
            <label className="field-label">{t.select_project} *</label>
            <select className="select" value={project} onChange={(e) => setProject(e.target.value)} disabled={loading}>
              {sites.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.project_name} · {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Reason */}
          <div style={{ marginTop: 12 }}>
            <label className="field-label">{t.why_off_zone} *</label>
            <textarea
              className="field-textarea"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t.why_off_zone_ph}
              rows={3}
              disabled={loading}
              style={{ minHeight: 78 }}
            />
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, textAlign: 'right' }}>
              {reason.trim().length < 8 ? `${8 - reason.trim().length} ${t.chars_more}` : `${reason.length} ${t.chars}`}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 10, marginTop: 18 }}>
            <button className="btn btn-ghost" onClick={onCancel} disabled={loading}>{t.cancel}</button>
            <button
              className="btn btn-primary"
              onClick={() => onSubmit({ selected_project: project, reason: reason.trim() })}
              disabled={!canSubmit}
            >
              {loading ? <span className="spinner" /> : <Icon name="check" size={16} />}
              {t.submit_for_review}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

Object.assign(window, { AttendanceScreen });
