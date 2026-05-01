// Leaves module — ERPNext Leave Application + Leave Allocation.
// Balances pulled from Leave Allocation rollups for the active leave period.

function LeavesScreen({ role, isOffline = false, offlineQueue = [], setOfflineQueue }) {
  const t = useT();
  const toast = useToast();
  const [tab, setTab] = React.useState('mine');
  const [period, setPeriod] = React.useState(null);
  const [balances, setBalances] = React.useState([]);
  const [mine, setMine] = React.useState([]);
  const [team, setTeam] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [showNew, setShowNew] = React.useState(false);
  const [reviewing, setReviewing] = React.useState(null);
  const [viewing, setViewing] = React.useState(null);

  const load = React.useCallback(() => {
    setLoading(true);
    Promise.all([
      window.frappe.getLeavePeriod(),
      window.frappe.getLeaveBalances(),
      window.frappe.getMyLeaves(),
      window.frappe.getTeamLeaves(),
    ]).then(([p, b, m, te]) => { setPeriod(p); setBalances(b); setMine(m); setTeam(te); setLoading(false); });
  }, []);
  React.useEffect(load, [load]);

  if (loading) return <div style={{ padding: 16 }}><Skeleton h={120} mb={12} /><Skeleton h={200} /></div>;

  const showTeam = role === 'manager';

  return (
    <>
      <div className="row-between" style={{ marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>{t.tab_leaves}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {window.CURRENT_USER.employee_name}
            {period && <> · <span className="mono">{period.label}</span></>}
          </div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}>
          <Icon name="plus" size={16} /> {t.new_request}
        </button>
      </div>

      {showTeam && (
        <div className="seg" style={{ marginBottom: 14 }}>
          <button className={`seg-btn ${tab === 'mine' ? 'active' : ''}`} onClick={() => setTab('mine')}>{t.role_employee}</button>
          <button className={`seg-btn ${tab === 'team' ? 'active' : ''}`} onClick={() => setTab('team')}>
            {t.role_manager}
            {team.length > 0 && <span style={{ marginInlineStart: 6, background: 'var(--bad)', color: 'white', fontSize: 10, padding: '1px 6px', borderRadius: 8 }}>{team.length}</span>}
          </button>
        </div>
      )}

      {tab === 'mine' || !showTeam ? (
        <>
          <div className="section-label" style={{ marginTop: 0 }}>
            {t.leave_balance}
            <span style={{ marginInlineStart: 6, fontSize: 9, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>· {t.leave_alloc_subtitle}</span>
          </div>
          <div
            className="hscroll"
            ref={(el) => {
              if (!el || el.__dragWired) return;
              el.__dragWired = true;
              let down = false, startX = 0, startScroll = 0, moved = false;
              el.addEventListener('mousedown', (e) => {
                down = true; moved = false;
                startX = e.pageX; startScroll = el.scrollLeft;
                el.style.cursor = 'grabbing';
                el.style.userSelect = 'none';
              });
              el.addEventListener('mousemove', (e) => {
                if (!down) return;
                const dx = e.pageX - startX;
                if (Math.abs(dx) > 3) moved = true;
                el.scrollLeft = startScroll - dx;
              });
              const stop = () => { down = false; el.style.cursor = 'grab'; el.style.userSelect = ''; };
              el.addEventListener('mouseup', stop);
              el.addEventListener('mouseleave', stop);
              // Suppress accidental click after drag
              el.addEventListener('click', (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
            }}
            style={{ cursor: 'grab' }}
            onWheel={(e) => {
              if (e.deltaY !== 0 && e.deltaX === 0) {
                e.currentTarget.scrollLeft += e.deltaY;
              }
            }}
          >
            {balances.filter((b) => (b.total_leaves_allocated || 0) > 0).map((b) => <BalanceCard key={b.leave_type} b={b} />)}
          </div>

          <div className="section-label"><span>{t.history}</span><span>{mine.length}</span></div>
          <div className="card card-flush">
            {mine.map((l) => <LeaveRow key={l.name} l={l} onClick={() => setViewing(l)} />)}
            {!mine.length && <div className="empty">{t.no_records}</div>}
          </div>
        </>
      ) : (
        <>
          <div className="section-label"><span>{t.pending}</span><span>{team.length}</span></div>
          <div className="card card-flush">
            {team.map((l) => (
              <button key={l.name} onClick={() => setReviewing(l)} style={{ width: '100%', textAlign: 'inherit', background: 'transparent', border: 0, padding: 0, color: 'inherit', display: 'block' }}>
                <div className="list-row">
                  <Avatar initials={l.avatar_initials} />
                  <div className="list-row-body">
                    <div className="list-row-title">{l.employee_name}</div>
                    <div className="list-row-sub truncate">{l.leave_type} · {fmtDateShort(l.from_date)}{l.from_date !== l.to_date ? ` → ${fmtDateShort(l.to_date)}` : ''}{l.half_day ? ' · ½' : ''}</div>
                  </div>
                  <div className="list-row-meta">
                    <div className="list-row-amount">{fmtDays(l.total_leave_days)}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtDateShort(l.posting_date)}</div>
                  </div>
                </div>
              </button>
            ))}
            {!team.length && <div className="empty">{t.no_pending_approvals}</div>}
          </div>
        </>
      )}

      <NewLeaveSheet open={showNew} onClose={() => setShowNew(false)} balances={balances} isOffline={isOffline} setOfflineQueue={setOfflineQueue} onSubmit={(r) => { setMine((m) => [r, ...m]); load(); toast(`${t.new_request} ${t.submitted.toLowerCase()}`, 'ok'); }} />
      <ReviewLeaveSheet item={reviewing} onClose={() => setReviewing(null)} onAct={(action, comment) => {
        const fn = action === 'approve' ? window.frappe.approveLeave : window.frappe.rejectLeave;
        fn(reviewing.name, comment).then(() => { load(); setReviewing(null); toast(`${action === 'approve' ? t.approved : t.rejected}`, action === 'approve' ? 'ok' : 'warn'); });
      }} />
      <LeaveDetailSheet item={viewing} onClose={() => setViewing(null)} />
    </>
  );
}

// ─── Balance card with stacked breakdown ──────────────────────────
function BalanceCard({ b }) {
  const t = useT();
  const totalAlloc = b.total_leaves_allocated || 1;
  const takenPct = (b.leaves_taken / totalAlloc) * 100;
  const pendPct = (b.leaves_pending_approval / totalAlloc) * 100;
  return (
    <div style={{ width: 156, padding: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
      <div style={{ position: 'absolute', insetInlineStart: 0, top: 0, bottom: 0, width: 4, background: b.color }} />
      <div style={{ paddingInlineStart: 8 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{b.leave_type}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 4 }}>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', color: b.color, fontVariantNumeric: 'tabular-nums' }}>{fmtDays(b.leave_balance)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>/ {b.total_leaves_allocated}</div>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
          {fmtDays(b.leaves_taken)} taken{b.leaves_pending_approval ? ` · ${fmtDays(b.leaves_pending_approval)} pending` : ''}
        </div>

        {/* Stacked bar: taken (color) + pending (striped) + remaining (gray) */}
        <div style={{ height: 6, background: 'var(--ink-100)', borderRadius: 3, marginTop: 10, overflow: 'hidden', display: 'flex' }}>
          <div style={{ width: `${takenPct}%`, height: '100%', background: b.color }} />
          <div style={{ width: `${pendPct}%`, height: '100%', background: `repeating-linear-gradient(45deg, ${b.color}, ${b.color} 3px, ${b.color}55 3px, ${b.color}55 6px)` }} />
        </div>

        {/* Meta chips */}
        <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
          {b.carry_forward > 0 && <span className="chip" style={{ fontSize: 9, background: 'var(--surface-2)', color: 'var(--text-muted)' }}>+{b.carry_forward} CF</span>}
          {b.allow_half_day && <span className="chip" style={{ fontSize: 9, background: 'var(--surface-2)', color: 'var(--text-muted)' }}>½-day</span>}
          {b.once_in_service && <span className="chip" style={{ fontSize: 9, background: 'var(--surface-2)', color: 'var(--text-muted)' }}>1× career</span>}
        </div>
      </div>
    </div>
  );
}

// ─── My leave row ──────────────────────────────────────────────
function LeaveRow({ l, onClick }) {
  const t = useT();
  const bal = window.LEAVE_BALANCES.find((x) => x.leave_type === l.leave_type) || {};
  return (
    <button onClick={onClick} style={{ width: '100%', textAlign: 'inherit', background: 'transparent', border: 0, padding: 0, color: 'inherit', display: 'block' }}>
      <div className="list-row">
        <div className="list-row-icon" style={{ background: (bal.color || '#1E3A5F') + '15', color: bal.color || 'var(--navy-800)' }}>
          <Icon name="calendar" size={16} />
        </div>
        <div className="list-row-body">
          <div className="list-row-title">
            {l.leave_type}
            {l.half_day && <span className="chip" style={{ marginInlineStart: 6, fontSize: 9, background: 'var(--surface-2)', color: 'var(--text-muted)' }}>½</span>}
          </div>
          <div className="list-row-sub">{fmtDateShort(l.from_date)}{l.from_date !== l.to_date ? ` → ${fmtDateShort(l.to_date)}` : ''} · {fmtDays(l.total_leave_days)} {l.total_leave_days === 1 ? t.day : t.days}</div>
        </div>
        <div className="list-row-meta">
          <StatusChip status={l.status} />
          <div className="mono" style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>{l.name}</div>
        </div>
      </div>
    </button>
  );
}

// ─── New leave application ──────────────────────────────────────
function NewLeaveSheet({ open, onClose, balances, onSubmit, isOffline, setOfflineQueue }) {
  const t = useT();
  const toast = useToast();
  const defaultType = (balances && balances[0] && balances[0].leave_type) || '';
  const [type, setType] = React.useState(defaultType);
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [halfDay, setHalfDay] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
      const iso = tomorrow.toISOString().slice(0, 10);
      // Default to the first available leave type for THIS user — no more
      // hardcoded "Annual Leave" that breaks on companies using different
      // leave-type names.
      const initialType = (balances && balances[0] && balances[0].leave_type) || '';
      setFrom(iso); setTo(iso); setHalfDay(false); setReason(''); setType(initialType);
    }
  }, [open, balances]);

  const selectedBal = balances.find((b) => b.leave_type === type);
  const rawDays = from && to ? Math.max(1, Math.round((+new Date(to) - +new Date(from)) / 86400000) + 1) : 0;
  const requestDays = halfDay ? Math.max(0.5, rawDays - 0.5) : rawDays;
  const insufficient = selectedBal && requestDays > selectedBal.leave_balance;

  const submit = async () => {
    if (!from || !to || !reason.trim() || insufficient || !type) return;
    setBusy(true);
    const payload = {
      leave_type: type,
      from_date: from,
      to_date: to,
      half_day: halfDay,
      half_day_date: halfDay ? from : undefined,
      description: reason,
    };
    if (isOffline && setOfflineQueue) {
      setOfflineQueue((q) => [...q, { ...payload, _kind: 'leave', _localId: `LV-OFFLINE-${Date.now()}`, queued_at: new Date().toISOString() }]);
      setBusy(false);
      toast(`${t.new_request} — ${t.queued}`, 'warn');
      onClose();
      return;
    }
    const r = await window.frappe.submitLeave(payload);
    setBusy(false);
    onSubmit(r);
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={t.new_request}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>{t.cancel}</button>
        <button className="btn btn-primary" onClick={submit} disabled={busy || !reason.trim() || insufficient || !type}>
          {busy ? <span className="spinner" /> : `${t.submit} · ${fmtDays(requestDays)} ${t.days}`}
        </button>
      </>}>
      <div className="field">
        <label className="field-label">{t.leave_type} *</label>
        <select className="field-select" value={type} onChange={(e) => { setType(e.target.value); if (!balances.find((b) => b.leave_type === e.target.value)?.allow_half_day) setHalfDay(false); }}>
          {balances.filter((b) => (b.total_leaves_allocated || 0) > 0).map((b) => <option key={b.leave_type} value={b.leave_type}>{b.leave_type} — {fmtDays(b.leave_balance)} {t.days} {t.balance}</option>)}
        </select>
      </div>

      {selectedBal && (
        <div style={{ background: selectedBal.color + '10', borderInlineStart: `3px solid ${selectedBal.color}`, padding: '10px 12px', borderRadius: 'var(--radius-sm)', marginBottom: 12, fontSize: 12 }}>
          <div className="row-between" style={{ color: 'var(--text-muted)' }}>
            <span>{t.allocated_period}</span><strong className="tabular" style={{ color: 'var(--text)' }}>{fmtDays(selectedBal.total_leaves_allocated)}</strong>
          </div>
          <div className="row-between" style={{ color: 'var(--text-muted)', marginTop: 3 }}>
            <span>{t.already_taken}</span><strong className="tabular" style={{ color: 'var(--text)' }}>−{fmtDays(selectedBal.leaves_taken)}</strong>
          </div>
          {selectedBal.leaves_pending_approval > 0 && (
            <div className="row-between" style={{ color: 'var(--text-muted)', marginTop: 3 }}>
              <span>{t.pending_approval}</span><strong className="tabular" style={{ color: 'var(--text)' }}>−{fmtDays(selectedBal.leaves_pending_approval)}</strong>
            </div>
          )}
          <div className="row-between" style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid ' + selectedBal.color + '30', fontWeight: 600, color: selectedBal.color }}>
            <span>{t.available}</span><span className="tabular">{fmtDays(selectedBal.leave_balance)}</span>
          </div>
        </div>
      )}

      <div className="field-row">
        <div className="field">
          <label className="field-label">{t.from} *</label>
          <input type="date" className="field-input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label">{t.to} *</label>
          <input type="date" className="field-input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {selectedBal?.allow_half_day && rawDays === 1 && (
        <div className="field" style={{ background: 'var(--surface-2)', padding: 12, borderRadius: 'var(--radius-sm)' }}>
          <div className="row-between">
            <div>
              <div style={{ fontWeight: 500, fontSize: 13 }}>{t.half_day}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.half_day_hint}</div>
            </div>
            <button type="button" className={`switch ${halfDay ? 'on' : ''}`} onClick={() => setHalfDay(!halfDay)}>
              <span className="switch-knob" />
            </button>
          </div>
        </div>
      )}

      {insufficient && (
        <div style={{ background: 'var(--bad-100)', color: 'var(--bad)', padding: '10px 12px', borderRadius: 'var(--radius-sm)', fontSize: 12, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="alert" size={14} /> {t.insufficient_balance} {fmtDays(selectedBal.leave_balance)} {t.days} {t.insufficient_balance_suffix}
        </div>
      )}

      <div className="field">
        <label className="field-label">{t.reason} *</label>
        <textarea className="field-textarea" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.reason_ph} />
      </div>

      <div style={{ background: 'var(--surface-2)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', fontSize: 11, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
        <span>{t.routes_to}</span>
        <strong style={{ color: 'var(--text)' }}>
          {(window.CURRENT_USER && (window.CURRENT_USER.leave_approver_name || window.CURRENT_USER.leave_approver))
            || <span style={{ color: 'var(--warn)', fontWeight: 500 }}>Not configured</span>}
        </strong>
      </div>
    </Sheet>
  );
}

// ─── My leave detail ───────────────────────────────────────────
function LeaveDetailSheet({ item, onClose }) {
  const t = useT();
  if (!item) return null;
  const bal = window.LEAVE_BALANCES.find((b) => b.leave_type === item.leave_type) || {};
  return (
    <Sheet open={!!item} onClose={onClose} title={`Leave ${item.name}`}
      footer={<button className="btn btn-ghost btn-block" onClick={onClose}>{t.close}</button>}>
      <div className="row-between" style={{ marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{item.leave_type}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtDate(item.from_date)}{item.from_date !== item.to_date && ` → ${fmtDate(item.to_date)}`}</div>
        </div>
        <StatusChip status={item.status} />
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row-between"><span className="muted">{t.total_days}</span><strong className="tabular">{fmtDays(item.total_leave_days)}</strong></div>
        {item.half_day && <div className="row-between" style={{ marginTop: 6 }}><span className="muted">{t.half_day}</span><strong>{fmtDate(item.half_day_date)}</strong></div>}
        <div className="row-between" style={{ marginTop: 6 }}><span className="muted">{t.posting_date}</span><strong>{fmtDate(item.posting_date)}</strong></div>
        <div className="row-between" style={{ marginTop: 6 }}><span className="muted">{t.approver}</span><strong>{item.leave_approver_name}</strong></div>
      </div>

      <div className="field">
        <label className="field-label">{t.reason}</label>
        <div style={{ padding: 12, background: 'var(--surface-2)', borderRadius: 'var(--radius)', fontSize: 13 }}>{item.description}</div>
      </div>

      {item.rejection_reason && (
        <div className="card" style={{ background: 'var(--bad-100)', borderColor: 'var(--bad)', marginTop: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--bad)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t.rejected_reason_label}</div>
          <div style={{ fontSize: 13, color: 'var(--bad)', marginTop: 4 }}>{item.rejection_reason}</div>
        </div>
      )}
    </Sheet>
  );
}

// ─── Manager review ────────────────────────────────────────────
function ReviewLeaveSheet({ item, onClose, onAct }) {
  const t = useT();
  const [comment, setComment] = React.useState('');
  React.useEffect(() => { if (item) setComment(''); }, [item]);
  if (!item) return null;
  const balanceAfter = (item.leave_balance_before_application ?? 0) - item.total_leave_days;
  const tight = balanceAfter < 0;
  return (
    <Sheet open={!!item} onClose={onClose} title={t.review_leave}
      footer={<>
        <button className="btn btn-danger" onClick={() => onAct('reject', comment)}>{t.reject}</button>
        <button className="btn btn-success" onClick={() => onAct('approve', comment)}>{t.approve}</button>
      </>}>
      <div className="row-flex" style={{ marginBottom: 14 }}>
        <Avatar initials={item.avatar_initials} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>{item.employee_name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.employee} · {fmtDate(item.posting_date)}</div>
        </div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>{item.name}</div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row-between"><span className="muted">{t.leave_type}</span><strong>{item.leave_type}</strong></div>
        <div className="row-between" style={{ marginTop: 6 }}><span className="muted">{t.from}</span><strong>{fmtDate(item.from_date)}</strong></div>
        <div className="row-between" style={{ marginTop: 6 }}><span className="muted">{t.to}</span><strong>{fmtDate(item.to_date)}</strong></div>
        {item.half_day && <div className="row-between" style={{ marginTop: 6 }}><span className="muted">{t.half_day}</span><strong>{fmtDate(item.half_day_date)}</strong></div>}
        <div className="row-between" style={{ marginTop: 6 }}><span className="muted">{t.days}</span><strong className="tabular">{fmtDays(item.total_leave_days)}</strong></div>
      </div>

      <div className="card" style={{ marginBottom: 12, background: tight ? 'var(--bad-100)' : 'var(--surface-2)', borderColor: tight ? 'var(--bad)' : 'var(--border)' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: tight ? 'var(--bad)' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
          {item.leave_type} balance · {item.employee_name.split(' ')[0]}
        </div>
        <div className="row-between" style={{ fontSize: 12 }}><span className="muted">{t.before_application}</span><strong className="tabular">{fmtDays(item.leave_balance_before_application)} {t.days}</strong></div>
        <div className="row-between" style={{ fontSize: 12, marginTop: 4 }}><span className="muted">{t.this_request}</span><strong className="tabular">−{fmtDays(item.total_leave_days)}</strong></div>
        <div className="row-between" style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)', fontWeight: 600, color: tight ? 'var(--bad)' : 'var(--text)' }}>
          <span>{t.if_approved}</span><span className="tabular">{fmtDays(balanceAfter)} {t.days}</span>
        </div>
      </div>

      <div className="field">
        <label className="field-label">{t.reason}</label>
        <div style={{ padding: 12, background: 'var(--surface-2)', borderRadius: 'var(--radius)', fontSize: 13 }}>{item.description}</div>
      </div>
      <div className="field">
        <label className="field-label">{t.comment}</label>
        <textarea className="field-textarea" value={comment} onChange={(e) => setComment(e.target.value)} />
      </div>
    </Sheet>
  );
}

// Format days like "1", "0.5", "1.5"
function fmtDays(n) {
  if (n == null) return '0';
  return Number(n) % 1 === 0 ? String(n) : Number(n).toFixed(1);
}

Object.assign(window, { LeavesScreen });
