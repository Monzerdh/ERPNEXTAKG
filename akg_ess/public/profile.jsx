// Profile + Approvals hub + Geofence violations + Login.

function ProfileScreen({ role, setRole, onLogout, outboxCount = 0, onOpenOutbox }) {
  const t = useT();
  const u = window.CURRENT_USER;
  return (
    <>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>{t.tab_profile}</div>
      </div>

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div className="avatar" style={{ width: 60, height: 60, fontSize: 18, background: 'var(--navy-800)', border: '3px solid var(--accent)' }}>{u.avatar_initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{u.employee_name}</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{u.designation}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }} className="mono">{u.employee} · {u.department}</div>
        </div>
      </div>

      <div className="card card-flush">
        <div className="list-row"><div className="list-row-icon"><Icon name="user" size={16} /></div><div className="list-row-body"><div className="list-row-sub">{t.email}</div><div className="list-row-title" style={{ fontSize: 13 }}>{u.user_id}</div></div></div>
        <div className="list-row"><div className="list-row-icon"><Icon name="bell" size={16} /></div><div className="list-row-body"><div className="list-row-sub">{t.mobile}</div><div className="list-row-title" style={{ fontSize: 13 }}>{u.cell_number}</div></div></div>
        <div className="list-row"><div className="list-row-icon"><Icon name="shield" size={16} /></div><div className="list-row-body"><div className="list-row-sub">{t.joined}</div><div className="list-row-title" style={{ fontSize: 13 }}>{fmtDate(u.date_of_joining)}</div></div></div>
        <div className="list-row"><div className="list-row-icon"><Icon name="file" size={16} /></div><div className="list-row-body"><div className="list-row-sub">{t.company}</div><div className="list-row-title" style={{ fontSize: 13 }}>{u.company}</div></div></div>
        <div className="list-row">
          <div className="list-row-icon"><Icon name="user" size={16} /></div>
          <div className="list-row-body">
            <div className="list-row-sub">{t.reports_to_label}</div>
            <div className="list-row-title" style={{ fontSize: 13 }}>
              {u.reports_to_name
                || (u.reports_to ? <span className="mono" style={{ fontSize: 12 }}>{u.reports_to}</span> : null)
                || <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{t.not_assigned}</span>}
            </div>
          </div>
        </div>
      </div>

      {role === 'manager' && <ManagerTeamCard />}
      <ApprovalsSection role={role} />


      <div className="section-label"><span>{t.app}</span></div>
      <div className="card card-flush">
        <PushToggle />
        <button className="list-row" style={{ width: '100%', background: 'transparent', border: 0, color: 'inherit', textAlign: 'inherit', cursor: 'pointer' }} onClick={onOpenOutbox}>
          <div className="list-row-icon" style={{ background: outboxCount ? 'var(--warn-100)' : 'var(--surface-2)', color: outboxCount ? 'var(--warn)' : 'var(--text-muted)' }}>
            <Icon name="inbox" size={16} />
          </div>
          <div className="list-row-body">
            <div className="list-row-title">{t.outbox}</div>
            <div className="list-row-sub">{outboxCount > 0 ? `${outboxCount} ${t.n_queued}` : t.outbox_empty}</div>
          </div>
          {outboxCount > 0 && <span className="chip chip-warn" style={{ marginInlineEnd: 6 }}>{outboxCount}</span>}
          <Icon name="chevron" size={16} style={{ color: 'var(--text-muted)' }} />
        </button>
        <button className="list-row" style={{ width: '100%', background: 'transparent', border: 0, color: 'inherit', textAlign: 'inherit' }} onClick={onLogout}>
          <div className="list-row-icon" style={{ background: 'var(--bad-100)', color: 'var(--bad)' }}><Icon name="logout" size={16} /></div>
          <div className="list-row-body"><div className="list-row-title" style={{ color: 'var(--bad)' }}>{t.sign_out}</div></div>
          <Icon name="chevron" size={16} style={{ color: 'var(--text-muted)' }} />
        </button>
      </div>

      <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 11 }}>
        AKG ESS · v1.0.0 · Munzer APPs
      </div>
    </>
  );
}

// Enable/disable browser push notifications (approvals, decisions).
function PushToggle() {
  const t = useT();
  const toast = useToast();
  const [state, setState] = React.useState('loading'); // loading|on|off|denied|unsupported
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!window.frappe.pushSupported()) { setState('unsupported'); return; }
    if (window.frappe.pushPermission() === 'denied') { setState('denied'); return; }
    window.frappe.isPushEnabled().then((on) => setState(on ? 'on' : 'off')).catch(() => setState('off'));
  }, []);

  const toggle = async () => {
    setBusy(true);
    try {
      if (state === 'on') { await window.frappe.disablePush(); setState('off'); toast(t.notifs_off, 'ok'); }
      else { await window.frappe.enablePush(); setState('on'); toast(t.notifs_on, 'ok'); }
    } catch (e) {
      toast(e.message || 'Failed', 'bad');
      if (window.frappe.pushPermission() === 'denied') setState('denied');
    } finally { setBusy(false); }
  };

  const sub = state === 'unsupported' ? t.push_unsupported
    : state === 'denied' ? t.push_denied
    : state === 'on' ? t.push_on : t.push_off;

  return (
    <div className="list-row">
      <div className="list-row-icon" style={{ background: state === 'on' ? 'var(--ok-100)' : 'var(--surface-2)', color: state === 'on' ? 'var(--ok)' : 'var(--text-muted)' }}>
        <Icon name="bell" size={16} />
      </div>
      <div className="list-row-body">
        <div className="list-row-title">{t.push_notifs}</div>
        <div className="list-row-sub">{sub}</div>
      </div>
      {(state === 'on' || state === 'off') && (
        <button
          className="btn btn-sm"
          style={{ background: state === 'on' ? 'var(--bad-100)' : 'var(--brand)', color: state === 'on' ? 'var(--bad)' : '#fff', marginInlineEnd: 6 }}
          onClick={toggle}
          disabled={busy}
        >
          {busy ? <span className="spinner" /> : (state === 'on' ? t.disable : t.enable)}
        </button>
      )}
    </div>
  );
}

function ManagerTeamCard() {
  const t = useT();
  const [team, setTeam] = React.useState([]);
  React.useEffect(() => { window.frappe.getTeam().then(setTeam); }, []);
  return (
    <>
      <div className="section-label"><span>{t.direct_reports}</span><span>{team.length}</span></div>
      <div className="card card-flush">
        {team.map((m) => {
          // Live attendance status for today: in / out / not-checked-in.
          const st = m.today_status || 'none';
          const chip = st === 'in'
            ? { label: t.live_in, style: { background: 'var(--ok-100)', color: 'var(--ok)' }, dot: true }
            : st === 'out'
              ? { label: t.live_out, style: { background: 'var(--ink-100)', color: 'var(--text-muted)' }, dot: false }
              : { label: t.live_not_in, style: { background: 'var(--surface-2)', color: 'var(--text-muted)' }, dot: false };
          return (
            <div key={m.name || m.employee} className="list-row">
              <Avatar initials={m.avatar_initials} />
              <div className="list-row-body">
                <div className="list-row-title">{m.employee_name}</div>
                <div className="list-row-sub truncate">{m.designation}</div>
              </div>
              <span className={`chip ${chip.dot ? 'chip-dot' : ''}`} style={chip.style}>{chip.label}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

// Approvals hub — "Me" (my own requests, read-only) and, for managers,
// "My team" (team requests with approve/reject). A person can never approve
// their own request; their own off-zone punches / missed check-outs are
// approved by their manager.
function ApprovalsSection({ role }) {
  const t = useT();
  const isManager = role === 'manager';
  const [tab, setTab] = React.useState(isManager ? 'team' : 'me');
  const mode = isManager ? tab : 'me';
  return (
    <>
      <div className="section-label" style={{ marginTop: 8 }}><span>{t.approvals}</span></div>
      {isManager && (
        <div className="seg" role="tablist" style={{ marginBottom: 10 }}>
          <button type="button" className={`seg-btn ${tab === 'me' ? 'active' : ''}`} onClick={() => setTab('me')}>
            {t.tab_me}
          </button>
          <button type="button" className={`seg-btn ${tab === 'team' ? 'active' : ''}`} onClick={() => setTab('team')}>
            {t.tab_my_team}
          </button>
        </div>
      )}
      <GeofenceViolations mode={mode} />
      {window.MissedCheckoutsQueue && <MissedCheckoutsQueue mode={mode} />}
    </>
  );
}

function GeofenceViolations({ mode = 'team' }) {
  const t = useT();
  const toast = useToast();
  const [v, setV] = React.useState([]);
  const [tab, setTab] = React.useState('pending'); // 'pending' | 'reviewed'
  const [busy, setBusy] = React.useState(null); // single-row action in flight
  const [filters, setFilters] = React.useState({});
  const [limit, setLimit] = React.useState(100);
  const [selected, setSelected] = React.useState(() => new Set());
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const [teamOpts, setTeamOpts] = React.useState([]);
  const canAct = mode === 'team';

  const refresh = React.useCallback(() => {
    const p = mode === 'team' ? window.frappe.getTeamViolations({ ...filters, limit }) : window.frappe.getMyViolations();
    Promise.resolve(p).then((rows) => setV(rows || [])).catch(() => setV([]));
  }, [mode, filters, limit]);
  React.useEffect(() => { refresh(); }, [refresh]);
  React.useEffect(() => {
    if (canAct) window.frappe.getTeam().then((tm) => setTeamOpts(tm || [])).catch(() => {});
  }, [canAct]);

  const pending = v.filter((x) => x.status === 'Pending');
  const reviewed = v.filter((x) => x.status !== 'Pending');
  const list = tab === 'pending' ? pending : reviewed;
  const reachedLimit = mode === 'team' && v.length >= limit;

  const changeFilters = (f) => { setSelected(new Set()); setLimit(100); setFilters(f); };
  const switchTab = (tb) => { setSelected(new Set()); setTab(tb); };
  const toggleSel = (name) => setSelected((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; });
  const allPendingSelected = pending.length > 0 && pending.every((x) => selected.has(x.name));
  const toggleAll = () => setSelected(allPendingSelected ? new Set() : new Set(pending.map((x) => x.name)));

  const act = async (row, kind) => {
    setBusy(row.name);
    try {
      if (kind === 'approve') {
        await window.frappe.approveViolation(row.name, '');
        toast(`${row.employee_name} · ${t.approve_release}`, 'ok');
      } else {
        await window.frappe.rejectViolation(row.name, '');
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
      const r = await window.frappe.bulkDecideViolations(names, action);
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
        <span>{t.violations}</span>
        {pending.length > 0 && <span className="chip chip-warn chip-dot">{pending.length} {t.pending_review}</span>}
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
          <div>{t.no_pending_violations}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {list.map((x) => {
            // Resolve display names from all active Projects (the off-zone
            // picker list), falling back to geofenced SITES, then the raw id.
            const projOf = (id) => id && ((window.PROJECTS || []).find((p) => p.name === id) || (window.SITES || []).find((s) => s.name === id));
            const site = projOf(x.nearest_site);
            const project = projOf(x.selected_project);
            const dist = x.distance_m >= 1000 ? `${(x.distance_m / 1000).toFixed(1)} km` : `${x.distance_m} m`;
            const isBusy = busy === x.name;
            const canSelect = canAct && x.status === 'Pending';
            const statusChip =
              x.status === 'Approved' ? <span className="chip chip-ok">{t.approved}</span> :
              x.status === 'Rejected' ? <span className="chip" style={{ background: 'var(--bad-100)', color: 'var(--bad)' }}>{t.rejected}</span> :
              <span className="chip chip-warn chip-dot">{t.pending_review}</span>;
            return (
              <div key={x.name} className="card" style={{ padding: 0, overflow: 'hidden', borderColor: selected.has(x.name) ? 'var(--navy-800)' : undefined }}>
                <div style={{ padding: 14, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  {canSelect && (
                    <input type="checkbox" style={{ marginTop: 4 }} checked={selected.has(x.name)} onChange={() => toggleSel(x.name)} />
                  )}
                  <Avatar initials={x.avatar_initials} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ fontSize: 14, fontWeight: 700 }} className="truncate">{x.employee_name}</div>
                      {statusChip}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span className="chip" style={{ background: x.log_type === 'IN' ? 'var(--ok-100)' : 'var(--ink-100)', color: x.log_type === 'IN' ? 'var(--ok)' : 'var(--text-muted)', fontSize: 10 }}>
                        {x.log_type === 'IN' ? t.check_in : t.check_out}
                      </span>
                      <span>{fmtDateShort(x.date)} · {x.time.slice(11, 16)}</span>
                    </div>

                    <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 11 }}>
                      <div>
                        <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>{t.select_project}</div>
                        <div className="truncate" style={{ fontWeight: 600 }}>{project?.project_name || x.selected_project}</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>{t.nearest}</div>
                        <div className="truncate"><span style={{ color: 'var(--warn)', fontWeight: 700 }}>{dist}</span> · {site?.project_name || x.nearest_site || '—'}</div>
                      </div>
                    </div>

                    <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--ink-50)', borderRadius: 8, fontSize: 12, lineHeight: 1.45, textWrap: 'pretty' }}>
                      "{x.reason}"
                    </div>

                    {/* Selfie captured at the punch (anti-buddy-punching) */}
                    {x.selfie && (
                      <a href={x.selfie} target="_blank" rel="noopener" style={{ display: 'inline-block', marginTop: 10 }}>
                        <img src={x.selfie} alt={t.selfie} style={{ width: 64, height: 64, borderRadius: 12, objectFit: 'cover', border: '2px solid var(--navy-200)' }} />
                      </a>
                    )}

                    {/* Real OSM map: employee position vs site centre + geofence circle */}
                    {(x.actual_lat ?? x.latitude) != null && site && (
                      <div style={{ marginTop: 10 }}>
                        <LeafletMap
                          sites={[site]}
                          userPos={{
                            lat: x.actual_lat ?? x.latitude,
                            lng: x.actual_lng ?? x.longitude,
                            accuracy: x.accuracy_m,
                          }}
                          userLabel={x.employee_name}
                          height={160}
                          interactive={false}
                          highlight={null}
                        />
                      </div>
                    )}

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

function LoginScreen({ onSignIn, lang, setLanguage }) {
  const t = useT();
  const [usr, setUsr] = React.useState('');
  const [pwd, setPwd] = React.useState('');
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await window.frappe.login(usr, pwd);
      onSignIn();
    } catch (ex) {
      setErr(ex.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="login-screen">
      {setLanguage && (
        <button
          type="button"
          onClick={() => setLanguage(lang === 'ar' ? 'en' : 'ar')}
          title={lang === 'ar' ? 'English' : 'العربية'}
          style={{
            position: 'absolute',
            top: 20,
            insetInlineEnd: 20,
            zIndex: 2,
            width: 40,
            height: 40,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(255,255,255,.08)',
            border: '1px solid rgba(255,255,255,.18)',
            color: 'rgba(255,255,255,.85)',
            borderRadius: 999,
            cursor: 'pointer',
            backdropFilter: 'blur(8px)',
          }}
        >
          <Icon name="globe" size={20} />
        </button>
      )}
      <img src="/assets/akg_ess/assets/akg-logo.png" alt="AKG" className="login-logo" />
      <div className="login-title">AKG ESS</div>
      <div className="login-sub">{t.employee_self_service}</div>
      <form className="login-form" onSubmit={submit}>
        <div className="field">
          <label className="field-label">{t.username}</label>
          <input className="field-input" value={usr} onChange={(e) => setUsr(e.target.value)} autoComplete="username" />
        </div>
        <div className="field">
          <label className="field-label">{t.password}</label>
          <input className="field-input" type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="current-password" />
        </div>
        {err && <div style={{ color: '#FCA5A5', fontSize: 12, marginBottom: 10 }}>{err}</div>}
        <button className="btn btn-accent btn-block btn-lg" type="submit" disabled={busy}>
          {busy ? <span className="spinner" /> : t.sign_in}
        </button>
      </form>
      <div style={{ textAlign: 'center', marginTop: 'auto', paddingTop: 24, fontSize: 11, color: 'rgba(255,255,255,.5)' }}>
        Powered by Munzer APPs · {window.location.host}
      </div>
    </div>
  );
}

Object.assign(window, { ProfileScreen, LoginScreen });
