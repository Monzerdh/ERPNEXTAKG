// ─── Missed Check-out flow ─────────────────────────────────────────────
// Engineer or office worker forgot to check out yesterday → on app open,
// a warn toast slides in and a full-screen modal opens. They pick the
// real OUT time + give a reason; submission puts the day on hold pending
// manager review. Mirrors OutsideZonePopup so the patterns stay consistent.
//
// Detection in production reads
//   window.frappe.getMyPendingMissedCheckouts()
// which returns Missed Checkout rows the scheduler created overnight.

function MissedCheckoutFlow() {
  const t = useT();
  const toast = useToast();
  // phase: idle | toast | modal | submitting | submitted
  const [phase, setPhase] = React.useState('idle');
  const [submitted, setSubmitted] = React.useState(false);

  const [items, setItems] = React.useState([]);
  const [idx, setIdx] = React.useState(0);
  const total = items.length;
  const current = items[idx];

  // On first mount only (after login). The app shell mounts this once
  // globally; we don't want to re-trigger on every tab change.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await window.frappe.getMyPendingMissedCheckouts();
        if (cancelled || !rows || !rows.length) return;
        setItems(rows);
        setIdx(0);
        setSubmitted(false);
        setPhase('toast');
        const tid = setTimeout(() => setPhase('modal'), 2500);
        return () => clearTimeout(tid);
      } catch (e) {
        // Silent — never block the app on detection failure.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const advance = () => {
    if (idx + 1 < total) {
      setIdx(idx + 1);
      setSubmitted(false);
      setPhase('modal');
    } else {
      setPhase('idle');
      setItems([]);
      window.dispatchEvent(new Event('akg:missed-checkout-resolved'));
    }
  };

  const onSubmit = async ({ time, reason }) => {
    setPhase('submitting');
    try {
      await window.frappe.submitMissedCheckout(current.name, { proposed_out_time: time, reason });
    } catch (e) {
      toast(e.message || 'Failed to submit', 'bad');
      setPhase('modal');
      return;
    }
    setSubmitted(true);
    setPhase('submitted');
    setTimeout(() => {
      toast(t.missed_co_submitted_title + ' ✓', 'ok');
      advance();
    }, 1500);
  };

  // Cancel re-fires next launch — for now we just close + advance.
  const onCancel = () => advance();

  return (
    <>
      {phase === 'toast' && (
        <div className="mc-toast">
          <Icon name="warn" size={16} />
          <span>{t.missed_co_toast}</span>
        </div>
      )}
      {(phase === 'modal' || phase === 'submitting' || phase === 'submitted') && current && (
        <MissedCheckoutModal
          item={current}
          idx={idx}
          total={total}
          submitted={submitted}
          loading={phase === 'submitting'}
          onCancel={onCancel}
          onSubmit={onSubmit}
        />
      )}
    </>
  );
}

function fmtMissedDate(d, lang) {
  const locale = lang === 'ar' ? 'ar-AE' : 'en-GB';
  return d.toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: 'short' });
}

function MissedCheckoutModal({ item, idx, total, submitted, loading, onCancel, onSubmit }) {
  const t = useT();
  const { lang } = useLang();
  const isOffice = item.is_office_worker || item.site?.kind === 'office';

  const defaultTime = isOffice ? '17:30' : '18:00';
  const [time, setTime] = React.useState(item.last_proposed_out_time || defaultTime);
  const [reason, setReason] = React.useState('');
  const [activeChip, setActiveChip] = React.useState(item.last_proposed_out_time ? 'custom' : 'shift_end');
  const [dontRemember, setDontRemember] = React.useState(false);
  const [cancelArmed, setCancelArmed] = React.useState(false);

  React.useEffect(() => {
    setCancelArmed(false);
    const id = setTimeout(() => setCancelArmed(true), 3000);
    return () => clearTimeout(id);
  }, [item.name]);

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && cancelArmed && !loading) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancelArmed, loading, onCancel]);

  const itemDate = React.useMemo(() => new Date(item.date), [item.date]);
  const elapsedH = React.useMemo(() => {
    if (!item.in_time) return 0;
    const [h, m] = item.in_time.split(':').map(Number);
    const inDate = new Date(itemDate); inDate.setHours(h, m, 0, 0);
    return Math.round((Date.now() - +inDate) / 3600000);
  }, [item, itemDate]);

  const dateLabel = fmtMissedDate(itemDate, lang);

  const chips = isOffice
    ? [
        { id: 'shift_end',  label: t.missed_co_chip_office_end, time: '17:30' },
        { id: 'custom',     label: t.missed_co_chip_custom,     time: null },
      ]
    : [
        { id: 'shift_end',  label: t.missed_co_chip_shift_end,  time: '18:00' },
        { id: 'site_close', label: t.missed_co_chip_site_close, time: '20:00' },
        { id: 'custom',     label: t.missed_co_chip_custom,     time: null },
      ];

  const pickChip = (c) => {
    setActiveChip(c.id);
    setDontRemember(false);
    if (c.time) setTime(c.time);
    if (c.id === 'custom') {
      setTimeout(() => document.getElementById('mc-time-input')?.focus(), 0);
    }
  };

  const onDontRemember = () => {
    setDontRemember(true);
    setActiveChip(null);
    if (item.in_time) {
      const [h, m] = item.in_time.split(':').map(Number);
      const out = new Date(); out.setHours(h + 8, m, 0, 0);
      setTime(`${String(out.getHours()).padStart(2,'0')}:${String(out.getMinutes()).padStart(2,'0')}`);
    }
    setReason(t.missed_co_dont_remember_reason);
  };

  const canSubmit = time && reason.trim().length >= 8 && !loading;

  if (submitted) {
    return ReactDOM.createPortal(
      <div className="modal-backdrop">
        <div className="modal-sheet">
          <div className="mc-submitted">
            <div className="mc-submitted-tile">
              <Icon name="check" size={36} />
            </div>
            <div className="mc-submitted-title">{t.missed_co_submitted_title}</div>
            <div className="mc-submitted-sub">{t.missed_co_submitted_sub}</div>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  return ReactDOM.createPortal(
    <div className="modal-backdrop" onClick={loading || !cancelArmed ? undefined : onCancel}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '20px 20px 18px' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 6 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              background: 'var(--warn-100)', color: 'var(--warn)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Icon name="clock" size={22} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>
                  {t.missed_co_title}
                </div>
                {total > 1 && (
                  <span className="chip chip-warn" style={{ fontSize: 10 }}>
                    {(t.missed_co_count_chip || '{n} of {total} to fix')
                      .replace('{n}', idx + 1)
                      .replace('{total}', total)}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.45 }}>
                {dateLabel} · {item.site?.project_name || '—'}
                {item.site?.name && <span className="muted"> ({item.site.name})</span>}
              </div>
            </div>
          </div>

          {/* Rejection callout (retry mode) */}
          {item.rejection && (
            <div className="mc-rejection">
              <Icon name="warn" size={14} style={{ color: 'var(--bad)' }} />
              <div>
                <div className="mc-rejection-title">
                  {(t.missed_co_rejection_title || '{name} sent it back').replace('{name}', item.rejection.manager || '')}
                </div>
                <div className="mc-rejection-note">"{item.rejection.note}"</div>
              </div>
            </div>
          )}

          {/* IN / elapsed read-out */}
          <div className="mc-readout">
            <div className="mc-readout-cell">
              <div className="mc-readout-label">{t.missed_co_checked_in}</div>
              <div className="mc-readout-value tabular">{item.in_time || '—'}</div>
              <div className="mc-readout-sub">{dateLabel}</div>
            </div>
            <div className="mc-readout-divider" />
            <div className="mc-readout-cell">
              <div className="mc-readout-label">{t.missed_co_hours_since}</div>
              <div className={`mc-readout-value tabular ${elapsedH > 18 ? 'is-bad' : ''}`}>
                {elapsedH}<span className="unit">h</span>
              </div>
              <div className="mc-readout-sub">{t.missed_co_no_out}</div>
            </div>
          </div>

          {/* Time picker */}
          <div style={{ marginTop: 16 }}>
            <label className="field-label" htmlFor="mc-time-input">{t.missed_co_picker_label} *</label>
            <input
              id="mc-time-input"
              type="time"
              className="select mc-time-input"
              value={time}
              disabled={loading}
              onChange={(e) => { setTime(e.target.value); setActiveChip('custom'); setDontRemember(false); }}
            />
            {!dontRemember && (
              <div className="mc-hint">{(t.missed_co_picker_hint || '').replace('{default}', defaultTime)}</div>
            )}

            {!dontRemember && (
              <div className="mc-chip-row">
                {chips.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`mc-chip ${activeChip === c.id ? 'is-active' : ''}`}
                    onClick={() => pickChip(c)}
                    disabled={loading}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            )}

            {!dontRemember && (
              <button type="button" className="mc-link" onClick={onDontRemember} disabled={loading}>
                {t.missed_co_dont_remember}
              </button>
            )}
          </div>

          {/* Reason */}
          <div style={{ marginTop: 14 }}>
            <label className="field-label">{t.missed_co_reason_label} *</label>
            <textarea
              className="field-textarea"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t.missed_co_reason_ph}
              rows={3}
              disabled={loading}
              style={{ minHeight: 78 }}
            />
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, textAlign: 'right' }}>
              {reason.trim().length < 8
                ? `${8 - reason.trim().length} ${t.chars_more}`
                : `${reason.length} ${t.chars}`}
            </div>
          </div>

          {/* Impact */}
          <div className="violation-impact">
            <div className="violation-impact-icon">
              <Icon name="user" size={14} />
            </div>
            <div className="violation-impact-body">
              <div className="violation-impact-title">{t.missed_co_will_be_held}</div>
              <div className="violation-impact-sub">
                <Icon name="user" size={11} />
                {t.manager_review}: <b>{(window.CURRENT_USER && (window.CURRENT_USER.leave_approver_name || window.CURRENT_USER.reports_to_name)) || '—'}</b>
              </div>
            </div>
            <span className="chip chip-warn chip-dot">
              <Icon name="warn" size={11} /> {t.pending_review}
            </span>
          </div>

          {/* Actions */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 10, marginTop: 18 }}>
            <button
              className="btn btn-ghost"
              onClick={onCancel}
              disabled={!cancelArmed || loading}
              title={!cancelArmed ? '…' : undefined}
            >
              {t.cancel}
            </button>
            <button
              className="btn btn-primary"
              onClick={() => onSubmit({ time, reason: reason.trim() })}
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

// ─── Hold pill — sits under the attendance hero while a missed-checkout
// is pending review (or briefly after it's been approved).
function MissedCheckoutHoldStrip({ status = 'pending', date }) {
  const t = useT();
  const { lang } = useLang();
  const dateLabel = date ? fmtMissedDate(date instanceof Date ? date : new Date(date), lang) : '';
  if (status === 'approved') {
    return (
      <div className="mc-hold-strip is-ok">
        <Icon name="check" size={14} />
        <div className="mc-hold-strip-body">
          <div className="mc-hold-strip-title">{t.missed_co_approved_pill}</div>
          <div className="mc-hold-strip-sub">{(t.missed_co_approved_sub || '').replace('{date}', dateLabel)}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="mc-hold-strip">
      <span className="mc-hold-strip-dot" />
      <div className="mc-hold-strip-body">
        <div className="mc-hold-strip-title">{t.missed_co_hold_pill}</div>
        <div className="mc-hold-strip-sub">{(t.missed_co_hold_sub || '').replace('{date}', dateLabel)}</div>
      </div>
      <span className="chip chip-warn" style={{ fontSize: 10 }}>{t.pending_review}</span>
    </div>
  );
}

// ─── Manager queue — sits on Profile under Geofence Violations.
function MissedCheckoutsQueue({ mode = 'team' }) {
  const t = useT();
  const toast = useToast();
  const [rows, setRows] = React.useState([]);
  const [tab, setTab] = React.useState('pending');
  const [busy, setBusy] = React.useState(null);
  const [filters, setFilters] = React.useState({});
  const [limit, setLimit] = React.useState(100);
  const [selected, setSelected] = React.useState(() => new Set());
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const [teamOpts, setTeamOpts] = React.useState([]);
  const canAct = mode === 'team';

  const refresh = React.useCallback(() => {
    const p = mode === 'team' ? window.frappe.getMissedCheckouts({ ...filters, limit }) : window.frappe.getMyMissedCheckouts();
    Promise.resolve(p).then((r) => setRows(r || [])).catch(() => setRows([]));
  }, [mode, filters, limit]);
  React.useEffect(() => { refresh(); }, [refresh]);
  React.useEffect(() => {
    if (canAct) window.frappe.getTeam().then((tm) => setTeamOpts(tm || [])).catch(() => {});
  }, [canAct]);

  const pending = rows.filter((r) => r.status === 'Pending');
  const reviewed = rows.filter((r) => r.status !== 'Pending');
  const list = tab === 'pending' ? pending : reviewed;
  const reachedLimit = mode === 'team' && rows.length >= limit;

  const changeFilters = (f) => { setSelected(new Set()); setLimit(100); setFilters(f); };
  const switchTab = (tb) => { setSelected(new Set()); setTab(tb); };
  const toggleSel = (name) => setSelected((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; });
  const allPendingSelected = pending.length > 0 && pending.every((x) => selected.has(x.name));
  const toggleAll = () => setSelected(allPendingSelected ? new Set() : new Set(pending.map((x) => x.name)));

  const act = async (row, kind) => {
    setBusy(row.name);
    try {
      if (kind === 'approve') {
        await window.frappe.approveMissedCheckout(row.name, { edited_out_time: row.proposed_out_time });
        toast(`${row.employee_name} · ${t.approve_release}`, 'ok');
      } else {
        await window.frappe.rejectMissedCheckout(row.name, '');
        toast(`${row.employee_name} · ${t.reject_violation}`, 'bad');
      }
      refresh();
    } catch (e) {
      toast(e.message || 'Failed', 'bad');
    } finally {
      setBusy(null);
    }
  };

  const bulk = async (action) => {
    const names = [...selected];
    if (!names.length) return;
    setBulkBusy(true);
    try {
      const r = await window.frappe.bulkDecideMissedCheckouts(names, action);
      const done = (r && r.done) ? r.done.length : 0;
      const failed = (r && r.failed) ? r.failed.length : 0;
      toast(`${done} ${action === 'approve' ? t.approved : t.rejected}${failed ? ` · ${failed} ${t.failed}` : ''}`, failed ? 'warn' : 'ok');
      setSelected(new Set());
      refresh();
    } catch (e) {
      toast(e.message || 'Failed', 'bad');
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <>
      <div className="section-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>{t.missed_checkouts}</span>
        {pending.length > 0 && (
          <span className="chip chip-warn chip-dot">{pending.length} {t.pending_review}</span>
        )}
      </div>

      {canAct && <TeamFilters team={teamOpts} projects={window.PROJECTS || []} value={filters} onChange={changeFilters} />}

      <div className="seg" role="tablist" style={{ marginBottom: 8 }}>
        <button type="button" className={`seg-btn ${tab === 'pending' ? 'active' : ''}`} onClick={() => switchTab('pending')}>
          {t.pending_review} ({pending.length})
        </button>
        <button type="button" className={`seg-btn ${tab === 'reviewed' ? 'active' : ''}`} onClick={() => switchTab('reviewed')}>
          {t.reviewed} ({reviewed.length})
        </button>
      </div>

      {canAct && tab === 'pending' && pending.length > 0 && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)', margin: '0 2px 8px' }}>
          <input type="checkbox" checked={allPendingSelected} onChange={toggleAll} />
          {t.select_all} ({pending.length})
        </label>
      )}

      {list.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '20px 16px' }}>
          <Icon name="check" size={20} style={{ color: 'var(--ok)', marginBottom: 6 }} />
          <div>{t.missed_co_no_pending}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {list.map((x) => {
            const dontRemember = /don'?t remember|لا يتذكر/i.test(x.reason || '');
            const isBusy = busy === x.name;
            const canSelect = canAct && x.status === 'Pending';
            const statusChip =
              x.status === 'Approved' ? <span className="chip chip-ok">{t.approved}</span> :
              x.status === 'Rejected' ? <span className="chip" style={{ background: 'var(--bad-100)', color: 'var(--bad)' }}>{t.rejected}</span> :
              <span className="chip chip-warn chip-dot">{t.pending_review}</span>;
            return (
              <div key={x.name} className="card mc-queue-card" style={{ padding: 0, overflow: 'hidden', borderColor: selected.has(x.name) ? 'var(--navy-800)' : undefined }}>
                <div style={{ padding: 14, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  {canSelect && (
                    <input type="checkbox" style={{ marginTop: 4 }} checked={selected.has(x.name)} onChange={() => toggleSel(x.name)} />
                  )}
                  <Avatar initials={x.avatar_initials || (x.employee_name || '?')[0]} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ fontSize: 14, fontWeight: 700 }} className="truncate">{x.employee_name}</div>
                      {statusChip}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }} className="truncate">
                      {x.site_name || ''} · {fmtDateShort(x.date)}
                    </div>

                    <div className="mc-queue-times" style={{ marginTop: 10 }}>
                      <div className="mc-queue-time mc-queue-time-in">
                        <div className="mc-queue-time-label">{t.missed_co_card_in}</div>
                        <div className="mc-queue-time-value tabular">{x.in_time || '—'}</div>
                      </div>
                      <div className="mc-queue-time">
                        <div className="mc-queue-time-label">{t.missed_co_card_proposed}</div>
                        <div className="mc-queue-time-value tabular" style={{ color: dontRemember ? 'var(--text-muted)' : 'var(--warn)' }}>
                          {dontRemember ? '— —' : (x.proposed_out_time || '—')}
                        </div>
                      </div>
                      <span className="mc-queue-elapsed">
                        {(t.missed_co_card_elapsed || '{h}h ago').replace('{h}', x.elapsed_h || '?')}
                      </span>
                    </div>

                    <div className="mc-queue-reason">
                      {dontRemember ? <em style={{ color: 'var(--text-muted)' }}>{t.missed_co_dont_remember}</em> : `"${x.reason || ''}"`}
                    </div>

                    {x.status !== 'Pending' && x.approver_comment && (
                      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                        <strong>{x.approver}:</strong> {x.approver_comment}
                      </div>
                    )}
                  </div>
                </div>

                {canAct && x.status === 'Pending' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, borderTop: '1px solid var(--ink-200)' }}>
                    <button
                      onClick={() => act(x, 'reject')}
                      disabled={isBusy}
                      style={{ padding: '12px 14px', background: 'transparent', border: 0, borderRight: '1px solid var(--ink-200)', color: 'var(--bad)', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                    >
                      <Icon name="x" size={14} /> {t.reject_violation}
                    </button>
                    <button
                      onClick={() => act(x, 'approve')}
                      disabled={isBusy}
                      style={{ padding: '12px 14px', background: 'var(--ok-100)', border: 0, color: 'var(--ok)', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                    >
                      {isBusy ? <span className="spinner" /> : <Icon name="check" size={14} />} {t.approve_release}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {reachedLimit && (
        <button className="btn btn-sm btn-ghost" style={{ width: '100%', marginTop: 10 }} onClick={() => setLimit((l) => l + 100)}>
          {t.load_more}
        </button>
      )}

      {canAct && tab === 'pending' && (
        <BulkActionBar count={selected.size} busy={bulkBusy} onApprove={() => bulk('approve')} onReject={() => bulk('reject')} onClear={() => setSelected(new Set())} />
      )}
    </>
  );
}

Object.assign(window, { MissedCheckoutFlow, MissedCheckoutModal, MissedCheckoutHoldStrip, MissedCheckoutsQueue });
