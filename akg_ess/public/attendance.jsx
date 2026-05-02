// Attendance — routes between two flows based on Employee.is_office_worker:
//   - Office workers: simple Check In / Check Out, no map, no project,
//     no activity/task — see OfficeAttendanceScreen below.
//   - Site workers: the original flow with GPS, geofence matching,
//     project picker, activity-type modal — see SiteAttendanceScreen.
function AttendanceScreen(props) {
  if (window.CURRENT_USER && window.CURRENT_USER.is_office_worker) {
    return <OfficeAttendanceScreen {...props} />;
  }
  return <SiteAttendanceScreen {...props} />;
}

// ─── Site worker flow (original, unchanged behaviour) ──────────────────
function SiteAttendanceScreen({ geofenceMode, offlineQueue, setOfflineQueue, isOffline, setIsOffline, onOpenMonthlyReport }) {
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
      setOfflineQueue((q) => [...q, { ...payload, _kind: 'checkin', queued_at: new Date().toISOString() }]);
      toast(`${t.check_in} — ${t.queued}`, 'warn');
      setActing(false);
      return;
    }
    try {
      const row = await window.frappe.createCheckin(payload);
      setCheckins((c) => [row, ...c]);
      toast(`${t.check_in} ✓ ${match.site.project_name}`, 'ok');
    } catch (e) {
      // Auto-queue on network error so we never lose a tap to bad signal.
      if (window.frappe.isNetworkError && window.frappe.isNetworkError(e)) {
        setOfflineQueue((q) => [...q, { ...payload, _kind: 'checkin', queued_at: new Date().toISOString() }]);
        setIsOffline(true);
        toast(`${t.check_in} — saved, will sync when online`, 'warn');
      } else {
        toast(e.message || 'Failed', 'bad');
      }
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
      setOfflineQueue((q) => [...q, { ...payload, _kind: 'checkin', queued_at: new Date().toISOString() }]);
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
      if (window.frappe.isNetworkError && window.frappe.isNetworkError(e)) {
        setOfflineQueue((q) => [...q, { ...payload, _kind: 'checkin', queued_at: new Date().toISOString() }]);
        setIsOffline(true);
        toast(`${t.check_out} — saved, will sync when online`, 'warn');
        setCheckoutModal(null);
      } else {
        toast(e.message || 'Failed', 'bad');
      }
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

  if (loading) return <AttendanceSkeleton />;

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

      {/* Site hero — day-state-aware navy block.  When checked in the stats
          row shifts to live elapsed timer + today total; when not, it shows
          distance + sites in radius. */}
      <SiteHero
        sites={sites}
        myPos={myPos}
        match={match}
        isCheckedIn={isCheckedIn}
        openSession={openSession}
        sessions={sessions}
        totalRaw={totalRaw}
      />

      {/* Big check-in/out button — single CTA copy split into label + sub */}
      <div style={{ marginTop: 14 }}>
        <button
          className={`checkin-button ${isCheckedIn ? 'out' : 'in'}`}
          onClick={isCheckedIn ? onRequestCheckOut : onCheckIn}
          disabled={acting}
        >
          {acting ? <span className="spinner" /> : <Icon name={isCheckedIn ? 'logout' : 'check'} size={26} />}
          <span className="checkin-button-label">
            {isCheckedIn ? t.cta_check_out : t.cta_check_in}
          </span>
          <span className="checkin-button-sub truncate">
            {isCheckedIn
              ? `${fmtTime(openSession.in.time)} · ${sessions.find((s) => s.project === openSession.project)?.siteName || ''}`
              : (firstIn
                  ? `${t.checked_out_at} ${fmtTime(lastOut?.time)}`
                  : (match.inside ? t.cta_check_in_sub : t.log_violation))}
          </span>
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

      {/* Monthly report entry — with inline KPI for this month */}
      <MonthlyCtaCard checkins={checkins} sites={sites} onClick={onOpenMonthlyReport} />

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

// ─── Office worker flow ───────────────────────────────────────────────
// Simple Check In / Check Out for staff who don't work on a site.
// EXACTLY ONE check-in + ONE check-out per calendar day.  Three states:
//   not_started → on_clock → done   (no way back; locked till tomorrow)
// No map, no geofence, no project / activity / task pickers.  Employee
// Checkin rows are created with project / latitude / longitude /
// accuracy_m all null.
function OfficeAttendanceScreen({ offlineQueue, setOfflineQueue, isOffline, setIsOffline, onOpenMonthlyReport }) {
  const t = useT();
  const toast = useToast();
  const greeting = useGreeting();
  const [checkins, setCheckins] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [acting, setActing] = React.useState(false);
  const [confirmOut, setConfirmOut] = React.useState(false);

  React.useEffect(() => {
    window.frappe.getMyCheckins().then((c) => { setCheckins(c); setLoading(false); });
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const todays = checkins
    .filter((c) => c.time && c.time.startsWith(today))
    .sort((a, b) => a.time.localeCompare(b.time));

  // Office workers get exactly one IN + one OUT per day. Anything beyond is ignored.
  const todayIn  = todays.find((c) => c.log_type === 'IN')  || null;
  const todayOut = todays.find((c) => c.log_type === 'OUT') || null;
  const dayState = todayOut ? 'done' : (todayIn ? 'on_clock' : 'not_started');

  // Live total minutes — auto-ticks every 30s while on the clock so the
  // hero "Today" stat stays current without remounting.
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (dayState !== 'on_clock') return;
    const id = setInterval(() => setTick((x) => x + 1), 30000);
    return () => clearInterval(id);
  }, [dayState]);

  let totalMin = 0;
  if (todayIn && todayOut) {
    totalMin = Math.max(0, Math.round(
      (+new Date(todayOut.time.replace(' ', 'T')) - +new Date(todayIn.time.replace(' ', 'T'))) / 60000
    ));
  } else if (todayIn) {
    totalMin = Math.max(0, Math.round(
      (Date.now() - +new Date(todayIn.time.replace(' ', 'T'))) / 60000
    ));
  }

  const submit = async (logType) => {
    setActing(true);
    const payload = {
      log_type: logType,
      latitude: null, longitude: null, project: null, accuracy: null,
    };
    if (isOffline) {
      setOfflineQueue((q) => [...q, { ...payload, _kind: 'checkin', queued_at: new Date().toISOString() }]);
      toast(`${logType === 'OUT' ? t.check_out : t.check_in} — ${t.queued}`, 'warn');
      setActing(false);
      setConfirmOut(false);
      return;
    }
    try {
      const row = await window.frappe.createCheckin(payload);
      setCheckins((c) => [row, ...c]);
      toast(`${logType === 'OUT' ? t.check_out : t.check_in} ✓`, 'ok');
    } catch (e) {
      // Auto-queue on real network failure (no signal in basement, etc).
      if (window.frappe.isNetworkError && window.frappe.isNetworkError(e)) {
        setOfflineQueue((q) => [...q, { ...payload, _kind: 'checkin', queued_at: new Date().toISOString() }]);
        setIsOffline(true);
        toast(`${logType === 'OUT' ? t.check_out : t.check_in} — saved, will sync when online`, 'warn');
      } else {
        toast(e.message || 'Failed', 'bad');
      }
    } finally {
      setActing(false);
      setConfirmOut(false);
    }
  };

  const onPrimary = () => {
    if (dayState === 'on_clock') setConfirmOut(true);
    else if (dayState === 'not_started') submit('IN');
  };

  if (loading) return (
    <div style={{ padding: 16 }}>
      <Skeleton h={84} mb={12} />
      <Skeleton h={220} mb={12} />
      <Skeleton h={140} />
    </div>
  );

  const u = window.CURRENT_USER || {};
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;

  return (
    <>
      {/* Greeting */}
      <div style={{ marginBottom: 14, display: 'flex', alignItems: 'flex-end', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{greeting},</div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
            {(u.employee_name || '').split(' ')[0]}
          </div>
        </div>
        <span className="chip chip-info" title="Office Worker">
          <Icon name="shield" size={12} /> Office
        </span>
      </div>

      {/* Offline banner */}
      {isOffline && (
        <div className="card" style={{ background: 'var(--warn-100)', borderColor: 'var(--warn)', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <Icon name="wifiOff" size={20} style={{ color: 'var(--warn)' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--warn)' }}>{t.offline_mode}</div>
            <div style={{ fontSize: 12, color: 'var(--warn)' }}>{offlineQueue.length} {t.queued}</div>
          </div>
        </div>
      )}

      {/* Hero clock card */}
      <div className={`office-hero ${dayState === 'on_clock' ? 'is-active' : ''} ${dayState === 'done' ? 'is-done' : ''}`}>
        <div className="office-hero-status">
          <span className="office-hero-status-dot" />
          {dayState === 'on_clock' && `On the clock · since ${fmtTime(todayIn.time)}`}
          {dayState === 'done'     && `Day complete · ${fmtTime(todayIn.time)} → ${fmtTime(todayOut.time)}`}
          {dayState === 'not_started' && 'Not started'}
        </div>
        <OfficeLiveClock />
        <div className="office-hero-stats">
          <div className="office-hero-stat">
            <div className="office-hero-stat-label">Today</div>
            <div className="office-hero-stat-value tabular">
              {String(hours).padStart(2, '0')}<span className="sep">:</span>{String(mins).padStart(2, '0')}
            </div>
            <div className="office-hero-stat-sub">
              {dayState === 'not_started' ? '—' : 'hours · mins'}
            </div>
          </div>
          <div className="office-hero-divider" />
          <div className="office-hero-stat">
            <div className="office-hero-stat-label">
              {dayState === 'done' ? 'Checked out' : 'Status'}
            </div>
            <div className="office-hero-stat-value tabular" style={{ fontSize: dayState === 'done' ? 26 : 22 }}>
              {dayState === 'done' && fmtTime(todayOut.time)}
              {dayState === 'on_clock' && <span style={{ color: '#4ADE80' }}>Live</span>}
              {dayState === 'not_started' && <span style={{ color: 'rgba(255,255,255,.55)' }}>—</span>}
            </div>
            <div className="office-hero-stat-sub">
              {dayState === 'on_clock' && <><span className="live-dot" /> Active now</>}
              {dayState === 'done'     && 'Locked for today'}
              {dayState === 'not_started' && 'Tap below to start'}
            </div>
          </div>
        </div>
      </div>

      {/* Primary action — three mutually exclusive renders */}
      <div style={{ marginTop: 14 }}>
        {dayState === 'done' ? (
          <div className="office-done-card">
            <div className="office-done-icon">
              <Icon name="check" size={22} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="office-done-title">You're done for today</div>
              <div className="office-done-sub">
                {(totalMin / 60).toFixed(2)}h logged · check-in opens again tomorrow
              </div>
            </div>
            <Icon name="shield" size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          </div>
        ) : (
          <button
            className={`checkin-button ${dayState === 'on_clock' ? 'out' : 'in'}`}
            onClick={onPrimary}
            disabled={acting}
          >
            {acting ? <span className="spinner" /> : <Icon name={dayState === 'on_clock' ? 'logout' : 'check'} size={26} />}
            <span className="checkin-button-label">
              {dayState === 'on_clock' ? t.cta_check_out : t.cta_check_in}
            </span>
            <span className="checkin-button-sub truncate">
              {dayState === 'on_clock'
                ? `${t.checked_in_at} ${fmtTime(todayIn.time)}`
                : t.cta_check_in_sub}
            </span>
          </button>
        )}
      </div>

      {/* Today's record — single session view */}
      {todayIn && (
        <div style={{ marginTop: 18 }}>
          <div className="section-label">Today</div>
          <div className="card card-flush">
            <div className="list-row">
              <div className="list-row-icon" style={{ background: 'var(--ok-100)', color: 'var(--ok)' }}>
                <Icon name="check" size={16} />
              </div>
              <div className="list-row-body">
                <div className="list-row-title">{t.check_in}</div>
                <div className="list-row-sub">{fmtTime(todayIn.time)}</div>
              </div>
              <div className="list-row-meta">
                <span className="chip chip-ok">Logged</span>
              </div>
            </div>
            <div className="list-row">
              <div className="list-row-icon" style={{
                background: todayOut ? 'var(--ink-100)' : 'var(--surface-2)',
                color: todayOut ? 'var(--text-muted)' : 'var(--ink-400)',
              }}>
                <Icon name="logout" size={16} />
              </div>
              <div className="list-row-body">
                <div className="list-row-title">
                  {t.check_out}
                  {!todayOut && <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}> · pending</span>}
                </div>
                <div className="list-row-sub">
                  {todayOut ? fmtTime(todayOut.time) : <><span className="live-dot" /> Working now…</>}
                </div>
              </div>
              <div className="list-row-meta">
                {todayOut
                  ? <span className="list-row-amount tabular">{(totalMin / 60).toFixed(2)}h</span>
                  : <span className="chip chip-warn chip-dot">Open</span>}
              </div>
            </div>
          </div>
        </div>
      )}

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
          <div style={{ fontSize: 14, fontWeight: 700 }}>{t.monthly_report_title || 'Monthly attendance'}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.monthly_report_sub || 'View your month at a glance'}</div>
        </div>
        <Icon name="chevron" size={18} style={{ color: 'var(--text-muted)' }} />
      </button>

      {/* Last 5 days hours bar */}
      <OfficeWeekly checkins={checkins} />

      {/* Confirm check-out modal — never submits OUT immediately */}
      {confirmOut && (
        <CheckOutConfirmModal
          checkInTime={todayIn ? fmtTime(todayIn.time) : ''}
          totalMin={totalMin}
          loading={acting}
          onCancel={() => !acting && setConfirmOut(false)}
          onConfirm={() => submit('OUT')}
        />
      )}
    </>
  );
}

// ─── Confirm check-out — single-shot warning for office workers ─────────
function CheckOutConfirmModal({ checkInTime, totalMin, loading, onCancel, onConfirm }) {
  const t = useT();
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !loading) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, loading]);
  const hours = Math.floor(totalMin / 60);
  const mins  = totalMin % 60;
  const now = new Date();
  const nowStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  return ReactDOM.createPortal(
    <div className="modal-backdrop" onClick={loading ? undefined : onCancel}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '22px 20px 18px' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 4 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: 'var(--warn-100)', color: 'var(--warn)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Icon name="alert" size={24} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>
                Check out for the day?
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
                Office workers can only check out <b style={{ color: 'var(--text)' }}>once per day</b>. You won't be able to check back in until tomorrow.
              </div>
            </div>
          </div>

          {/* Today's summary block */}
          <div className="checkout-summary">
            <div className="checkout-summary-row">
              <div className="checkout-summary-label">Checked in</div>
              <div className="checkout-summary-value tabular">{checkInTime || '—'}</div>
            </div>
            <div className="checkout-summary-row">
              <div className="checkout-summary-label">Checking out</div>
              <div className="checkout-summary-value tabular" style={{ color: 'var(--warn)' }}>{nowStr}</div>
            </div>
            <div className="checkout-summary-divider" />
            <div className="checkout-summary-row">
              <div className="checkout-summary-label" style={{ fontWeight: 600, color: 'var(--text)' }}>Total today</div>
              <div className="checkout-summary-value tabular" style={{ fontSize: 22, fontWeight: 800 }}>
                {String(hours).padStart(2,'0')}:{String(mins).padStart(2,'0')}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 10, marginTop: 18 }}>
            <button className="btn btn-ghost" onClick={onCancel} disabled={loading}>
              {t.cancel || 'Cancel'}
            </button>
            <button className="btn btn-danger" onClick={onConfirm} disabled={loading}>
              {loading ? <span className="spinner" /> : <Icon name="logout" size={16} />}
              Yes, check out
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Big live clock for the hero ──────────────────────────────────────
function OfficeLiveClock() {
  const [now, setNow] = React.useState(new Date());
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const ctx = useLang ? useLang() : { lang: 'en' };
  const lang = (ctx && ctx.lang) || 'en';
  const locale = lang === 'ar' ? 'ar-AE' : 'en-GB';
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const date = now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div className="office-clock">
      <div className="office-clock-time tabular">
        <span>{hh}</span>
        <span className="office-clock-sep">:</span>
        <span>{mm}</span>
        <span className="office-clock-sec tabular">{ss}</span>
      </div>
      <div className="office-clock-date">{date}</div>
    </div>
  );
}

// Pair raw events into office sessions — first IN + first OUT only
function pairOfficeSessions(events) {
  const inEv = events.find((e) => e.log_type === 'IN');
  const outEv = events.find((e) => e.log_type === 'OUT' && (!inEv || e.time > inEv.time));
  if (!inEv) return [];
  const session = { in: inEv, out: outEv || null };
  if (outEv) {
    session.duration_min = Math.max(0, Math.round(
      (+new Date(outEv.time.replace(' ', 'T')) - +new Date(inEv.time.replace(' ', 'T'))) / 60000
    ));
  }
  return [session];
}

// 5-day mini hours strip
function OfficeWeekly({ checkins }) {
  const days = [];
  for (let i = 4; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const dayEvents = checkins.filter((c) => c.time && c.time.startsWith(key)).sort((a, b) => a.time.localeCompare(b.time));
    const sessions = pairOfficeSessions(dayEvents);
    const hrs = sessions.reduce((acc, s) => {
      if (s.out) return acc + (s.duration_min || 0) / 60;
      if (s.in && key === new Date().toISOString().slice(0, 10)) {
        return acc + Math.max(0, (Date.now() - +new Date(s.in.time.replace(' ', 'T'))) / 3600000);
      }
      return acc;
    }, 0);
    days.push({ d, key, hrs: Math.round(hrs * 10) / 10, isToday: i === 0 });
  }
  const max = Math.max(8, ...days.map((x) => x.hrs));
  const total = days.reduce((a, b) => a + b.hrs, 0);

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="row-between" style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="card-title">Last 5 days</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Total {total.toFixed(1)}h · target 40h/wk</div>
        </div>
        <span className="chip chip-info">{(total / 5).toFixed(1)}h avg</span>
      </div>
      <div className="office-week">
        {days.map((x) => (
          <div key={x.key} className={`office-week-col ${x.isToday ? 'is-today' : ''}`}>
            <div className="office-week-bar-track">
              <div className="office-week-bar"
                   style={{ height: `${(x.hrs / max) * 100}%` }}
                   title={`${x.hrs}h`}>
                {x.hrs > 0 && <span className="office-week-bar-num tabular">{x.hrs.toFixed(1)}</span>}
              </div>
            </div>
            <div className="office-week-day">{x.d.toLocaleDateString([], { weekday: 'short' }).slice(0, 3)}</div>
            <div className="office-week-date tabular">{x.d.getDate()}</div>
          </div>
        ))}
      </div>
    </div>
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
// Active session lifts to a highlighted "Currently working" row above the
// closed sessions list — with a live elapsed timer.
function TodaySessions({ sessions }) {
  const t = useT();
  const active = sessions.find((s) => !s.out);
  const closed = sessions.filter((s) => s.out);
  return (
    <div style={{ marginTop: 14 }}>
      <div className="section-label">{t.todays_sessions}</div>

      {active && <ActiveSessionCard session={active} />}

      {closed.length > 0 && (
        <div className="card card-flush" style={{ marginTop: active ? 8 : 0 }}>
          {closed.map((s, i) => (
            <div key={i} className="list-row">
              <div className="list-row-icon" style={{ background: 'var(--navy-100)', color: 'var(--navy-700)', fontWeight: 700, fontSize: 12 }}>
                {i + 1}
              </div>
              <div className="list-row-body">
                <div className="list-row-title truncate">{s.siteName || t.unassigned_outside_short}</div>
                <div className="list-row-sub">
                  {fmtTime(s.in.time)} → {fmtTime(s.out.time)}
                  {s.activity_type && ` · ${s.activity_type}`}
                </div>
              </div>
              <div className="list-row-meta">
                <div className="list-row-amount tabular">{(s.duration_min / 60).toFixed(1)}h</div>
                {s.task && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{s.task}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Highlighted card for the currently-active session — live elapsed timer.
function ActiveSessionCard({ session }) {
  const t = useT();
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);
  const elapsedMin = Math.max(0, Math.round((Date.now() - +new Date(session.in.time.replace(' ', 'T'))) / 60000));
  const h = Math.floor(elapsedMin / 60);
  const m = elapsedMin % 60;
  return (
    <div className="active-session-card">
      <div className="active-session-stripe" />
      <div className="active-session-body">
        <div className="active-session-head">
          <span className="active-session-pill">
            <span className="active-session-pill-dot" />
            {t.live_now} · {t.active_session_title}
          </span>
        </div>
        <div className="active-session-title truncate">{session.siteName || t.unassigned_outside_short}</div>
        <div className="active-session-sub">
          {fmtTime(session.in.time)} → <span className="muted-on-tile">{t.active_now}</span>
          {session.activity_type && ` · ${session.activity_type}`}
        </div>
      </div>
      <div className="active-session-timer">
        <div className="active-session-timer-value tabular">
          {String(h).padStart(2, '0')}<span className="sep">:</span>{String(m).padStart(2, '0')}
        </div>
        <div className="active-session-timer-label">{t.elapsed}</div>
      </div>
    </div>
  );
}

// ─── Monthly attendance CTA — shows live KPI ("21 days · 1 absent") ────
function MonthlyCtaCard({ checkins, sites, onClick }) {
  const t = useT();
  const now = new Date();
  const ym = now.toISOString().slice(0, 7);
  const presentDays = new Set(
    (checkins || [])
      .filter((c) => c.log_type === 'IN' && c.time && c.time.startsWith(ym))
      .map((c) => c.time.slice(0, 10))
  ).size;
  // Working days elapsed = weekdays from 1st to today; UAE skips Fri/Sat.
  let workingElapsed = 0;
  for (let d = 1; d <= now.getDate(); d++) {
    const wd = new Date(now.getFullYear(), now.getMonth(), d).getDay();
    if (wd !== 5 && wd !== 6) workingElapsed++;
  }
  const absent = Math.max(0, workingElapsed - presentDays);
  return (
    <button
      className="card monthly-cta"
      onClick={onClick}
      style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'inherit', cursor: 'pointer', font: 'inherit', color: 'inherit' }}
    >
      <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--navy-100)', color: 'var(--navy-700)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon name="calendar" size={20} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{t.monthly_report_title}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 2 }}>
          {presentDays > 0 ? (
            <span><b style={{ color: 'var(--text)' }}>{presentDays}</b> {t.days_present}</span>
          ) : (
            <span>{t.this_month}</span>
          )}
          {absent > 0 && (
            <>
              <span style={{ color: 'var(--ink-300)' }}>·</span>
              <span><b style={{ color: 'var(--bad)' }}>{absent}</b> {(t.absent || 'absent').toLowerCase()}</span>
            </>
          )}
        </div>
      </div>
      <Icon name="chevron" size={18} style={{ color: 'var(--text-muted)' }} />
    </button>
  );
}

// ─── Skeleton matching the new hero shape ──────────────────────────────
function AttendanceSkeleton() {
  return (
    <div style={{ padding: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <Skeleton h={12} w="40%" mb={6} />
          <Skeleton h={22} w="55%" />
        </div>
      </div>
      <div className="site-hero-skeleton">
        <div className="site-hero-skeleton-head">
          <Skeleton h={14} w={110} mb={8} />
          <Skeleton h={20} w="60%" mb={4} />
          <Skeleton h={11} w="40%" />
        </div>
        <div className="site-hero-skeleton-map" />
        <div className="site-hero-skeleton-stats">
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ flex: 1 }}>
              <Skeleton h={9} w="50%" mb={6} />
              <Skeleton h={20} w="70%" mb={4} />
              <Skeleton h={9} w="40%" />
            </div>
          ))}
        </div>
        <div className="site-hero-skeleton-stripe" />
      </div>
      <Skeleton h={84} mb={12} style={{ marginTop: 14 }} />
      <Skeleton h={64} mb={12} />
      <Skeleton h={120} />
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
// ─── Site hero ─────────────────────────────────────────────────────────
// Navy block that mirrors the office-hero visual language for site
// (engineer) attendance.  Day-state-aware: status pill reflects
// 'On the clock' / 'Checked out for the day' / 'Not checked in', and
// the 3-up stats row shifts to show live elapsed time + today total
// when checked in, vs. distance + sites count when not.
function SiteHero({ sites, myPos, match, isCheckedIn, openSession, sessions = [], totalRaw = 0 }) {
  const t = useT();
  const inside = !!match.inside;
  const distLabel = match.distance >= 1000 ? `${(match.distance / 1000).toFixed(1)}` : `${match.distance}`;
  const distUnit  = match.distance >= 1000 ? 'km' : 'm';
  const acc = (myPos && myPos.accuracy) || 8;
  const center = inside && match.site
    ? { lat: match.site.lat ?? match.site.site_latitude, lng: match.site.lng ?? match.site.site_longitude }
    : (myPos && myPos.lat != null ? { lat: myPos.lat, lng: myPos.lng } : null);

  // Live elapsed-on-site (mins) when checked in — auto-tick every 60s.
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!isCheckedIn) return;
    const id = setInterval(() => setTick((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, [isCheckedIn]);
  let elapsedMin = 0;
  if (isCheckedIn && openSession?.in?.time) {
    elapsedMin = Math.max(0, Math.round((Date.now() - +new Date(openSession.in.time.replace(' ', 'T'))) / 60000));
  }
  const elapsedH = Math.floor(elapsedMin / 60);
  const elapsedM = elapsedMin % 60;

  // Status pill copy reflects actual day state, not just geofence.
  const dayDone = !isCheckedIn && (sessions || []).some((s) => s.out);
  const statusText = isCheckedIn
    ? (inside ? t.inside_zone : t.outside_zone)
    : (dayDone ? t.checked_out_for_day : t.not_checked_in);
  const showLogHint = !inside && !isCheckedIn;

  return (
    <div className={`site-hero ${inside ? 'is-inside' : 'is-outside'} ${isCheckedIn ? 'is-on-clock' : ''}`}>
      <div className="site-hero-head">
        <div className="site-hero-head-body">
          <span className="site-hero-status">
            <span className="site-hero-status-dot" />
            {statusText}
          </span>
          <div className="site-hero-project truncate">
            {inside
              ? match.site.project_name
              : (match.site?.project_name || t.no_site_matched)}
          </div>
          <div className="site-hero-sub">
            <Icon name="pin" size={12} />
            {inside
              ? <><b>{match.site.client || match.site.name}</b> · {match.distance}{t.from_center}</>
              : <>{t.distance_to_nearest} · <b>{match.distance}{t.meters_away}</b></>}
          </div>
          {showLogHint && (
            <div className="site-hero-hint">
              <Icon name="warn" size={11} />
              <span>{t.tap_to_log_violation}</span>
            </div>
          )}
        </div>
        <SiteHeroClock />
      </div>

      <div className="site-hero-map">
        <LeafletMap
          sites={sites}
          userPos={myPos && myPos.lat != null ? myPos : null}
          userLabel={t.location}
          center={center}
          zoom={15}
          height={200}
          interactive={false}
          highlight={match.inside ? match.site?.name : (match.site?.name || null)}
        />
        <div className="site-hero-map-chip">
          <Icon name="pin" size={11} />
          <span><b>{match.distance}</b>{distUnit === 'km' ? ' km' : 'm'}</span>
        </div>
        <div className="site-hero-map-legend">
          <span className="pill-dot" />
          {t.live}
        </div>
      </div>

      <div className="site-hero-stats">
        <div className="site-hero-stat">
          <div className="site-hero-stat-label">
            {isCheckedIn ? t.on_site_since : (inside ? t.from_center_short : t.distance_short)}
          </div>
          <div className="site-hero-stat-value tabular">
            {isCheckedIn && openSession?.in
              ? <>{fmtTime(openSession.in.time)}</>
              : <>{distLabel}<span className="unit">{distUnit}</span></>}
          </div>
          <div className="site-hero-stat-sub">
            {isCheckedIn ? (
              <>
                <span className="live-dot" />
                {elapsedH}h {String(elapsedM).padStart(2, '0')}m {t.elapsed.toLowerCase()}
              </>
            ) : (
              <><Icon name="pin" size={11} />{match.site?.name || '—'}</>
            )}
          </div>
        </div>
        <div className="site-hero-divider" />
        <div className="site-hero-stat">
          <div className="site-hero-stat-label">{t.accuracy_short}</div>
          <div className="site-hero-stat-value">±{acc}<span className="unit">m</span></div>
          <div className="site-hero-stat-sub">
            <span className="live-dot" /> {t.gps_live}
          </div>
        </div>
        <div className="site-hero-divider" />
        <div className="site-hero-stat">
          <div className="site-hero-stat-label">{isCheckedIn ? t.today : t.sites_short}</div>
          <div className="site-hero-stat-value tabular">
            {isCheckedIn
              ? <>{(totalRaw / 60).toFixed(1)}<span className="unit">h</span></>
              : sites.length}
          </div>
          <div className="site-hero-stat-sub">
            {isCheckedIn ? `${(sessions || []).length} ${t.sessions.toLowerCase()}` : t.in_radius}
          </div>
        </div>
      </div>
    </div>
  );
}

// Embedded clock for the engineer site hero (mirrors office-hero pattern).
function SiteHeroClock() {
  const [now, setNow] = React.useState(new Date());
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const ctx = useLang ? useLang() : { lang: 'en' };
  const lang = (ctx && ctx.lang) || 'en';
  const locale = lang === 'ar' ? 'ar-AE' : 'en-GB';
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const date = now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div className="site-hero-clock office-clock" aria-label="Current time">
      <div className="office-clock-time tabular">
        <span>{hh}</span>
        <span className="office-clock-sep">:</span>
        <span>{mm}</span>
        <span className="office-clock-sec tabular">{ss}</span>
      </div>
      <div className="office-clock-date">{date}</div>
    </div>
  );
}

// ─── Legacy MiniMap (unused after the SiteHero rewrite, kept here for any
// other consumer that still references it) ────────────────────────────
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
  const todayKey = new Date().toISOString().slice(0, 10);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const dayEvents = checkins.filter((c) => c.time.startsWith(key)).sort((a, b) => a.time.localeCompare(b.time));
    const sessions = pairSessions(dayEvents, sites);
    let hrs = sessions.reduce((acc, s) => {
      if (s.out) return acc + (s.duration_min || 0) / 60;
      // Live-tally any open session if it's today
      if (s.in && key === todayKey) {
        return acc + Math.max(0, (Date.now() - +new Date(s.in.time.replace(' ', 'T'))) / 3600000);
      }
      return acc;
    }, 0);
    hrs = Math.round(hrs * 10) / 10;
    const site = sessions[0] ? sites.find((s) => s.name === sessions[0].project) : null;
    days.push({ d, key, hrs, site, isToday: key === todayKey });
  }
  const max = Math.max(8, ...days.map((x) => x.hrs));
  const total = days.reduce((a, b) => a + b.hrs, 0);

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="row-between" style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="card-title">{t.weekly_timesheet}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {t.this_week || 'This week'} · {total.toFixed(1)}h
          </div>
        </div>
        <span className="chip chip-info">{(total / 7).toFixed(1)}h {t.avg_per_day || 'avg/day'}</span>
      </div>
      <div className="office-week" style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {days.map((x) => (
          <div key={x.key} className={`office-week-col ${x.isToday ? 'is-today' : ''}`}>
            <div className="office-week-bar-track">
              <div
                className="office-week-bar"
                style={{
                  height: `${(x.hrs / max) * 100}%`,
                  background: x.site?.color || (x.isToday ? 'var(--hivis)' : 'var(--ink-300)'),
                }}
                title={`${x.hrs}h`}
              >
                {x.hrs > 0 && <span className="office-week-bar-num tabular">{x.hrs.toFixed(1)}</span>}
              </div>
            </div>
            <div className="office-week-day">{x.d.toLocaleDateString([], { weekday: 'short' }).slice(0, 3)}</div>
            <div className="office-week-date tabular">{x.d.getDate()}</div>
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

          {/* Impact preview — what happens after submit */}
          <div className="violation-impact">
            <div className="violation-impact-icon">
              <Icon name="user" size={14} />
            </div>
            <div className="violation-impact-body">
              <div className="violation-impact-title">{t.day_will_be_held}</div>
              <div className="violation-impact-sub">
                <Icon name="user" size={11} />
                {t.manager_review}: <b>{(window.CURRENT_USER && (window.CURRENT_USER.leave_approver_name || window.CURRENT_USER.leave_approver || window.CURRENT_USER.reports_to_name)) || '—'}</b>
              </div>
            </div>
            <span className="chip chip-warn chip-dot">
              <Icon name="warn" size={11} /> {t.pending_review}
            </span>
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
