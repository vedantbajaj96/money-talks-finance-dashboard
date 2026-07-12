// Tab component — see frontend/AGENTS.md for context
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { TRANSACTIONS, CATEGORIES, ACCOUNTS, MONTHS, RECURRING, NET_WORTH_HISTORY } from '@/lib/fin';
import { fmtMoney, fmtMoney2, fmtAbbr, fmt, catById, acctById, txnsForMonth, sumByCategory, monthSummary } from '@/lib/helpers';
import { apiFetch } from '@/lib/api';
import { SummaryCard, TxnList, SearchableSelect } from '@/components';
import { AddTransactionModal } from '@/components/modals';

function TransactionsTab({ monthKey, txnOverrides, setTxnOverrides, search: globalSearch = '', setSearch: setGlobalSearch, refreshFin, finVersion }) {
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState(globalSearch);
  const [catFilter, setCatFilter] = useState(() => {
    try { return sessionStorage.getItem('txns.catFilter') || 'all'; } catch { return 'all'; }
  });
  const [acctFilter, setAcctFilter] = useState(() => {
    try { return sessionStorage.getItem('txns.acctFilter') || 'all'; } catch { return 'all'; }
  });
  const [showFlagged, setShowFlagged] = useState(() => {
    try { return sessionStorage.getItem('txns.showFlagged') === 'true'; } catch { return false; }
  });

  // Persist filter state within session
  useEffect(() => { try { sessionStorage.setItem('txns.catFilter', catFilter); } catch {} }, [catFilter]);
  useEffect(() => { try { sessionStorage.setItem('txns.acctFilter', acctFilter); } catch {} }, [acctFilter]);
  useEffect(() => { try { sessionStorage.setItem('txns.showFlagged', String(showFlagged)); } catch {} }, [showFlagged]);

  // Semantic search state
  const [semMerchants, setSemMerchants] = useState(null); // null = not yet searched
  const [semLoading, setSemLoading]     = useState(false);
  const [isSemantic, setIsSemantic]     = useState(false);
  const semDebounce = useRef(null);

  // Keep in sync when the TopBar search changes
  useEffect(() => { setSearch(globalSearch); }, [globalSearch]);

  // Trigger semantic search with debounce
  useEffect(() => {
    clearTimeout(semDebounce.current);
    if (!search.trim()) {
      setSemMerchants(null);
      setIsSemantic(false);
      setSemLoading(false);
      return;
    }
    setSemLoading(true);
    semDebounce.current = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/transactions/search?q=${encodeURIComponent(search)}`);
        const data = await res.json();
        if (data.semantic && (data.matches || data.merchants)) {
          // New format: matches = [{merchant, category}] keyed as "merchant||category"
          // Legacy fallback: plain merchants list
          if (data.matches) {
            setSemMerchants(new Map(data.matches.map(m => [
              `${m.merchant}||${m.category}`,
              data.scores?.[`${m.merchant}||${m.category}`] ?? 0,
            ])));
          } else {
            setSemMerchants(new Map(data.merchants.map(m => [m, data.scores?.[m] ?? 0])));
          }
          setIsSemantic(true);
        } else {
          setSemMerchants(null);
          setIsSemantic(false);
        }
      } catch(e) {
        setSemMerchants(null);
        setIsSemantic(false);
      }
      setSemLoading(false);
    }, 350);
  }, [search]);

  // When a search term is active, search across ALL months not just the current one
  const isGlobalSearch = search.trim().length > 0;
  const baseTxns = (isGlobalSearch ? TRANSACTIONS : txnsForMonth(monthKey)).map((t) =>
    txnOverrides[t.id] ? { ...t, category: txnOverrides[t.id] } : t,
  );

  const filtered = baseTxns.filter((t) => {
    if (catFilter !== 'all' && t.category !== catFilter) return false;
    if (acctFilter !== 'all' && t.account !== acctFilter) return false;
    if (showFlagged && !t.flagged) return false;
    if (search) {
      if (semMerchants) {
        // Semantic results: match on merchant+category pair, or merchant alone (legacy),
        // with substring fallback for notes/tags
        const semKey = `${t.merchant}||${t.category}`;
        const legacyKey = t.merchant;
        if (!semMerchants.has(semKey) && !semMerchants.has(legacyKey)) {
          const q = search.toLowerCase();
          const substringHit = t.merchant.toLowerCase().includes(q) ||
                               (t.notes || '').toLowerCase().includes(q) ||
                               (t.tags  || '').toLowerCase().includes(q);
          if (!substringHit) return false;
        }
      } else {
        // Still loading or semantic unavailable: substring fallback
        const q = search.toLowerCase();
        const hit = t.merchant.toLowerCase().includes(q) ||
                    (t.notes || '').toLowerCase().includes(q) ||
                    (t.tags  || '').toLowerCase().includes(q) ||
                    t.date.includes(q);
        if (!hit) return false;
      }
    }
    return true;
  }).sort((a, b) => {
    if (search) {
      const q = search.toLowerCase();
      const exactA = a.merchant?.toLowerCase().includes(q) || (a.notes || '').toLowerCase().includes(q);
      const exactB = b.merchant?.toLowerCase().includes(q) || (b.notes || '').toLowerCase().includes(q);
      if (exactA !== exactB) return exactA ? -1 : 1;
    }
    return b.date > a.date ? 1 : -1;
  });

  const nonTransfer = filtered.filter((t) => t.category !== 'transfer');
  const totalIn  = nonTransfer.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const totalOut = nonTransfer.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

  const [autoMsg, setAutoMsg] = useState(null);

  const recat = async (id, cat) => {
    // Optimistic update
    setTxnOverrides(prev => ({ ...prev, [id]: cat }));
    try {
      const res = await fetch(`/api/transactions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: cat }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.auto_applied > 0) {
          setAutoMsg(`Also updated ${data.auto_applied} similar transaction${data.auto_applied > 1 ? 's' : ''}`);
        }
        // Small delay ensures the parquet write has flushed before we re-fetch
        setTimeout(() => { if (refreshFin) refreshFin(); }, 300);
      }
    } catch(e) { /* optimistic, ignore */ }
  };

  return (
    <div className="tab-body">
      <div className="card">
        {isGlobalSearch && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 16px', background: 'var(--accent-bg, #f0fdf4)',
            borderBottom: '1px solid var(--line)', fontSize: 12, color: 'var(--accent)',
            fontWeight: 500,
          }}>
            {semLoading
              ? <span style={{ animation: 'spin 0.7s linear infinite', display: 'inline-block' }}>◌</span>
              : <span>⌕</span>
            }
            <span>
              {semLoading ? 'Semantic search…' : (
                isSemantic
                  ? `Semantic · all months · ${filtered.length} result${filtered.length !== 1 ? 's' : ''}`
                  : `All months · ${filtered.length} result${filtered.length !== 1 ? 's' : ''}`
              )}
            </span>
            {isSemantic && !semLoading && (
              <span style={{ fontSize: 10, background: 'var(--accent)', color: '#fff',
                padding: '1px 6px', borderRadius: 8, fontWeight: 600 }}>AI</span>
            )}
            <button onClick={() => { setSearch(''); setGlobalSearch(''); setSemMerchants(null); setIsSemantic(false); }}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--muted)', fontSize: 11, padding: '2px 6px', borderRadius: 4 }}>
              Clear ×
            </button>
          </div>
        )}
        <div className="filter-bar">
          <div className="search-input">
            <span className="search-icon">⌕</span>
            <input
              placeholder="Search all months…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setGlobalSearch(e.target.value); }}
            />
          </div>
          <SearchableSelect
            value={catFilter}
            onChange={setCatFilter}
            placeholder="All categories"
            options={[
              { value: 'all', label: 'All categories' },
              ...CATEGORIES.map(c => ({ value: c.id, label: c.name, dot: c.color })),
            ]}
          />
          <SearchableSelect
            value={acctFilter}
            onChange={setAcctFilter}
            placeholder="All accounts"
            options={[
              { value: 'all', label: 'All accounts' },
              ...ACCOUNTS.map(a => ({ value: a.id, label: a.name, dot: a.color })),
            ]}
          />
          <button
            onClick={() => setShowFlagged(f => !f)}
            title={showFlagged ? 'Show all transactions' : 'Show flagged only'}
            className={`filter-btn ${showFlagged ? 'active' : ''}`}
            style={showFlagged ? { borderColor: '#f97316', background: 'rgba(249,115,22,0.08)', color: '#c2410c' } : {}}
          >⚑ Flagged</button>
          <div className="filter-stats">
            <span><b>{filtered.length}</b> txns</span>
            <span className="pos">+{fmtMoney(totalIn)}</span>
            <span className="neg">−{fmtMoney(totalOut)}</span>
          </div>
          <button onClick={() => setShowAdd(true)} style={{
            padding: '6px 14px', borderRadius: 8, border: '1px solid var(--accent)',
            background: 'none', color: 'var(--accent)', cursor: 'pointer',
            fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
          }}>+ Add</button>
        </div>
        <TxnList
          key={isSemantic ? 'sem' : 'default'}
          txns={isSemantic && semMerchants
            ? [...filtered].sort((a, b) => {
                const scoreA = semMerchants.get(`${a.merchant}||${a.category}`) ?? semMerchants.get(a.merchant) ?? 0;
                const scoreB = semMerchants.get(`${b.merchant}||${b.category}`) ?? semMerchants.get(b.merchant) ?? 0;
                return scoreB - scoreA;
              })
            : filtered}
          presorted={isSemantic}
          onRecategorize={recat}
          refreshFin={refreshFin}
        />
        {filtered.length === 0 && <div className="empty">No transactions match your filters.</div>}
      </div>
      {showAdd && <AddTransactionModal onClose={() => setShowAdd(false)} refreshFin={refreshFin} />}
      {autoMsg && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--surface)', border: '1px solid var(--accent)',
          borderRadius: 12, padding: '10px 20px', fontSize: 13, fontWeight: 500,
          color: 'var(--ink)', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', zIndex: 9999,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ color: 'var(--accent)' }}>✓</span> {autoMsg}
        </div>
      )}
    </div>
  );
}

// ─── Budget Bars ──────────────────────────────────────────────
// Shows spending vs budget for each category with inline editing.
function BudgetBars({ monthKey }) {
  const [budgets,    setBudgets]    = useState(null); // { cat_id: amount }
  const [editing,    setEditing]    = useState(null); // cat_id being edited
  const [draftValue, setDraftValue] = useState('');
  const [saving,     setSaving]     = useState(false);

  useEffect(() => {
    apiFetch('/api/budgets')
      .then(r => r.json())
      .then(setBudgets)
      .catch(() => setBudgets({}));
  }, []);

  const txns = txnsForMonth(monthKey);
  // Spending by category this month (expenses only)
  const spendMap = {};
  txns.forEach(t => {
    if (t.amount >= 0 || t.category === 'transfer' || t.category === 'income') return;
    spendMap[t.category] = (spendMap[t.category] || 0) + Math.abs(t.amount);
  });

  // Rows = all categories that either have a budget or have spending this month
  const catIds = [...new Set([
    ...Object.keys(spendMap),
    ...Object.keys(budgets || {}),
  ])].filter(id => id && id !== 'transfer' && id !== 'income');

  const rows = catIds.map(id => {
    const info    = catById(id);
    const spent   = spendMap[id] || 0;
    const budget  = budgets?.[id] || null;
    const pct     = budget ? Math.min(spent / budget, 1) : null;
    const over    = budget && spent > budget;
    return { id, info, spent, budget, pct, over };
  }).sort((a, b) => (b.budget || 0) - (a.budget || 0) || b.spent - a.spent);

  async function saveBudget(catId, value) {
    setSaving(true);
    const amount = value === '' || value === '0' ? null : parseFloat(value);
    try {
      const res = await apiFetch('/api/budgets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [catId]: amount }),
      });
      const updated = await res.json();
      setBudgets(updated);
    } catch(e) {}
    setSaving(false);
    setEditing(null);
  }

  if (!budgets) return <div className="empty">Loading budgets…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {rows.map(row => (
        <div key={row.id} style={{
          display: 'grid', gridTemplateColumns: '28px 1fr auto',
          alignItems: 'center', gap: 10,
          padding: '9px 0', borderBottom: '1px solid var(--line)',
        }}>
          {/* Icon */}
          <div style={{
            width: 28, height: 28, borderRadius: 7, fontSize: 14,
            background: `${row.info.color}18`,
            display: 'grid', placeItems: 'center',
          }}>{row.info.icon}</div>

          {/* Name + bar */}
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{row.info.name}</span>
              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: row.over ? 'var(--terra)' : 'var(--ink-2)' }}>
                {fmtMoney(row.spent)}
                {row.budget && <span style={{ color: 'var(--ink-4)' }}> / {fmtMoney(row.budget)}</span>}
              </span>
            </div>
            {row.budget ? (
              <div style={{ height: 5, background: 'var(--line)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 3,
                  width: `${row.pct * 100}%`,
                  background: row.over ? 'var(--terra)' : row.pct > 0.8 ? '#fbbf24' : row.info.color,
                  transition: 'width .4s ease',
                }} />
              </div>
            ) : (
              <div style={{ height: 5, background: 'var(--line)', borderRadius: 3 }} />
            )}
          </div>

          {/* Edit button / inline input */}
          {editing === row.id ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="number" min="0" step="10"
                value={draftValue}
                autoFocus
                onChange={e => setDraftValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') saveBudget(row.id, draftValue);
                  if (e.key === 'Escape') setEditing(null);
                }}
                style={{
                  width: 72, padding: '3px 6px', borderRadius: 6, fontSize: 12,
                  border: '1px solid var(--line-2)', background: 'var(--bg)', color: 'var(--ink)',
                  fontFamily: 'var(--font-mono)', textAlign: 'right',
                }}
              />
              <button onClick={() => saveBudget(row.id, draftValue)} disabled={saving}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 14, padding: 2 }}>✓</button>
              <button onClick={() => setEditing(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 14, padding: 2 }}>×</button>
            </div>
          ) : (
            <button
              onClick={() => { setEditing(row.id); setDraftValue(row.budget ? String(row.budget) : ''); }}
              style={{
                background: 'none', border: '1px solid var(--line)', borderRadius: 6,
                padding: '3px 8px', fontSize: 11, color: 'var(--ink-3)', cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}>
              {row.budget ? 'Edit' : '+ Budget'}
            </button>
          )}
        </div>
      ))}
      {rows.length === 0 && (
        <div className="empty">No spending this month yet.</div>
      )}
    </div>
  );
}

// ─── Weekly Spend Chart ────────────────────────────────────────────
// Bar chart showing total spending per week for the last 13 weeks.
function WeeklySpendChart() {
  const today = new Date();

  // Build 13 weekly buckets. Week starts on Monday.
  const weeks = [];
  for (let w = 12; w >= 0; w--) {
    const endDate = new Date(today);
    endDate.setDate(today.getDate() - w * 7);
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - 6);
    const startStr = startDate.toISOString().slice(0, 10);
    const endStr   = endDate.toISOString().slice(0, 10);
    const label = startDate.toLocaleString('default', { month: 'short', day: 'numeric' });
    weeks.push({ startStr, endStr, label, amount: 0 });
  }

  TRANSACTIONS.forEach(t => {
    if (t.amount >= 0 || t.category === 'transfer' || t.category === 'income') return;
    const d = t.date ? t.date.slice(0, 10) : null;
    if (!d) return;
    const bucket = weeks.find(w => d >= w.startStr && d <= w.endStr);
    if (bucket) bucket.amount += Math.abs(t.amount);
  });

  const max = Math.max(...weeks.map(w => w.amount), 1);
  const avg = weeks.reduce((s, w) => s + w.amount, 0) / weeks.length;

  const [hovered, setHovered] = useState(null);
  const chartH = 140;
  const barW   = 100 / weeks.length;

  return (
    <div>
      <div className="card-head" style={{ marginBottom: 12 }}>
        <h3>Weekly spend pattern</h3>
        <span className="muted">Last 13 weeks · avg {fmtMoney(avg)}/wk</span>
      </div>
      <div style={{ position: 'relative' }}>
        <svg width="100%" height={chartH + 24} style={{ overflow: 'visible', display: 'block' }}>
          {/* Avg reference line */}
          {(() => {
            const y = chartH - (avg / max) * chartH;
            return (
              <line x1="0" y1={y} x2="100%" y2={y}
                stroke="var(--line-2)" strokeWidth="1" strokeDasharray="4 3" />
            );
          })()}
          {weeks.map((w, i) => {
            const barH = (w.amount / max) * chartH;
            const x    = `${i * barW + barW * 0.1}%`;
            const bw   = `${barW * 0.8}%`;
            const isHigh = w.amount > avg * 1.3;
            return (
              <g key={i}>
                <rect
                  x={x} y={chartH - barH} width={bw} height={Math.max(barH, 1)}
                  rx="3"
                  fill={hovered === i ? 'var(--terra)' : isHigh ? 'rgba(217,119,87,0.7)' : 'rgba(217,119,87,0.35)'}
                  style={{ transition: 'fill .1s', cursor: 'default' }}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                />
                {/* X-axis label — every 3rd week to avoid crowding */}
                {i % 3 === 0 && (
                  <text x={`${i * barW + barW / 2}%`} y={chartH + 16}
                    textAnchor="middle" fontSize="9.5" fill="var(--ink-4)"
                    fontFamily="var(--font-mono)">
                    {w.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {/* Hover tooltip */}
        {hovered !== null && (
          <div style={{
            position: 'absolute',
            left: `${hovered * barW + barW / 2}%`,
            top: Math.max(0, chartH - (weeks[hovered].amount / max) * chartH - 42),
            transform: 'translateX(-50%)',
            background: 'var(--surface)', border: '1px solid var(--line-2)',
            borderRadius: 8, padding: '5px 9px', fontSize: 12,
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)', pointerEvents: 'none', zIndex: 10,
            whiteSpace: 'nowrap',
          }}>
            <div style={{ fontSize: 10, color: 'var(--ink-3)', marginBottom: 1 }}>
              Wk of {weeks[hovered].label}
            </div>
            <div style={{ fontWeight: 600, color: 'var(--terra)' }}>
              {fmtMoney2(weeks[hovered].amount)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export { BudgetBars, WeeklySpendChart };
export default TransactionsTab;
