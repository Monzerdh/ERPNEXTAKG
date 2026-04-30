// Icon set + small reusable UI primitives.
// Stroke-based, 24x24 viewBox, currentColor.

const Icon = ({ name, size = 22, ...rest }) => {
  const paths = {
    clock:    <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    map:      <><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6z"/><path d="M9 4v14M15 6v14"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></>,
    wallet:   <><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M16 14h2"/></>,
    user:     <><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></>,
    check:    <><path d="M5 12l5 5L20 7"/></>,
    x:        <><path d="M6 6l12 12M18 6L6 18"/></>,
    plus:     <><path d="M12 5v14M5 12h14"/></>,
    chevron:  <><path d="M9 6l6 6-6 6"/></>,
    chevronL: <><path d="M15 6l-6 6 6 6"/></>,
    chevronD: <><path d="M6 9l6 6 6-6"/></>,
    bell:     <><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2H4.5L6 16z"/><path d="M10 20a2 2 0 0 0 4 0"/></>,
    camera:   <><path d="M5 8h3l2-2h4l2 2h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z"/><circle cx="12" cy="13" r="3.5"/></>,
    upload:   <><path d="M12 4v12M6 10l6-6 6 6"/><path d="M4 18v2h16v-2"/></>,
    pin:      <><path d="M12 22s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></>,
    pinFill:  <><path d="M12 22s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12z" fill="currentColor"/><circle cx="12" cy="10" r="2.5" fill="white" stroke="none"/></>,
    warn:     <><path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5M12 18v.01"/></>,
    info:     <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 8v.01"/></>,
    arrow:    <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    refresh:  <><path d="M4 12a8 8 0 0 1 14-5l2 2"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-14 5l-2-2"/><path d="M4 20v-5h5"/></>,
    globe:    <><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></>,
    wifi:     <><path d="M2 9a16 16 0 0 1 20 0"/><path d="M5 13a11 11 0 0 1 14 0"/><path d="M8.5 16.5a6 6 0 0 1 7 0"/><circle cx="12" cy="20" r="1" fill="currentColor"/></>,
    wifiOff:  <><path d="M2 9a16 16 0 0 1 20 0"/><path d="M5 13a11 11 0 0 1 14 0" opacity=".4"/><path d="M3 3l18 18"/><circle cx="12" cy="20" r="1" fill="currentColor"/></>,
    receipt:  <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z"/><path d="M9 8h6M9 12h6M9 16h4"/></>,
    fuel:     <><path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16"/><path d="M3 21h14"/><path d="M15 9h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V8l-3-3"/></>,
    food:     <><path d="M3 8h18M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><path d="M8 4l1 4M16 4l-1 4M12 3v5"/></>,
    truck:    <><rect x="2" y="7" width="12" height="9" rx="1"/><path d="M14 10h4l3 3v3h-7"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></>,
    box:      <><path d="M3 7l9-4 9 4v10l-9 4-9-4V7z"/><path d="M3 7l9 4 9-4M12 11v10"/></>,
    dot:      <><circle cx="12" cy="12" r="4" fill="currentColor"/></>,
    eye:      <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>,
    file:     <><path d="M6 3h8l4 4v14H6V3z"/><path d="M14 3v4h4"/></>,
    logout:   <><path d="M14 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3"/><path d="M9 12h13M18 8l4 4-4 4"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></>,
    shield:   <><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/></>,
    coin:     <><circle cx="12" cy="12" r="9"/><path d="M15 9h-3.5a2 2 0 0 0 0 4h3a2 2 0 0 1 0 4H10M12 7v10"/></>,
    target:   <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></>,
    inbox:    <><path d="M3 12V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6"/><path d="M3 12h5l1.5 2h5L16 12h5v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6z"/></>,
    alert:    <><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16v.01"/></>,
    close:    <><path d="M6 6l12 12M18 6L6 18"/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...rest}>
      {paths[name] || null}
    </svg>
  );
};

// Toast manager
const ToastCtx = React.createContext(null);
function ToastProvider({ children }) {
  const [toasts, setToasts] = React.useState([]);
  const push = React.useCallback((msg, kind = '') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.kind === 'ok' && <Icon name="check" size={16} />}
            {t.kind === 'bad' && <Icon name="warn" size={16} />}
            {t.kind === 'warn' && <Icon name="info" size={16} />}
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
const useToast = () => React.useContext(ToastCtx);

// Bottom sheet
function Sheet({ open, onClose, title, children, footer }) {
  if (!open) return null;
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="sheet-handle" />
        <div className="sheet-header">
          <div className="sheet-title">{title}</div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={22} /></button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-footer">{footer}</div>}
      </div>
    </>
  );
}

// Status chip helper
function StatusChip({ status }) {
  const map = {
    Open:     ['chip-warn', 'pending'],
    Pending:  ['chip-warn', 'pending'],
    Approved: ['chip-ok',   'approved'],
    Posted:   ['chip-info', 'posted'],
    Rejected: ['chip-bad',  'rejected'],
    Synced:   ['chip-ok',   'synced'],
    Queued:   ['chip-warn', 'queued'],
  };
  const t = useT();
  const [cls, key] = map[status] || ['', status];
  return <span className={`chip ${cls}`}>{t[key] || status}</span>;
}

// i18n
const I18nCtx = React.createContext({ lang: 'en', t: window.STRINGS.en });
const useT = () => React.useContext(I18nCtx).t;
const useLang = () => React.useContext(I18nCtx);

// Format helpers
const fmtTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso.replace(' ', 'T'));
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
};
const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(window.LANG === 'ar' ? 'ar-AE' : [], { day: '2-digit', month: 'short', year: 'numeric' });
};
const fmtDateShort = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(window.LANG === 'ar' ? 'ar-AE' : [], { day: '2-digit', month: 'short' });
};
const fmtMoney = (n, ccy = 'AED') => `${ccy} ${Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

// Avatar
function Avatar({ initials, size = 'md', color }) {
  const cls = size === 'sm' ? 'avatar avatar-sm' : 'avatar';
  return <div className={cls} style={color ? { background: color } : null}>{initials}</div>;
}

// Loading skeleton
function Skeleton({ h = 40, w = '100%', mb = 8 }) {
  return <div className="skeleton" style={{ height: h, width: w, marginBottom: mb }} />;
}

// Greet by hour
function useGreeting() {
  const t = useT();
  const h = new Date().getHours();
  if (h < 12) return t.greeting_morning;
  if (h < 17) return t.greeting_afternoon;
  return t.greeting_evening;
}

Object.assign(window, {
  Icon, ToastProvider, useToast, Sheet, StatusChip,
  I18nCtx, useT, useLang,
  fmtTime, fmtDate, fmtDateShort, fmtMoney,
  Avatar, Skeleton, useGreeting,
});
