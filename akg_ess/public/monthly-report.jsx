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

  // Build display grid: Monday-first (UAE Mon–Fri working week, Sat+Sun weekend)
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
        <div style={{ width: 70 }} />
      </div>

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
                  {d.status === 'absent' && <div className="cal-tag">A</div>}
                  {d.status === 'leave' && <div className="cal-tag">L</div>}
                </button>
              ))}
            </div>

            {/* Legend */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14, fontSize: 11, color: 'var(--text-muted)' }}>
              <LegendDot color="var(--ok)" label={`${t.present} (${data.summary.present_days - data.summary.pending_days})`} />
              <LegendDot color="var(--warn)" label={`${t.pending_approval} (${data.summary.pending_days})`} />
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
                <span className={`chip chip-dot chip-${selected.status === 'present' ? 'ok' : selected.status === 'pending' ? 'warn' : selected.status === 'leave' ? 'info' : 'bad'}`}>
                  {selected.status === 'present' ? t.status_present : selected.status === 'pending' ? t.pending_approval : selected.status === 'leave' ? t.status_on_leave : t.status_absent}
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

Object.assign(window, { MonthlyReport });
