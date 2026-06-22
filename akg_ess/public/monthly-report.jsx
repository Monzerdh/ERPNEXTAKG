// Monthly Attendance Report — calendar grid with green/red status + total hours.
// Employee: locked to self. Manager: dropdown to switch between self + direct reports.

function MonthlyReport({ role, onBack }) {
  const t = useT();
  const today = new Date();
  const [year, setYear] = React.useState(today.getFullYear());
  const [month, setMonth] = React.useState(today.getMonth() + 1); // 1-12
  const [employee, setEmployee] = React.useState(window.CURRENT_USER.employee);
  const [team, setTeam] = React.useState([]);
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [selected, setSelected] = React.useState(null);
  const [correctionModal, setCorrectionModal] = React.useState(null);
  const isOwn = employee === window.CURRENT_USER.employee;

  React.useEffect(() => {
    if (role === 'manager') window.frappe.getTeam().then(setTeam);
  }, [role]);

  React.useEffect(() => {
    setLoading(true);
    window.frappe.getMonthlyAttendance(employee, year, month).then((d) => {
      setData(d); setLoading(false);
    });
  }, [employee, year, month]);

  const stepMonth = (delta) => {
    let m = month + delta, y = year;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    setMonth(m); setYear(y); setSelected(null);
  };

  const locale = window.LANG === 'ar' ? 'ar-AE' : undefined;
  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const monthMax = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const isCurrentMax = year === monthMax.getFullYear() && month === monthMax.getMonth() + 1;

  // Build display grid: Monday-first. AKG default: Mon–Sat are working
  // days, Sunday is the weekend column at the end of each row. Employees
  // who work on Sunday still get a 'present' tile — only empty Sundays
  // render as 'weekend'.
  const firstDow = data ? new Date(year, month - 1, 1).getDay() : 0;
  // dow: Sun=0 Mon=1 ... Sat=6  → display index: Mon=0 Tue=1 Wed=2 Thu=3 Fri=4 Sat=5 Sun=6
  const dowToCol = (dow) => (dow + 6) % 7;
  const leadingBlanks = data ? dowToCol(firstDow) : 0;

  const teamPicker = role === 'manager' && (
    <select
      className="select"
      value={employee}
      onChange={(e) => { setEmployee(e.target.value); setSelected(null); }}
      style={{ marginBottom: 12 }}
    >
      <option value={window.CURRENT_USER.employee}>
        {window.CURRENT_USER.employee_name} (me)
      </option>
      {team.map((m) => (
        <option key={m.employee} value={m.employee}>
          {m.employee_name} · {m.designation}
        </option>
      ))}
    </select>
  );

  const empMeta = employee === window.CURRENT_USER.employee
    ? { name: window.CURRENT_USER.employee_name, designation: window.CURRENT_USER.designation, initials: window.CURRENT_USER.avatar_initials }
    : team.find((m) => m.employee === employee) || { name: employee, designation: '', initials: '?' };

  return (
    <>
      {/* Header strip */}
      <div className="row-between" style={{ marginBottom: 14 }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>
          <Icon name="chevronL" size={16} /> {t.back}
        </button>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}>
          {t.monthly_attendance_kicker}
        </div>
        {isOwn ? (
          <button className="btn btn-ghost btn-sm" onClick={() => setCorrectionModal({ date: (selected && selected.date) || new Date().toISOString().slice(0, 10) })}>
            <Icon name="edit" size={14} /> {t.request_fix}
          </button>
        ) : (
          <div style={{ width: 70 }} />
        )}
      </div>

      {correctionModal && (
        <CorrectionModal
          initialDate={correctionModal.date}
          onClose={() => setCorrectionModal(null)}
          onSubmitted={() => window.frappe.getMonthlyAttendance(employee, year, month).then(setData)}
        />
      )}

      {/* Employee picker */}
      {teamPicker}
      {!teamPicker && (
        <div className="card" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="app-header-avatar" style={{ width: 36, height: 36, fontSize: 13 }}>{empMeta.initials || empMeta.name?.[0]}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }} className="truncate">{empMeta.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{empMeta.designation}</div>
          </div>
        </div>
      )}

      {/* Month nav */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <button className="icon-btn" onClick={() => stepMonth(-1)} aria-label={t.prev_month}>
          <Icon name="chevronL" size={20} />
        </button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>{monthLabel}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{empMeta.name?.split(' ')[0]}{t.employee_attendance_suffix}</div>
        </div>
        <button
          className="icon-btn"
          onClick={() => stepMonth(1)}
          disabled={isCurrentMax}
          style={{ opacity: isCurrentMax ? 0.35 : 1 }}
          aria-label={t.next_month}
        >
          <Icon name="chevron" size={20} />
        </button>
      </div>

      {loading || !data ? (
        <Skeleton h={300} />
      ) : (
        <>
          {/* Summary stats */}
          <div className="stat-grid stat-grid-3" style={{ marginBottom: 12 }}>
            <div className="stat">
              <div className="stat-label">{t.present}</div>
              <div className="stat-value" style={{ color: 'var(--ok)' }}>{data.summary.present_days}<span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>/{data.summary.work_days}</span></div>
              <div className="stat-sub">{data.summary.attendance_pct}%</div>
            </div>
            <div className="stat">
              <div className="stat-label">{t.total_hrs}</div>
              <div className="stat-value">{data.summary.total_hours}</div>
              <div className="stat-sub">{t.avg_per_day} {data.summary.avg_hours}h/{t.day}</div>
            </div>
            <div className="stat">
              <div className="stat-label">{t.absent}</div>
              <div className="stat-value" style={{ color: data.summary.absent_days ? 'var(--bad)' : 'var(--text)' }}>{data.summary.absent_days}</div>
              <div className="stat-sub">{data.summary.leave_days} {t.on_leave}</div>
            </div>
          </div>

          {/* Calendar */}
          <div className="card" style={{ padding: 12 }}>
            <div className="cal-grid cal-head">
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((c, i) => (
                <div key={i} className="cal-dow" style={{ color: (i === 5 || i === 6) ? 'var(--bad)' : 'var(--text-muted)' }}>{c}</div>
              ))}
            </div>
            <div className="cal-grid">
              {Array.from({ length: leadingBlanks }).map((_, i) => <div key={'b' + i} className="cal-cell cal-blank" />)}
              {data.days.map((d) => (
                <button
                  key={d.date}
                  className={`cal-cell cal-${d.status} ${selected?.date === d.date ? 'cal-selected' : ''}`}
                  onClick={() => setSelected(d)}
                  disabled={d.status === 'future'}
                >
                  <div className="cal-num">{d.day}</div>
                  {d.status === 'present' && <div className="cal-hrs tabular">{d.hours.toFixed(1)}h</div>}
                  {d.status === 'pending' && <div className="cal-hrs tabular">{d.hours.toFixed(1)}h</div>}
                  {d.status === 'missed' && <div className="cal-tag">MC</div>}
                  {d.status === 'absent' && <div className="cal-tag">A</div>}
                  {d.status === 'leave' && <div className="cal-tag">L</div>}
                </button>
              ))}
            </div>

            {/* Legend */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14, fontSize: 11, color: 'var(--text-muted)' }}>
              <LegendDot color="var(--ok)" label={`${t.present} (${data.summary.present_days - data.summary.pending_days})`} />
              <LegendDot color="var(--warn)" label={`${t.pending_approval} (${data.summary.pending_days})`} />
              <LegendDot color="#9333EA" label={`${t.missed_checkout} (${data.summary.missed_days || 0})`} />
              <LegendDot color="var(--bad)" label={`${t.absent} (${data.summary.absent_days})`} />
              <LegendDot color="#6366F1" label={`${t.leave} (${data.summary.leave_days})`} />
              <LegendDot color="var(--ink-300)" label={t.weekend} />
            </div>
          </div>

          {/* Selected day details */}
          {selected && selected.status !== 'weekend' && selected.status !== 'future' && (
            <div className="card" style={{ marginTop: 12, borderColor: 'var(--navy-200)' }}>
              <div className="row-between" style={{ marginBottom: 10 }}>
                <div>
                  <div className="card-title" style={{ marginBottom: 2 }}>
                    {new Date(selected.date).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>{selected.date}</div>
                </div>
                <span className={`chip chip-dot chip-${selected.status === 'present' ? 'ok' : (selected.status === 'pending' || selected.status === 'missed') ? 'warn' : selected.status === 'leave' ? 'info' : 'bad'}`}>
                  {selected.status === 'present' ? t.status_present : selected.status === 'pending' ? t.pending_approval : selected.status === 'missed' ? t.missed_checkout : selected.status === 'leave' ? t.status_on_leave : t.status_absent}
                </span>
              </div>
              {(selected.status === 'present' || selected.status === 'pending') && (
                <div className="stat-grid stat-grid-3">
                  <div className="stat" style={{ padding: 10 }}>
                    <div className="stat-label">{t.first_in}</div>
                    <div className="stat-value" style={{ fontSize: 18 }}>{selected.inTime}</div>
                  </div>
                  <div className="stat" style={{ padding: 10 }}>
                    <div className="stat-label">{t.hours}</div>
                    <div className="stat-value" style={{ fontSize: 18 }}>{selected.hours}</div>
                  </div>
                  <div className="stat" style={{ padding: 10 }}>
                    <div className="stat-label">{t.sessions}</div>
                    <div className="stat-value" style={{ fontSize: 18 }}>{selected.sessions}</div>
                  </div>
                </div>
              )}
              {selected.status === 'missed' && (
                <div className="empty-inline" style={{ color: 'var(--warn)' }}>
                  {t.missed_checkout_hint} {selected.inTime ? `· ${t.first_in}: ${selected.inTime}` : ''}
                </div>
              )}
              {selected.status === 'absent' && (
                <div className="empty-inline">{t.no_checkins_recorded}</div>
              )}
              {selected.status === 'leave' && (
                <div className="empty-inline">{t.approved_leave_on_day}</div>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}

function LegendDot({ color, label }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: color, display: 'inline-block' }} />
      <span>{label}</span>
    </div>
  );
}

// ─── Request a correction ─────────────────────────────────────────────
// Employee proposes a fix to a day (in/out time, project, scope) + reason.
// Goes to their manager for approval; on approve the day is corrected.
function CorrectionModal({ initialDate, onClose, onSubmitted }) {
  const t = useT();
  const toast = useToast();
  const [date, setDate] = React.useState(initialDate || new Date().toISOString().slice(0, 10));
  const [ctype, setCtype] = React.useState('Wrong time');
  const [inTime, setInTime] = React.useState('');
  const [inProject, setInProject] = React.useState('');
  const [outTime, setOutTime] = React.useState('');
  const [outProject, setOutProject] = React.useState('');
  const [scope, setScope] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [scopes, setScopes] = React.useState([]);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => { window.frappe.getScopesOfWork().then(setScopes).catch(() => {}); }, []);
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const projects = window.PROJECTS || [];
  const hasChange = inTime || inProject || outTime || outProject || scope;
  // To ADD a missing day you must give a time (a punch can't exist without
  // one); re-tagging a project/scope only works on a day that already has a
  // check-in.
  const needsTime = ctype === 'Missing punch';
  const timeOk = !needsTime || inTime || outTime;
  const canSubmit = date && reason.trim().length >= 5 && hasChange && timeOk && !busy;

  const submit = async () => {
    setBusy(true);
    try {
      await window.frappe.submitCorrection({
        date, correction_type: ctype, reason: reason.trim(),
        in_time: inTime || null, in_project: inProject || null,
        out_time: outTime || null, out_project: outProject || null, scope_of_work: scope || null,
      });
      toast(t.correction_sent, 'ok');
      if (onSubmitted) onSubmitted();
      onClose();
    } catch (e) {
      toast(e.message || 'Failed', 'bad');
    } finally { setBusy(false); }
  };

  return ReactDOM.createPortal(
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '20px 20px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--navy-100)', color: 'var(--navy-800)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="edit" size={18} />
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>{t.request_fix}</div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>{t.correction_hint}</div>
          {needsTime && !timeOk && (
            <div style={{ fontSize: 11.5, color: 'var(--warn)', marginBottom: 10, fontWeight: 600 }}>{t.correction_need_time}</div>
          )}

          <div className="row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label className="field-label">{t.date}</label>
              <input type="date" className="select" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} />
            </div>
            <div>
              <label className="field-label">{t.correction_type}</label>
              <select className="select" value={ctype} onChange={(e) => setCtype(e.target.value)} disabled={busy}>
                {['Wrong time', 'Wrong project', 'Missing punch', 'Other'].map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>

          <div className="row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
            <div>
              <label className="field-label">{t.check_in} ({t.time_label})</label>
              <input type="time" className="select" value={inTime} onChange={(e) => setInTime(e.target.value)} disabled={busy} />
            </div>
            <div>
              <label className="field-label">{t.check_in} {t.project_label}</label>
              <select className="select" value={inProject} onChange={(e) => setInProject(e.target.value)} disabled={busy}>
                <option value="">—</option>
                {projects.map((p) => <option key={p.name} value={p.name}>{p.project_name || p.name}</option>)}
              </select>
            </div>
          </div>

          <div className="row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
            <div>
              <label className="field-label">{t.check_out} ({t.time_label})</label>
              <input type="time" className="select" value={outTime} onChange={(e) => setOutTime(e.target.value)} disabled={busy} />
            </div>
            <div>
              <label className="field-label">{t.check_out} {t.project_label}</label>
              <select className="select" value={outProject} onChange={(e) => setOutProject(e.target.value)} disabled={busy}>
                <option value="">—</option>
                {projects.map((p) => <option key={p.name} value={p.name}>{p.project_name || p.name}</option>)}
              </select>
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <label className="field-label">{t.scope_of_work}</label>
            <select className="select" value={scope} onChange={(e) => setScope(e.target.value)} disabled={busy}>
              <option value="">—</option>
              {scopes.map((sc) => <option key={sc.name} value={sc.name}>{sc.scope_name || sc.name}</option>)}
            </select>
          </div>

          <div style={{ marginTop: 12 }}>
            <label className="field-label">{t.reason} *</label>
            <textarea className="field-textarea" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.correction_reason_ph} rows={3} disabled={busy} style={{ minHeight: 70 }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: 10, marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={onClose} disabled={busy}>{t.cancel}</button>
            <button className="btn btn-primary" onClick={submit} disabled={!canSubmit}>
              {busy ? <span className="spinner" /> : <Icon name="check" size={16} />}
              {t.submit_for_review}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

Object.assign(window, { MonthlyReport });
