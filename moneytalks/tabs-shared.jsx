// Shared primitives — loaded first; sets up globals used by all other tab files.
const { useState, useMemo, useEffect, useRef } = React;
const { ACCOUNTS, CATEGORIES, MONTHS, TRANSACTIONS, RECURRING, NET_WORTH_HISTORY,
  txnsForMonth, sumByCategory, monthSummary, fmt, acctById } = window.FIN;
const { DonutChart, StackedBarChart, AreaChart, Sparkline, BarList } = window;

// Live categories cache — initialized from bootstrap data, refreshed after edits.
// CategoryPicker reads this so reorders/renames show immediately without page reload.
let _liveCategories = [...CATEGORIES];
async function refreshLiveCategories() {
  try {
    const res  = await apiFetch('/api/categories');
    const data = await res.json();
    if (data.categories) {
      _liveCategories = data.categories;
    }
  } catch(e) { /* keep existing */ }
}

// Live-aware catById — checks _liveCategories first so newly added categories
// show their display name instead of the raw ID.
function catById(id) {
  return _liveCategories.find(c => c.id === id)
    || CATEGORIES.find(c => c.id === id)
    || { id, name: id, color: '#94a3b8', icon: '○', group: 'variable' };
}
const FIN = { ...window.FIN, catById };

const fmtMoney = (v) => fmt(v, { decimals: 0 });
const fmtMoney2 = (v) => fmt(v, { decimals: 2 });
const fmtAbbr = (v) => fmt(v, { decimals: 0, abbr: true });

// ── Month Vibe Banner ───────────────────────────────────────────────

function SummaryCard({ label, value, n, nFmt = fmtMoney, sub, trend, accent, spark }) {
  const animated = useCountUp(n);
  const display  = n != null ? nFmt(animated) : value;
  return (
    <div className="card sum-card">
      <div className="sum-label">{label}</div>
      <div className="sum-value" style={{ color: accent || 'var(--ink)' }}>{display}</div>
      <div className="sum-foot">
        {sub && <span className="sum-sub">{sub}</span>}
        {trend != null && (
          <span className={`sum-trend ${trend >= 0 ? 'up' : 'down'}`}>
            {trend >= 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(1)}%
          </span>
        )}
        {spark && <Sparkline points={spark} color={accent || 'var(--accent)'} width={60} height={22} />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// OVERVIEW TAB
// ═══════════════════════════════════════════════════════════════════


function TxnList({ txns, compact = false, onRecategorize, refreshFin, sortCol: initSortCol, sortDir: initSortDir, presorted = false, extraMenuItems }) {
  const [splitTxn, setSplitTxn]     = useState(null);
  const [editDateId, setEditDateId] = useState(null);
  const [editTxn, setEditTxn]       = useState(null);
  const [menuId, setMenuId]         = useState(null);
  const [activeMerchant, setActiveMerchant] = useState(null);
  const [mapTxn, setMapTxn]         = useState(null);
  const [sortCol, setSortCol]       = useState(presorted ? null : (initSortCol || 'date'));
  const [sortDir, setSortDir]       = useState(initSortDir || 'desc');
  const [dateOverrides, setDateOverrides] = useState({});
  const [localFlags, setLocalFlags] = useState(() => {
    const flags = {};
    txns.forEach(t => { if (t.flagged) flags[t.id] = true; });
    return flags;
  });

  async function toggleFlag(txnId, current) {
    const next = !current;
    setLocalFlags(prev => ({ ...prev, [txnId]: next }));
    try {
      await apiFetch(`/api/transactions/${txnId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flagged: next }),
      });
      window.showToast?.(next ? '⚑ Flagged for review' : 'Flag removed');
      if (refreshFin) refreshFin();
    } catch(e) {
      setLocalFlags(prev => ({ ...prev, [txnId]: current }));
    }
  }

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortCol(col); setSortDir('desc'); }
  }

  const sorted = sortCol === null ? txns : [...txns].sort((a, b) => {
    let cmp = 0;
    if (sortCol === 'date')   cmp = a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    if (sortCol === 'amount') cmp = Math.abs(a.amount) - Math.abs(b.amount);
    return sortDir === 'desc' ? -cmp : cmp;
  });

  function handleSplitClose(reload) {
    setSplitTxn(null);
    if (reload) { if (refreshFin) refreshFin(); else window.location.reload(); }
  }

  async function saveDate(txnId, newDate) {
    setEditDateId(null);
    setDateOverrides(prev => ({ ...prev, [txnId]: newDate }));
    try {
      const res = await fetch(`/api/transactions/${txnId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: newDate }),
      });
      if (!res.ok) console.error('Date save failed:', res.status, await res.text());
      setTimeout(() => { if (refreshFin) refreshFin(); }, 300);
    } catch(e) { console.error('Date save error:', e); }
  }

  const SortIcon = ({ col }) => {
    if (sortCol !== col) return <span style={{ opacity: 0.25, fontSize: 10 }}>↕</span>;
    return <span style={{ fontSize: 10, color: 'var(--accent)' }}>{sortDir === 'desc' ? '↓' : '↑'}</span>;
  };

  return (
    <>
      {mapTxn && <MapPopover txn={mapTxn} onClose={() => setMapTxn(null)} />}
      {activeMerchant && <MerchantDrawer merchant={activeMerchant.merchant} category={activeMerchant.category} onClose={() => setActiveMerchant(null)} />}
      {!compact && (
        <div style={{
          display: 'grid', gridTemplateColumns: '36px 1fr 56px 96px 20px',
          gap: 10, padding: '6px 4px 5px',
          borderBottom: '2px solid var(--line)',
          fontSize: 11, fontWeight: 600, color: 'var(--muted)',
          textTransform: 'uppercase', letterSpacing: '0.04em',
          userSelect: 'none',
        }}>
          <div />
          <div>Merchant</div>
          <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}
            onClick={() => toggleSort('date')}>
            Date <SortIcon col="date" />
          </div>
          <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 3 }}
            onClick={() => toggleSort('amount')}>
            <SortIcon col="amount" /> Amount
          </div>
          <div />
        </div>
      )}
      <div className={`txn-list ${compact ? 'compact' : ''}`}>
        {sorted.map((t) => {
          const cat = catById(t.category);
          const acct = acctById(t.account);
          const isSplit = t.is_split;
          const canEdit = !!onRecategorize && !isSplit;
          const isFlagged = !!localFlags[t.id];
          return (
            <div key={t.id} className="txn-row" style={isSplit ? { paddingLeft: 28, borderLeft: `3px solid ${cat.color}40` } : isFlagged ? { background: 'rgba(249,115,22,0.035)' } : {}}>
              <div className="txn-icon" style={{ background: cat.color + '24', color: cat.color }}>
                {isSplit ? '⋮' : cat.icon}
              </div>
              <div className="txn-main">
                <div className="txn-merchant">
                  <span onClick={() => !isSplit && setActiveMerchant({ merchant: t.merchant, category: t.category })} style={{
                    cursor: isSplit ? 'default' : 'pointer',
                    textDecoration: isSplit ? 'none' : 'underline dotted',
                    textUnderlineOffset: 2,
                    textDecorationColor: 'var(--line-2)',
                  }}>{t.merchant}</span>
                  {isFlagged && <span style={{ fontSize: 11, color: '#f97316', marginLeft: 6 }} title="Flagged for review">⚑</span>}
                  {t.pending && <span className="pending-pill">pending</span>}
                  {isSplit && <span className="pending-pill" style={{ background: cat.color + '20', color: cat.color }}>split</span>}
                  {t.notes && !isSplit && <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 6 }}>{t.notes}</span>}
                  {isSplit && t.notes && <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 6 }}>{t.notes}</span>}
                </div>
                <div className="txn-meta">
                  {onRecategorize && !isSplit ? (
                    <CategoryPicker value={t.category} onChange={(c) => onRecategorize(t.id, c)} />
                  ) : (
                    <span className="cat-pill" style={{ color: cat.color }}>{cat.name}</span>
                  )}
                  <span className="dot-sep">·</span>
                  <span>{acct.name}</span>
                  {(t.location_city || (t.lat != null && t.lon != null)) && (() => {
                    const label = [t.location_city, t.location_region].filter(Boolean).join(', ');
                    return <>
                      <span className="dot-sep">·</span>
                      <button
                        onClick={e => { e.stopPropagation(); setMapTxn(t); }}
                        title={[t.location_address, label].filter(Boolean).join(' · ')}
                        style={{
                          background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                          border: 'none', borderRadius: 5, cursor: 'pointer',
                          color: 'var(--accent)', fontSize: 10.5, fontWeight: 600,
                          padding: '1px 6px 1px 4px', fontFamily: 'inherit', lineHeight: 1.6,
                          display: 'inline-flex', alignItems: 'center', gap: 2,
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 18%, transparent)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 10%, transparent)'}
                      >📍 {label || 'View map'}</button>
                    </>;
                  })()}
                </div>
              </div>
              {canEdit && editDateId === t.id ? (
                <DateEditor
                  currentDate={dateOverrides[t.id] ?? t.date}
                  onSave={d => saveDate(t.id, d)}
                  onCancel={() => setEditDateId(null)}
                />
              ) : (
                <div
                  className="txn-date"
                  title={canEdit ? 'Click to edit date' : undefined}
                  style={canEdit ? { cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: 2 } : {}}
                  onClick={canEdit ? () => setEditDateId(t.id) : undefined}
                >
                  {(dateOverrides[t.id] ?? t.date).slice(5).replace('-', '/')}
                </div>
              )}
              <div className={`txn-amt ${t.amount >= 0 ? 'pos' : 'neg'}`}>
                {fmt(t.amount, { sign: true })}
              </div>
              {onRecategorize && !isSplit && !compact ? (
                <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
                  <button
                    className="txn-menu-btn"
                    onClick={e => { e.stopPropagation(); setMenuId(menuId === t.id ? null : t.id); }}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--muted)', fontSize: 15, padding: '0 2px',
                      lineHeight: 1, width: 20,
                    }}
                  >⋮</button>
                  {menuId === t.id && (
                    <div style={{
                      position: 'absolute', right: 0, top: '100%', zIndex: 300,
                      background: 'var(--surface)', border: '1px solid var(--line)',
                      borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
                      minWidth: 130, overflow: 'hidden',
                    }} onClick={e => e.stopPropagation()}>
                      {[
                        { label: 'Edit details', action: () => { setEditTxn(t); setMenuId(null); } },
                        { label: isFlagged ? '⚑ Unflag' : '⚑ Flag for review', action: async () => { setMenuId(null); await toggleFlag(t.id, isFlagged); } },
                        { label: 'Split', action: () => { setSplitTxn(t); setMenuId(null); } },
                        { label: 'Delete', action: async () => {
                          setMenuId(null);
                          if (!confirm(`Delete "${t.merchant}"?`)) return;
                          await fetch(`/api/transactions/${t.id}`, { method: 'DELETE' });
                          window.showToast?.('Transaction deleted');
                          if (refreshFin) refreshFin();
                        }, danger: true },
                        ...(extraMenuItems ? extraMenuItems(t).map(item => ({
                          ...item,
                          action: () => { setMenuId(null); item.action(); },
                        })) : []),
                      ].map(item => (
                        <button key={item.label} onClick={item.action} style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '8px 14px', background: 'none', border: 'none',
                          cursor: 'pointer', fontSize: 13,
                          color: item.danger ? 'var(--terra, #e05c5c)' : 'var(--ink)',
                        }}
                          onMouseEnter={e => e.target.style.background = 'var(--bg)'}
                          onMouseLeave={e => e.target.style.background = 'none'}
                        >{item.label}</button>
                      ))}
                    </div>
                  )}
                </div>
              ) : <div />}
            </div>
          );
        })}
      </div>
      {splitTxn && <SplitModal txn={splitTxn} onClose={handleSplitClose} />}
      {editTxn && <EditTransactionModal txn={editTxn} onClose={() => { setEditTxn(null); if (refreshFin) refreshFin(); }} />}
    </>
  );
}

// ─── Inline category picker ────────────────────────────────────────
// ─── Inline category picker (with semantic search) ────────────────
function CategoryPicker({ value, onChange }) {
  const [open, setOpen]       = useState(false);
  const [q, setQ]             = useState('');
  const [results, setResults] = useState(null);   // null = show _liveCategories
  const [loading, setLoading] = useState(false);
  const debounceRef = React.useRef(null);
  const cat = catById(value);

  function handleOpen(e) {
    e.stopPropagation();
    const opening = !open;
    setOpen(opening);
    if (opening) { setQ(''); setResults(null); }
  }

  function handlePick(id) {
    onChange(id);
    setOpen(false);
    setQ('');
    setResults(null);
  }

  function handleQuery(val) {
    setQ(val);
    clearTimeout(debounceRef.current);
    if (!val.trim()) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/categories/search?q=${encodeURIComponent(val)}`);
        const data = await res.json();
        if (data.categories) setResults(data.categories);
      } catch (e) {
        // fallback to local substring filter
        setResults(_liveCategories.filter(c =>
          c.name.toLowerCase().includes(val.toLowerCase())
        ));
      }
      setLoading(false);
    }, 280);
  }

  const visible = results || (q.trim()
    ? _liveCategories.filter(c => c.name.toLowerCase().includes(q.toLowerCase()))
    : _liveCategories);

  return (
    <div className="cat-picker">
      <button className="cat-pill cat-pill-btn" style={{ color: cat.color, borderColor: cat.color + '50' }}
        onClick={handleOpen}>
        {cat.name} <span className="caret">⌄</span>
      </button>
      {open && (
        <>
          <div className="cat-overlay" onClick={() => { setOpen(false); setQ(''); setResults(null); }} />
          <div className="cat-menu">
            <div style={{ padding: '6px 8px 4px', borderBottom: '1px solid var(--line)', position: 'relative' }}>
              <input
                autoFocus
                placeholder="Search categories…"
                value={q}
                onChange={e => handleQuery(e.target.value)}
                onClick={e => e.stopPropagation()}
                style={{
                  width: '100%', border: '1px solid var(--line)', borderRadius: 6,
                  padding: '4px 26px 4px 8px', fontSize: 12, background: 'var(--bg)',
                  color: 'var(--ink)', outline: 'none', boxSizing: 'border-box',
                }}
              />
              {loading && (
                <span style={{
                  position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
                  fontSize: 11, color: 'var(--muted)', display: 'inline-block',
                  animation: 'spin 0.7s linear infinite',
                }}>◌</span>
              )}
            </div>
            {visible.map((c) => (
              <button key={c.id} className="cat-menu-item" onClick={() => handlePick(c.id)}>
                <span className="cat-dot" style={{ background: c.color }} />
                {c.name}
              </button>
            ))}
            {visible.length === 0 && !loading && (
              <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--muted)' }}>No match</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Searchable select (replaces native <select> for category filter) ─
function SearchableSelect({ value, onChange, options, placeholder = 'All' }) {
  const [open, setOpen]   = useState(false);
  const [q, setQ]         = useState('');
  const selected = options.find(o => o.value === value);
  const visible  = q.trim()
    ? options.filter(o => o.label.toLowerCase().includes(q.toLowerCase()))
    : options;

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => { setOpen(!open); if (!open) setQ(''); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
          border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)',
          color: value === 'all' ? 'var(--ink-3)' : 'var(--ink)', fontSize: 12,
          cursor: 'pointer', whiteSpace: 'nowrap', minWidth: 130,
          fontFamily: 'inherit',
        }}
      >
        {selected?.dot && (
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: selected.dot, flexShrink: 0 }} />
        )}
        <span style={{ flex: 1, textAlign: 'left' }}>{selected?.label || placeholder}</span>
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>⌄</span>
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={() => { setOpen(false); setQ(''); }} />
          <div style={{
            position: 'absolute', top: '100%', left: 0, zIndex: 1000, marginTop: 4,
            background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)', minWidth: 180, maxHeight: 260, overflowY: 'auto',
          }}>
            <div style={{ padding: '6px 8px 4px', borderBottom: '1px solid var(--line)' }}>
              <input
                autoFocus
                placeholder="Filter…"
                value={q}
                onChange={e => setQ(e.target.value)}
                onClick={e => e.stopPropagation()}
                style={{
                  width: '100%', border: '1px solid var(--line)', borderRadius: 6,
                  padding: '3px 7px', fontSize: 12, background: 'var(--bg)',
                  color: 'var(--ink)', outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
            {visible.map(o => (
              <button key={o.value}
                onClick={() => { onChange(o.value); setOpen(false); setQ(''); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '7px 12px', background: o.value === value ? 'var(--accent-bg, #f0fdf4)' : 'none',
                  border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--ink)',
                  textAlign: 'left', fontFamily: 'inherit',
                }}
              >
                {o.dot && <span style={{ width: 7, height: 7, borderRadius: '50%', background: o.dot, flexShrink: 0 }} />}
                {o.label}
              </button>
            ))}
            {visible.length === 0 && (
              <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--muted)' }}>No match</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TRANSACTIONS TAB
