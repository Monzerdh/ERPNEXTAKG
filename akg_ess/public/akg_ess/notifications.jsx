// Notifications inbox + Outbox (offline queue) — share styling with the rest of the app.

// ─── helpers ─────────────────────────────────────────────────────────
function formatRelative(iso, t) {
  const ms = Date.now() - new Date(iso.replace(' ', 'T')).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return t.just_now;
  if (m < 60) return `${m} ${t.minutes_ago}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ${t.hours_ago}`;
  const d = Math.floor(h / 24);
  if (d === 1) return t.yesterday;
  return `${d} ${t.days_ago}`;
}

function bucketize(items, t) {
  const now = Date.now();
  const today = [], week = [], earlier = [];
  for (const n of items) {
    const ms = now - new Date(n.time.replace(' ', 'T')).getTime();
    if (ms < 86400000) today.push(n);
    else if (ms < 86400000 * 7) week.push(n);
    else earlier.push(n);
  }
  return [
    { key: 'today', label: t.notif_today, items: today },
    { key: 'week', label: t.notif_this_week, items: week },
    { key: 'earlier', label: t.notif_earlier, items: earlier },
  ].filter((g) => g.items.length);
}

const KIND_META = {
  leave:     { icon: 'calendar', tint: 'success' },
  claim:     { icon: 'wallet',   tint: 'info' },
  document:  { icon: 'shield',   tint: 'warn' },
  pending:   { icon: 'inbox',    tint: 'info' },
  sync:      { icon: 'refresh',  tint: 'success' },
  pay:       { icon: 'wallet',   tint: 'success' },
  violation: { icon: 'alert',    tint: 'warn' },
};

// ─── Bell button + count ─────────────────────────────────────────────
function NotificationsBell({ role, onOpen }) {
  const [unread, setUnread] = React.useState(0);
  const refresh = React.useCallback(() => {
    window.frappe.getNotifications(role).then((items) => {
      setUnread(items.filter((n) => !n.read).length);
    });
  }, [role]);
  React.useEffect(() => { refresh(); }, [refresh]);
  // Listen for global refresh event
  React.useEffect(() => {
    const h = () => refresh();
    window.addEventListener('akg:notifs-changed', h);
    return () => window.removeEventListener('akg:notifs-changed', h);
  }, [refresh]);

  return (
    <button className="icon-btn" onClick={onOpen} title="Notifications" style={{ color: 'var(--text-muted)', position: 'relative' }}>
      <Icon name="bell" size={20} />
      {unread > 0 && (
        <span style={{
          position: 'absolute', top: 4, insetInlineEnd: 4,
          background: 'var(--danger, #DC2626)', color: 'white',
          fontSize: 9, fontWeight: 700,
          minWidth: 14, height: 14, borderRadius: 7,
          display: 'grid', placeItems: 'center', padding: '0 3px',
          boxShadow: '0 0 0 2px var(--header-bg, #fff)',
        }}>{unread > 9 ? '9+' : unread}</span>
      )}
    </button>
  );
}

// ─── Inbox sheet ─────────────────────────────────────────────────────
function NotificationsSheet({ role, onClose, onNavigate }) {
  const t = useT();
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(() => {
    setLoading(true);
    window.frappe.getNotifications(role).then((rows) => {
      setItems(rows);
      setLoading(false);
    });
  }, [role]);
  React.useEffect(() => { load(); }, [load]);

  const handleClick = async (n) => {
    if (!n.read) {
      await window.frappe.markNotificationRead(n.name);
      window.dispatchEvent(new Event('akg:notifs-changed'));
    }
    if (n.target?.tab && onNavigate) onNavigate(n.target.tab);
    onClose();
  };

  const handleMarkAllRead = async () => {
    await window.frappe.markAllNotificationsRead(role);
    window.dispatchEvent(new Event('akg:notifs-changed'));
    load();
  };

  const groups = bucketize(items, t);
  const unreadCount = items.filter((n) => !n.read).length;

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="notif-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="notif-header">
          <div>
            <div className="notif-title">{t.notifications}</div>
            {unreadCount > 0 && <div className="notif-sub">{unreadCount} {t.pending.toLowerCase()}</div>}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {unreadCount > 0 && (
              <button className="btn btn-sm btn-ghost" onClick={handleMarkAllRead}>{t.mark_all_read}</button>
            )}
            <button className="icon-btn" onClick={onClose} title={t.close}>
              <Icon name="close" size={18} />
            </button>
          </div>
        </div>

        <div className="notif-body">
          {loading && <div className="notif-empty">…</div>}
          {!loading && !items.length && (
            <div className="notif-empty">
              <Icon name="bell" size={28} />
              <div>{t.no_notifications}</div>
            </div>
          )}
          {groups.map((g) => (
            <div key={g.key} className="notif-group">
              <div className="notif-group-label">{g.label}</div>
              {g.items.map((n) => {
                const meta = KIND_META[n.kind] || KIND_META.pending;
                const title = t[n.title_key] || n.title_key;
                return (
                  <button key={n.name} className={`notif-item ${n.read ? 'is-read' : ''}`} onClick={() => handleClick(n)}>
                    <div className={`notif-icon notif-icon-${meta.tint}`}>
                      <Icon name={meta.icon} size={16} />
                    </div>
                    <div className="notif-content">
                      <div className="notif-line1">
                        <span className="notif-item-title">{title}</span>
                        <span className="notif-time">{formatRelative(n.time, t)}</span>
                      </div>
                      <div className="notif-item-body">{n.body}</div>
                    </div>
                    {!n.read && <span className="notif-dot" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── Outbox screen (lives inside Profile or as a sub-view) ──────────
function OutboxView({ outbox, onSyncAll, isOffline, onBack }) {
  const t = useT();
  const grouped = React.useMemo(() => {
    const g = { checkin: [], leave: [], claim: [], topup: [] };
    outbox.forEach((it) => {
      const k = it._kind || 'checkin';
      if (!g[k]) g[k] = [];
      g[k].push(it);
    });
    return g;
  }, [outbox]);

  const sectionMeta = {
    checkin: { label: t.tab_attendance, icon: 'clock' },
    leave:   { label: t.tab_leaves, icon: 'calendar' },
    claim:   { label: t.tab_petty, icon: 'wallet' },
    topup:   { label: t.request_topup, icon: 'wallet' },
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>{t.outbox}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{t.outbox_subtitle}</div>
        </div>
        {outbox.length > 0 && !isOffline && (
          <button className="btn btn-sm btn-primary" onClick={onSyncAll}>
            <Icon name="refresh" size={14} /> {t.sync_all}
          </button>
        )}
      </div>

      {!outbox.length && (
        <div className="card" style={{ textAlign: 'center', padding: '28px 12px', color: 'var(--text-muted)' }}>
          <Icon name="check" size={28} />
          <div style={{ marginTop: 6, fontSize: 13 }}>{t.outbox_empty}</div>
        </div>
      )}

      {Object.entries(grouped).map(([kind, list]) => {
        if (!list.length) return null;
        const meta = sectionMeta[kind];
        return (
          <div key={kind} style={{ marginBottom: 12 }}>
            <div className="section-label"><span>{meta.label}</span><span>{list.length}</span></div>
            <div className="card card-flush">
              {list.map((it, i) => <OutboxRow key={it._localId || i} item={it} kind={kind} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OutboxRow({ item, kind }) {
  const t = useT();
  let title, sub;
  if (kind === 'checkin') {
    title = item.log_type === 'IN' ? t.check_in : t.check_out;
    sub = item.project || t.unassigned_outside_short;
  } else if (kind === 'leave') {
    title = `${item.leave_type || t.tab_leaves}`;
    sub = `${item.from_date} → ${item.to_date}`;
  } else if (kind === 'claim') {
    title = item.vendor || t.new_claim;
    const total = (item.expenses || []).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    sub = `AED ${total.toFixed(2)} · ${(item.expenses || []).length} ${t.expenses_count}`;
  } else if (kind === 'topup') {
    title = `AED ${parseFloat(item.amount || 0).toFixed(2)}`;
    sub = item.reason || t.request_topup;
  }

  const queuedAt = item.queued_at ? new Date(item.queued_at).toLocaleString() : '';

  return (
    <div className="list-row" style={{ alignItems: 'flex-start' }}>
      <div className="list-row-icon" style={{ background: 'var(--warn-100)', color: 'var(--warn)' }}>
        <Icon name="clock" size={16} />
      </div>
      <div className="list-row-body">
        <div className="list-row-title">{title}</div>
        <div className="list-row-sub">{sub}</div>
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {t.queued_offline} · {queuedAt}
        </div>
      </div>
    </div>
  );
}

// Expose
Object.assign(window, { NotificationsBell, NotificationsSheet, OutboxView });
