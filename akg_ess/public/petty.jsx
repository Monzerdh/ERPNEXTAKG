// Petty Cash — ERPNext Expense Claim DocType.
// Parent: Expense Claim. Children: Expense Claim Detail rows with
// expense_date, expense_type, description, amount, sanctioned_amount, vat_included, attachment.

function PettyScreen({ role, geofenceMode, isOffline = false, offlineQueue = [], setOfflineQueue }) {
  const t = useT();
  const toast = useToast();
  const [tab, setTab] = React.useState('mine');
  const [balance, setBalance] = React.useState(null);
  const [mine, setMine] = React.useState([]);
  const [team, setTeam] = React.useState([]);
  const [myTopups, setMyTopups] = React.useState([]);
  const [teamTopups, setTeamTopups] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [showNew, setShowNew] = React.useState(false);
  const [showTopup, setShowTopup] = React.useState(false);
  const [reviewing, setReviewing] = React.useState(null);
  const [reviewingTopup, setReviewingTopup] = React.useState(null);
  const [viewingTopup, setViewingTopup] = React.useState(null);
  const [viewing, setViewing] = React.useState(null);

  const load = React.useCallback(() => {
    setLoading(true);
    Promise.all([
      window.frappe.getPettyBalance(),
      window.frappe.getMyClaims(),
      window.frappe.getTeamClaims(),
      window.frappe.getMyTopups(),
      window.frappe.getTeamTopups(),
    ]).then(([b, m, te, mt, tt]) => {
      setBalance(b); setMine(m); setTeam(te); setMyTopups(mt); setTeamTopups(tt); setLoading(false);
    });
  }, []);
  React.useEffect(load, [load]);

  if (loading) return <div style={{ padding: 16 }}><Skeleton h={140} mb={12} /><Skeleton h={200} /></div>;

  const showTeam = role === 'manager';

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>{t.tab_petty}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{window.CURRENT_USER.employee_name}</div>
      </div>

      {showTeam && (
        <div className="seg" style={{ marginBottom: 14 }}>
          <button className={`seg-btn ${tab === 'mine' ? 'active' : ''}`} onClick={() => setTab('mine')}>{t.role_employee}</button>
          <button className={`seg-btn ${tab === 'team' ? 'active' : ''}`} onClick={() => setTab('team')}>
            {t.role_manager}
            {(team.length + teamTopups.length) > 0 && <span style={{ marginInlineStart: 6, background: 'var(--bad)', color: 'white', fontSize: 10, padding: '1px 6px', borderRadius: 8 }}>{team.length + teamTopups.length}</span>}
          </button>
        </div>
      )}

      {(tab === 'mine' || !showTeam) && (
        <>
          <div className="card card-flush" style={{ background: 'linear-gradient(135deg, var(--navy-900) 0%, var(--navy-700) 100%)', color: 'white', border: 0, marginBottom: 14 }}>
            <div className="hivis-stripe" />
            <div style={{ padding: 18 }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.65)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>{t.petty_balance}</div>
              <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.02em', marginTop: 4 }}>{fmtMoney(balance.available, balance.currency)}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,.15)' }}>
                <div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,.55)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t.advance}</div>
                  <div style={{ fontWeight: 600, marginTop: 2 }}>{fmtMoney(balance.advance, balance.currency)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,.55)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t.spent}</div>
                  <div style={{ fontWeight: 600, marginTop: 2 }}>{fmtMoney(balance.spent, balance.currency)}</div>
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <button className="btn btn-accent btn-lg" onClick={() => setShowNew(true)}>
              <Icon name="camera" size={18} /> {t.new_claim}
            </button>
            <button className="btn btn-ghost btn-lg" onClick={() => setShowTopup(true)}>
              <Icon name="plus" size={18} /> {t.request_topup}
            </button>
          </div>

          {myTopups.length > 0 && (
            <>
              <div className="section-label">{t.my_topups}</div>
              <div className="card card-flush" style={{ marginBottom: 14 }}>
                {myTopups.map((r) => <TopupRow key={r.name} row={r} onClick={() => setViewingTopup(r)} />)}
              </div>
            </>
          )}

          <div className="section-label">{t.history}</div>
          <div className="card card-flush">
            {mine.map((c) => <ClaimRow key={c.name} claim={c} onClick={() => setViewing(c)} />)}
            {!mine.length && <div className="empty">{t.no_records}</div>}
          </div>
        </>
      )}

      {tab === 'team' && showTeam && (
        <>
          {teamTopups.length > 0 && (
            <>
              <div className="section-label"><span>{t.topup_requests}</span><span>{teamTopups.length}</span></div>
              <div className="card card-flush" style={{ marginBottom: 14 }}>
                {teamTopups.map((r) => <TopupRow key={r.name} row={r} showEmployee onClick={() => setReviewingTopup(r)} />)}
              </div>
            </>
          )}
          <div className="section-label"><span>{t.pending}</span><span>{team.length}</span></div>
          <div className="card card-flush">
            {team.map((c) => <ClaimRow key={c.name} claim={c} showEmployee onClick={() => setReviewing(c)} />)}
            {!team.length && <div className="empty">{t.no_pending_claims}</div>}
          </div>
        </>
      )}

      <NewClaimSheet open={showNew} onClose={() => setShowNew(false)} geofenceMode={geofenceMode} isOffline={isOffline} setOfflineQueue={setOfflineQueue}
        onSubmit={(row) => { setMine((m) => [row, ...m]); load(); toast(`Expense claim ${t.submitted.toLowerCase()}`, 'ok'); }} />

      <TopupSheet open={showTopup} onClose={() => setShowTopup(false)}
        onSubmit={() => { load(); toast(`${t.request_topup} ✓`, 'ok'); }} />

      <ReviewClaimSheet item={reviewing} onClose={() => setReviewing(null)} onAct={(action, comment) => {
        const fn = action === 'approve' ? window.frappe.approveClaim : window.frappe.rejectClaim;
        fn(reviewing.name, comment).then(() => { load(); setReviewing(null); toast(`${action === 'approve' ? t.approved : t.rejected}`, action === 'approve' ? 'ok' : 'warn'); });
      }} />

      <ReviewTopupSheet item={reviewingTopup} onClose={() => setReviewingTopup(null)} onAct={(action, comment) => {
        const fn = action === 'approve' ? window.frappe.approveTopup : window.frappe.rejectTopup;
        fn(reviewingTopup.name, comment).then(() => { load(); setReviewingTopup(null); toast(`${action === 'approve' ? t.approved : t.rejected}`, action === 'approve' ? 'ok' : 'warn'); });
      }} />

      <TopupDetailSheet item={viewingTopup} onClose={() => setViewingTopup(null)} />

      <ClaimDetailSheet item={viewing} onClose={() => setViewing(null)} />
    </>
  );
}

function ClaimRow({ claim, showEmployee, onClick }) {
  const t = useT();
  const first = claim.expenses?.[0];
  const lineCount = claim.expenses?.length || 0;
  const type = window.EXPENSE_CLAIM_TYPES.find((x) => x.name === first?.expense_type) || window.EXPENSE_CLAIM_TYPES.at(-1);
  return (
    <button onClick={onClick} style={{ width: '100%', background: 'transparent', border: 0, padding: 0, color: 'inherit', display: 'block', textAlign: 'inherit' }}>
      <div className="list-row">
        {showEmployee
          ? <Avatar initials={claim.avatar_initials} />
          : <div className="list-row-icon" style={{ background: type.bg, color: type.color }}><Icon name={type.icon} size={16} /></div>}
        <div className="list-row-body">
          <div className="list-row-title truncate">{showEmployee ? claim.employee_name : claim.vendor}</div>
          <div className="list-row-sub truncate">
            {showEmployee ? `${claim.vendor} · ` : ''}
            {lineCount > 1 ? `${lineCount} ${t.expenses_count}` : first?.expense_type}
            {first?.vat_included ? ' · VAT' : ''}
          </div>
        </div>
        <div className="list-row-meta">
          <div className="list-row-amount">{fmtMoney(claim.total_amount, claim.currency)}</div>
          <div style={{ marginTop: 2 }}><StatusChip status={claim.status} /></div>
        </div>
      </div>
    </button>
  );
}

// ─── New claim ─────────────────────────────────────────────────────────────
function NewClaimSheet({ open, onClose, geofenceMode, onSubmit, isOffline, setOfflineQueue }) {
  const t = useT();
  const toast = useToast();
  const [expenses, setExpenses] = React.useState([]);
  const fileRef = React.useRef(null);
  const cameraRef = React.useRef(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => { if (open) setExpenses([]); }, [open]);

  // GL/cost-center auto-suggest based on current site (live GPS).
  // Falls back to head-office cost center when off-site or GPS isn't ready.
  const [currentSite, setCurrentSite] = React.useState(null);
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const pos = await window.geo.getCurrentPosition({ timeout: 8000 });
        const sites = window.SITES || [];
        const m = window.geo.matchSite(pos, sites);
        if (!cancelled && m.inside && m.site) setCurrentSite(m.site.name);
      } catch (e) { /* keep null */ }
    })();
    return () => { cancelled = true; };
  }, [open]);
  // If we matched a site, use its cost center. Otherwise leave blank — the
  // server will fall back to the company default cost center on Expense
  // Claim insert. Hardcoding a name here would 400 on sites that don't
  // happen to have that cost center.
  const defaultCC = (window.SITES || []).find((s) => s.name === currentSite)?.cost_center || '';
  const defaultProject = currentSite || '';

  const onPick = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    for (const f of files) {
      const dataUrl = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
      const id = Math.random().toString(36).slice(2);
      const today = new Date().toISOString().slice(0, 10);
      const newE = {
        id,
        attachment_url: dataUrl,
        attachment: f.name,
        scanning: true,
        expense_date: today,
        expense_type: 'Other',
        description: '',
        vendor: '',
        amount: 0,
        vat_included: true,
        is_tax_invoice: false,
        trn: '',
        invoice_number: '',
        project: defaultProject,
      };
      setExpenses((r) => [...r, newE]);
      window.frappe.extractReceipt(dataUrl).then((extracted) => {
        setExpenses((r) => r.map((x) => x.id === id ? {
          ...x,
          vendor: extracted.vendor || x.vendor,
          amount: extracted.amount || 0,
          expense_date: extracted.date || x.expense_date,
          expense_type: extracted.expense_type || extracted.category || 'Other',
          description: extracted.description || extracted.vendor || '',
          vat_included: typeof extracted.vat_included === 'boolean' ? extracted.vat_included : true,
          is_tax_invoice: !!extracted.is_tax_invoice,
          trn: extracted.trn || '',
          invoice_number: extracted.invoice_number || '',
          scanning: false,
        } : x));
      });
    }
  };

  const update = (id, patch) => setExpenses((r) => r.map((x) => x.id === id ? { ...x, ...patch } : x));
  const remove = (id) => setExpenses((r) => r.filter((x) => x.id !== id));

  const submit = async () => {
    if (!expenses.length) return;
    setBusy(true);
    const payload = {
      vendor: expenses[0].vendor || expenses[0].description || t.multi_vendor_claim,
      posting_date: new Date().toISOString().slice(0, 10),
      cost_center: defaultCC,
      expenses: expenses.map((e) => ({
        expense_date: e.expense_date,
        expense_type: e.expense_type,
        description: e.description,
        amount: parseFloat(e.amount) || 0,
        vat_included: !!e.vat_included,
        attachment: e.attachment,
        attachment_url: e.attachment_url,
        vendor: e.vendor,
        is_tax_invoice: !!e.is_tax_invoice,
        trn: e.trn,
        invoice_number: e.invoice_number,
        project: e.project,
      })),
    };
    if (isOffline && setOfflineQueue) {
      setOfflineQueue((q) => [...q, { ...payload, _kind: 'claim', _localId: `EC-OFFLINE-${Date.now()}`, queued_at: new Date().toISOString() }]);
      setBusy(false);
      toast(`${t.new_claim} — ${t.queued}`, 'warn');
      onClose();
      return;
    }
    const row = await window.frappe.submitClaim(payload);
    setBusy(false);
    onSubmit(row);
    onClose();
  };

  const total = expenses.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const allReady = expenses.length && expenses.every((r) => !r.scanning && r.description && r.amount > 0 && r.vendor && r.project && (!r.is_tax_invoice || (r.trn && r.trn.length >= 10)));

  // Derive VAT breakdown
  const vatLines = expenses.filter((r) => r.vat_included && !r.scanning);
  const vatGross = vatLines.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const subtotal = vatGross / 1.05;
  const vat = vatGross - subtotal;
  const nonVat = expenses.filter((r) => !r.vat_included && !r.scanning).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

  return (
    <Sheet open={open} onClose={onClose}
      title={`${t.new_claim}${expenses.length > 1 ? ` (${expenses.length})` : ''}`}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>{t.cancel}</button>
        <button className="btn btn-primary" onClick={submit} disabled={busy || !allReady}>
          {busy ? <span className="spinner" /> : `${t.submit} · ${fmtMoney(total)}`}
        </button>
      </>}>
      {!expenses.length && (
        <div style={{ padding: 32, textAlign: 'center', border: '2px dashed var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface-2)' }}>
          <Icon name="receipt" size={36} style={{ color: 'var(--text-muted)', marginBottom: 8 }} />
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{t.snap_or_upload}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>{t.autofill_hint}</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button className="btn btn-primary btn-sm" onClick={() => cameraRef.current?.click()}>
              <Icon name="camera" size={14} /> {t.scan_receipt}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={14} /> {t.upload_receipt}
            </button>
          </div>
        </div>
      )}

      {expenses.length > 0 && expenses.some((r) => !r.scanning) && (
        <div style={{ background: 'var(--warn-100)', border: '1px solid var(--warn)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', marginBottom: 12, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--warn)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name="eye" size={13} />
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text)' }}>
            <strong>{t.review_before_submit_title}</strong> · {t.review_before_submit_body}
          </div>
        </div>
      )}

      {expenses.map((r) => <ExpenseLineCard key={r.id} r={r} onChange={(p) => update(r.id, p)} onRemove={() => remove(r.id)} />)}

      {expenses.length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
            <button className="btn btn-ghost" onClick={() => cameraRef.current?.click()}>
              <Icon name="camera" size={14} /> {t.scan_receipt}
            </button>
            <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={14} /> {t.upload_receipt}
            </button>
          </div>

          {/* VAT breakdown */}
          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-title" style={{ marginBottom: 10 }}>{t.vat_breakdown}</div>
            <div className="row-between" style={{ fontSize: 13 }}><span className="muted">{t.subtotal} (excl. VAT)</span><span className="tabular">{fmtMoney(subtotal + nonVat)}</span></div>
            <div className="row-between" style={{ fontSize: 13, marginTop: 6 }}><span className="muted">{t.vat_amount}</span><span className="tabular">{fmtMoney(vat)}</span></div>
            <div className="row-between" style={{ fontSize: 14, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', fontWeight: 700 }}>
              <span>{t.grand_total}</span><span className="tabular">{fmtMoney(total)}</span>
            </div>
          </div>
        </>
      )}

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={onPick} />
      <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple style={{ display: 'none' }} onChange={onPick} />
    </Sheet>
  );
}

function ExpenseLineCard({ r, onChange, onRemove }) {
  const t = useT();
  const types = window.EXPENSE_CLAIM_TYPES;
  const isPdf = (r.attachment || '').toLowerCase().endsWith('.pdf');
  // Active sites for project picker — restrict to non-archived
  const sites = (window.SITES || []).filter((s) => s.status !== 'Archived');

  return (
    <div className="card" style={{ position: 'relative', padding: 0, overflow: 'hidden', marginBottom: 12 }}>
      {/* Bill preview */}
      <div style={{ position: 'relative', height: 160, background: '#0F172A' }}>
        {isPdf ? (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 6, color: 'white' }}>
            <Icon name="file" size={36} />
            <div style={{ fontSize: 12, opacity: 0.8 }}>{r.attachment}</div>
          </div>
        ) : (
          <img src={r.attachment_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
        {r.scanning && (
          <div className="scan-overlay">
            <div className="scan-line" />
            <Icon name="eye" size={28} />
            <div style={{ fontWeight: 600, fontSize: 13 }}>{t.scanning}</div>
          </div>
        )}
        <button className="icon-btn" style={{ position: 'absolute', top: 8, insetInlineEnd: 8, background: 'rgba(0,0,0,.55)', color: 'white' }} onClick={onRemove}>
          <Icon name="x" size={18} />
        </button>
        {!r.scanning && (
          <div style={{ position: 'absolute', bottom: 8, insetInlineStart: 8, background: 'rgba(15,128,61,.92)', color: 'white', padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Icon name="check" size={12} /> {t.auto_filled}
          </div>
        )}
        <div style={{ position: 'absolute', top: 8, insetInlineStart: 8, background: 'rgba(0,0,0,.55)', color: 'white', padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
          <Icon name="receipt" size={12} /> {r.attachment}
        </div>
      </div>

      <div style={{ padding: 14 }}>
        {/* Expense Claim Type */}
        <div className="field">
          <label className="field-label">{t.expense_type} *</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, background: 'var(--surface-2)', padding: 3, borderRadius: 'var(--radius)' }}>
            {types.map((c) => (
              <button key={c.name} type="button" className={`seg-btn ${r.expense_type === c.name ? 'active' : ''}`} onClick={() => onChange({ expense_type: c.name })} style={{ padding: '8px 4px', flexDirection: 'column', display: 'flex', alignItems: 'center', gap: 2 }} disabled={r.scanning}>
                <Icon name={c.icon} size={14} />
                <span style={{ fontSize: 9.5, lineHeight: 1.1 }}>{c.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Date */}
        <div className="field">
          <label className="field-label">{t.expense_date} *</label>
          <input className="field-input" type="date" value={r.expense_date} onChange={(e) => onChange({ expense_date: e.target.value })} disabled={r.scanning} />
        </div>

        {/* Vendor / Supplier */}
        <div className="field">
          <label className="field-label">{t.vendor} *</label>
          <input className="field-input" type="text" value={r.vendor} onChange={(e) => onChange({ vendor: e.target.value })} disabled={r.scanning} placeholder={t.vendor_ph} />
        </div>

        {/* Tax invoice toggle + TRN */}
        <div className="field">
          <div className="row-flex" style={{ alignItems: 'center', justifyContent: 'space-between', marginBottom: r.is_tax_invoice ? 8 : 0 }}>
            <label className="field-label" style={{ margin: 0 }}>{t.tax_invoice}</label>
            <div className={`switch ${r.is_tax_invoice ? 'on' : ''}`} onClick={() => !r.scanning && onChange({ is_tax_invoice: !r.is_tax_invoice, vat_included: !r.is_tax_invoice ? true : r.vat_included })}>
              <div className="switch-knob" />
            </div>
          </div>
          {r.is_tax_invoice && (
            <input
              className="field-input mono"
              type="text"
              value={r.trn || ''}
              onChange={(e) => onChange({ trn: e.target.value.replace(/[^\d]/g, '').slice(0, 15) })}
              disabled={r.scanning}
              placeholder={t.trn_ph}
              maxLength={15}
              inputMode="numeric"
            />
          )}
          {r.is_tax_invoice && r.trn && r.trn.length < 15 && (
            <div style={{ fontSize: 11, color: 'var(--bad)', marginTop: 4 }}>{t.trn_length_hint}</div>
          )}
        </div>

        {/* Project (employee selects — info not on the bill) */}
        <div className="field">
          <label className="field-label">{t.project} *</label>
          <select className="field-input" value={r.project || ''} onChange={(e) => onChange({ project: e.target.value })} disabled={r.scanning}>
            <option value="">{t.select_project_ph}</option>
            {sites.map((s) => <option key={s.name} value={s.name}>{s.project_name || s.name}</option>)}
          </select>
        </div>

        {/* Description */}
        <div className="field">
          <label className="field-label">{t.description} *</label>
          <textarea className="field-textarea" value={r.description} onChange={(e) => onChange({ description: e.target.value })} disabled={r.scanning} placeholder={t.expense_desc_ph} style={{ minHeight: 60 }} />
        </div>

        {/* Amount + VAT */}
        <div className="field-row">
          <div className="field">
            <label className="field-label">{t.amount} (AED) *</label>
            <input className="field-input tabular" type="number" step="0.01" inputMode="decimal" value={r.amount} onChange={(e) => onChange({ amount: e.target.value })} disabled={r.scanning} />
          </div>
          <div className="field">
            <label className="field-label">{t.vat_included}</label>
            <div className="seg" style={{ height: 48 }}>
              <button type="button" className={`seg-btn ${r.vat_included ? 'active' : ''}`} onClick={() => onChange({ vat_included: true })} disabled={r.scanning}>{t.yes}</button>
              <button type="button" className={`seg-btn ${!r.vat_included ? 'active' : ''}`} onClick={() => onChange({ vat_included: false })} disabled={r.scanning}>{t.no}</button>
            </div>
          </div>
        </div>

        {/* VAT breakdown for this line */}
        {!r.scanning && r.amount > 0 && r.vat_included && (
          <div style={{ background: 'var(--navy-50)', padding: '8px 10px', borderRadius: 'var(--radius-sm)', display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
            <span>Subtotal {fmtMoney(parseFloat(r.amount) / 1.05)} + VAT {fmtMoney(parseFloat(r.amount) - parseFloat(r.amount) / 1.05)}</span>
            <strong style={{ color: 'var(--text)' }}>{fmtMoney(r.amount)}</strong>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── View own claim detail ─────────────────────────────────────────────────
function ClaimDetailSheet({ item, onClose }) {
  const t = useT();
  if (!item) return null;
  const subtotal = item.expenses.reduce((s, e) => s + (e.vat_included ? e.amount / 1.05 : e.amount), 0);
  const vat = item.expenses.reduce((s, e) => s + (e.vat_included ? e.amount - e.amount / 1.05 : 0), 0);
  return (
    <Sheet open={!!item} onClose={onClose} title={`Claim ${item.name}`}
      footer={<button className="btn btn-ghost btn-block" onClick={onClose}>{t.close}</button>}>
      <div className="row-between" style={{ marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 17 }}>{fmtMoney(item.total_amount, item.currency)}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtDate(item.posting_date)} · <span className="mono">{item.cost_center}</span></div>
        </div>
        <StatusChip status={item.status} />
      </div>

      {item.rejection_reason && (
        <div className="card" style={{ background: 'var(--bad-100)', borderColor: 'var(--bad)', marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--bad)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t.rejected_label}</div>
          <div style={{ fontSize: 13, color: 'var(--bad)', marginTop: 4 }}>{item.rejection_reason}</div>
        </div>
      )}

      <div className="section-label" style={{ marginTop: 0 }}>{item.expenses.length} {t.expenses_count}</div>
      <div className="card card-flush">
        {item.expenses.map((e, i) => <ExpenseLineView key={i} e={e} />)}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="row-between" style={{ fontSize: 13 }}><span className="muted">{t.subtotal}</span><span className="tabular">{fmtMoney(subtotal)}</span></div>
        <div className="row-between" style={{ fontSize: 13, marginTop: 6 }}><span className="muted">{t.vat_amount}</span><span className="tabular">{fmtMoney(vat)}</span></div>
        <div className="row-between" style={{ fontSize: 14, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', fontWeight: 700 }}>
          <span>{t.grand_total}</span><span className="tabular">{fmtMoney(item.total_amount)}</span>
        </div>
        {item.status === 'Approved' && item.total_sanctioned !== item.total_amount && (
          <div className="row-between" style={{ fontSize: 13, marginTop: 6, color: 'var(--ok)' }}>
            <span>{t.sanctioned}</span><span className="tabular">{fmtMoney(item.total_sanctioned)}</span>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function ExpenseLineView({ e }) {
  const t = useT();
  const type = window.EXPENSE_CLAIM_TYPES.find((x) => x.name === e.expense_type) || window.EXPENSE_CLAIM_TYPES.at(-1);
  const isPdf = (e.attachment || '').toLowerCase().endsWith('.pdf');
  return (
    <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
      <div className="row-flex" style={{ marginBottom: 6 }}>
        <div className="list-row-icon" style={{ background: type.bg, color: type.color, width: 28, height: 28 }}>
          <Icon name={type.icon} size={14} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{e.expense_type}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtDate(e.expense_date)}</div>
        </div>
        <div className="tabular" style={{ fontWeight: 600 }}>{fmtMoney(e.amount)}</div>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 8, paddingInlineStart: 38 }}>{e.description}</div>
      <div style={{ display: 'flex', gap: 6, paddingInlineStart: 38, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className={`chip ${e.vat_included ? 'chip-info' : ''}`} style={{ fontSize: 10 }}>
          {e.vat_included ? t.vat_included : t.vat_excluded}
        </span>
        {e.attachment && (
          <a href={e.attachment_url || '#'} target="_blank" rel="noreferrer" className="chip" style={{ fontSize: 10, background: 'var(--surface-2)', color: 'var(--text)', textDecoration: 'none' }} onClick={(ev) => { if (!e.attachment_url) ev.preventDefault(); }}>
            <Icon name={isPdf ? 'file' : 'receipt'} size={11} /> {e.attachment}
          </a>
        )}
      </div>
    </div>
  );
}

// ─── Top-up ──────────────────────────────────────────────────────────────
function TopupSheet({ open, onClose, onSubmit }) {
  const t = useT();
  const [amount, setAmount] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (open) { setAmount(''); setReason(''); setBusy(false); } }, [open]);
  const submit = async () => {
    if (!amount || parseFloat(amount) <= 0) return;
    setBusy(true);
    await window.frappe.requestTopup(parseFloat(amount), reason);
    onSubmit();
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title={t.request_topup}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>{t.cancel}</button>
        <button className="btn btn-primary" onClick={submit} disabled={!amount || parseFloat(amount) <= 0 || busy}>{busy ? '…' : t.submit}</button>
      </>}>
      <div className="field">
        <label className="field-label">{t.topup_amount} (AED)</label>
        <input className="field-input" type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoFocus />
      </div>
      <div className="field">
        <label className="field-label">{t.reason}</label>
        <textarea className="field-textarea" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.topup_ph} />
      </div>
      <div style={{ background: 'var(--navy-50)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 12, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--navy-700)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name="info" size={14} />
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--text-muted)' }}>
          <div style={{ color: 'var(--text)', fontWeight: 600, marginBottom: 2 }}>{t.topup_routing}</div>
          {t.topup_after_approval}
        </div>
      </div>
    </Sheet>
  );
}

// ─── Top-up row ────────────────────────────────────────────────────────
function TopupRow({ row, showEmployee, onClick }) {
  const t = useT();
  const statusLabel = {
    Pending: t.topup_pending,
    Approved: t.topup_approved,
    Posted: t.topup_posted,
    Rejected: t.topup_rejected,
  }[row.status] || row.status;
  return (
    <button onClick={onClick} style={{ width: '100%', background: 'transparent', border: 0, padding: 0, color: 'inherit', display: 'block', textAlign: 'inherit' }}>
      <div className="list-row">
        {showEmployee
          ? <Avatar initials={row.avatar_initials} />
          : <div className="list-row-icon" style={{ background: '#DBEAFE', color: 'var(--navy-700)' }}><Icon name="plus" size={16} /></div>}
        <div className="list-row-body">
          <div className="list-row-title truncate">{showEmployee ? row.employee_name : t.request_topup}</div>
          <div className="list-row-sub truncate">{statusLabel} · {row.request_date}</div>
        </div>
        <div className="list-row-meta">
          <div className="list-row-amount">{fmtMoney(row.amount, row.currency)}</div>
          <div style={{ marginTop: 2 }}><StatusChip status={row.status} /></div>
        </div>
      </div>
    </button>
  );
}

// ─── Manager review of a top-up request ────────────────────────────────
function ReviewTopupSheet({ item, onClose, onAct }) {
  const t = useT();
  const [comment, setComment] = React.useState('');
  React.useEffect(() => { if (item) setComment(''); }, [item]);
  if (!item) return null;
  return (
    <Sheet open={!!item} onClose={onClose} title={t.review_topup}
      footer={<>
        <button className="btn btn-danger" onClick={() => onAct('reject', comment)}>{t.reject}</button>
        <button className="btn btn-success" onClick={() => onAct('approve', comment)}>{t.approve}</button>
      </>}>
      <div className="row-flex" style={{ marginBottom: 14 }}>
        <Avatar initials={item.avatar_initials} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>{item.employee_name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.employee} · {fmtDate(item.request_date)}</div>
        </div>
        <StatusChip status={item.status} />
      </div>

      <div style={{ background: 'var(--navy-50)', borderRadius: 'var(--radius-sm)', padding: 14, marginBottom: 14, textAlign: 'center' }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>{t.topup_amount}</div>
        <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--navy-700)', marginTop: 2 }}>{fmtMoney(item.amount, item.currency)}</div>
      </div>

      <div className="field">
        <label className="field-label">{t.reason}</label>
        <div style={{ background: 'var(--surface-alt)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 12, fontSize: 14, lineHeight: 1.5 }}>
          {item.reason || <span style={{ color: 'var(--text-muted)' }}>—</span>}
        </div>
      </div>

      <div className="field">
        <label className="field-label">{t.comment}</label>
        <textarea className="field-textarea" value={comment} onChange={(e) => setComment(e.target.value)} />
      </div>

      <div style={{ background: 'var(--navy-50)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 12, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55 }}>
        {t.topup_after_approval}
      </div>
    </Sheet>
  );
}

// ─── Employee detail (read-only) ───────────────────────────────────────
function TopupDetailSheet({ item, onClose }) {
  const t = useT();
  if (!item) return null;
  const statusLabel = {
    Pending: t.topup_pending,
    Approved: t.topup_approved,
    Posted: t.topup_posted,
    Rejected: t.topup_rejected,
  }[item.status] || item.status;
  return (
    <Sheet open={!!item} onClose={onClose} title={t.request_topup}
      footer={<button className="btn btn-ghost" onClick={onClose}>{t.close}</button>}>
      <div style={{ background: 'var(--navy-50)', borderRadius: 'var(--radius-sm)', padding: 14, marginBottom: 14, textAlign: 'center' }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>{t.topup_amount}</div>
        <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--navy-700)', marginTop: 2 }}>{fmtMoney(item.amount, item.currency)}</div>
        <div style={{ marginTop: 8, fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}>{statusLabel}</div>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 0, marginBottom: 14, overflow: 'hidden' }}>
        <div className="kv-row"><div>{t.requested_on}</div><div className="mono">{fmtDate(item.request_date)}</div></div>
        {item.approved_on && <div className="kv-row"><div>{t.approved_on}</div><div className="mono">{fmtDate(item.approved_on)}</div></div>}
        {item.payment_reference && <div className="kv-row"><div>{t.payment_ref}</div><div className="mono">{item.payment_reference}</div></div>}
      </div>

      <div className="field">
        <label className="field-label">{t.reason}</label>
        <div style={{ background: 'var(--surface-alt)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 12, fontSize: 14, lineHeight: 1.5 }}>
          {item.reason || <span style={{ color: 'var(--text-muted)' }}>—</span>}
        </div>
      </div>

      {item.approver_comment && (
        <div className="field">
          <label className="field-label">{t.comment}</label>
          <div style={{ background: 'var(--surface-alt)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 12, fontSize: 14, lineHeight: 1.5 }}>
            {item.approver_comment}
          </div>
        </div>
      )}
    </Sheet>
  );
}

// ─── Manager review ──────────────────────────────────────────────────────
function ReviewClaimSheet({ item, onClose, onAct }) {
  const t = useT();
  const [comment, setComment] = React.useState('');
  React.useEffect(() => { if (item) setComment(''); }, [item]);
  if (!item) return null;
  const subtotal = item.expenses.reduce((s, e) => s + (e.vat_included ? e.amount / 1.05 : e.amount), 0);
  const vat = item.expenses.reduce((s, e) => s + (e.vat_included ? e.amount - e.amount / 1.05 : 0), 0);
  return (
    <Sheet open={!!item} onClose={onClose} title={t.review_claim}
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
        <div className="tabular" style={{ fontWeight: 700, fontSize: 17 }}>{fmtMoney(item.total_amount, item.currency)}</div>
      </div>

      <div style={{ background: 'var(--navy-50)', padding: 10, borderRadius: 'var(--radius)', marginBottom: 12, fontSize: 12, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
        <span>{t.cost_center}</span><strong className="mono" style={{ color: 'var(--text)' }}>{item.cost_center}</strong>
      </div>

      <div className="section-label" style={{ marginTop: 0 }}>{item.expenses.length} {t.expenses_count}</div>
      <div className="card card-flush" style={{ marginBottom: 12 }}>
        {item.expenses.map((e, i) => <ExpenseLineView key={i} e={e} />)}
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row-between" style={{ fontSize: 13 }}><span className="muted">{t.subtotal}</span><span className="tabular">{fmtMoney(subtotal)}</span></div>
        <div className="row-between" style={{ fontSize: 13, marginTop: 6 }}><span className="muted">{t.vat_amount}</span><span className="tabular">{fmtMoney(vat)}</span></div>
        <div className="row-between" style={{ fontSize: 14, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', fontWeight: 700 }}>
          <span>{t.grand_total}</span><span className="tabular">{fmtMoney(item.total_amount)}</span>
        </div>
      </div>

      <div className="field">
        <label className="field-label">{t.comment}</label>
        <textarea className="field-textarea" value={comment} onChange={(e) => setComment(e.target.value)} />
      </div>
    </Sheet>
  );
}

Object.assign(window, { PettyScreen });
