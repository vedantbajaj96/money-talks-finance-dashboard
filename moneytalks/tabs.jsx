// Tab components for the finance dashboard.
// Loaded after data.js, charts.jsx, and React.
(function () {
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
function MonthVibeBanner({ summary, prev }) {
  if (!summary || summary.income === 0) return null;
  const savingsRate = summary.income > 0 ? (summary.net / summary.income) * 100 : 0;
  const betterThanPrev = prev && summary.net > prev.net;
  const improvement    = prev ? summary.net - prev.net : 0;

  let emoji = '', text = '', color = '';

  if (savingsRate >= 30) {
    emoji = '🚀'; color = '#22c55e';
    text  = `${savingsRate.toFixed(0)}% savings rate — you're crushing it this month!`;
  } else if (savingsRate >= 20) {
    emoji = '✨'; color = 'var(--accent)';
    text  = `${savingsRate.toFixed(0)}% savings rate — solid month. Keep it up!`;
  } else if (savingsRate >= 10) {
    emoji = '👍'; color = '#60a5fa';
    text  = `${savingsRate.toFixed(0)}% savings rate — steady as she goes.`;
  } else if (summary.net < 0) {
    emoji = '😬'; color = '#f97316';
    text  = `Spent more than earned this month.${betterThanPrev ? ' But still better than last month!' : ' Next month is a fresh start.'}`;
  } else {
    emoji = '📊'; color = 'var(--muted)';
    text  = `${savingsRate.toFixed(0)}% savings rate this month.`;
  }

  if (betterThanPrev && improvement > 0 && savingsRate >= 10) {
    text += ` ${fmtMoney(improvement)} better than last month! 🎉`;
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 16px', marginBottom: 16, borderRadius: 12,
      background: 'color-mix(in srgb, var(--surface) 80%, transparent)',
      border: '1px solid var(--line)',
      fontSize: 13, color: 'var(--ink)',
    }}>
      <span style={{ fontSize: 20 }}>{emoji}</span>
      <span style={{ color }}>{text}</span>
    </div>
  );
}

// ─── Count-up animation hook ───────────────────────────────────────
// Animates from 0 → target on mount (and when target changes significantly).
function useCountUp(target, duration = 550) {
  const [val, setVal] = React.useState(0);
  const rafRef = useRef(null);
  useEffect(() => {
    if (target == null || isNaN(target)) return;
    cancelAnimationFrame(rafRef.current);
    let start = null;
    const from = 0;
    function tick(ts) {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3); // cubic ease-out
      setVal(from + (target - from) * eased);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target]);
  return val;
}

// ─── Reusable: Summary card ────────────────────────────────────────
// Pass `n` (raw number) + `nFmt` (formatter fn) for count-up animation.
// Falls back to static `value` string when `n` is not provided.
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
function MonthlyTab({ monthKey, txnOverrides, setTxnOverrides, refreshFin }) {
  const { useState, useEffect } = React;
  const [selectedCat, setSelectedCat] = useState(null);
  const [subCat, setSubCat]           = useState(null); // drilled category within expenses breakdown
  const [sortBy, setSortBy]           = useState('amount'); // 'amount' | 'date'

  const summary = monthSummary(monthKey);
  const rawMonthTxns = txnsForMonth(monthKey);
  const monthTxns = rawMonthTxns.map(t =>
    txnOverrides && txnOverrides[t.id] ? { ...t, category: txnOverrides[t.id] } : t
  );
  const breakdown = sumByCategory(monthTxns);
  const incomeSeries  = MONTHS.map((m) => ({ label: m.short, value: monthSummary(m.key).income }));
  const expenseSeries = MONTHS.map((m) => ({ label: m.short, value: monthSummary(m.key).expenses }));
  const prevIdx = MONTHS.findIndex((m) => m.key === monthKey) - 1;
  const prev = prevIdx >= 0 ? monthSummary(MONTHS[prevIdx].key) : null;
  const trend = (cur, prv) => prv ? ((cur - prv) / prv) * 100 : 0;

  const catInfo = selectedCat === 'income'
    ? { name: 'Income', color: 'var(--green)', cat: 'income' }
    : selectedCat ? breakdown.find(b => b.cat === selectedCat) : null;
  const catTxns = selectedCat
    ? monthTxns.filter(t => t.category === selectedCat).sort((a, b) =>
        sortBy === 'date' ? new Date(b.date) - new Date(a.date) : Math.abs(b.amount) - Math.abs(a.amount))
    : monthTxns.slice(0, 8);

  function handleSliceClick(s) {
    setSelectedCat(prev => prev === s.cat ? null : s.cat);
  }

  const recat = async (id, cat) => {
    if (setTxnOverrides) setTxnOverrides(prev => ({ ...prev, [id]: cat }));
    try {
      const res = await fetch(`/api/transactions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: cat }),
      });
      if (res.ok && refreshFin) refreshFin();
    } catch(e) {}
  };

  return (
    <div className="tab-body">
      <div className="grid-4">
        <div onClick={() => setSelectedCat(c => c === 'income' ? null : 'income')}
          style={{ cursor: 'pointer', outline: selectedCat === 'income' ? '2px solid var(--green)' : 'none', borderRadius: 16 }}>
          <SummaryCard label="Income" n={summary.income} accent="var(--green)"
            trend={prev ? trend(summary.income, prev.income) : null}
            spark={incomeSeries.map((p) => p.value)} />
        </div>
        <div onClick={() => setSelectedCat(c => c === 'expenses' ? null : 'expenses')}
          style={{ cursor: 'pointer', outline: selectedCat === 'expenses' ? '2px solid var(--terra)' : 'none', borderRadius: 16 }}>
          <SummaryCard label="Expenses" n={summary.expenses} accent="var(--terra)"
            trend={prev ? trend(summary.expenses, prev.expenses) : null}
            spark={expenseSeries.map((p) => p.value)} />
        </div>
        <SummaryCard label="Net" n={summary.net} accent={summary.net >= 0 ? 'var(--green)' : 'var(--terra)'}
          sub={`${summary.income > 0 ? ((summary.net / summary.income) * 100).toFixed(0) : 0}% savings rate`} />
        <SummaryCard label="Saved" n={summary.savings} accent="var(--accent2)"
          sub="auto-transfers + IRA" />
      </div>
      {selectedCat === 'expenses' && (() => {
        const expCats = breakdown.filter(b => b.cat !== 'income' && b.cat !== 'transfer' && b.cat !== 'refund');
        const total   = expCats.reduce((s, b) => s + b.amount, 0);
        const subInfo = subCat ? expCats.find(b => b.cat === subCat) : null;
        const subTxns = subCat
          ? monthTxns.filter(t => t.category === subCat)
              .sort((a, b) => sortBy === 'date' ? new Date(b.date) - new Date(a.date) : Math.abs(b.amount) - Math.abs(a.amount))
          : [];

        return (
          <div className="card" style={{ borderColor: 'var(--terra)', borderWidth: 1.5 }}>
            {/* Header — collapses to category name when drilled in */}
            <div className="card-head">
              {subInfo ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                  <button onClick={() => setSubCat(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 13, padding: 0, fontFamily: 'inherit' }}>← All</button>
                  <span className="cat-dot" style={{ background: subInfo.color }} />
                  <span style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 14 }}>{subInfo.name}</span>
                  <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>{fmtMoney(subInfo.amount)}</span>
                </div>
              ) : (
                <h3 style={{ color: 'var(--terra)' }}>↙ Spending breakdown</h3>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {subInfo && ['amount', 'date'].map(s => (
                  <button key={s} onClick={() => setSortBy(s)} style={{
                    background: sortBy === s ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'none',
                    border: `1px solid ${sortBy === s ? 'var(--accent)' : 'var(--line)'}`,
                    borderRadius: 6, padding: '2px 10px', fontSize: 12, cursor: 'pointer',
                    color: sortBy === s ? 'var(--accent)' : 'var(--ink-3)', fontFamily: 'inherit',
                  }}>{s === 'amount' ? '$ Amount' : '📅 Date'}</button>
                ))}
                {!subInfo && <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--terra)' }}>{fmtMoney(total)}</span>}
                <button onClick={() => { setSelectedCat(null); setSubCat(null); }} style={{
                  background: 'none', border: '1px solid var(--line)', borderRadius: 6,
                  padding: '2px 10px', fontSize: 12, color: 'var(--ink-3)', cursor: 'pointer',
                }}>Close</button>
              </div>
            </div>

            {subInfo ? (
              /* Drilled into a category — show transactions inline */
              <TxnList txns={subTxns} compact onRecategorize={recat} refreshFin={refreshFin}
                sortCol={sortBy === 'date' ? 'date' : 'amount'} sortDir="desc" />
            ) : (
              /* Category list */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {expCats.map(b => (
                  <div key={b.cat} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0',
                    borderBottom: '1px solid var(--line)', cursor: 'pointer' }}
                    onClick={() => setSubCat(b.cat)}>
                    <span className="cat-dot" style={{ background: b.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 14, color: 'var(--ink)' }}>{b.name}</span>
                    <div style={{ width: 120, height: 6, background: 'var(--line)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 3, background: b.color,
                        width: `${total > 0 ? (b.amount / total) * 100 : 0}%` }} />
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', minWidth: 70, textAlign: 'right' }}>{fmtMoney(b.amount)}</span>
                    <span style={{ fontSize: 12, color: 'var(--ink-3)', minWidth: 36, textAlign: 'right' }}>
                      {total > 0 ? ((b.amount / total) * 100).toFixed(0) : 0}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}
      {selectedCat === 'income' && (() => {
        const incomeTxns = monthTxns.filter(t => t.category === 'income').sort((a,b) => Math.abs(b.amount) - Math.abs(a.amount));
        const bySource = {};
        incomeTxns.forEach(t => {
          const src = t.account || 'Other';
          bySource[src] = (bySource[src] || 0) + Math.abs(t.amount);
        });
        return (
          <div className="card" style={{ borderColor: 'var(--green)', borderWidth: 1.5 }}>
            <div className="card-head">
              <h3 style={{ color: 'var(--green)' }}>↗ Income this month</h3>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--green)' }}>{fmtMoney(summary.income)}</span>
                <button onClick={() => setSelectedCat(null)} style={{
                  background: 'none', border: '1px solid var(--line)', borderRadius: 6,
                  padding: '2px 10px', fontSize: 12, color: 'var(--ink-3)', cursor: 'pointer',
                }}>Close</button>
              </div>
            </div>
            <TxnList txns={incomeTxns} compact onRecategorize={recat} refreshFin={refreshFin} />
          </div>
        );
      })()}
      <MonthVibeBanner summary={summary} prev={prev} />
      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h3>Cash flow</h3><span className="muted">Last 6 months</span></div>
          <AreaChart series={[
            { key: 'inc', name: 'Income',   color: '#5ec98a', points: incomeSeries },
            { key: 'exp', name: 'Expenses', color: '#d97757', points: expenseSeries },
          ]} height={240} formatter={fmtAbbr} />
        </div>
        {/* "Where it went" — collapses to a single-line header when a category is selected */}
        {selectedCat && catInfo && selectedCat !== 'income' && selectedCat !== 'expenses' ? (
          <div className="card" style={{ cursor: 'pointer', alignSelf: 'start' }} onClick={() => setSelectedCat(null)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 0' }}>
              <span className="cat-dot" style={{ background: catInfo.color, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{catInfo.name}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{fmtMoney(catInfo.amount)}</span>
              <span style={{ fontSize: 12, color: 'var(--ink-3)', marginLeft: 4 }}>▾ All categories</span>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="card-head"><h3>Where it went</h3><span className="muted">{MONTHS.find((m) => m.key === monthKey)?.label}</span></div>
            <div className="donut-row">
              <DonutChart data={breakdown} size={200} thickness={26} formatter={fmtMoney}
                selectedCat={selectedCat} onSliceClick={handleSliceClick} />
              <div className="donut-legend">
                {breakdown.map((b) => (
                  <div key={b.cat} className="legend-row"
                    style={{ cursor: 'pointer', opacity: selectedCat && selectedCat !== b.cat ? 0.4 : 1, transition: 'opacity .15s' }}
                    onClick={() => handleSliceClick(b)}>
                    <span className="cat-dot" style={{ background: b.color }} />
                    <span className="legend-name">{b.name}</span>
                    <span className="legend-amt">{fmtMoney(b.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      {/* Transactions — appear full-width directly below the grid */}
      {selectedCat && catInfo && selectedCat !== 'income' && selectedCat !== 'expenses' && (
        <div className="card">
          <div className="card-head">
            <h3>
              <span className="cat-dot" style={{ background: catInfo.color, display: 'inline-block', marginRight: 6 }} />
              {catInfo.name}
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {['amount', 'date'].map(s => (
                <button key={s} onClick={() => setSortBy(s)} style={{
                  background: sortBy === s ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'none',
                  border: `1px solid ${sortBy === s ? 'var(--accent)' : 'var(--line)'}`,
                  borderRadius: 6, padding: '2px 10px', fontSize: 12, cursor: 'pointer',
                  color: sortBy === s ? 'var(--accent)' : 'var(--ink-3)', fontFamily: 'inherit',
                }}>{s === 'amount' ? '$ Amount' : '📅 Date'}</button>
              ))}
            </div>
          </div>
          <TxnList txns={catTxns} compact onRecategorize={recat} refreshFin={refreshFin}
            sortCol={sortBy === 'date' ? 'date' : 'amount'} sortDir="desc" />
        </div>
      )}
      {!selectedCat && (
        <div className="card">
          <div className="card-head">
            <h3>Recent transactions</h3>
            <span className="muted">{monthTxns.length} this month · click a slice or Income to filter</span>
          </div>
          <TxnList txns={catTxns} compact onRecategorize={recat} refreshFin={refreshFin} />
        </div>
      )}
    </div>
  );
}

// ─── Overview Tab (month-agnostic, draggable widgets) ──────────────────────
const OVERVIEW_WIDGETS = [
  { id: 'networth',  label: 'Net Worth'             },
  { id: 'quality',   label: 'Data Quality'          },
  { id: 'vs6mo',     label: 'vs. 6-Month Avg'       },
  { id: 'anomalies', label: 'Spending Alerts'       },
  { id: 'merchants', label: 'Top Merchants'         },
  { id: 'trends',    label: 'Spending Trends'       },
  { id: 'recurring', label: 'Upcoming Bills'        },
  { id: 'recent',    label: 'Recent Transactions'   },
  { id: 'funfact',   label: '✨ Fun Fact'           },
];

const OVERVIEW_ORDER_KEY = 'mt_overview_order';

function DragCard({ id, index, order, onReorder, title, children }) {
  const { useRef } = React;
  const dragRef = useRef(null);

  function onDragStart(e) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  }
  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }
  function onDrop(e) {
    e.preventDefault();
    const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (fromIdx === index) return;
    const next = [...order];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(index, 0, moved);
    onReorder(next);
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{ cursor: 'grab' }}
    >
      <div className="card">
        <div className="card-head">
          <h3>{title}</h3>
          <span style={{ color: 'var(--line-2)', fontSize: 14, userSelect: 'none' }}>⠿</span>
        </div>
        <div>
          {children}
        </div>
      </div>
    </div>
  );
}

function OverviewTab() {
  const { useState, useMemo } = React;

  const savedOrder = (() => {
    try { return JSON.parse(localStorage.getItem(OVERVIEW_ORDER_KEY)); } catch(e) { return null; }
  })();
  const defaultOrder = OVERVIEW_WIDGETS.map(w => w.id);
  const [order, setOrder] = useState(savedOrder || defaultOrder);

  function handleReorder(next) {
    setOrder(next);
    localStorage.setItem(OVERVIEW_ORDER_KEY, JSON.stringify(next));
  }

  // ── Pre-compute all widget data ──────────────────────────────────
  const now   = new Date();
  const today = now.toISOString().slice(0, 10);
  const ago30 = new Date(now - 30 * 864e5).toISOString().slice(0, 10);
  const ago90 = new Date(now - 90 * 864e5).toISOString().slice(0, 10);

  const allTxns = TRANSACTIONS.filter(t => t.category !== 'transfer');

  // Net worth from account balances (balance already signed: negative = liability)
  const netWorth = useMemo(() => {
    let assets = 0, liabilities = 0;
    ACCOUNTS.forEach(a => {
      if (a.balance >= 0) assets      += a.balance;
      else                liabilities += Math.abs(a.balance);
    });
    return { total: assets - liabilities, assets, liabilities };
  }, []);

  // Top merchants last 30 days — spending only (amount < 0 after server negation)
  const topMerchants = useMemo(() => {
    const map = {};
    allTxns.filter(t => t.date >= ago30 && t.category !== 'income' && t.amount < 0).forEach(t => {
      map[t.merchant] = (map[t.merchant] || 0) + Math.abs(t.amount);
    });
    return Object.entries(map).sort((a,b) => b[1]-a[1]).slice(0, 8)
      .map(([name, amt]) => ({ name, amt }));
  }, []);

  // Spending anomalies: current month vs 3-month avg (spending only, income excluded)
  const anomalies = useMemo(() => {
    const curMonth = today.slice(0, 7);
    const spendingTxns = allTxns.filter(t => t.category !== 'income' && t.amount < 0);
    const catTotals = (from, to) => {
      const map = {};
      spendingTxns.filter(t => t.date >= from && t.date <= to).forEach(t => {
        map[t.category] = (map[t.category] || 0) + Math.abs(t.amount);
      });
      return map;
    };
    const cur = catTotals(curMonth + '-01', today);
    // avg = prev 90 days / 3
    const alerts = [];
    Object.entries(cur).forEach(([cat, curAmt]) => {
      const p3Total = spendingTxns.filter(t => t.date >= ago90 && t.date < curMonth + '-01'
        && t.category === cat).reduce((s, t) => s + Math.abs(t.amount), 0);
      const avg = p3Total / 3;
      if (avg > 20 && curAmt > avg * 1.25 && curAmt - avg > 50) {
        const catInfo = catById(cat);
        alerts.push({ cat, name: catInfo.name, color: catInfo.color, cur: curAmt, avg, pct: Math.round((curAmt/avg-1)*100) });
      }
    });
    return alerts.sort((a,b) => b.pct - a.pct).slice(0, 4);
  }, []);

  // Spending trends: last 6 months per top spending category (income excluded)
  const trends = useMemo(() => {
    const last6 = MONTHS.slice(-6);
    const topCats = [...new Set(
      allTxns.filter(t => t.category !== 'income' && t.amount < 0)
        .sort((a,b) => Math.abs(b.amount) - Math.abs(a.amount))
        .slice(0, 100).map(t => t.category)
    )].slice(0, 5);
    return topCats.map(cat => {
      const catInfo = catById(cat);
      const points = last6.map(m => ({
        label: m.short,
        value: allTxns.filter(t => t.date.startsWith(m.key) && t.category === cat && t.amount < 0)
          .reduce((s,t) => s + Math.abs(t.amount), 0),
      }));
      return { cat, name: catInfo.name, color: catInfo.color, points };
    });
  }, []);

  // Upcoming recurring (next 14 days)
  const upcoming = useMemo(() => {
    const dayOfMonth = now.getDate();
    return RECURRING.filter(r => {
      const due = r.day || 1;
      const daysUntil = due >= dayOfMonth ? due - dayOfMonth : (28 - dayOfMonth + due);
      return daysUntil <= 14;
    }).map(r => {
      const due = r.day || 1;
      const daysUntil = due >= dayOfMonth ? due - dayOfMonth : (28 - dayOfMonth + due);
      return { ...r, daysUntil };
    }).sort((a,b) => a.daysUntil - b.daysUntil).slice(0, 6);
  }, []);

  // Recent txns (last 10 across all time)
  const recentTxns = allTxns.slice(0, 10);

  // Fun fact — computed once from spending data
  const funFact = useMemo(() => {
    const spendTxns = allTxns.filter(t => t.amount < 0 && t.category !== 'income');
    if (spendTxns.length === 0) return null;

    const totalSpend  = spendTxns.reduce((s, t) => s + Math.abs(t.amount), 0);
    const catMap      = {};
    spendTxns.forEach(t => { catMap[t.category] = (catMap[t.category] || 0) + Math.abs(t.amount); });
    const topCat      = Object.entries(catMap).sort((a,b) => b[1]-a[1])[0];
    const diningAmt   = catMap['dining'] || catMap['food'] || catMap['restaurants'] || 0;
    const coffeeAmt   = catMap['coffee'] || 0;
    const daysOfData  = Math.max(1, Math.round((new Date(spendTxns[0]?.date) - new Date(spendTxns[spendTxns.length-1]?.date)) / 864e5));
    const dailySpend  = totalSpend / Math.max(1, daysOfData);
    const yearlyDining = diningAmt * (365 / Math.max(1, daysOfData));

    const facts = [];

    if (diningAmt > 200) {
      const burritos = Math.round(yearlyDining / 12);
      facts.push({ emoji: '🌯', text: `At your dining pace, you'll spend ${fmtMoney(yearlyDining)} on food this year — that's ${burritos.toLocaleString()} Chipotle burritos.` });
    }
    if (coffeeAmt > 50) {
      const yearCoffee = coffeeAmt * (365 / Math.max(1, daysOfData));
      const cups = Math.round(yearCoffee / 6);
      facts.push({ emoji: '☕', text: `You spend ${fmtMoney(yearCoffee)} on coffee per year — enough for ${cups.toLocaleString()} lattes.` });
    }
    if (topCat && topCat[1] > 100) {
      const catInfo = catById(topCat[0]);
      const topPct  = Math.round((topCat[1] / totalSpend) * 100);
      const CAT_EMOJIS = { dining: '🍽️', food: '🍽️', restaurant: '🍽️', transport: '🚗', auto: '🚗', car: '🚗', shopping: '🛍️', housing: '🏠', rent: '🏠', entertainment: '🎬', health: '💊', travel: '✈️', groceries: '🛒', coffee: '☕', clothing: '👗', utilities: '💡', fitness: '💪', subscription: '📱' };
      const emojiKey = Object.keys(CAT_EMOJIS).find(k => topCat[0].toLowerCase().includes(k));
      facts.push({ emoji: CAT_EMOJIS[emojiKey] || '💸', text: `${catInfo.name} is your #1 spending category at ${topPct}% of total spend.` });
    }
    if (dailySpend > 10) {
      facts.push({ emoji: '📅', text: `You spend about ${fmtMoney(dailySpend)}/day on average — or ${fmtMoney(dailySpend * 365)} a year.` });
    }

    // Pick one pseudo-randomly (based on current date so it changes daily)
    if (facts.length === 0) return null;
    const pick = facts[new Date().getDate() % facts.length];
    return pick;
  }, []);

  // Data quality stats — fetched from /api/review
  const [reviewStats, setReviewStats] = useState(null);
  useEffect(() => {
    apiFetch('/api/review')
      .then(r => r.json())
      .then(d => setReviewStats(d))
      .catch(() => {});
  }, []);

  // Category spend: this month vs 6-month average
  const curMonthKey = MONTHS[MONTHS.length - 1]?.key;
  const vs6mo = useMemo(() => {
    const last6 = MONTHS.slice(-7, -1); // 6 months before current
    const curTxns = txnsForMonth(curMonthKey);

    // Sum spending by category for each of the last 6 months, then average
    const avgMap = {};
    last6.forEach(m => {
      txnsForMonth(m.key).forEach(t => {
        if (t.amount >= 0 || t.category === 'transfer' || t.category === 'income') return;
        avgMap[t.category] = (avgMap[t.category] || 0) + Math.abs(t.amount);
      });
    });
    Object.keys(avgMap).forEach(k => { avgMap[k] /= last6.length || 1; });

    // Current month spending by category
    const curMap = {};
    curTxns.forEach(t => {
      if (t.amount >= 0 || t.category === 'transfer' || t.category === 'income') return;
      curMap[t.category] = (curMap[t.category] || 0) + Math.abs(t.amount);
    });

    // Merge all categories
    const cats = [...new Set([...Object.keys(avgMap), ...Object.keys(curMap)])];
    return cats.map(id => {
      const info  = catById(id);
      const avg   = avgMap[id] || 0;
      const cur   = curMap[id] || 0;
      const delta = avg > 0 ? ((cur - avg) / avg) * 100 : null;
      return { id, info, avg, cur, delta };
    })
    .filter(r => r.avg > 20 || r.cur > 20) // hide tiny categories
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 10);
  }, [curMonthKey]);

  // ── Widget renderers ─────────────────────────────────────────────
  function renderWidget(id, index) {
    const label = OVERVIEW_WIDGETS.find(w => w.id === id)?.label || id;

    if (id === 'networth') return (
      <DragCard key={id} id={id} index={index} order={order} onReorder={handleReorder} title="Net Worth">
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
              {fmt(netWorth.total, { decimals: 0 })}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
              {fmt(netWorth.assets, { decimals: 0 })} assets · {fmt(netWorth.liabilities, { decimals: 0 })} liabilities
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {ACCOUNTS.filter(a => a.balance !== 0).sort((a,b) => Math.abs(b.balance) - Math.abs(a.balance)).slice(0,6).map(a => (
            <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: a.color, display: 'inline-block', flexShrink: 0 }} />
                <span style={{ color: 'var(--ink-2)' }}>{a.inst || a.name}</span>
              </div>
              <span style={{ fontWeight: 500, color: a.balance < 0 ? 'var(--terra)' : 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                {fmt(a.balance, { decimals: 0, sign: false })}
              </span>
            </div>
          ))}
        </div>
      </DragCard>
    );

    if (id === 'quality') {
      const { total = 0, approved = 0, remaining = 0, streak = 0, last_reviewed = null } = reviewStats || {};
      const qPct   = total > 0 ? Math.round((approved / total) * 100) : (reviewStats ? 100 : 0);
      const lowConf = TRANSACTIONS.filter(t => t.confidence === 'low').length;
      const daysSince = last_reviewed
        ? Math.floor((Date.now() - new Date(last_reviewed)) / 864e5)
        : null;
      const needsAttention = daysSince !== null && daysSince > 7;
      // Hide when fully reviewed and recently active — nothing actionable to show
      if (reviewStats && qPct >= 100 && remaining === 0 && !needsAttention) return null;
      return (
        <DragCard key={id} id={id} index={index} order={order} onReorder={handleReorder} title="Data Quality">
          {!reviewStats ? (
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: qPct >= 90 ? 'var(--green)' : qPct >= 70 ? '#fbbf24' : 'var(--terra)',
                    letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>{qPct}%</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>transactions reviewed</div>
                </div>
                {streak > 0 && (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 20 }}>{streak >= 2 ? '🔥' : '✓'}</div>
                    <div style={{ fontSize: 11, color: streak >= 4 ? '#f97316' : 'var(--muted)', fontWeight: 600 }}>
                      {streak}w streak
                    </div>
                  </div>
                )}
              </div>
              <div style={{ height: 5, background: 'var(--line)', borderRadius: 3, overflow: 'hidden', marginBottom: 12 }}>
                <div style={{ height: '100%', width: `${qPct}%`, borderRadius: 3,
                  background: qPct >= 90 ? 'var(--green)' : qPct >= 70 ? '#fbbf24' : 'var(--terra)',
                  transition: 'width 0.4s ease' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, fontSize: 13 }}>
                {remaining > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--ink-2)' }}>Awaiting review</span>
                    <span style={{ fontWeight: 600, color: 'var(--terra)' }}>{remaining}</span>
                  </div>
                )}
                {lowConf > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--ink-2)' }}>Low confidence</span>
                    <span style={{ fontWeight: 600, color: '#d97706' }}>{lowConf}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--ink-2)' }}>Last reviewed</span>
                  <span style={{ fontWeight: 500, color: needsAttention ? 'var(--terra)' : 'var(--ink)' }}>
                    {daysSince === null ? 'Never' : daysSince === 0 ? 'Today' : `${daysSince}d ago`}
                  </span>
                </div>
              </div>
            </>
          )}
        </DragCard>
      );
    }

    if (id === 'vs6mo') return (
      <DragCard key={id} id={id} index={index} order={order} onReorder={handleReorder} title="vs. 6-Month Avg">
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 12 }}>
          {MONTHS[MONTHS.length - 1]?.label} · compared to 6-month average
        </div>
        {vs6mo.length === 0 ? (
          <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>Not enough history yet.</div>
        ) : vs6mo.map(row => {
          const max = Math.max(row.avg, row.cur);
          const avgPct = max > 0 ? (row.avg / max) * 100 : 0;
          const curPct = max > 0 ? (row.cur / max) * 100 : 0;
          const over   = row.cur > row.avg * 1.1;
          const under  = row.cur < row.avg * 0.9;
          return (
            <div key={row.id} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13 }}>{row.info.icon}</span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{row.info.name}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: over ? 'var(--terra)' : under ? 'var(--green)' : 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtMoney(row.cur)}
                  </span>
                  {row.delta !== null && (
                    <span style={{ fontSize: 11, color: over ? 'var(--terra)' : under ? 'var(--green)' : 'var(--ink-3)' }}>
                      {row.delta > 0 ? '+' : ''}{row.delta.toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>
              {/* Dual bar: avg (grey) behind, current (colored) on top */}
              <div style={{ position: 'relative', height: 5 }}>
                <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${avgPct}%`,
                  background: 'rgba(20,24,32,0.1)', borderRadius: 3 }} />
                <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${curPct}%`,
                  background: over ? 'var(--terra)' : under ? 'var(--green)' : row.info.color,
                  borderRadius: 3, opacity: 0.75 }} />
              </div>
              <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>
                avg {fmtMoney(row.avg)}/mo
              </div>
            </div>
          );
        })}
      </DragCard>
    );

    if (id === 'anomalies') return (
      <DragCard key={id} id={id} index={index} order={order} onReorder={handleReorder} title="Spending Alerts">
        {anomalies.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 13, padding: '12px 0' }}>
            All categories within normal range. Nice work.
          </div>
        ) : anomalies.map(a => (
          <div key={a.cat} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: a.color, display: 'inline-block' }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{a.name}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>avg {fmtMoney(a.avg)}/mo</div>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--terra)' }}>{fmtMoney(a.cur)}</div>
              <div style={{ fontSize: 11, color: '#ef4444' }}>+{a.pct}% this month</div>
            </div>
          </div>
        ))}
      </DragCard>
    );

    if (id === 'merchants') return (
      <DragCard key={id} id={id} index={index} order={order} onReorder={handleReorder} title="Top Merchants">
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>Last 30 days</div>
        {topMerchants.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>No transactions yet.</div>
        ) : topMerchants.map((m, i) => {
          const max = topMerchants[0].amt;
          return (
            <div key={m.name} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                <span style={{ color: 'var(--ink)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{m.name}</span>
                <span style={{ color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(m.amt)}</span>
              </div>
              <div style={{ height: 3, background: 'var(--line)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(m.amt/max)*100}%`, background: 'var(--accent)', borderRadius: 2 }} />
              </div>
            </div>
          );
        })}
      </DragCard>
    );

    if (id === 'trends') return (
      <DragCard key={id} id={id} index={index} order={order} onReorder={handleReorder} title="Spending Trends">
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>Last 6 months by category</div>
        {trends.map(t => (
          <div key={t.cat} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <div style={{ width: 90, fontSize: 12, color: 'var(--ink-2)', fontWeight: 500, flexShrink: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
            <div style={{ flex: 1 }}>
              <Sparkline points={t.points.map(p => p.value)} color={t.color} height={28} />
            </div>
            <div style={{ width: 60, textAlign: 'right', fontSize: 12, color: 'var(--ink)',
              fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(t.points[t.points.length-1]?.value || 0)}</div>
          </div>
        ))}
      </DragCard>
    );

    if (id === 'recurring') return (
      <DragCard key={id} id={id} index={index} order={order} onReorder={handleReorder} title="Upcoming Bills">
        {upcoming.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>No bills due in the next 14 days.</div>
        ) : upcoming.map(r => (
          <div key={r.merchant} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{r.merchant}</div>
              <div style={{ fontSize: 11, color: r.daysUntil <= 3 ? '#f97316' : 'var(--muted)' }}>
                {r.daysUntil === 0 ? 'Due today' : `In ${r.daysUntil} day${r.daysUntil > 1 ? 's' : ''}`}
              </div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
              {fmtMoney(Math.abs(r.amount))}
            </div>
          </div>
        ))}
      </DragCard>
    );

    if (id === 'recent') return (
      <DragCard key={id} id={id} index={index} order={order} onReorder={handleReorder} title="Recent Transactions">
        {recentTxns.length === 0 ? (
          <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>No transactions yet.</div>
        ) : (
          <div>
            {recentTxns.map(t => {
              const cat = catById(t.category);
              return (
                <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '32px 1fr auto', gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ width: 32, height: 32, borderRadius: 9, background: cat.color + '22', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: cat.color, display: 'inline-block' }} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.merchant}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                      <span className="cat-pill" style={{ color: cat.color }}>{cat.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)' }}>{t.date.slice(5).replace('-', '/')}</span>
                    </div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: t.amount >= 0 ? 'var(--green)' : 'var(--ink)', flexShrink: 0, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {fmt(t.amount, { sign: true })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DragCard>
    );

    if (id === 'funfact') {
      if (!funFact) return null;
      return (
        <DragCard key={id} id={id} index={index} order={order} onReorder={handleReorder} title="✨ Fun Fact">
          <div style={{
            display: 'flex', gap: 14, alignItems: 'flex-start',
            background: 'color-mix(in srgb, var(--accent) 6%, transparent)',
            border: '1px solid color-mix(in srgb, var(--accent) 15%, transparent)',
            borderRadius: 10, padding: '14px 16px',
          }}>
            <span style={{ fontSize: 28, lineHeight: 1, flexShrink: 0 }}>{funFact.emoji}</span>
            <p style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.65, margin: 0 }}>
              {funFact.text}
            </p>
          </div>
        </DragCard>
      );
    }

    return null;
  }

  return (
    <div className="tab-body">
      <div className="grid-overview">
        {order.map((id, idx) => renderWidget(id, idx))}
      </div>
    </div>
  );
}

// ─── Transaction List ─────────────────────────────────────────────
// ─── Split transaction modal ───────────────────────────────────────
function SplitModal({ txn, onClose }) {
  const parentAmt = Math.abs(txn.amount);
  const [splits, setSplits] = useState([
    { category: txn.category, amount: String((parentAmt / 2).toFixed(2)), notes: '' },
    { category: txn.category, amount: String((parentAmt / 2).toFixed(2)), notes: '' },
  ]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const splitTotal = splits.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const diff = Math.abs(splitTotal - parentAmt);
  const valid = diff < 0.02 && splits.every(r => r.category && parseFloat(r.amount) > 0);

  function updateSplit(i, field, val) {
    setSplits(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: val } : s));
  }
  function addRow() {
    setSplits(prev => [...prev, { category: txn.category, amount: '0.00', notes: '' }]);
  }
  function removeRow(i) {
    if (splits.length <= 2) return;
    setSplits(prev => prev.filter((_, idx) => idx !== i));
  }

  async function save() {
    setSaving(true); setErr(null);
    try {
      const res = await fetch(`/api/transactions/${txn.id}/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ splits }),
      });
      if (res.ok) {
        onClose(true); // true = reload
      } else {
        const d = await res.json();
        setErr(d.detail || 'Failed to save');
      }
    } catch(e) {
      setErr('Network error');
    }
    setSaving(false);
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={() => onClose(false)}>
      <div style={{
        background: 'var(--surface)', borderRadius: 16, padding: 24, width: 440,
        maxWidth: '95vw', boxShadow: '0 8px 40px rgba(0,0,0,0.2)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--ink)' }}>{txn.merchant}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {txn.date} · Split {fmt(txn.amount, { sign: true })}
            </div>
          </div>
          <button onClick={() => onClose(false)} style={{ background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 18, color: 'var(--muted)', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {splits.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: '0 0 140px' }}>
                <CategoryPicker value={s.category} onChange={v => updateSplit(i, 'category', v)} />
              </div>
              <input
                type="number" min="0" step="0.01"
                value={s.amount}
                onChange={e => updateSplit(i, 'amount', e.target.value)}
                style={{
                  flex: '0 0 90px', padding: '5px 8px', borderRadius: 6, fontSize: 13,
                  border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)',
                  textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                }}
              />
              <input
                placeholder="Note (optional)"
                value={s.notes}
                onChange={e => updateSplit(i, 'notes', e.target.value)}
                style={{
                  flex: 1, padding: '5px 8px', borderRadius: 6, fontSize: 12,
                  border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)',
                }}
              />
              <button onClick={() => removeRow(i)}
                disabled={splits.length <= 2}
                style={{ background: 'none', border: 'none', cursor: splits.length <= 2 ? 'default' : 'pointer',
                  color: splits.length <= 2 ? 'var(--line)' : 'var(--muted)', fontSize: 16, padding: '0 4px' }}>×</button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, fontSize: 12 }}>
          <button onClick={addRow} style={{
            background: 'none', border: '1px dashed var(--line)', borderRadius: 6,
            padding: '4px 10px', cursor: 'pointer', color: 'var(--muted)', fontSize: 12,
          }}>+ Add row</button>
          <span style={{
            marginLeft: 'auto', color: diff < 0.02 ? 'var(--green)' : 'var(--terra)',
            fontWeight: 500, fontVariantNumeric: 'tabular-nums',
          }}>
            {diff < 0.02 ? '✓ Balanced' : `${fmt(splitTotal - parentAmt, { sign: true })} off`}
          </span>
        </div>

        {err && <div style={{ color: 'var(--terra)', fontSize: 12, marginBottom: 8 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={() => onClose(false)} style={{
            padding: '7px 16px', borderRadius: 8, border: '1px solid var(--line)',
            background: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--ink)',
          }}>Cancel</button>
          <button onClick={save} disabled={!valid || saving} style={{
            padding: '7px 16px', borderRadius: 8, border: 'none',
            background: valid ? 'var(--accent)' : 'var(--line)', color: '#fff',
            cursor: valid ? 'pointer' : 'default', fontSize: 13, fontWeight: 500,
          }}>{saving ? 'Saving…' : 'Save split'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit Transaction Modal ───────────────────────────────────────
function EditTransactionModal({ txn, onClose }) {
  const isExpense = txn.amount < 0;
  const [form, setForm] = useState({
    description: txn.merchant,
    amount:      String(Math.abs(txn.amount)),
    category:    txn.category,
    notes:       txn.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState(null);

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const valid = form.description.trim() && form.amount !== '' && !isNaN(parseFloat(form.amount));

  async function save() {
    setSaving(true); setErr(null);
    try {
      const amtRaw = parseFloat(form.amount);
      // Keep original sign direction (expense stays negative, income stays positive)
      const newAmount = isExpense ? -Math.abs(amtRaw) : Math.abs(amtRaw);
      const res = await fetch(`/api/transactions/${txn.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: form.description.trim(),
          amount:      newAmount,
          category:    form.category,
          notes:       form.notes.trim(),
        }),
      });
      if (res.ok) { onClose(); }
      else { const d = await res.json(); setErr(d.detail || 'Failed to save'); }
    } catch(e) { setErr('Network error'); }
    setSaving(false);
  }

  const inputStyle = {
    width: '100%', padding: '7px 10px', borderRadius: 8, fontSize: 13,
    border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)',
    boxSizing: 'border-box',
  };
  const labelStyle = { fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, display: 'block' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 24, width: 420, maxWidth: '95vw', boxShadow: '0 8px 40px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>Edit transaction</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--muted)' }}>×</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>Description</label>
            <input value={form.description} onChange={e => set('description', e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Amount ($) <span style={{ color: isExpense ? 'var(--terra)' : 'var(--green)', fontWeight: 400, textTransform: 'none' }}>{isExpense ? 'expense' : 'income'}</span></label>
            <input type="number" min="0" step="0.01" value={form.amount} onChange={e => set('amount', e.target.value)} style={{ ...inputStyle, textAlign: 'right' }} />
          </div>
          <div>
            <label style={labelStyle}>Category</label>
            <CategoryPicker value={form.category} onChange={v => set('category', v)} />
          </div>
          <div>
            <label style={labelStyle}>Notes</label>
            <input placeholder="Optional…" value={form.notes} onChange={e => set('notes', e.target.value)} style={inputStyle} />
          </div>
        </div>
        {err && <div style={{ color: 'var(--terra)', fontSize: 12, marginTop: 10 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid var(--line)', background: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--ink)' }}>Cancel</button>
          <button onClick={save} disabled={!valid || saving} style={{ padding: '7px 20px', borderRadius: 8, border: 'none', background: valid ? 'var(--accent)' : 'var(--line)', color: '#fff', cursor: valid ? 'pointer' : 'default', fontSize: 13, fontWeight: 600 }}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Add Transaction Modal ────────────────────────────────────────
function AddTransactionModal({ onClose, refreshFin }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    date: today, description: '', amount: '', txnType: 'expense',
    category: 'Other', source: 'Cash', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState(null);

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const valid = form.date && form.description.trim() && form.amount !== '' && !isNaN(parseFloat(form.amount));

  async function save() {
    setSaving(true); setErr(null);
    try {
      const amtRaw = parseFloat(form.amount);
      const res = await apiFetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date:             form.date,
          description:      form.description.trim(),
          amount:           form.txnType === 'expense' ? -Math.abs(amtRaw) : Math.abs(amtRaw),
          transaction_type: form.txnType,
          category:         form.category,
          source:           form.source.trim() || 'Cash',
          notes:            form.notes.trim(),
        }),
      });
      if (res.ok) {
        if (refreshFin) await refreshFin();
        onClose();
      } else {
        const d = await res.json();
        setErr(d.detail || 'Failed to save');
      }
    } catch(e) {
      setErr('Network error');
    }
    setSaving(false);
  }

  const inputStyle = {
    width: '100%', padding: '7px 10px', borderRadius: 8, fontSize: 13,
    border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)',
    boxSizing: 'border-box',
  };
  const labelStyle = { fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, display: 'block' };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: 'var(--surface)', borderRadius: 16, padding: 24, width: 420,
        maxWidth: '95vw', boxShadow: '0 8px 40px rgba(0,0,0,0.2)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>Add transaction</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--muted)', lineHeight: 1 }}>×</button>
        </div>

        {/* Type toggle */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {['expense', 'income'].map(t => (
            <button key={t} onClick={() => set('txnType', t)} style={{
              flex: 1, padding: '7px 0', borderRadius: 8, border: '1px solid var(--line)',
              background: form.txnType === t ? (t === 'expense' ? 'var(--terra, #e05c5c)' : 'var(--green, #5ec98a)') : 'var(--bg)',
              color: form.txnType === t ? '#fff' : 'var(--muted)',
              cursor: 'pointer', fontSize: 13, fontWeight: 600,
              textTransform: 'capitalize',
            }}>{t}</button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Date</label>
              <input type="date" value={form.date} onChange={e => set('date', e.target.value)} style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Amount ($)</label>
              <input type="number" min="0" step="0.01" placeholder="0.00"
                value={form.amount} onChange={e => set('amount', e.target.value)}
                style={{ ...inputStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Description</label>
            <input placeholder="e.g. Farmer's market" value={form.description}
              onChange={e => set('description', e.target.value)} style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Category</label>
            <CategoryPicker value={form.category} onChange={v => set('category', v)} />
          </div>

          <div>
            <label style={labelStyle}>Account / Source</label>
            <input placeholder="Cash" value={form.source}
              onChange={e => set('source', e.target.value)} style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Notes (optional)</label>
            <input placeholder="Any extra details…" value={form.notes}
              onChange={e => set('notes', e.target.value)} style={inputStyle} />
          </div>
        </div>

        {err && <div style={{ color: 'var(--terra)', fontSize: 12, marginTop: 10 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} style={{
            padding: '7px 16px', borderRadius: 8, border: '1px solid var(--line)',
            background: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--ink)',
          }}>Cancel</button>
          <button onClick={save} disabled={!valid || saving} style={{
            padding: '7px 20px', borderRadius: 8, border: 'none',
            background: valid ? 'var(--accent)' : 'var(--line)', color: '#fff',
            cursor: valid ? 'pointer' : 'default', fontSize: 13, fontWeight: 600,
          }}>{saving ? 'Saving…' : 'Add transaction'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Inline date editor ───────────────────────────────────────────
// Auto-saves on blur (click away) or Enter. Escape cancels.
function DateEditor({ currentDate, onSave, onCancel }) {
  const [value, setValue] = React.useState(currentDate);
  const savedRef = React.useRef(false);
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      try { inputRef.current.showPicker(); } catch(_) {}
    }
  }, []);

  function commit() {
    if (savedRef.current) return;
    savedRef.current = true;
    if (value && value !== currentDate) onSave(value);
    else onCancel();
  }

  return (
    <input
      ref={inputRef}
      type="date"
      value={value}
      onChange={e => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { savedRef.current = true; onCancel(); }
      }}
      style={{
        fontSize: 12, padding: '2px 4px', borderRadius: 6, width: '100%',
        border: '1px solid var(--accent)', background: 'var(--bg)',
        color: 'var(--ink)', fontFamily: 'var(--font-mono)',
        cursor: 'pointer',
      }}
    />
  );
}


function BarCol({ label, value, maxVal }) {
  const [hovered, setHovered] = React.useState(false);
  const amt = value >= 1000 ? `$${(value / 1000).toFixed(1)}k` : value > 0 ? `$${Math.round(value)}` : '';
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, position: 'relative' }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div style={{ height: 24, flexShrink: 0 }} />
      <div style={{
        position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
        fontSize: 20, color: 'var(--accent)', fontWeight: 700, lineHeight: '24px',
        opacity: hovered && value > 0 ? 1 : 0, transition: 'opacity 0.15s', whiteSpace: 'nowrap', zIndex: 2,
      }}>{amt}</div>
      <div style={{
        width: '100%', borderRadius: 3,
        background: value > 0 ? (hovered ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 70%, transparent)') : 'var(--line)',
        height: value > 0 ? `${Math.max(4, (value / maxVal) * 44)}px` : '3px',
        transition: 'height 0.2s, background 0.15s',
      }} />
      <div style={{ fontSize: 9, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>{label}</div>
    </div>
  );
}

function MerchantDrawer({ merchant, category, onClose }) {
  const { useState: useStateD } = React;
  const [drawerSort, setDrawerSort] = useStateD('date');
  const allTxns = TRANSACTIONS.filter(t => t.merchant === merchant && t.category === category)
    .sort((a, b) => drawerSort === 'date'
      ? b.date.localeCompare(a.date)
      : Math.abs(b.amount) - Math.abs(a.amount));

  const allTimeTotal = allTxns.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const thisYear     = new Date().getFullYear().toString();
  const yearTotal    = allTxns.filter(t => t.amount < 0 && t.date.startsWith(thisYear))
                              .reduce((s, t) => s + Math.abs(t.amount), 0);
  const avgTxn       = allTxns.length > 0 ? allTimeTotal / allTxns.filter(t => t.amount < 0).length : 0;

  // Monthly spend for bar chart — last 12 months
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    return d.toISOString().slice(0, 7);
  });
  const byMonth = {};
  allTxns.filter(t => t.amount < 0).forEach(t => {
    const m = t.date.slice(0, 7);
    byMonth[m] = (byMonth[m] || 0) + Math.abs(t.amount);
  });
  const chartData = months.map(m => ({ label: m.slice(5), value: byMonth[m] || 0 }));
  const maxVal = Math.max(...chartData.map(d => d.value), 1);

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, zIndex: 400,
        background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)',
      }} />

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 401,
        width: 420, background: 'var(--surface)', borderLeft: '1px solid var(--line)',
        display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 32px rgba(0,0,0,0.12)',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
                {merchant}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3 }}>
                {category} · {allTxns.length} transaction{allTxns.length !== 1 ? 's' : ''}
              </div>
            </div>
            <button onClick={onClose} style={{
              background: 'none', border: '1px solid var(--line)', borderRadius: 8,
              padding: '5px 10px', cursor: 'pointer', fontSize: 16, color: 'var(--ink-3)',
              lineHeight: 1, flexShrink: 0,
            }}>✕</button>
          </div>

          {/* Stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 16 }}>
            {[
              { label: 'All time',    value: fmtMoney(allTimeTotal) },
              { label: thisYear,      value: fmtMoney(yearTotal) },
              { label: 'Avg / txn',  value: fmtMoney(avgTxn) },
            ].map(({ label, value }) => (
              <div key={label} style={{
                background: 'var(--surface-3)', borderRadius: 10, padding: '10px 12px',
              }}>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600,
                  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Monthly bar chart */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase',
            letterSpacing: '0.07em', marginBottom: 10 }}>Monthly spend — last 12 months</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 96 }}>
            {chartData.map(({ label, value }) => (
              <BarCol key={label} label={label} value={value} maxVal={maxVal} />
            ))}
          </div>
        </div>

        {/* Transaction list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0' }}>
          <div style={{ display: 'flex', gap: 6, padding: '10px 24px', borderBottom: '1px solid var(--line)' }}>
            {['date', 'amount'].map(s => (
              <button key={s} onClick={() => setDrawerSort(s)} style={{
                background: drawerSort === s ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'none',
                border: `1px solid ${drawerSort === s ? 'var(--accent)' : 'var(--line)'}`,
                borderRadius: 6, padding: '3px 10px', fontSize: 12, cursor: 'pointer',
                color: drawerSort === s ? 'var(--accent)' : 'var(--ink-3)', fontFamily: 'inherit',
              }}>{s === 'date' ? '📅 Date' : '$ Amount'}</button>
            ))}
          </div>
          {allTxns.map(t => {
            const cat = catById(t.category);
            return (
              <div key={t.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 24px', borderBottom: '1px solid var(--line)',
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                  background: cat.color + '24', color: cat.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15,
                }}>{cat.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>{t.date.slice(5).replace('-', '/')}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 1 }}>
                    <span className="cat-pill" style={{ color: cat.color }}>{cat.name}</span>
                  </div>
                </div>
                <div style={{
                  fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                  color: t.amount >= 0 ? 'var(--green)' : 'var(--ink)',
                }}>{fmt(t.amount, { sign: true })}</div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ─── Inline map popover (OpenStreetMap, no API key needed) ─────────
function MapPopover({ txn, onClose }) {
  useEffect(() => {
    // Inject animation once
    if (!document.getElementById('map-popover-css')) {
      const s = document.createElement('style');
      s.id = 'map-popover-css';
      s.textContent = `
        @keyframes mapPopIn {
          from { opacity: 0; transform: translate(-50%, -48%) scale(0.94); }
          to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
      `;
      document.head.appendChild(s);
    }
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const hasCoords = txn.lat != null && txn.lon != null;
  const fullAddress = [txn.location_address, txn.location_city, txn.location_region]
    .filter(Boolean).join(', ');
  const coordLabel = [txn.location_city, txn.location_region].filter(Boolean).join(', ');

  const delta = 0.007;
  const osmSrc = hasCoords
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${txn.lon - delta},${txn.lat - delta},${txn.lon + delta},${txn.lat + delta}&layer=mapnik&marker=${txn.lat},${txn.lon}`
    : null;
  // Use Apple Maps on iOS/macOS (opens natively), Google Maps elsewhere
  const isApple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) && !window.MSStream;
  const mapsUrl = hasCoords
    ? (isApple
        ? `https://maps.apple.com/?q=${txn.lat},${txn.lon}`
        : `https://www.google.com/maps?q=${txn.lat},${txn.lon}`)
    : (isApple
        ? `https://maps.apple.com/?q=${encodeURIComponent(fullAddress || txn.merchant)}`
        : `https://www.google.com/maps/search/${encodeURIComponent(fullAddress || txn.merchant)}`);

  const cat = catById(txn.category);

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, zIndex: 800,
        background: 'rgba(0,0,0,0.28)', backdropFilter: 'blur(2px)',
      }} />
      <div style={{
        position: 'fixed', zIndex: 801,
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 340,
        background: 'var(--surface)',
        borderRadius: 20, overflow: 'hidden',
        border: '1px solid var(--line)',
        boxShadow: '0 32px 80px rgba(0,0,0,0.4)',
        animation: 'mapPopIn 0.22s cubic-bezier(0.2, 0.8, 0.3, 1.15) forwards',
      }}>
        {/* Category accent bar */}
        <div style={{ height: 3, background: cat.color }} />

        {/* Header */}
        <div style={{ padding: '14px 16px 10px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.01em', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {txn.merchant}
            </div>
            {fullAddress && (
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {fullAddress}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{
            background: 'var(--surface-2)', border: 'none', borderRadius: 8,
            cursor: 'pointer', color: 'var(--ink-3)', fontSize: 13, lineHeight: 1,
            padding: '5px 8px', flexShrink: 0, fontFamily: 'inherit',
          }}>✕</button>
        </div>

        {/* Map */}
        {hasCoords ? (
          <div style={{ position: 'relative', height: 224 }}>
            <iframe
              src={osmSrc}
              title={`Map: ${txn.merchant}`}
              style={{ width: '100%', height: '100%', border: 'none', display: 'block', filter: 'saturate(0.8) brightness(0.9)' }}
              loading="lazy"
            />
            {/* Inner vignette */}
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', boxShadow: 'inset 0 0 24px rgba(0,0,0,0.18)' }} />
          </div>
        ) : (
          <div style={{
            height: 110, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 7,
            background: 'var(--surface-2)', color: 'var(--ink-3)', fontSize: 13,
          }}>
            <span style={{ fontSize: 28 }}>📍</span>
            <span>No exact coordinates — city-level only</span>
          </div>
        )}

        {/* Footer */}
        <div style={{
          padding: '10px 16px', borderTop: '1px solid var(--line)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
            {hasCoords ? `${txn.lat.toFixed(5)}, ${txn.lon.toFixed(5)}` : (coordLabel || '—')}
          </span>
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', textDecoration: 'none', letterSpacing: '-0.01em' }}>
            {isApple ? 'Open in Apple Maps ↗' : 'Open in Google Maps ↗'}
          </a>
        </div>
      </div>
    </>
  );
}

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
// ═══════════════════════════════════════════════════════════════════
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
  const semDebounce = React.useRef(null);

  // Keep in sync when the TopBar search changes
  React.useEffect(() => { setSearch(globalSearch); }, [globalSearch]);

  // Trigger semantic search with debounce
  React.useEffect(() => {
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

  const [autoMsg, setAutoMsg] = React.useState(null);

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
              ..._liveCategories.map(c => ({ value: c.id, label: c.name, dot: c.color })),
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

// ─── Budget Bars ──────────────────────────────────────────────────
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

// ═══════════════════════════════════════════════════════════════════
// SPENDING TAB
// ═══════════════════════════════════════════════════════════════════
function SpendingTab({ monthKey, finVersion }) {
  const txns = txnsForMonth(monthKey);
  const breakdown = sumByCategory(txns);
  const total = breakdown.reduce((s, b) => s + b.amount, 0);

  // Stacked bar — last 6 months by group (fixed/variable)
  const groupColors = { fixed: '#6b8aab', variable: '#d97757', other: '#94a3b8' };
  const monthly = MONTHS.map((m) => {
    const tx = txnsForMonth(m.key);
    const byGroup = {};
    tx.forEach((t) => {
      if (t.category === 'income' || t.category === 'transfer') return;
      const cat = catById(t.category);
      const g = cat.group === 'fixed' ? 'fixed' : 'variable';
      byGroup[g] = (byGroup[g] || 0) + Math.abs(t.amount);
    });
    return {
      label: m.short,
      segments: [
        { key: 'fixed', name: 'Fixed', value: byGroup.fixed || 0, color: groupColors.fixed },
        { key: 'variable', name: 'Variable', value: byGroup.variable || 0, color: groupColors.variable },
      ],
    };
  });

  // By account — spending per account this month
  const byAccount = {};
  txns.forEach((t) => {
    if (t.category === 'income' || t.category === 'transfer') return;
    if (t.amount >= 0) return;
    const acct = acctById(t.account);
    if (!byAccount[t.account]) byAccount[t.account] = { name: acct.name, color: acct.color, amount: 0, count: 0 };
    byAccount[t.account].amount += Math.abs(t.amount);
    byAccount[t.account].count  += 1;
  });
  const accountBreakdown = Object.entries(byAccount)
    .sort((a, b) => b[1].amount - a[1].amount)
    .map(([id, a]) => ({ ...a, id, cat: a.name }));

  // Stacked bar by account over last 6 months
  const monthlyByAccount = MONTHS.map((m) => {
    const tx = txnsForMonth(m.key);
    const segments = accountBreakdown.map(a => {
      const val = tx
        .filter(t => t.account === a.id && t.category !== 'income' && t.category !== 'transfer' && t.amount < 0)
        .reduce((s, t) => s + Math.abs(t.amount), 0);
      return { key: a.id, name: a.name, value: val, color: a.color };
    });
    return { label: m.short, segments };
  });

  return (
    <div className="tab-body">
      <div className="grid-3">
        <SummaryCard label="Total spend" n={total} accent="var(--terra)" />
        <SummaryCard label="Daily average"
          n={total / 30} accent="var(--ink)"
          sub={`${txns.filter((t) => t.amount < 0 && t.category !== 'transfer').length} transactions`} />
        <SummaryCard label="Largest category"
          value={breakdown[0]?.name || '—'} accent={breakdown[0]?.color}
          sub={fmtMoney(breakdown[0]?.amount || 0)} />
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Monthly spend — fixed vs variable</h3>
          <div className="legend-inline">
            <span><i style={{ background: groupColors.fixed }} /> Fixed</span>
            <span><i style={{ background: groupColors.variable }} /> Variable</span>
          </div>
        </div>
        <StackedBarChart data={monthly} height={260} formatter={fmtAbbr} />
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <h3>By category</h3>
            <span className="muted">{MONTHS.find((m) => m.key === monthKey).label}</span>
          </div>
          <BarList data={breakdown} formatter={fmtMoney} />
        </div>
        <div className="card">
          <div className="card-head">
            <h3>By account</h3>
            <span className="muted">{MONTHS.find((m) => m.key === monthKey).label}</span>
          </div>
          {accountBreakdown.length === 0 ? (
            <div className="empty">No spending data for this month.</div>
          ) : (
            <>
              <BarList data={accountBreakdown} formatter={fmtMoney} />
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {accountBreakdown.map(a => (
                  <div key={a.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: a.color, flexShrink: 0 }} />
                    <span style={{ flex: 1 }}>{a.name}</span>
                    <span>{a.count} txn{a.count !== 1 ? 's' : ''}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--ink)', fontWeight: 500, minWidth: 70, textAlign: 'right' }}>
                      {fmtMoney(a.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Budgets</h3>
          <span className="muted">Click + Budget to set a limit · bars turn amber at 80%, red when over</span>
        </div>
        <BudgetBars monthKey={monthKey} />
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Monthly spend by account</h3>
          <div className="legend-inline">
            {accountBreakdown.map(a => (
              <span key={a.name}><i style={{ background: a.color }} /> {a.name}</span>
            ))}
          </div>
        </div>
        <StackedBarChart data={monthlyByAccount} height={220} formatter={fmtAbbr} />
      </div>

      <div className="card">
        <WeeklySpendChart />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// INCOME TAB
// ═══════════════════════════════════════════════════════════════════
function IncomeTab({ monthKey, finVersion }) {
  const txns = txnsForMonth(monthKey).filter((t) => t.category === 'income');
  const total = txns.reduce((s, t) => s + t.amount, 0);

  // Income by source
  const bySource = {};
  txns.forEach((t) => { bySource[t.merchant] = (bySource[t.merchant] || 0) + t.amount; });
  const sources = Object.entries(bySource).map(([name, amount], i) => ({
    cat: name, name, amount,
    color: ['#5ec98a', '#67e8f9', '#a3e635', '#fbbf24'][i % 4],
  })).sort((a, b) => b.amount - a.amount);

  // 6-mo income trend
  const trendSeries = MONTHS.map((m) => ({ label: m.short, value: monthSummary(m.key).income }));
  const avg = trendSeries.reduce((s, p) => s + p.value, 0) / trendSeries.length;

  return (
    <div className="tab-body">
      <div className="grid-3">
        <SummaryCard label="Income this month" n={total} accent="var(--green)" />
        <SummaryCard label="6-month average" n={avg} accent="var(--ink)" />
        <SummaryCard label="Sources" value={sources.length}
          sub={sources.map((s) => s.name.split(' ')[0]).join(', ')} />
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h3>By source</h3></div>
          <BarList data={sources} formatter={fmtMoney} />
        </div>
        <div className="card">
          <div className="card-head"><h3>Income transactions</h3></div>
          <TxnList txns={txns} compact />
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Income trend</h3>
          <span className="muted">Last 6 months</span>
        </div>
        <AreaChart
          series={[{ key: 'inc', name: 'Income', color: '#5ec98a', points: trendSeries }]}
          height={240}
          formatter={fmtAbbr}
        />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// FLOW TAB (Spending + Income merged with toggle)
// ═══════════════════════════════════════════════════════════════════
function FlowTab({ monthKey, finVersion }) {
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem('flow.mode') || 'spending'; } catch { return 'spending'; }
  });
  function switchMode(m) {
    setMode(m);
    try { localStorage.setItem('flow.mode', m); } catch {}
  }
  return (
    <div>
      <div className="flow-toggle">
        {[['spending', 'Spending'], ['income', 'Income']].map(([id, label]) => (
          <button key={id} className={`flow-toggle-btn${mode === id ? ' active' : ''}`}
            onClick={() => switchMode(id)}>
            {label}
          </button>
        ))}
      </div>
      <div key={mode} className="tab-fade">
        {mode === 'spending'
          ? <SpendingTab monthKey={monthKey} finVersion={finVersion} />
          : <IncomeTab   monthKey={monthKey} finVersion={finVersion} />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CASH FLOW TAB
// ═══════════════════════════════════════════════════════════════════
function CashFlowTab() {
  const incomeSeries = MONTHS.map((m) => ({ label: m.short, value: monthSummary(m.key).income }));
  const expenseSeries = MONTHS.map((m) => ({ label: m.short, value: monthSummary(m.key).expenses }));
  const netSeries = MONTHS.map((m) => ({ label: m.short, value: monthSummary(m.key).net }));

  const totalIn = incomeSeries.reduce((s, p) => s + p.value, 0);
  const totalOut = expenseSeries.reduce((s, p) => s + p.value, 0);
  const totalNet = totalIn - totalOut;

  return (
    <div className="tab-body">
      <div className="grid-3">
        <SummaryCard label="6-mo income" n={totalIn} accent="var(--green)" />
        <SummaryCard label="6-mo expenses" n={totalOut} accent="var(--terra)" />
        <SummaryCard label="6-mo net" n={totalNet}
          accent={totalNet >= 0 ? 'var(--green)' : 'var(--terra)'}
          sub={`${((totalNet / totalIn) * 100).toFixed(0)}% savings rate`} />
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Cash flow — income vs expenses</h3>
          <div className="legend-inline">
            <span><i style={{ background: '#5ec98a' }} /> Income</span>
            <span><i style={{ background: '#d97757' }} /> Expenses</span>
          </div>
        </div>
        <AreaChart
          series={[
            { key: 'inc', name: 'Income', color: '#5ec98a', points: incomeSeries },
            { key: 'exp', name: 'Expenses', color: '#d97757', points: expenseSeries },
          ]}
          height={300}
          formatter={fmtAbbr}
        />
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Net cash flow</h3>
          <span className="muted">Income minus expenses</span>
        </div>
        <AreaChart
          series={[{ key: 'net', name: 'Net', color: '#67e8f9', points: netSeries }]}
          height={220}
          formatter={fmtAbbr}
        />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// NET WORTH TAB
// ═══════════════════════════════════════════════════════════════════
function NetWorthTab() {
  const assets = ACCOUNTS.filter((a) => a.balance > 0).reduce((s, a) => s + a.balance, 0);
  const liabilities = ACCOUNTS.filter((a) => a.balance < 0).reduce((s, a) => s + Math.abs(a.balance), 0);
  const net = assets - liabilities;

  const series = [
    { key: 'assets', name: 'Assets', color: '#5ec98a',
      points: NET_WORTH_HISTORY.map((h) => ({ label: h.month.slice(0, 3), value: h.assets })) },
    { key: 'liab', name: 'Liabilities', color: '#d97757',
      points: NET_WORTH_HISTORY.map((h) => ({ label: h.month.slice(0, 3), value: h.liabilities })) },
  ];

  const netSeries = [{ key: 'net', name: 'Net worth', color: '#67e8f9',
    points: NET_WORTH_HISTORY.map((h) => ({ label: h.month.slice(0, 3), value: h.assets - h.liabilities })) }];

  const prevNet = NET_WORTH_HISTORY.length >= 2
    ? NET_WORTH_HISTORY[NET_WORTH_HISTORY.length - 2].assets - NET_WORTH_HISTORY[NET_WORTH_HISTORY.length - 2].liabilities
    : null;
  const netTrend = prevNet && prevNet !== 0 ? ((net - prevNet) / Math.abs(prevNet)) * 100 : null;

  return (
    <div className="tab-body">
      <div className="grid-3">
        <SummaryCard label="Net worth" n={net} accent="var(--accent2)"
          trend={netTrend} />
        <SummaryCard label="Total assets" n={assets} accent="var(--green)"
          sub={`${ACCOUNTS.filter((a) => a.balance > 0).length} accounts`} />
        <SummaryCard label="Total liabilities" n={liabilities} accent="var(--terra)"
          sub={`${ACCOUNTS.filter((a) => a.balance < 0).length} cards`} />
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Net worth over time</h3>
          <span className="muted">Last 12 months</span>
        </div>
        <AreaChart series={netSeries} height={260} formatter={fmtAbbr} />
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Assets & liabilities</h3>
          <div className="legend-inline">
            <span><i style={{ background: '#5ec98a' }} /> Assets</span>
            <span><i style={{ background: '#d97757' }} /> Liabilities</span>
          </div>
        </div>
        <AreaChart series={series} height={240} formatter={fmtAbbr} />
      </div>

      <div className="card">
        <div className="card-head"><h3>Account balances</h3></div>
        <AccountList />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ACCOUNTS TAB
// ═══════════════════════════════════════════════════════════════════
function AccountList() {
  return (
    <div className="acct-list">
      {ACCOUNTS.map((a) => {
        const isCredit = a.type === 'credit';
        const hasLimit = isCredit && a.limit > 0;
        const used = hasLimit ? Math.abs(a.balance) / a.limit : null;
        return (
          <div key={a.id} className="acct-row">
            <div className="acct-mark" style={{ background: a.color }} />
            <div className="acct-main">
              <div className="acct-name">{a.name}</div>
              <div className="acct-meta">
                <span>{a.inst}</span>
                <span className="dot-sep">·</span>
                <span>•••• {a.last4}</span>
                <span className="acct-type-pill">{a.type}</span>
              </div>
            </div>
            {hasLimit && (
              <div className="acct-util">
                <div className="util-track">
                  <div className="util-fill" style={{ width: `${used * 100}%`, background: a.color }} />
                </div>
                <div className="util-label">{(used * 100).toFixed(0)}% of {fmtMoney(a.limit)}</div>
              </div>
            )}
            <div className={`acct-bal ${a.balance < 0 ? 'neg' : ''}`}>
              {fmt(a.balance, { sign: false })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AccountsTab({ onSync, syncing }) {
  const { useState, useEffect } = React;
  const [plaidAccounts, setPlaidAccounts] = useState([]);
  const [configured, setConfigured]       = useState(false);
  const [syncResult, setSyncResult]       = useState(null);
  const [linking, setLinking]             = useState(false);
  const [error, setError]                 = useState('');

  const loadAccounts = () =>
    apiFetch('/api/plaid/accounts').then(r => r.json()).then(d => {
      setConfigured(d.configured);
      setPlaidAccounts(d.accounts || []);
    });

  useEffect(() => { loadAccounts(); }, []);

  async function openPlaidLink() {
    setError('');
    setLinking(true);
    try {
      const res = await apiFetch('/api/plaid/link-token', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setError(data.detail || 'Failed to get link token'); setLinking(false); return; }

      // Load Plaid Link SDK dynamically
      await new Promise((resolve, reject) => {
        if (window.Plaid) { resolve(); return; }
        const s = document.createElement('script');
        s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });

      const handler = window.Plaid.create({
        token: data.link_token,
        onSuccess: async (public_token, metadata) => {
          const inst = metadata?.institution?.name || 'Unknown';
          await apiFetch('/api/plaid/exchange', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ public_token, institution_name: inst }),
          });
          await loadAccounts();
          setLinking(false);
        },
        onExit: () => setLinking(false),
      });
      handler.open();
    } catch (e) {
      setError(String(e));
      setLinking(false);
    }
  }


  async function removeAccount(item_id) {
    await fetch(`/api/plaid/accounts/${item_id}`, { method: 'DELETE' });
    loadAccounts();
  }

  return (
    <div className="tab-body">
      {/* Connected accounts */}
      <div className="card">
        <div className="card-head">
          <h3>Linked accounts</h3>
          {plaidAccounts.length > 0 && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => onSync && onSync()} disabled={syncing} style={{
                background: 'var(--accent)', color: '#052015', border: 'none',
                borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 600,
                fontFamily: 'inherit', cursor: syncing ? 'default' : 'pointer',
                opacity: syncing ? 0.6 : 1,
              }}>{syncing ? 'Syncing…' : 'Sync now'}</button>
              <button onClick={() => onSync && onSync(true)} disabled={syncing} title="Reset cursors and re-pull full transaction history" style={{
                background: 'transparent', color: 'var(--muted)',
                border: '1px solid var(--border)',
                borderRadius: 8, padding: '6px 14px', fontSize: 13,
                fontFamily: 'inherit', cursor: syncing ? 'default' : 'pointer',
                opacity: syncing ? 0.6 : 1,
              }}>Full re-sync</button>
            </div>
          )}
        </div>

        {syncResult && (
          <div style={{
            margin: '0 0 16px', padding: '12px 16px', borderRadius: 10, fontSize: 13,
            background: syncResult.ok
              ? 'color-mix(in srgb, var(--accent) 8%, transparent)'
              : 'color-mix(in srgb, #ef4444 8%, transparent)',
            border: `1px solid ${syncResult.ok ? 'var(--accent)' : '#ef4444'}`,
            color: syncResult.ok ? 'var(--text)' : '#ef4444',
          }}>
            {syncResult.ok
              ? `✓ ${syncResult.full ? 'Full re-sync' : 'Synced'} — ${syncResult.stats?.added ?? 0} new, ${syncResult.stats?.modified ?? 0} updated, ${syncResult.stats?.removed ?? 0} removed`
              : `⚠ ${syncResult.error || 'Sync failed'}`}
          </div>
        )}

        {plaidAccounts.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 14, padding: '12px 0' }}>
            No accounts linked yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {plaidAccounts.map(acct => (
              <div key={acct.item_id} style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '12px 0', borderBottom: '1px solid var(--border)',
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: 'var(--bg)', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: 16, border: '1px solid var(--border)',
                }}>🏦</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>{acct.institution_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>via Plaid</div>
                </div>
                <button onClick={() => removeAccount(acct.item_id)} style={{
                  background: 'transparent', border: '1px solid var(--border)',
                  borderRadius: 7, padding: '5px 12px', fontSize: 12,
                  color: 'var(--muted)', cursor: 'pointer', fontFamily: 'inherit',
                }}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Link new account */}
      {error && (
        <div style={{ marginBottom: 12, padding: '12px 16px', borderRadius: 10,
          background: 'color-mix(in srgb, #ef4444 8%, transparent)',
          border: '1px solid #ef4444', fontSize: 13, color: '#ef4444' }}>
          ⚠ {error}
        </div>
      )}

      <div className="card add-acct" onClick={configured ? openPlaidLink : undefined}
        style={{ cursor: configured ? 'pointer' : 'default', opacity: linking ? 0.6 : 1 }}>
        <div className="add-icon">{linking ? '…' : '+'}</div>
        <div>
          <div className="add-title">
            {linking ? 'Opening Plaid…' : 'Link another account'}
          </div>
          <div className="muted">
            {configured
              ? 'Connect a bank or card via Plaid'
              : 'Add your Plaid API keys in Settings first'}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// RECURRING TAB
// ═══════════════════════════════════════════════════════════════════
function RecurringTab() {
  const subs = RECURRING.filter((r) => r.category === 'subs');
  const bills = RECURRING.filter((r) => r.category !== 'subs');
  const monthlyTotal = RECURRING.reduce((s, r) => s + r.amount, 0);
  const subsTotal = subs.reduce((s, r) => s + r.amount, 0);

  const FREQ_COLORS = {
    Weekly: '#f97316', 'Bi-weekly': '#fbbf24', Monthly: '#5ec98a',
    Quarterly: '#67e8f9', Annual: '#a78bfa',
  };
  const RecRow = ({ r }) => {
    const cat = catById(r.category);
    const acct = acctById(r.account);
    const freqColor = FREQ_COLORS[r.freq] || '#94a3b8';
    const nextDate  = r.next ? r.next.slice(5).replace('-', '/') : '—';
    const today     = new Date().toISOString().slice(0, 10);
    const daysUntil = r.next ? Math.ceil((new Date(r.next) - new Date(today)) / 864e5) : null;
    return (
      <div className="rec-row">
        <div className="rec-icon" style={{ background: cat.color + '24', color: cat.color }}>{cat.icon}</div>
        <div className="rec-main">
          <div className="rec-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {r.merchant}
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 10,
              background: freqColor + '20', color: freqColor, textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>{r.freq}</span>
          </div>
          <div className="rec-meta">
            <span style={{ color: cat.color }}>{cat.name}</span>
            <span className="dot-sep">·</span>
            <span>{acct.name}</span>
            {r.occurrences > 0 && (
              <>
                <span className="dot-sep">·</span>
                <span style={{ color: 'var(--muted)' }}>{r.occurrences}× detected</span>
              </>
            )}
          </div>
        </div>
        <div className="rec-next">
          <div className="rec-next-label">Next charge</div>
          <div className="rec-next-date" style={{ color: daysUntil !== null && daysUntil <= 5 ? 'var(--terra)' : undefined }}>
            {nextDate}
            {daysUntil !== null && daysUntil >= 0 && daysUntil <= 14 && (
              <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 4 }}>
                ({daysUntil === 0 ? 'today' : `${daysUntil}d`})
              </span>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="rec-amt">{fmt(r.amount, { decimals: 2 })}<span className="rec-freq">/{r.freq === 'Monthly' ? 'mo' : r.freq.toLowerCase()}</span></div>
          {r.est_monthly && r.freq !== 'Monthly' && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
              ~{fmt(r.est_monthly, { decimals: 0 })}/mo
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="tab-body">
      <div className="grid-3">
        <SummaryCard label="Monthly recurring" n={monthlyTotal} accent="var(--accent)" />
        <SummaryCard label="Subscriptions" n={subsTotal} accent="#a78bfa"
          sub={`${subs.length} active`} />
        <SummaryCard label="Annual cost" value={fmtMoney(monthlyTotal * 12)} accent="var(--ink)" />
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Subscriptions</h3>
          <span className="muted">{subs.length} services</span>
        </div>
        <div className="rec-list">{subs.map((r) => <RecRow key={r.merchant} r={r} />)}</div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Bills & utilities</h3>
          <span className="muted">{bills.length} recurring</span>
        </div>
        <div className="rec-list">{bills.map((r) => <RecRow key={r.merchant} r={r} />)}</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CATEGORIES TAB
// ═══════════════════════════════════════════════════════════════════
function CategoriesTab({ monthKey, finVersion }) {
  const txns = txnsForMonth(monthKey);
  const breakdown = sumByCategory(txns);
  const total = breakdown.reduce((s, b) => s + b.amount, 0);

  // 6-mo per-category trend (top 5)
  const top = breakdown.slice(0, 5);
  const series = top.map((b) => ({
    key: b.cat, name: b.name, color: b.color,
    points: MONTHS.map((m) => {
      const v = txnsForMonth(m.key)
        .filter((t) => t.category === b.cat)
        .reduce((s, t) => s + Math.abs(t.amount), 0);
      return { label: m.short, value: v };
    }),
  }));

  return (
    <div className="tab-body">
      <div className="card">
        <div className="card-head">
          <h3>Category breakdown</h3>
          <span className="muted">{fmtMoney(total)} total · {MONTHS.find((m) => m.key === monthKey).label}</span>
        </div>
        <div className="cat-grid">
          {breakdown.map((b) => (
            <div key={b.cat} className="cat-card" style={{ borderColor: b.color + '30' }}>
              <div className="cat-card-head">
                <span className="cat-card-icon" style={{ background: b.color + '24', color: b.color }}>{b.icon}</span>
                <span className="cat-card-name">{b.name}</span>
              </div>
              <div className="cat-card-amt" style={{ color: b.color }}>{fmtMoney(b.amount)}</div>
              <div className="cat-card-pct">
                <div className="cat-card-track">
                  <div className="cat-card-fill" style={{ width: `${(b.amount / total) * 100}%`, background: b.color }} />
                </div>
                <span>{((b.amount / total) * 100).toFixed(1)}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Top 5 categories — 6 month trend</h3>
        </div>
        <AreaChart series={series} height={260} formatter={fmtAbbr} fill={false} />
        <div className="legend-row-inline">
          {series.map((s) => (
            <span key={s.key}><i style={{ background: s.color }} />{s.name}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TRENDS TAB
// ═══════════════════════════════════════════════════════════════════
function TrendsTab({ setTab, setMonthKey }) {
  const [sortCol, setSortCol] = useState('key');
  const [sortDir, setSortDir] = useState('desc');

  function toggleSort(col) {
    setSortCol(prev => {
      if (prev === col) { setSortDir(d => d === 'desc' ? 'asc' : 'desc'); return col; }
      setSortDir('desc'); return col;
    });
  }

  // MoM income, expense, savings rate
  const data = MONTHS.map((m) => {
    const s = monthSummary(m.key);
    return { ...m, ...s, savingsRate: s.income > 0 ? (s.net / s.income) * 100 : 0 };
  });

  const incExpData = data.map((d) => ({
    label: d.short,
    segments: [
      { key: 'inc', name: 'Income', value: d.income, color: '#5ec98a' },
      { key: 'exp', name: 'Expenses', value: d.expenses, color: '#d97757' },
    ],
  }));

  // Side-by-side bars: render as 2 separate StackedBarCharts? Easier: stacked.
  // For comparison view, let's show income and expenses separately.

  return (
    <div className="tab-body">
      <div className="card">
        <div className="card-head">
          <h3>Income vs expenses</h3>
          <span className="muted">Month over month</span>
        </div>
        <SideBySideBars data={data} />
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Savings rate</h3>
          <span className="muted">% of income saved</span>
        </div>
        <AreaChart
          series={[{ key: 'sr', name: 'Savings rate', color: '#67e8f9',
            points: data.map((d) => ({ label: d.short, value: d.savingsRate })) }]}
          height={220}
          formatter={(v) => v.toFixed(0) + '%'}
        />
      </div>

      <div className="card">
        <div className="card-head"><h3>Month-by-month</h3>
          <span className="muted" style={{ fontSize: 11 }}>Click a row to view that month · click headers to sort</span>
        </div>
        {(() => {
          const activeData = data.filter(d => d.income > 0 || d.expenses > 0);
          const bestNet    = activeData.length ? Math.max(...activeData.map(d => d.net)) : null;
          const worstNet   = activeData.length ? Math.min(...activeData.map(d => d.net)) : null;
          const bestSr     = activeData.length ? Math.max(...activeData.map(d => d.savingsRate)) : null;

          const sorted = [...data].sort((a, b) => {
            const mul = sortDir === 'desc' ? -1 : 1;
            if (sortCol === 'income')  return mul * (a.income - b.income);
            if (sortCol === 'expenses') return mul * (a.expenses - b.expenses);
            if (sortCol === 'net')     return mul * (a.net - b.net);
            if (sortCol === 'sr')      return mul * (a.savingsRate - b.savingsRate);
            return sortDir === 'desc' ? b.key.localeCompare(a.key) : a.key.localeCompare(b.key);
          });

          const SortTh = ({ col, children, right }) => (
            <th onClick={() => toggleSort(col)} style={{
              cursor: 'pointer', userSelect: 'none',
              textAlign: right ? 'right' : undefined,
            }}>
              {children}
              <span style={{ marginLeft: 4, fontSize: 10, opacity: sortCol === col ? 1 : 0.25 }}>
                {sortCol === col ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}
              </span>
            </th>
          );

          return (
            <table className="trend-table">
              <thead>
                <tr>
                  <SortTh col="key">Month</SortTh>
                  <SortTh col="income" right>Income</SortTh>
                  <SortTh col="expenses" right>Expenses</SortTh>
                  <SortTh col="net" right>Net</SortTh>
                  <SortTh col="sr" right>Savings rate</SortTh>
                </tr>
              </thead>
              <tbody>
                {sorted.map((d) => {
                  const isBestNet  = bestNet  !== null && d.net === bestNet  && d.income > 0;
                  const isWorstNet = worstNet !== null && d.net === worstNet && d.income > 0;
                  const isBestSr   = bestSr   !== null && d.savingsRate === bestSr && d.income > 0;
                  return (
                    <tr key={d.key}
                      className={isBestNet || isBestSr ? 'trend-best' : isWorstNet ? 'trend-worst' : ''}
                      title={`Click to view ${d.label} in Overview`}
                      style={{ cursor: setTab ? 'pointer' : undefined }}
                      onClick={() => {
                        if (!setTab || !setMonthKey) return;
                        setMonthKey(d.key);
                        setTab('overview');
                      }}>
                      <td style={{ fontWeight: 500 }}>{d.label}</td>
                      <td className="pos" style={{ textAlign: 'right' }}>{fmtMoney(d.income)}</td>
                      <td className="neg" style={{ textAlign: 'right' }}>{fmtMoney(d.expenses)}</td>
                      <td className={d.net >= 0 ? 'pos' : 'neg'} style={{ textAlign: 'right' }}>
                        {fmt(d.net, { sign: true, decimals: 0 })}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {d.income > 0 ? `${d.savingsRate.toFixed(0)}%` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          );
        })()}
      </div>
    </div>
  );
}

// Side-by-side bar chart for income vs expenses
function SideBySideBars({ data }) {
  const [hover, setHover] = useState(null);
  const padding = { top: 20, right: 12, bottom: 28, left: 56 };
  const width = 720;
  const height = 260;
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const max = Math.max(...data.flatMap((d) => [d.income, d.expenses])) * 1.15;
  const groupW = innerW / data.length;
  const barW = groupW * 0.32;

  const ticks = 4;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => (max / ticks) * i);

  return (
    <div className="chart-wrap">
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        {tickVals.map((v, i) => {
          const y = padding.top + innerH - (v / max) * innerH;
          return (
            <g key={i}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y}
                stroke="rgba(20,24,32,0.06)" />
              <text x={padding.left - 8} y={y + 4} textAnchor="end" className="chart-axis-label">
                {fmtAbbr(v)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const cx = padding.left + groupW * i + groupW / 2;
          const incH = (d.income / max) * innerH;
          const expH = (d.expenses / max) * innerH;
          const isH = hover === i;
          return (
            <g key={d.key}>
              <rect x={cx - barW - 2} y={padding.top + innerH - incH} width={barW} height={incH}
                fill="#5ec98a" rx="2" opacity={hover != null && !isH ? 0.4 : 1} />
              <rect x={cx + 2} y={padding.top + innerH - expH} width={barW} height={expH}
                fill="#d97757" rx="2" opacity={hover != null && !isH ? 0.4 : 1} />
              <rect x={cx - groupW / 2} y={padding.top} width={groupW} height={innerH} fill="transparent"
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
              <text x={cx} y={height - 8} textAnchor="middle" className="chart-axis-label">{d.short}</text>
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div className="chart-tooltip" style={{ left: padding.left + groupW * hover + groupW / 2, top: 12 }}>
          <div className="tt-title">{data[hover].label}</div>
          <div className="tt-row"><i style={{ background: '#5ec98a' }} /><span>Income</span><span className="tt-val">{fmtMoney(data[hover].income)}</span></div>
          <div className="tt-row"><i style={{ background: '#d97757' }} /><span>Expenses</span><span className="tt-val">{fmtMoney(data[hover].expenses)}</span></div>
          <div className="tt-row"><span>Net</span><span className="tt-val">{fmt(data[hover].net, { sign: true, decimals: 0 })}</span></div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CHAT TAB
// ═══════════════════════════════════════════════════════════════════
function ChatTab() {
  const [messages, setMessages]     = React.useState([]);
  const [sqlLog, setSqlLog]         = React.useState({});
  const [input, setInput]           = React.useState('');
  const [loading, setLoading]       = React.useState(false);
  const [configOk, setConfigOk]     = React.useState(null);
  const [isRecording, setIsRecording] = React.useState(false);
  const [speakEnabled, setSpeakEnabled] = React.useState(false);
  const [isSpeaking, setIsSpeaking] = React.useState(false);
  const recognitionRef = React.useRef(null);
  const bottomRef = React.useRef(null);

  const hasVoiceInput  = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const hasVoiceOutput = !!window.speechSynthesis;

  // Check if AI is configured
  React.useEffect(() => {
    apiFetch('/api/config').then((r) => r.json()).then((cfg) => {
      setConfigOk(cfg.has_anthropic || cfg.has_gemini);
    });
  }, []);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const SUGGESTIONS = [
    "What's my biggest spending category?",
    "Am I spending more than I earn?",
    "What are my recurring charges?",
    "How has my spending changed month over month?",
    "Where am I overspending?",
  ];

  // Auto-speak new assistant messages when speaker is on
  React.useEffect(() => {
    if (!speakEnabled || !hasVoiceOutput || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role !== 'assistant') return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(last.content);
    utt.onstart = () => setIsSpeaking(true);
    utt.onend   = () => setIsSpeaking(false);
    utt.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utt);
  }, [messages, speakEnabled]);

  function toggleSpeaker() {
    if (isSpeaking) { window.speechSynthesis.cancel(); setIsSpeaking(false); }
    setSpeakEnabled(v => !v);
  }

  function toggleMic() {
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous      = false;
    rec.interimResults  = true;
    rec.lang            = 'en-US';
    rec.onresult = (e) => {
      const transcript = Array.from(e.results).map(r => r[0].transcript).join('');
      setInput(transcript);
      if (e.results[e.results.length - 1].isFinal) {
        rec.stop();
        setIsRecording(false);
        // slight delay so state settles before send
        setTimeout(() => send(transcript), 50);
      }
    };
    rec.onerror = () => setIsRecording(false);
    rec.onend   = () => setIsRecording(false);
    recognitionRef.current = rec;
    rec.start();
    setIsRecording(true);
  }

  const send = async (text) => {
    if (!text.trim() || loading) return;
    const userMsg = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    try {
      const res = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Only send conversation history — no raw financial data
        body: JSON.stringify({ messages: newMessages }),
      });
      const data = await res.json();
      const assistantIdx = newMessages.length; // index the assistant reply will land at
      setMessages([...newMessages, { role: 'assistant', content: data.reply }]);
      if (data.sql) setSqlLog(prev => ({ ...prev, [assistantIdx]: { sql: data.sql, rows: data.rows } }));
    } catch (e) {
      setMessages([...newMessages, { role: 'assistant', content: `Error: ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  if (configOk === false) {
    return (
      <div className="tab-body">
        <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔑</div>
          <h3 style={{ margin: '0 0 8px' }}>No AI provider configured</h3>
          <p style={{ color: 'var(--muted)', margin: '0 0 20px' }}>
            Add a Claude or Gemini API key in Settings.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="tab-body" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' }}>
      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 16 }}>
        {messages.length === 0 && (
          <div style={{ padding: '32px 0' }}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>💬</div>
              <h3 style={{ margin: '0 0 6px', color: 'var(--ink)' }}>Ask about your finances</h3>
              <p style={{ color: 'var(--muted)', margin: 0, fontSize: 14 }}>
                Your real transaction data is the context.
              </p>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 20, padding: '8px 16px', fontSize: 13,
                  color: 'var(--ink)', cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'border-color 0.12s',
                }}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{
            display: 'flex', flexDirection: 'column',
            alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
          }}>
            <div style={{
              maxWidth: '72%',
              padding: '12px 16px',
              borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
              background: m.role === 'user' ? 'var(--accent)' : 'var(--surface)',
              color: m.role === 'user' ? '#052015' : 'var(--ink)',
              border: m.role === 'user' ? 'none' : '1px solid var(--border)',
              fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap',
            }}>{m.content}</div>
            {m.role === 'assistant' && sqlLog[i] && (
              <details style={{ maxWidth: '72%', marginTop: 4 }}>
                <summary style={{
                  fontSize: 11, color: 'var(--muted)', cursor: 'pointer',
                  userSelect: 'none', listStyle: 'none', paddingLeft: 4,
                }}>
                  ▸ Query ran locally · {sqlLog[i].rows} row{sqlLog[i].rows !== 1 ? 's' : ''}
                </summary>
                <pre style={{
                  margin: '6px 0 0', padding: '10px 14px', borderRadius: 8,
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
                  color: 'var(--muted)', whiteSpace: 'pre-wrap', overflowX: 'auto',
                }}>{sqlLog[i].sql}</pre>
              </details>
            )}
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{
              padding: '12px 16px', borderRadius: '16px 16px 16px 4px',
              background: 'var(--surface)', border: '1px solid var(--border)',
              color: 'var(--muted)', fontSize: 13,
            }}>Thinking…</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        display: 'flex', gap: 8, paddingTop: 12,
        borderTop: '1px solid var(--border)',
      }}>
        {/* Mic button */}
        {hasVoiceInput && (
          <button
            onClick={toggleMic}
            title={isRecording ? 'Stop recording' : 'Speak your question'}
            style={{
              background: isRecording ? '#ef4444' : 'var(--surface)',
              color: isRecording ? '#fff' : 'var(--muted)',
              border: `1px solid ${isRecording ? '#ef4444' : 'var(--border)'}`,
              borderRadius: 10, padding: '10px 12px', fontSize: 16,
              cursor: 'pointer', flexShrink: 0,
              animation: isRecording ? 'pulse 1s infinite' : 'none',
            }}
          >🎙</button>
        )}

        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send(input))}
          placeholder={isRecording ? 'Listening…' : 'Ask about your spending, income, trends…'}
          style={{
            flex: 1, padding: '10px 14px', borderRadius: 10,
            border: `1px solid ${isRecording ? '#ef4444' : 'var(--border)'}`,
            fontSize: 14, fontFamily: 'inherit', background: 'var(--surface)',
            outline: 'none',
          }}
        />

        {/* Speaker toggle */}
        {hasVoiceOutput && (
          <button
            onClick={toggleSpeaker}
            title={isSpeaking ? 'Stop speaking' : speakEnabled ? 'Voice replies on — click to turn off' : 'Turn on voice replies'}
            style={{
              background: speakEnabled ? 'var(--accent)' : 'var(--surface)',
              color: speakEnabled ? '#052015' : 'var(--muted)',
              border: `1px solid ${speakEnabled ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 10, padding: '10px 12px', fontSize: 16,
              cursor: 'pointer', flexShrink: 0,
            }}
          >{isSpeaking ? '⏹' : '🔊'}</button>
        )}

        <button onClick={() => send(input)} disabled={!input.trim() || loading} style={{
          background: 'var(--accent)', color: '#052015', border: 'none',
          borderRadius: 10, padding: '10px 18px', fontWeight: 600,
          fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
          opacity: (!input.trim() || loading) ? 0.5 : 1,
        }}>Send</button>
        {messages.length > 0 && (
          <button onClick={() => { setMessages([]); setSqlLog({}); window.speechSynthesis?.cancel(); }} style={{
            background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '10px 14px', fontSize: 13,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>Clear</button>
        )}
      </div>
    </div>
  );
}

// ─── Plaid sync card — lives in Settings, defined outside to avoid remounting
function PlaidSyncCard() {
  const { useState } = React;
  const [syncing, setSyncing]             = useState(false);
  const [result,  setResult]             = useState(null);
  const [backfilling, setBackfilling]    = useState(false);
  const [backfillResult, setBackfillResult] = useState(null);

  async function sync(full = false) {
    setSyncing(true); setResult(null);
    try {
      const res  = await apiFetch('/api/plaid/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full }),
      });
      const data = await res.json();
      setResult({ ...data, full });
      if (data.ok && (data.stats?.added > 0 || data.stats?.modified > 0 || data.stats?.removed > 0)) {
        setTimeout(() => { if (refreshFin) refreshFin(); }, 1200);
      }
    } catch (e) {
      setResult({ ok: false, error: String(e) });
    } finally {
      setSyncing(false);
    }
  }

  async function backfillLocations() {
    setBackfilling(true); setBackfillResult(null);
    try {
      const res  = await apiFetch('/api/plaid/backfill-locations', { method: 'POST' });
      const data = await res.json();
      setBackfillResult(data);
      if (data.ok && data.updated > 0) setTimeout(() => { if (refreshFin) refreshFin(); }, 1200);
    } catch (e) {
      setBackfillResult({ ok: false, error: String(e) });
    } finally {
      setBackfilling(false);
    }
  }

  return (
    <SettingsCard title="Plaid — Sync Transactions">
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>
          Pull the latest transactions from all your linked bank accounts.
          <strong> Sync now</strong> fetches only new changes (fast).
          <strong> Full re-sync</strong> re-pulls your entire history.
        </div>

        {result && (
          <div style={{
            padding: '12px 16px', borderRadius: 10, fontSize: 13,
            background: result.ok ? 'rgba(94,201,138,0.08)' : 'rgba(239,68,68,0.08)',
            border: `1px solid ${result.ok ? 'rgba(94,201,138,0.3)' : 'rgba(239,68,68,0.3)'}`,
            color: result.ok ? 'var(--ink)' : '#f87171',
          }}>
            {result.ok
              ? `✓ ${result.full ? 'Full re-sync' : 'Synced'} — ${result.stats?.added ?? 0} new, ${result.stats?.modified ?? 0} updated, ${result.stats?.removed ?? 0} removed${result.stats?.added > 0 ? ' — reloading…' : ''}`
              : `⚠ ${result.error || 'Sync failed'}`}
            {result.ok && result.errors?.length > 0 && (
              <div style={{ marginTop: 6, color: 'var(--ink-3)' }}>
                {result.errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => sync(false)} disabled={syncing || backfilling} style={{
            flex: 1, background: 'var(--accent)', color: '#052015', border: 'none',
            borderRadius: 10, padding: '11px 0', fontWeight: 600, fontSize: 14,
            fontFamily: 'inherit', cursor: syncing ? 'default' : 'pointer', opacity: syncing ? 0.6 : 1,
          }}>{syncing ? 'Syncing…' : 'Sync now'}</button>
          <button onClick={() => sync(true)} disabled={syncing || backfilling} style={{
            flex: 1, background: 'transparent', color: 'var(--ink-2)',
            border: '1px solid var(--line)', borderRadius: 10, padding: '11px 0',
            fontWeight: 500, fontSize: 14, fontFamily: 'inherit',
            cursor: syncing ? 'default' : 'pointer', opacity: syncing ? 0.6 : 1,
          }}>Full re-sync</button>
        </div>

        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
            Backfill location data (📍 city/coordinates) for existing transactions. A backup is created first.
          </div>
          {backfillResult && (
            <div style={{
              padding: '10px 14px', borderRadius: 8, fontSize: 12, marginBottom: 8,
              background: backfillResult.ok ? 'rgba(94,201,138,0.08)' : 'rgba(239,68,68,0.08)',
              border: `1px solid ${backfillResult.ok ? 'rgba(94,201,138,0.3)' : 'rgba(239,68,68,0.3)'}`,
              color: backfillResult.ok ? 'var(--ink)' : '#f87171',
            }}>
              {backfillResult.ok
                ? `✓ Updated location on ${backfillResult.updated} transaction${backfillResult.updated !== 1 ? 's' : ''}${backfillResult.updated > 0 ? ' — reloading…' : ''}`
                : `⚠ ${backfillResult.error || 'Failed'}`}
            </div>
          )}
          <button onClick={backfillLocations} disabled={syncing || backfilling} style={{
            background: 'transparent', color: 'var(--muted)',
            border: '1px solid var(--line)', borderRadius: 8, padding: '8px 16px',
            fontWeight: 500, fontSize: 13, fontFamily: 'inherit',
            cursor: backfilling ? 'default' : 'pointer', opacity: backfilling ? 0.6 : 1,
          }}>{backfilling ? 'Fetching locations…' : '📍 Backfill locations'}</button>
        </div>
      </div>
    </SettingsCard>
  );
}

// ─── Settings helpers — defined OUTSIDE SettingsTab so their identity is
//     stable across renders. If defined inside, React remounts children
//     (including focused inputs) on every state update.
function SettingsCard({ title, children }) {
  return (
    <div style={{
      background: 'var(--surface)', borderRadius: 16,
      border: '1px solid var(--line)', padding: '24px 28px', marginBottom: 20,
    }}>
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 20, color: 'var(--ink)' }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function SettingsLabel({ children }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-3)', marginBottom: 6, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
      {children}
    </div>
  );
}

function StatusDot({ active }) {
  return (
    <span style={{
      display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
      background: active ? 'var(--accent)' : 'var(--line-2)', marginRight: 6,
    }} />
  );
}

// ─── Categories Manager Card ────────────────────────────────────────────────
function CategoriesManagerCard() {
  const { useState, useEffect, useRef } = React;
  const COLORS = ['#818cf8','#fb7185','#5ec98a','#67e8f9','#d97757','#a3e635','#fbbf24',
                  '#a78bfa','#ec4899','#22d3ee','#f97316','#e879f9','#34d399','#6b8aab','#94a3b8'];
  const SYSTEM_IDS = new Set(['transfer','savings','income']);

  const [cats, setCats]         = useState([]);
  const [editId, setEditId]     = useState(null);  // which row is open for color picker
  const [newName, setNewName]   = useState('');
  const [newColor, setNewColor] = useState('#818cf8');
  const [addErr, setAddErr]     = useState('');
  const [delErr, setDelErr]     = useState({});    // {cat_id: message}
  const [saving, setSaving]     = useState({});

  useEffect(() => {
    apiFetch('/api/categories').then(r => r.json()).then(d => {
      setCats((d.categories || []).filter(c => !SYSTEM_IDS.has(c.id)));
    });
  }, []);

  // ── Helpers ──────────────────────────────────────────────────────
  async function patchCat(id, patch) {
    setSaving(p => ({...p, [id]: true}));
    await fetch(`/api/categories/${id}`, {
      method: 'PATCH', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(patch),
    });
    setSaving(p => ({...p, [id]: false}));
    refreshLiveCategories();
  }

  function updateLocal(id, patch) {
    setCats(prev => prev.map(c => c.id === id ? {...c, ...patch} : c));
  }

  async function move(idx, dir) {
    const next = [...cats];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setCats(next);
    await apiFetch('/api/categories/reorder', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ order: next.map(c => c.id) }),
    });
    refreshLiveCategories();
  }

  async function addCat() {
    if (!newName.trim()) return;
    setAddErr('');
    const res  = await apiFetch('/api/categories', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ name: newName.trim(), color: newColor, group: 'variable' }),
    });
    const data = await res.json();
    if (!res.ok) { setAddErr(data.detail || 'Failed'); return; }
    setCats(prev => [...prev, data.category]);
    setNewName(''); setNewColor('#818cf8');
    refreshLiveCategories();
  }

  async function deleteCat(id) {
    setDelErr(p => ({...p, [id]: ''}));
    const res  = await fetch(`/api/categories/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      setDelErr(p => ({...p, [id]: data.detail || 'Cannot delete'}));
      return;
    }
    setCats(prev => prev.filter(c => c.id !== id));
    refreshLiveCategories();
  }

  const rowStyle = {
    display: 'grid', gridTemplateColumns: '28px 1fr 36px 36px 28px',
    alignItems: 'center', gap: 8, padding: '8px 12px',
    borderBottom: '1px solid var(--line)',
  };

  return (
    <SettingsCard title="Categories">
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
        Click the color dot to change color. Edit the name inline. Use ↑↓ to reorder.
        Built-in categories can be renamed and recolored but not deleted.
      </div>

      <div style={{ borderRadius: 10, border: '1px solid var(--line)', overflow: 'hidden' }}>

        {cats.map((c, idx) => (
          <div key={c.id}>
            <div style={{...rowStyle, background: idx % 2 === 0 ? 'var(--bg)' : 'transparent'}}>

              {/* Color swatch — click to toggle picker */}
              <button onClick={() => setEditId(editId === c.id ? null : c.id)} style={{
                width: 22, height: 22, borderRadius: 6, background: c.color,
                border: editId === c.id ? `2px solid var(--ink)` : '2px solid transparent',
                cursor: 'pointer', flexShrink: 0,
              }} title="Change color" />

              {/* Name input */}
              <input
                defaultValue={c.name}
                onBlur={e => {
                  const v = e.target.value.trim();
                  if (v && v !== c.name) { updateLocal(c.id, {name: v}); patchCat(c.id, {name: v}); }
                }}
                style={{
                  background: 'transparent', border: 'none', outline: 'none',
                  fontSize: 14, color: 'var(--ink)', fontFamily: 'inherit',
                  fontWeight: 500, width: '100%',
                }}
              />

              {/* Up / Down */}
              <button onClick={() => move(idx, -1)} disabled={idx === 0} style={{
                background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer',
                color: idx === 0 ? 'var(--line-2)' : 'var(--muted)', fontSize: 14, padding: 0,
              }}>↑</button>
              <button onClick={() => move(idx, 1)} disabled={idx === cats.length - 1} style={{
                background: 'none', border: 'none',
                cursor: idx === cats.length - 1 ? 'default' : 'pointer',
                color: idx === cats.length - 1 ? 'var(--line-2)' : 'var(--muted)', fontSize: 14, padding: 0,
              }}>↓</button>

              {/* Delete button — server blocks if transactions exist */}
              <button onClick={() => deleteCat(c.id)} title="Remove category" style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--muted)', fontSize: 16, padding: 0, lineHeight: 1,
              }}>×</button>
            </div>

            {/* Inline color picker */}
            {editId === c.id && (
              <div style={{
                padding: '10px 12px', background: 'var(--surface)',
                borderBottom: '1px solid var(--line)',
                display: 'flex', flexWrap: 'wrap', gap: 6,
              }}>
                {COLORS.map(col => (
                  <button key={col} onClick={() => {
                    updateLocal(c.id, {color: col});
                    patchCat(c.id, {color: col});
                    setEditId(null);
                  }} style={{
                    width: 24, height: 24, borderRadius: 6, background: col, border: 'none',
                    cursor: 'pointer', outline: c.color === col ? `2px solid ${col}` : 'none',
                    outlineOffset: 2, opacity: c.color === col ? 1 : 0.65,
                  }} />
                ))}
              </div>
            )}

            {/* Delete error */}
            {delErr[c.id] && (
              <div style={{
                padding: '6px 12px', fontSize: 12, color: '#ef4444',
                background: 'rgba(239,68,68,0.06)', borderBottom: '1px solid var(--line)',
              }}>⚠ {delErr[c.id]}</div>
            )}
          </div>
        ))}

        {/* Add new row */}
        <div style={{...rowStyle, gridTemplateColumns: '28px 1fr auto', background: 'var(--surface)'}}>
          <button onClick={() => setEditId(editId === '__new__' ? null : '__new__')} style={{
            width: 22, height: 22, borderRadius: 6, background: newColor,
            border: editId === '__new__' ? '2px solid var(--ink)' : '2px solid transparent',
            cursor: 'pointer', flexShrink: 0,
          }} />
          <input
            value={newName} onChange={e => { setNewName(e.target.value); setAddErr(''); }}
            onKeyDown={e => e.key === 'Enter' && addCat()}
            placeholder="Add a category…"
            style={{
              background: 'transparent', border: 'none', outline: 'none',
              fontSize: 14, color: 'var(--ink)', fontFamily: 'inherit',
              fontWeight: 400, width: '100%',
            }}
          />
          <button onClick={addCat} disabled={!newName.trim()} style={{
            background: newName.trim() ? 'var(--accent)' : 'var(--line)',
            color: newName.trim() ? '#052015' : 'var(--muted)',
            border: 'none', borderRadius: 8, padding: '5px 12px',
            fontSize: 12, fontWeight: 600, cursor: newName.trim() ? 'pointer' : 'default',
            fontFamily: 'inherit', whiteSpace: 'nowrap',
          }}>Add</button>
        </div>

        {editId === '__new__' && (
          <div style={{
            padding: '10px 12px', background: 'var(--surface)',
            borderTop: '1px solid var(--line)',
            display: 'flex', flexWrap: 'wrap', gap: 6,
          }}>
            {COLORS.map(col => (
              <button key={col} onClick={() => { setNewColor(col); setEditId(null); }} style={{
                width: 24, height: 24, borderRadius: 6, background: col, border: 'none',
                cursor: 'pointer', outline: newColor === col ? `2px solid ${col}` : 'none',
                outlineOffset: 2, opacity: newColor === col ? 1 : 0.65,
              }} />
            ))}
          </div>
        )}

        {addErr && (
          <div style={{ padding: '6px 12px', fontSize: 12, color: '#ef4444',
            background: 'rgba(239,68,68,0.06)' }}>⚠ {addErr}</div>
        )}
      </div>
    </SettingsCard>
  );
}

// ─── Settings Tab ─────────────────────────────────────────────────────────
const NOTIFICATION_SUBS = [
  { key: 'market_drop',     label: 'Market drop alert',      desc: 'Email when SPY falls your threshold in a day — DCA signal' },
  { key: 'portfolio_drop',  label: 'Portfolio drop alert',   desc: 'Email when your Wealthfront value drops your threshold' },
  { key: 'daily_brief',     label: 'Daily market brief',     desc: 'AI-written market summary every morning (7–10am)' },
  { key: 'monthly_digest',  label: 'Monthly portfolio digest', desc: 'End-of-month recap: portfolio vs SPY, fees, AI summary' },
];

function NotificationsCard() {
  const [alertEmail,    setAlertEmail]    = useState('');
  const [dropThreshold, setDropThreshold] = useState('1.5');
  const [portThreshold, setPortThreshold] = useState('3.0');
  const [subs,          setSubs]          = useState({});   // { market_drop: true, ... }
  const [saving,        setSaving]        = useState(false);
  const [saved,         setSaved]         = useState(false);
  const [testStatus,    setTestStatus]    = useState(null);
  const [testMsg,       setTestMsg]       = useState('');

  useEffect(() => {
    apiFetch('/api/config').then(r => r.json()).then(d => {
      setAlertEmail(d.alert_email || '');
      setDropThreshold(String(d.market_drop_threshold ?? 1.5));
      setPortThreshold(String(d.portfolio_drop_threshold ?? 3.0));
      setSubs({
        market_drop:    !!d.notify_market_drop,
        portfolio_drop: !!d.notify_portfolio_drop,
        daily_brief:    !!d.daily_brief_enabled,
        monthly_digest: !!d.monthly_digest_enabled,
      });
    });
  }, []);

  async function save() {
    setSaving(true);
    await apiFetch('/api/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alert_email:              alertEmail.trim() || null,
        market_drop_threshold:    parseFloat(dropThreshold) || 1.5,
        portfolio_drop_threshold: parseFloat(portThreshold) || 3.0,
        notify_market_drop:    !!subs.market_drop,
        notify_portfolio_drop: !!subs.portfolio_drop,
        daily_brief_enabled:   !!subs.daily_brief,
        monthly_digest_enabled:!!subs.monthly_digest,
      }),
    });
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function sendTestEmail() {
    setTestStatus('sending'); setTestMsg('');
    try {
      const res  = await apiFetch('/api/notifications/test', { method: 'POST' });
      const data = await res.json();
      if (res.ok) { setTestStatus('ok');    setTestMsg(`Sent to ${data.sent_to}`); }
      else        { setTestStatus('error'); setTestMsg(data.detail || 'Failed'); }
    } catch(e) { setTestStatus('error'); setTestMsg(String(e)); }
    setTimeout(() => { setTestStatus(null); setTestMsg(''); }, 4000);
  }

  const FieldLabel = ({ children }) => (
    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', marginBottom: 6 }}>{children}</div>
  );

  return (
    <SettingsCard title="Notifications">
      <div style={{ display: 'grid', gap: 16 }}>
        <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>
          AI-powered email alerts sent from the MoneyTalks account. Enter your personal email below to receive them.
        </div>

        <div>
          <FieldLabel>Your Email (receive alerts here)</FieldLabel>
          <input value={alertEmail} onChange={e => setAlertEmail(e.target.value)}
            placeholder="you@gmail.com" type="email"
            style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface-3)', color: 'var(--ink)', fontSize: 13, boxSizing: 'border-box' }} />
        </div>

        {/* Subscription toggles */}
        <div style={{ background: 'var(--surface-3)', borderRadius: 10, overflow: 'hidden' }}>
          {NOTIFICATION_SUBS.map(({ key, label, desc }, i) => (
            <div key={key} onClick={() => setSubs(p => ({ ...p, [key]: !p[key] }))} style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px',
              borderTop: i > 0 ? '1px solid var(--line)' : 'none', cursor: 'pointer',
            }}>
              {/* Checkbox */}
              <div style={{
                width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                border: `2px solid ${subs[key] ? 'var(--accent)' : 'var(--line-2)'}`,
                background: subs[key] ? 'var(--accent)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {subs[key] && <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>✓</span>}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{label}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Thresholds — only show if relevant subs are on */}
        {(subs.market_drop || subs.portfolio_drop) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {subs.market_drop && (
              <div>
                <FieldLabel>Alert me when SPY drops more than…</FieldLabel>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input value={dropThreshold} onChange={e => setDropThreshold(e.target.value)}
                    type="number" step="0.1" min="0.1"
                    style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface-3)', color: 'var(--ink)', fontSize: 13 }} />
                  <span style={{ fontSize: 13, color: 'var(--ink-3)', flexShrink: 0 }}>% in a day</span>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  {['0.5', '1', '1.5', '2', '3'].map(v => (
                    <button key={v} onClick={() => setDropThreshold(v)} style={{
                      padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid',
                      borderColor: dropThreshold === v ? 'var(--accent)' : 'var(--line)',
                      background: dropThreshold === v ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                      color: dropThreshold === v ? 'var(--accent)' : 'var(--ink-3)',
                    }}>{v}%</button>
                  ))}
                </div>
              </div>
            )}
            {subs.portfolio_drop && (
              <div>
                <FieldLabel>Alert me when my portfolio drops more than…</FieldLabel>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input value={portThreshold} onChange={e => setPortThreshold(e.target.value)}
                    type="number" step="0.1" min="0.1"
                    style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface-3)', color: 'var(--ink)', fontSize: 13 }} />
                  <span style={{ fontSize: 13, color: 'var(--ink-3)', flexShrink: 0 }}>% in a day</span>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  {['1', '2', '3', '5', '7'].map(v => (
                    <button key={v} onClick={() => setPortThreshold(v)} style={{
                      padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid',
                      borderColor: portThreshold === v ? 'var(--accent)' : 'var(--line)',
                      background: portThreshold === v ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                      color: portThreshold === v ? 'var(--accent)' : 'var(--ink-3)',
                    }}>{v}%</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10 }}>
          <button onClick={save} disabled={saving} style={{
            background: 'var(--accent)', color: '#052015', border: 'none',
            borderRadius: 10, padding: '11px 0', fontWeight: 600, fontSize: 14,
            fontFamily: 'inherit', cursor: 'pointer', opacity: saving ? 0.6 : 1,
          }}>
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
          </button>
          <button onClick={sendTestEmail} disabled={testStatus === 'sending'} style={{
            background: 'var(--surface-3)', color: 'var(--ink-2)', border: '1px solid var(--line)',
            borderRadius: 10, padding: '11px 18px', fontWeight: 600, fontSize: 13,
            fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
            {testStatus === 'sending' ? 'Sending…' : 'Send Test'}
          </button>
        </div>

        {testMsg && (
          <div style={{
            padding: '10px 14px', borderRadius: 8, fontSize: 13,
            background: testStatus === 'ok' ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'color-mix(in srgb, var(--terra) 10%, transparent)',
            color: testStatus === 'ok' ? 'var(--accent)' : 'var(--terra)',
            border: `1px solid ${testStatus === 'ok' ? 'var(--accent)' : 'var(--terra)'}`,
          }}>{testMsg}</div>
        )}
      </div>
    </SettingsCard>
  );
}

function SettingsTab({ refreshFin }) {
  const { useState, useEffect, useRef } = React;

  const [dragging, setDragging]     = useState(false);
  const [uploading, setUploading]   = useState(false);
  const [uploadResult, setUpload]   = useState(null);
  const fileRef = useRef();

  const [cfg, setCfg]               = useState(null);
  const [claudeKey, setClaudeKey]   = useState('');
  const [geminiKey, setGeminiKey]   = useState('');
  const [provider, setProvider]     = useState('claude');
  const [plaidId, setPlaidId]             = useState('');
  const [plaidSecret, setPlaidSecret]     = useState('');
  const [plaidEnv, setPlaidEnv]           = useState('sandbox');
  const [plaidRedirect, setPlaidRedirect] = useState('');
  const [saving, setSaving]               = useState(false);
  const [saved, setSaved]                 = useState(false);
  const [repairing, setRepairing]         = useState(false);
  const [repairResult, setRepairResult]   = useState(null);
  const [syncInterval, setSyncInterval]             = useState(0);
  const [autoInvestSnapshot, setAutoInvestSnapshot] = useState(false);

  useEffect(() => {
    apiFetch('/api/config').then(r => r.json()).then(d => {
      setCfg(d);
      setProvider(d.preferred_provider || 'claude');
      if (d.plaid_environment) setPlaidEnv(d.plaid_environment);
      if (d.plaid_redirect_uri) setPlaidRedirect(d.plaid_redirect_uri);
      setSyncInterval(d.auto_sync_interval || 0);
      setAutoInvestSnapshot(!!d.auto_investment_snapshot);
    });
  }, []);

  async function handleFile(file) {
    if (!file || !file.name.endsWith('.csv')) {
      setUpload({ error: 'Please upload a CSV file.' });
      return;
    }
    setUploading(true);
    setUpload(null);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await apiFetch('/api/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) setUpload({ error: data.detail || 'Upload failed' });
      else setUpload(data);
    } catch (e) {
      setUpload({ error: String(e) });
    } finally {
      setUploading(false);
    }
  }

  async function saveConfig() {
    setSaving(true);
    const body = { preferred_provider: provider, plaid_environment: plaidEnv, auto_sync_interval: syncInterval };
    if (claudeKey)    body.anthropic_api_key  = claudeKey;
    if (geminiKey)    body.gemini_api_key     = geminiKey;
    if (plaidId)      body.plaid_client_id    = plaidId;
    if (plaidSecret)  body.plaid_secret       = plaidSecret;
    body.plaid_redirect_uri = plaidRedirect.trim() || null;
    await apiFetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    setSaved(true);
    setCfg(prev => ({
      ...prev,
      has_anthropic: !!(claudeKey || prev?.has_anthropic),
      has_gemini:    !!(geminiKey  || prev?.has_gemini),
      has_plaid:     !!(plaidId   || prev?.has_plaid),
      preferred_provider: provider,
      plaid_environment:  plaidEnv,
    }));
    setClaudeKey(''); setGeminiKey(''); setPlaidId(''); setPlaidSecret('');
    setTimeout(() => setSaved(false), 2500);
  }

  // Card, Label, StatusDot are defined outside this function (above) so
  // React doesn't remount them — and their children — on every state change.
  const Card = SettingsCard;
  const Label = SettingsLabel;

  return (
    <div style={{ maxWidth: 640, padding: '8px 0' }}>
      <Card title="Upload Bank CSV">
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
          onClick={() => fileRef.current.click()}
          style={{
            border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border)'}`,
            borderRadius: 12, padding: '36px 24px', textAlign: 'center',
            cursor: 'pointer', transition: 'border-color 0.15s',
            background: dragging ? 'color-mix(in srgb, var(--accent) 5%, transparent)' : 'var(--bg)',
          }}
        >
          <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }}
            onChange={e => handleFile(e.target.files[0])} />
          <div style={{ fontSize: 28, marginBottom: 10 }}>📂</div>
          {uploading
            ? <div style={{ color: 'var(--muted)', fontSize: 14 }}>Processing…</div>
            : <>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, color: 'var(--text)' }}>
                  Drop a CSV here or click to browse
                </div>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                  Supports Chase Bank, Chase Credit Card, and Amex
                </div>
              </>
          }
        </div>

        {uploadResult && (
          <div style={{
            marginTop: 16, padding: '14px 18px', borderRadius: 10,
            background: uploadResult.error
              ? 'color-mix(in srgb, #ef4444 8%, transparent)'
              : 'color-mix(in srgb, var(--accent) 8%, transparent)',
            border: `1px solid ${uploadResult.error ? '#ef4444' : 'var(--accent)'}`,
            fontSize: 14,
          }}>
            {uploadResult.error
              ? <span style={{ color: '#ef4444' }}>⚠ {uploadResult.error}</span>
              : <div style={{ color: 'var(--text)' }}>
                  <strong>✓ {uploadResult.format?.replace('_', ' ')} uploaded</strong>
                  <div style={{ marginTop: 6, color: 'var(--muted)', fontSize: 13 }}>
                    {uploadResult.new} new · {uploadResult.duplicates} duplicates skipped · {uploadResult.total} total on file
                  </div>
                </div>
            }
          </div>
        )}
      </Card>

      <Card title="Plaid — Linked Bank Accounts">
        <div style={{ display: 'grid', gap: 16 }}>
          <div>
            <Label><StatusDot active={cfg?.has_plaid} />Client ID {cfg?.has_plaid ? '(saved)' : '(not set)'}</Label>
            <input type="password" value={plaidId} onChange={e => setPlaidId(e.target.value)}
              placeholder="Plaid client_id"
              style={{ width: '100%', padding: '10px 14px', borderRadius: 10, boxSizing: 'border-box',
                border: '1px solid var(--border)', fontSize: 14, fontFamily: 'inherit',
                background: 'var(--bg)', color: 'var(--text)', outline: 'none' }} />
          </div>
          <div>
            <Label>Secret</Label>
            <input type="password" value={plaidSecret} onChange={e => setPlaidSecret(e.target.value)}
              placeholder="Plaid secret"
              style={{ width: '100%', padding: '10px 14px', borderRadius: 10, boxSizing: 'border-box',
                border: '1px solid var(--border)', fontSize: 14, fontFamily: 'inherit',
                background: 'var(--bg)', color: 'var(--text)', outline: 'none' }} />
          </div>
          <div>
            <Label>Environment</Label>
            <div style={{ display: 'flex', gap: 10 }}>
              {['sandbox', 'production'].map(env => (
                <button key={env} onClick={() => setPlaidEnv(env)} style={{
                  flex: 1, padding: '9px 0', borderRadius: 9, fontSize: 14,
                  fontFamily: 'inherit', cursor: 'pointer', fontWeight: 500,
                  border: plaidEnv === env ? '2px solid var(--accent)' : '1px solid var(--border)',
                  background: plaidEnv === env ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--bg)',
                  color: plaidEnv === env ? 'var(--accent)' : 'var(--muted)',
                }}>
                  {env.charAt(0).toUpperCase() + env.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>OAuth Redirect URI <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(required for AMEX, Chase, BofA, Capital One)</span></Label>
            <input type="text" value={plaidRedirect} onChange={e => setPlaidRedirect(e.target.value)}
              placeholder="https://your-domain.com/oauth_callback"
              style={{ width: '100%', padding: '10px 14px', borderRadius: 10, boxSizing: 'border-box',
                border: '1px solid var(--border)', fontSize: 14, fontFamily: 'inherit',
                background: 'var(--bg)', color: 'var(--text)', outline: 'none' }} />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5, lineHeight: 1.5 }}>
              Must match a URI registered in Plaid Dashboard → Developers → API → Allowed Redirect URIs.
              Use <code>ngrok http 8502</code> for a quick HTTPS URL, or Tailscale.
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
            Get your keys from <strong>dashboard.plaid.com</strong> → Team Settings → Keys.
            Use Sandbox for testing, Production for real bank connections.
          </div>
          <button onClick={saveConfig} disabled={saving} style={{
            background: 'var(--accent)', color: '#052015', border: 'none',
            borderRadius: 10, padding: '11px 0', fontWeight: 600, fontSize: 14,
            fontFamily: 'inherit', cursor: 'pointer', opacity: saving ? 0.6 : 1, width: '100%',
          }}>
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Plaid keys'}
          </button>
        </div>
      </Card>

      <PlaidSyncCard />

      <Card title="Auto-Sync Schedule">
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>
            Automatically sync your accounts in the background. New transactions will appear in the Review tab when you next open the app.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { value: 0,  label: 'Off' },
              { value: 6,  label: 'Every 6h' },
              { value: 12, label: 'Every 12h' },
              { value: 24, label: 'Every 24h' },
            ].map(({ value, label }) => (
              <button key={value} onClick={() => setSyncInterval(value)} style={{
                padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                cursor: 'pointer', border: '1px solid',
                borderColor: syncInterval === value ? 'var(--accent)' : 'var(--line)',
                background: syncInterval === value ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--surface-3)',
                color: syncInterval === value ? 'var(--accent)' : 'var(--ink-3)',
              }}>{label}</button>
            ))}
          </div>
          <button onClick={async () => {
            setSaving(true);
            await apiFetch('/api/config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ auto_sync_interval: syncInterval }),
            });
            setSaving(false); setSaved(true);
            setTimeout(() => setSaved(false), 2500);
          }} disabled={saving} style={{
            background: 'var(--accent)', color: '#052015', border: 'none',
            borderRadius: 10, padding: '11px 0', fontWeight: 600, fontSize: 14,
            fontFamily: 'inherit', cursor: 'pointer', opacity: saving ? 0.6 : 1, width: '100%',
          }}>
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
          </button>
        </div>
      </Card>

      <Card title="Investment Snapshot">
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>
            Record your portfolio value once a day in the background. Builds the historical chart on the Investments tab.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[{ value: false, label: 'Off' }, { value: true, label: 'Daily' }].map(({ value, label }) => (
              <button key={label} onClick={() => setAutoInvestSnapshot(value)} style={{
                padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                cursor: 'pointer', border: '1px solid',
                borderColor: autoInvestSnapshot === value ? 'var(--accent)' : 'var(--line)',
                background: autoInvestSnapshot === value ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--surface-3)',
                color: autoInvestSnapshot === value ? 'var(--accent)' : 'var(--ink-3)',
              }}>{label}</button>
            ))}
          </div>
          <button onClick={async () => {
            setSaving(true);
            await apiFetch('/api/config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ auto_investment_snapshot: autoInvestSnapshot }),
            });
            setSaving(false); setSaved(true);
            setTimeout(() => setSaved(false), 2500);
          }} disabled={saving} style={{
            background: 'var(--accent)', color: '#052015', border: 'none',
            borderRadius: 10, padding: '11px 0', fontWeight: 600, fontSize: 14,
            fontFamily: 'inherit', cursor: 'pointer', opacity: saving ? 0.6 : 1, width: '100%',
          }}>
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
          </button>
        </div>
      </Card>

      <NotificationsCard />

      <CategoriesManagerCard />

      <Card title="Data Quality">
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
            Fixes corrupted column types, derives missing income/expense labels from
            amounts, and runs AI categorization on any uncategorized transactions.
          </div>

          {repairResult && (
            <div style={{
              padding: '12px 16px', borderRadius: 10, fontSize: 13,
              background: repairResult.ok
                ? 'color-mix(in srgb, var(--accent) 8%, transparent)'
                : 'color-mix(in srgb, #ef4444 8%, transparent)',
              border: `1px solid ${repairResult.ok ? 'var(--accent)' : '#ef4444'}`,
            }}>
              {repairResult.ok ? (
                <div style={{ color: 'var(--text)' }}>
                  ✓ Repaired {repairResult.total} transactions
                  <div style={{ marginTop: 4, color: 'var(--muted)' }}>
                    {repairResult.type_fixed} type labels fixed ·{' '}
                    {repairResult.llm_categorized} of {repairResult.pending_before} uncategorized rows classified
                  </div>
                </div>
              ) : (
                <span style={{ color: '#ef4444' }}>⚠ {repairResult.error}</span>
              )}
            </div>
          )}

          <button onClick={async () => {
            setRepairing(true); setRepairResult(null);
            try {
              const res = await apiFetch('/api/repair', { method: 'POST' });
              setRepairResult(await res.json());
            } catch (e) { setRepairResult({ ok: false, error: String(e) }); }
            finally { setRepairing(false); }
          }} disabled={repairing} style={{
            background: 'var(--accent)', color: '#052015', border: 'none',
            borderRadius: 10, padding: '11px 0', fontWeight: 600, fontSize: 14,
            fontFamily: 'inherit', cursor: repairing ? 'default' : 'pointer',
            opacity: repairing ? 0.6 : 1, width: '100%',
          }}>
            {repairing ? 'Repairing…' : 'Repair data'}
          </button>
        </div>
      </Card>

    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
// ALL-DONE CELEBRATION
// ═══════════════════════════════════════════════════════════════════
function AllDoneCelebration({ total, streak, setTab }) {
  const { useEffect, useState } = React;
  const [show, setShow] = useState(false);
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { clearInterval(interval); if (setTab) setTab('monthly'); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [setTab]);

  useEffect(() => {
    if (!document.getElementById('review-done-css')) {
      const s = document.createElement('style');
      s.id = 'review-done-css';
      s.textContent = `
        @keyframes confettiFall {
          0%   { transform: translateY(-10px) rotate(0deg);  opacity: 1; }
          100% { transform: translateY(90px)  rotate(390deg);opacity: 0; }
        }
        @keyframes popIn {
          0%   { transform: scale(0.4); opacity: 0; }
          65%  { transform: scale(1.12); }
          100% { transform: scale(1);   opacity: 1; }
        }
        .rdone-emoji { animation: confettiFall linear forwards; position: absolute; top: 0; pointer-events: none; }
        .rdone-pop   { animation: popIn 0.55s cubic-bezier(.2,.8,.3,1.3) forwards; }
      `;
      document.head.appendChild(s);
    }
    const t = setTimeout(() => setShow(true), 30);
    return () => clearTimeout(t);
  }, []);

  const CONFETTI = ['🎉','✨','🎊','💸','🌟','🏆','💚','🎈','🥳','💰'];
  const streakMsg = streak >= 7 ? "7+ week streak — absolute legend! 🏆"
    : streak >= 4 ? `${streak} weeks running — you're on fire! 🔥`
    : streak >= 2 ? `${streak} weeks in a row! Keep it going 🔥`
    : null;
  const reviewedMsg = total > 500 ? `${total} transactions? You're practically a CPA.`
    : total > 200 ? `${total} transactions reviewed. Seriously impressive.`
    : total > 50  ? `${total} transactions reviewed. Finance goals: unlocked.`
    : `All ${total} transactions reviewed.`;

  return (
    <div style={{
      background: 'var(--surface)', borderRadius: 16,
      border: '1px solid var(--line)', padding: '52px 24px',
      textAlign: 'center', position: 'relative', overflow: 'hidden',
    }}>
      {show && CONFETTI.map((em, i) => (
        <span key={i} className="rdone-emoji" style={{
          left: `${5 + i * 9}%`,
          fontSize: 18 + (i % 3) * 4,
          animationDuration: `${1.3 + i * 0.13}s`,
          animationDelay: `${i * 0.12}s`,
        }}>{em}</span>
      ))}
      <div className="rdone-pop" style={{ opacity: 0 }}>
        <div style={{ fontSize: 60, marginBottom: 10, lineHeight: 1 }}>🎉</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)', marginBottom: 8, letterSpacing: '-0.02em' }}>
          You're all caught up!
        </div>
        <div style={{ fontSize: 14, color: 'var(--muted)', marginBottom: streakMsg ? 20 : 0, maxWidth: 340, margin: '0 auto', lineHeight: 1.5 }}>
          {reviewedMsg}
        </div>
        {streakMsg && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 20,
            background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
            border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
            borderRadius: 20, padding: '8px 18px',
            fontSize: 13, fontWeight: 600, color: 'var(--accent)',
          }}>
            {streakMsg}
          </div>
        )}
        <div style={{ marginTop: 24, fontSize: 12, color: 'var(--muted)' }}>
          Redirecting to Monthly tab in {countdown}s…
        </div>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
// REVIEW TAB
// ═══════════════════════════════════════════════════════════════════
function ReviewTab({ refreshFin, setTab }) {
  const { useState, useEffect, useCallback, useMemo } = React;

  const [state, setState]         = useState(null);
  const [loading, setLoading]     = useState(true);
  const [groupIdx, setGroupIdx]   = useState(() => {
    try { return parseInt(localStorage.getItem('review.groupIdx') || '0', 10) || 0; } catch { return 0; }
  });
  const [groupCats, setGroupCats] = useState({});   // vendorKey → group fill category
  const [itemCats, setItemCats]   = useState(() => {
    try { return JSON.parse(localStorage.getItem('review.itemCats') || '{}'); } catch { return {}; }
  });   // txnId → per-row category override
  const [localFlags, setLocalFlags] = useState({});
  const [approving, setApproving]   = useState(false);

  // Persist groupIdx and itemCats across sessions
  useEffect(() => {
    try { localStorage.setItem('review.groupIdx', String(groupIdx)); } catch {}
  }, [groupIdx]);
  useEffect(() => {
    try { localStorage.setItem('review.itemCats', JSON.stringify(itemCats)); } catch {}
  }, [itemCats]);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch('/api/review')
      .then(r => r.json())
      .then(d => {
        setState(d);
        setGroupCats({});
        // Keep itemCats — they may still be valid for transactions in the new batch
        const flags = {};
        (d.batch || []).forEach(t => { if (t.id) flags[t.id] = !!t.flagged; });
        setLocalFlags(flags);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Group batch by normalized merchant description
  const groups = useMemo(() => {
    if (!state?.batch?.length) return [];
    const map = {};
    state.batch.forEach(t => {
      const key = t.description.trim().toLowerCase().replace(/\s+/g, ' ');
      if (!map[key]) map[key] = { key, name: t.description, txns: [] };
      map[key].txns.push(t);
    });
    return Object.values(map)
      .sort((a, b) => b.txns.length - a.txns.length || a.name.localeCompare(b.name))
      .map(g => ({
        ...g,
        txns: g.txns.slice().sort((a, b) => (b.date > a.date ? 1 : -1)),
        total: g.txns.reduce((s, t) => s + Math.abs(t.amount), 0),
        suggestedCat: g.txns[0].category,
        isExpense: g.txns[0].amount >= 0,
      }));
  }, [state?.batch]);

  // Clamp groupIdx to valid range after groups change
  const safeIdx = Math.max(0, Math.min(groupIdx, groups.length - 1));

  function getGroupCat(g)   { return groupCats[g.key] ?? g.suggestedCat; }
  function getItemCat(g, t) { return itemCats[t.id] ?? getGroupCat(g); }

  function toggleFlag(txnId) {
    const next = !localFlags[txnId];
    setLocalFlags(prev => ({ ...prev, [txnId]: next }));
    apiFetch(`/api/transactions/${txnId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flagged: next }),
    }).catch(() => setLocalFlags(prev => ({ ...prev, [txnId]: !next })));
  }

  async function deleteRow(txnId) {
    const r = await apiFetch(`/api/transactions/${txnId}`, { method: 'DELETE' });
    if (!r.ok) return;
    setState(prev => ({
      ...prev,
      batch:     (prev.batch || []).filter(t => t.id !== txnId),
      remaining: Math.max(0, (prev.remaining || 1) - 1),
      total:     Math.max(0, (prev.total || 1) - 1),
    }));
    setItemCats(prev => { const n = {...prev}; delete n[txnId]; return n; });
  }

  async function doApprove(ids, overrides) {
    const r = await apiFetch('/api/review/approve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, overrides }),
    });
    return r.json();
  }

  async function approveGroup(g) {
    if (approving) return;
    setApproving(true);
    try {
      const overrides = {};
      g.txns.forEach(t => { if (t.id) overrides[t.id] = getItemCat(g, t); });
      const ids = g.txns.map(t => t.id).filter(Boolean);
      const data = await doApprove(ids, overrides);
      if (data.ok) {
        const gone = new Set(ids);
        const newBatch = (state.batch || []).filter(t => !gone.has(t.id));
        setState(prev => ({
          ...prev,
          total: data.total ?? prev.total,
          approved: data.approved,
          remaining: data.remaining,
          streak: data.streak,
          last_reviewed: data.last_reviewed,
          batch: newBatch,
        }));
        window.showToast?.(`Approved ${ids.length} transaction${ids.length !== 1 ? 's' : ''}`);
        // Clamp to valid index — groups will re-derive with one fewer entry
        if (groupIdx >= groups.length - 1 && groupIdx > 0) setGroupIdx(groups.length - 2);
        if (refreshFin) refreshFin();
        if (newBatch.length === 0 && data.remaining > 0) load();
      }
    } catch(_) {}
    finally { setApproving(false); }
  }

  async function approveAll() {
    if (approving || !state?.batch?.length) return;
    setApproving(true);
    try {
      const overrides = {};
      groups.forEach(g => g.txns.forEach(t => { if (t.id) overrides[t.id] = getItemCat(g, t); }));
      const ids = state.batch.map(t => t.id).filter(Boolean);
      const data = await doApprove(ids, overrides);
      if (data.ok) {
        setState(prev => ({
          ...prev,
          total: data.total ?? prev.total,
          approved: data.approved,
          remaining: data.remaining,
          streak: data.streak,
          last_reviewed: data.last_reviewed,
          batch: [],
        }));
        window.showToast?.(`Approved all ${ids.length} transaction${ids.length !== 1 ? 's' : ''}`);
        if (refreshFin) refreshFin();
        if (data.remaining > 0) load();
      }
    } catch(_) {}
    finally { setApproving(false); }
  }

  if (loading) return (
    <div className="tab-body review-tab-body">
      {/* Progress header skeleton */}
      <div className="review-progress-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="skeleton" style={{ height: 10, width: 130, borderRadius: 4 }} />
            <div className="skeleton" style={{ height: 16, width: 100, borderRadius: 4 }} />
            <div className="skeleton" style={{ height: 12, width: 80, borderRadius: 4 }} />
          </div>
          <div className="skeleton" style={{ height: 40, width: 64, borderRadius: 6 }} />
        </div>
        <div className="skeleton" style={{ height: 5, width: '100%', borderRadius: 3 }} />
      </div>
      {/* Group card skeleton */}
      <div className="review-group-card" style={{ marginTop: 20 }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="skeleton" style={{ height: 18, width: 160, borderRadius: 4 }} />
            <div className="skeleton" style={{ height: 12, width: 100, borderRadius: 4 }} />
          </div>
          <div className="skeleton" style={{ height: 22, width: 80, borderRadius: 11 }} />
        </div>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '90px 1fr auto auto auto', gap: 12, padding: '14px 24px', borderBottom: '1px solid var(--line)' }}>
            <div className="skeleton" style={{ height: 14, width: 50, borderRadius: 4 }} />
            <div className="skeleton" style={{ height: 24, width: 120, borderRadius: 6 }} />
            <div className="skeleton" style={{ height: 16, width: 64, borderRadius: 4, justifySelf: 'end' }} />
            <div className="skeleton" style={{ height: 18, width: 18, borderRadius: '50%' }} />
            <div className="skeleton" style={{ height: 18, width: 18, borderRadius: '50%' }} />
          </div>
        ))}
      </div>
    </div>
  );

  const { total = 0, approved = 0, remaining = 0, streak = 0, last_reviewed = null } = state || {};
  const pct = total > 0 ? Math.round((approved / total) * 100) : 100;
  const allDone = state !== null && remaining === 0 && total > 0;
  const g = groups[safeIdx] || null;
  const catInfo = g ? FIN.catById(getGroupCat(g)) : null;
  const batchCount = state?.batch?.length || 0;

  // Detect if current group looks like a duplicate pair
  const dupGroup = g && g.txns.length >= 2 && g.txns.every(t =>
    Math.abs(Math.abs(t.amount) - Math.abs(g.txns[0].amount)) < 0.01 &&
    Math.abs(new Date(t.date) - new Date(g.txns[0].date)) / 86400000 <= 7
  );
  const dupOlder = dupGroup ? [...g.txns].sort((a, b) => a.date < b.date ? -1 : 1)[0] : null;
  const dupNewer = dupGroup ? [...g.txns].sort((a, b) => a.date > b.date ? -1 : 1)[0] : null;

  async function resolveDup(keepId) {
    if (!g) return;
    const deleteIds = g.txns.filter(t => t.id !== keepId).map(t => t.id);
    // Delete the others
    await Promise.all(deleteIds.map(id => apiFetch(`/api/transactions/${id}`, { method: 'DELETE' })));
    // Approve the kept one
    const overrides = {};
    overrides[keepId] = getItemCat(g, g.txns.find(t => t.id === keepId));
    await doApprove([keepId], overrides);
    setState(prev => {
      const removed = new Set([...deleteIds]);
      const batch = (prev.batch || []).filter(t => !removed.has(t.id) && t.id !== keepId);
      return { ...prev, batch, remaining: Math.max(0, (prev.remaining || 0) - g.txns.length) };
    });
    setItemCats(prev => {
      const n = {...prev};
      g.txns.forEach(t => delete n[t.id]);
      return n;
    });
    if (groupIdx >= groups.length - 1 && groupIdx > 0) setGroupIdx(groups.length - 2);
  }

  return (
    <div className="tab-body review-tab-body">

      {/* ── Progress header ─────────────────────────────────────────── */}
      <div className="review-progress-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 5 }}>
              Transaction Review
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
              {allDone ? 'All caught up!' : `${remaining} to review`}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
              {approved} of {total} approved
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
            <div style={{
              fontSize: 36, fontWeight: 800,
              color: pct >= 90 ? 'var(--green)' : pct >= 70 ? '#fbbf24' : 'var(--accent)',
              letterSpacing: '-0.05em', fontFamily: 'var(--font-display)', lineHeight: 1,
            }}>{pct}%</div>
            {streak > 0 && (
              <div style={{ fontSize: 11.5, fontWeight: 700, color: streak >= 4 ? '#f97316' : streak >= 2 ? '#fbbf24' : 'var(--ink-3)' }}>
                {streak >= 2 ? '🔥' : '✓'} {streak} week{streak !== 1 ? 's' : ''} streak
              </div>
            )}
          </div>
        </div>
        <div style={{ height: 5, background: 'var(--line)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${pct}%`, borderRadius: 3,
            background: 'linear-gradient(90deg, var(--accent), var(--accent-2, var(--accent)))',
            transition: 'width 0.5s cubic-bezier(0.22,1,0.36,1)',
          }} />
        </div>
      </div>

      {allDone ? (
        <AllDoneCelebration total={total} streak={streak} setTab={setTab} />
      ) : !g ? null : (
        <>
          {/* ── Group navigator chips ──────────────────────────────── */}
          {groups.length > 1 && (
            <div className="review-chips">
              {groups.map((grp, i) => {
                const isActive = i === safeIdx;
                const gc = FIN.catById(getGroupCat(grp));
                return (
                  <button key={grp.key} className={`review-chip ${isActive ? 'active' : ''}`}
                    style={{
                      borderColor: isActive ? gc.color : undefined,
                      background: isActive ? gc.color + '16' : undefined,
                    }}
                    onClick={() => setGroupIdx(i)}>
                    <span style={{ color: gc.color }}>{gc.icon}</span>
                    <span style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {grp.name}
                    </span>
                    <span className="review-chip-count" style={{
                      background: isActive ? gc.color : 'var(--line)',
                      color: isActive ? '#fff' : 'var(--ink-3)',
                    }}>{grp.txns.length}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* ── Main group card ────────────────────────────────────── */}
          <div className="review-group-card">

            {/* Group header */}
            <div className="review-group-header" style={{ background: catInfo.color + '09' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                {/* Vendor icon + name */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div className="review-vendor-icon" style={{ background: catInfo.color + '20', color: catInfo.color }}>
                    {catInfo.icon}
                  </div>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-0.025em', marginBottom: 3 }}>
                      {g.name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                      {g.txns.length} transaction{g.txns.length !== 1 ? 's' : ''}
                      <span style={{ color: 'var(--ink-4)', margin: '0 6px' }}>·</span>
                      <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--ink-2)' }}>
                        {fmtMoney2(g.total)}
                      </span> total
                    </div>
                  </div>
                </div>

                {/* Prev / count / Next */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <button className="review-nav-btn"
                    onClick={() => setGroupIdx(i => Math.max(0, i - 1))}
                    style={{ opacity: safeIdx === 0 ? 0.3 : 1, cursor: safeIdx === 0 ? 'default' : 'pointer' }}
                    disabled={safeIdx === 0}>←</button>
                  <span style={{ fontSize: 11, color: 'var(--ink-3)', padding: '0 4px', fontFamily: 'var(--font-mono)' }}>
                    {safeIdx + 1} / {groups.length}
                  </span>
                  <button className="review-nav-btn"
                    onClick={() => setGroupIdx(i => Math.min(groups.length - 1, i + 1))}
                    style={{ opacity: safeIdx === groups.length - 1 ? 0.3 : 1, cursor: safeIdx === groups.length - 1 ? 'default' : 'pointer' }}
                    disabled={safeIdx === groups.length - 1}>→</button>
                </div>
              </div>

              {/* "Fill all" shortcut — sets every row's category at once, individually still editable */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10, background: 'rgba(20,24,32,0.04)' }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
                  Fill all →
                </span>
                <CategoryPicker
                  value={getGroupCat(g)}
                  onChange={cat => {
                    setGroupCats(prev => ({ ...prev, [g.key]: cat }));
                    // Push the chosen category to every item that hasn't been individually overridden yet
                    setItemCats(prev => {
                      const next = { ...prev };
                      g.txns.forEach(t => { next[t.id] = cat; });
                      return next;
                    });
                  }}
                />
                <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>overwrites all rows</span>
              </div>
            </div>

            {/* Column header */}
            <div style={{
              display: 'grid', gridTemplateColumns: '90px 1fr auto auto auto',
              gap: 12, padding: '7px 24px',
              borderBottom: '2px solid var(--line)',
              fontSize: 10.5, fontWeight: 700, color: 'var(--ink-3)',
              textTransform: 'uppercase', letterSpacing: '0.07em',
            }}>
              <div>Date</div>
              <div>Category</div>
              <div style={{ textAlign: 'right' }}>Amount</div>
              <div />
              <div />
            </div>

            {/* Transaction rows — each has its own category picker, always visible */}
            {g.txns.map((t, i) => {
              const isFlagged   = !!localFlags[t.id];
              const currentCat  = getItemCat(g, t);
              const currentInfo = FIN.catById(currentCat);
              const isExpense   = t.amount >= 0;
              const isIndividual = !!itemCats[t.id] && itemCats[t.id] !== getGroupCat(g);
              // Detect if this row is a possible duplicate within its group
              const isPossibleDup = t.notes?.includes('Possible duplicate') || g.txns.some((other, oi) =>
                oi !== i &&
                Math.abs(Math.abs(other.amount) - Math.abs(t.amount)) < 0.01 &&
                Math.abs(new Date(other.date) - new Date(t.date)) / 86400000 <= 7
              );
              return (
                <div key={t.id || i}
                  style={{
                    display: 'grid', gridTemplateColumns: '90px 1fr auto auto auto',
                    alignItems: 'center', gap: 12, padding: '10px 24px',
                    borderBottom: i < g.txns.length - 1 ? '1px solid var(--line)' : 'none',
                    background: isPossibleDup ? 'rgba(234,179,8,0.04)' : isFlagged ? 'rgba(249,115,22,0.04)' : i % 2 === 1 ? 'rgba(20,24,32,0.012)' : undefined,
                    transition: 'background 0.1s',
                  }}>

                  {/* Date + source */}
                  <div>
                    <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--ink)', fontWeight: 500 }}>
                      {t.date.slice(5).replace('-', '/')}
                    </div>
                    {t.source && (
                      <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.source}
                      </div>
                    )}
                    {isPossibleDup && (
                      <div style={{ fontSize: 9.5, color: '#ca8a04', fontWeight: 700, marginTop: 2, letterSpacing: '0.03em' }}>
                        ⚠ dup?
                      </div>
                    )}
                  </div>

                  {/* Per-row category picker — always visible */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <CategoryPicker
                        value={currentCat}
                        onChange={cat => {
                          setItemCats(prev => ({ ...prev, [t.id]: cat }));
                        }}
                      />
                      {/* Fill below: apply this category to all rows after this one */}
                      {i < g.txns.length - 1 && (
                        <button
                          title="Apply this category to all rows below"
                          onClick={() => {
                            const below = g.txns.slice(i + 1);
                            setItemCats(prev => {
                              const n = { ...prev };
                              below.forEach(bt => { n[bt.id] = currentCat; });
                              return n;
                            });
                          }}
                          style={{
                            background: 'none', border: '1px solid var(--line)', borderRadius: 4,
                            cursor: 'pointer', color: 'var(--ink-4)', fontSize: 10, padding: '1px 4px',
                            lineHeight: 1.4, fontFamily: 'inherit', flexShrink: 0,
                          }}>
                          ↓ fill
                        </button>
                      )}
                    </div>
                    {isIndividual && (
                      <button
                        onClick={() => setItemCats(prev => { const n = {...prev}; delete n[t.id]; return n; })}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--ink-4)', fontSize: 10, padding: '1px 0',
                          fontFamily: 'inherit', textDecoration: 'underline dotted',
                        }}>
                        reset
                      </button>
                    )}
                  </div>

                  {/* Amount */}
                  <div style={{
                    fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)',
                    color: isExpense ? 'var(--ink)' : 'var(--green)',
                    whiteSpace: 'nowrap', textAlign: 'right', letterSpacing: '-0.02em',
                  }}>
                    {isExpense ? '−' : '+'}{FIN.fmt(Math.abs(t.amount))}
                  </div>

                  {/* Flag */}
                  <button
                    onClick={() => t.id && toggleFlag(t.id)}
                    title={isFlagged ? 'Remove flag' : 'Flag for later review'}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
                      fontSize: 14, lineHeight: 1,
                      color: isFlagged ? '#f97316' : 'var(--ink-4)',
                      opacity: isFlagged ? 1 : 0.45,
                      transition: 'color 0.12s, opacity 0.12s',
                    }}
                    onMouseEnter={e => { if (!isFlagged) e.currentTarget.style.opacity = '1'; }}
                    onMouseLeave={e => { if (!isFlagged) e.currentTarget.style.opacity = '0.45'; }}
                  >⚑</button>

                  {/* Delete */}
                  <button
                    onClick={() => t.id && deleteRow(t.id)}
                    title="Delete this transaction"
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
                      fontSize: 15, lineHeight: 1, color: 'var(--ink-4)',
                      opacity: 0.3, transition: 'color 0.12s, opacity 0.12s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = '#dc2626'; }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = '0.3'; e.currentTarget.style.color = 'var(--ink-4)'; }}
                  >×</button>
                </div>
              );
            })}

            {/* Footer — dup resolution or normal approve */}
            {dupGroup ? (
              <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line)', background: 'rgba(234,179,8,0.04)' }}>
                <div style={{ fontSize: 11, color: '#92400e', fontWeight: 600, marginBottom: 8, letterSpacing: '0.02em' }}>
                  ⚠ Possible duplicate — which charge is real?
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="review-skip-btn"
                    onClick={() => setGroupIdx(i => (i + 1) % groups.length)}>
                    Skip →
                  </button>
                  <button
                    disabled={approving}
                    onClick={() => dupOlder && resolveDup(dupOlder.id)}
                    style={{
                      flex: 1, padding: '10px 14px', borderRadius: 10, border: 'none',
                      background: 'var(--surface-2)', color: 'var(--ink)',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                    Keep {dupOlder?.date.slice(5).replace('-', '/')} · delete newer
                  </button>
                  <button
                    disabled={approving}
                    onClick={() => dupNewer && resolveDup(dupNewer.id)}
                    style={{
                      flex: 1, padding: '10px 14px', borderRadius: 10, border: 'none',
                      background: catInfo?.color || 'var(--accent)', color: '#fff',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                    Keep {dupNewer?.date.slice(5).replace('-', '/')} · delete older
                  </button>
                </div>
              </div>
            ) : (
              <div className="review-group-footer">
                <button className="review-skip-btn"
                  onClick={() => setGroupIdx(i => (i + 1) % groups.length)}>
                  Skip →
                </button>
                <button className="review-approve-btn" disabled={approving}
                  onClick={() => approveGroup(g)}
                  style={{ background: catInfo.color || 'var(--accent)' }}>
                  {approving ? 'Saving…' : `✓ Approve ${g.txns.length} · ${fmtMoney2(g.total)}`}
                </button>
              </div>
            )}
          </div>

          {/* Approve all */}
          {groups.length > 0 && batchCount > (g?.txns?.length || 0) && (
            <div style={{ textAlign: 'center' }}>
              <button className="review-approve-all-btn" disabled={approving} onClick={approveAll}>
                Approve all {batchCount} transactions ({groups.length} group{groups.length !== 1 ? 's' : ''})
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
// FLAGGED TAB — possible duplicates + manually flagged transactions
// ═══════════════════════════════════════════════════════════════════
function FlaggedTab() {
  const { useState, useEffect, useCallback } = React;
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState('dups'); // 'dups' | 'flagged'
  const [filter, setFilter]   = useState('all');  // 'all' | 'high'
  const [deleting, setDeleting] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('mt_dismissed_dups') || '[]')); }
    catch { return new Set(); }
  });
  const [trash, setTrash]     = useState(null);
  const [restoring, setRestoring] = useState(null);

  function dismissPair(id1, id2) {
    const key = [id1, id2].sort().join('|');
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(key);
      try { localStorage.setItem('mt_dismissed_dups', JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  const load = useCallback(() => {
    setLoading(true);
    apiFetch('/api/flagged')
      .then(r => r.json())
      .then(d => setData(d))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (section === 'trash' && trash === null) {
      apiFetch('/api/transactions/trash').then(r => r.json()).then(d => setTrash(d.items || [])).catch(() => setTrash([]));
    }
  }, [section]);

  async function deleteTxn(txnId) {
    setDeleting(txnId);
    try {
      const r = await apiFetch(`/api/transactions/${txnId}`, { method: 'DELETE' });
      if (!r.ok) return;
      setData(prev => ({
        ...prev,
        pairs:   (prev.pairs   || []).filter(p => p.txn1.id !== txnId && p.txn2.id !== txnId),
        flagged: (prev.flagged || []).filter(t => t.id !== txnId),
      }));
      // Refresh trash list so the newly deleted item appears immediately
      setTrash(null);
    } finally {
      setDeleting(null);
    }
  }

  async function restoreTxn(txnId) {
    setRestoring(txnId);
    try {
      const r = await apiFetch(`/api/transactions/${txnId}/restore`, { method: 'POST' });
      if (r.ok) {
        setTrash(prev => prev.filter(t => t.id !== txnId));
        window.showToast?.('Transaction restored');
      }
    } finally {
      setRestoring(null);
    }
  }

  async function unflagTxn(txnId) {
    await apiFetch(`/api/transactions/${txnId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flagged: false }),
    });
    setData(prev => ({ ...prev, flagged: (prev.flagged || []).filter(t => t.id !== txnId) }));
  }

  if (loading) return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 24px' }}>
      <div style={{ marginBottom: 20 }}>
        <div className="skeleton" style={{ height: 26, width: 180, borderRadius: 6, marginBottom: 10 }} />
        <div className="skeleton" style={{ height: 13, width: 320, borderRadius: 4 }} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <div className="skeleton" style={{ height: 34, width: 160, borderRadius: 8 }} />
        <div className="skeleton" style={{ height: 34, width: 100, borderRadius: 8 }} />
      </div>
      {[1, 2, 3].map(i => (
        <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: 20, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div className="skeleton" style={{ height: 14, width: 80, borderRadius: 4 }} />
            <div className="skeleton" style={{ height: 20, width: 50, borderRadius: 10 }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ padding: 12, border: '1px solid var(--line)', borderRadius: 8 }}>
              <div className="skeleton" style={{ height: 12, width: '70%', borderRadius: 4, marginBottom: 6 }} />
              <div className="skeleton" style={{ height: 16, width: '50%', borderRadius: 4 }} />
            </div>
            <div style={{ padding: 12, border: '1px solid var(--line)', borderRadius: 8 }}>
              <div className="skeleton" style={{ height: 12, width: '70%', borderRadius: 4, marginBottom: 6 }} />
              <div className="skeleton" style={{ height: 16, width: '50%', borderRadius: 4 }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  const pairs       = data?.pairs   || [];
  const flaggedList = data?.flagged || [];
  const activePairs = pairs.filter(p => !dismissed.has([p.txn1.id, p.txn2.id].sort().join('|')));
  const highCount   = activePairs.filter(p => p.confidence === 'high').length;
  const visiblePairs = filter === 'high' ? activePairs.filter(p => p.confidence === 'high') : activePairs;

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 24px' }}>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: 'var(--ink)' }}>Needs Attention</h2>
        <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: '5px 0 0' }}>
          Possible duplicate charges and transactions you flagged for review.
        </p>
      </div>

      {/* Section toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[
          { id: 'dups',    label: `Possible Duplicates (${activePairs.length})` },
          { id: 'flagged', label: `Flagged (${flaggedList.length})` },
          { id: 'trash',   label: `🗑 Trash` },
        ].map(s => (
          <button key={s.id} onClick={() => setSection(s.id)}
            style={{
              padding: '7px 16px', borderRadius: 8, border: '1px solid var(--line)',
              background: section === s.id ? 'var(--ink)' : 'var(--surface)',
              color: section === s.id ? 'var(--bg)' : 'var(--ink)',
              fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              transition: 'all 0.15s',
            }}>
            {s.label}
          </button>
        ))}
      </div>

      {/* ── Duplicates section ── */}
      {section === 'dups' && (
        <>
          <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12, lineHeight: 1.5 }}>
            Same merchant · same amount · within 7 days. Check your bank statement before deleting.
          </p>
          {pairs.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {[
                { id: 'all',  label: `All (${pairs.length})`,           color: null },
                { id: 'high', label: `High confidence (${highCount})`,  color: '#dc2626' },
              ].map(f => (
                <button key={f.id} onClick={() => setFilter(f.id)}
                  style={{
                    padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'inherit', border: '1px solid',
                    background: filter === f.id
                      ? (f.color ? 'rgba(220,38,38,0.08)' : 'var(--surface-2)')
                      : 'var(--surface)',
                    color:       filter === f.id ? (f.color || 'var(--ink)') : 'var(--ink-3)',
                    borderColor: filter === f.id ? (f.color ? 'rgba(220,38,38,0.3)' : 'var(--line)') : 'var(--line)',
                  }}>
                  {f.label}
                </button>
              ))}
            </div>
          )}
          {visiblePairs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--ink-3)' }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>✓</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-3)' }}>No duplicates found</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>Your transactions look clean!</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {visiblePairs.map(pair => (
                <div key={`${pair.txn1.id}-${pair.txn2.id}`} className="card" style={{ overflow: 'hidden', padding: 0 }}>
                  {/* Pair header */}
                  <div style={{
                    padding: '12px 18px', borderBottom: '1px solid var(--line)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: '50%', background: 'var(--surface-2)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 800, color: 'var(--ink-3)',
                        flexShrink: 0,
                      }}>
                        {(pair.txn1.description.trim()[0] || '?').toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
                          {pair.txn1.description}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 1 }}>
                          {pair.delta_days === 0 ? 'Same day' : `${pair.delta_days}d apart`}
                          {' · '}
                          <span style={{ color: pair.confidence === 'high' ? '#dc2626' : '#d97706', fontWeight: 600 }}>
                            {pair.confidence === 'high' ? 'high' : 'medium'} confidence
                          </span>
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ fontSize: 15, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>
                        {FIN.fmt(Math.abs(pair.txn1.amount))}
                      </div>
                      <button onClick={() => dismissPair(pair.txn1.id, pair.txn2.id)} style={{
                        padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                        cursor: 'pointer', fontFamily: 'inherit', border: '1px solid var(--line)',
                        background: 'var(--surface-2)', color: 'var(--ink-3)',
                      }} title="Mark as not a duplicate and hide this pair">
                        Keep both
                      </button>
                    </div>
                  </div>
                  {/* Two rows */}
                  {[pair.txn1, pair.txn2].map((txn, ti) => (
                    <div key={txn.id} style={{
                      display: 'grid', gridTemplateColumns: '100px 1fr auto',
                      alignItems: 'center', gap: 12, padding: '10px 18px',
                      borderBottom: ti === 0 ? '1px solid var(--line)' : 'none',
                      background: ti === 1 ? 'rgba(20,24,32,0.015)' : undefined,
                    }}>
                      <div>
                        <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                          {txn.date.slice(5).replace('-', '/')}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 1 }}>{txn.source}</div>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                        {txn.category}
                        {txn.approved && <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--green)', fontWeight: 700 }}>✓ approved</span>}
                        {txn.pending  && <span style={{ marginLeft: 8, fontSize: 10, color: '#d97706', fontWeight: 700 }}>pending</span>}
                        {txn.notes?.includes('Possible duplicate') && <span style={{ marginLeft: 8, fontSize: 10, color: '#d97706', fontWeight: 700 }}>⚠ flagged</span>}
                      </div>
                      <button onClick={() => deleteTxn(txn.id)} disabled={!!deleting}
                        style={{
                          padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                          cursor: deleting ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                          border: '1px solid rgba(220,38,38,0.25)', background: 'rgba(220,38,38,0.06)',
                          color: '#dc2626', opacity: deleting === txn.id ? 0.5 : 1, transition: 'opacity 0.1s',
                        }}>
                        {deleting === txn.id ? '…' : 'Delete'}
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Flagged transactions section ── */}
      {section === 'flagged' && (
        <>
          <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12 }}>
            Transactions you flagged for manual review from the Review tab.
          </p>
          {flaggedList.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--ink-3)' }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>⚑</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-3)' }}>Nothing flagged</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>
                Flag transactions in Review to see them here.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {flaggedList.map(txn => (
                <div key={txn.id} className="card" style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {txn.description}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
                      {txn.date.slice(5).replace('-', '/')} · {txn.source} · {txn.category}
                      {txn.approved && <span style={{ marginLeft: 8, color: 'var(--green)', fontWeight: 600 }}>✓ approved</span>}
                    </div>
                    {txn.notes && <div style={{ fontSize: 11, color: '#d97706', marginTop: 2 }}>{txn.notes}</div>}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--ink)', whiteSpace: 'nowrap' }}>
                    {txn.amount >= 0 ? '−' : '+'}{FIN.fmt(Math.abs(txn.amount))}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => unflagTxn(txn.id)}
                      style={{
                        padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                        cursor: 'pointer', fontFamily: 'inherit',
                        border: '1px solid var(--line)', background: 'var(--surface)',
                        color: 'var(--ink-3)',
                      }}>
                      Unflag
                    </button>
                    <button onClick={() => deleteTxn(txn.id)} disabled={!!deleting}
                      style={{
                        padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                        cursor: deleting ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                        border: '1px solid rgba(220,38,38,0.25)', background: 'rgba(220,38,38,0.06)',
                        color: '#dc2626', opacity: deleting === txn.id ? 0.5 : 1,
                      }}>
                      {deleting === txn.id ? '…' : 'Delete'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Trash section ── */}
      {section === 'trash' && (
        <>
          <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 16, lineHeight: 1.5 }}>
            Deleted transactions are kept for 7 days, then permanently removed. Click Restore to bring one back.
          </p>
          {trash === null ? (
            <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>Loading…</div>
          ) : trash.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--ink-3)' }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>🗑</div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Trash is empty</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>Deleted transactions will appear here for 7 days.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {trash.map(t => {
                const cat = catById(t.category);
                return (
                  <div key={t.id} className="card" style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 9, background: cat.color + '22', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: cat.color }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.merchant}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
                        {t.date} · {cat.name}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginRight: 8 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: t.amount >= 0 ? 'var(--green)' : 'var(--ink)' }}>
                        {fmtMoney(Math.abs(t.amount))}
                      </div>
                      <div style={{ fontSize: 10, color: t.expires_in <= 1 ? 'var(--terra)' : 'var(--ink-4)', marginTop: 2 }}>
                        {t.expires_in === 0 ? 'expires today' : `${t.expires_in}d left`}
                      </div>
                    </div>
                    <button onClick={() => restoreTxn(t.id)} disabled={restoring === t.id}
                      style={{
                        padding: '5px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                        cursor: restoring === t.id ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                        border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
                        background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
                        color: 'var(--accent)', flexShrink: 0,
                        opacity: restoring === t.id ? 0.5 : 1,
                      }}>
                      {restoring === t.id ? '…' : 'Restore'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
// FEEDBACK TAB
// ═══════════════════════════════════════════════════════════════════
function FeedbackTab() {
  const { useState, useEffect } = React;

  const CATS = [
    { id: 'bug',     label: '🐛 Bug',            desc: 'Something is broken or wrong' },
    { id: 'feature', label: '✨ Feature request', desc: "Something you'd like to see" },
    { id: 'general', label: '💬 General',         desc: 'Anything else' },
  ];

  const [cat, setCat]         = useState('general');
  const [msg, setMsg]         = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent]       = useState(false);
  const [err, setErr]         = useState('');
  const [entries, setEntries] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    apiFetch('/api/feedback')
      .then(r => r.json())
      .then(d => { setEntries(d.entries || []); setIsAdmin(d.is_admin); });
  }, [sent]);

  async function submit() {
    if (!msg.trim()) return;
    setSending(true); setErr('');
    try {
      const res = await apiFetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: cat, message: msg.trim() }),
      });
      if (res.ok) { setSent(true); setMsg(''); setTimeout(() => setSent(false), 3000); }
      else { const d = await res.json(); setErr(d.detail || 'Failed to send'); }
    } catch(e) { setErr(String(e)); }
    finally { setSending(false); }
  }

  const catColors = { bug: '#ef4444', feature: '#a78bfa', general: '#67e8f9' };
  const catLabel  = { bug: 'Bug', feature: 'Feature', general: 'General' };

  return (
    <div className="tab-body" style={{ maxWidth: 680, margin: '0 auto' }}>

      {/* Submit form */}
      <div style={{
        background: 'var(--surface)', borderRadius: 16,
        border: '1px solid var(--line)', padding: '24px 28px', marginBottom: 20,
      }}>
        <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--ink)', marginBottom: 18 }}>
          Share feedback
        </div>

        {/* Category selector */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {CATS.map(c => (
            <button key={c.id} onClick={() => setCat(c.id)} style={{
              padding: '7px 14px', borderRadius: 20, fontSize: 13, fontWeight: 500,
              border: `1px solid ${cat === c.id ? catColors[c.id] : 'var(--line)'}`,
              background: cat === c.id ? catColors[c.id] + '18' : 'transparent',
              color: cat === c.id ? catColors[c.id] : 'var(--muted)',
              cursor: 'pointer', fontFamily: 'inherit',
            }}>{c.label}</button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          {CATS.find(c => c.id === cat)?.desc}
        </div>

        <textarea
          value={msg}
          onChange={e => setMsg(e.target.value)}
          placeholder="Describe what you'd like to share…"
          rows={4}
          style={{
            width: '100%', padding: '12px 14px', borderRadius: 10, fontSize: 14,
            border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)',
            fontFamily: 'inherit', resize: 'vertical', outline: 'none',
            boxSizing: 'border-box', lineHeight: 1.5,
          }}
        />

        {err && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 6 }}>{err}</div>}

        <button onClick={submit} disabled={sending || !msg.trim()} style={{
          marginTop: 12, width: '100%', padding: '12px 0',
          background: sent ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'var(--accent)',
          color: sent ? 'var(--accent)' : '#052015',
          border: sent ? '1px solid var(--accent)' : 'none',
          borderRadius: 10, fontSize: 14, fontWeight: 600,
          fontFamily: 'inherit', cursor: sending || !msg.trim() ? 'default' : 'pointer',
          opacity: sending || !msg.trim() ? 0.5 : 1,
        }}>
          {sending ? 'Sending…' : sent ? '✓ Sent — thanks!' : 'Send feedback'}
        </button>
      </div>

      {/* Inbox — admin sees all, users see their own */}
      {entries.length > 0 && (
        <div style={{
          background: 'var(--surface)', borderRadius: 16,
          border: '1px solid var(--line)', overflow: 'hidden',
        }}>
          <div style={{
            padding: '14px 20px', borderBottom: '1px solid var(--line)',
            fontSize: 13, fontWeight: 600, color: 'var(--ink)',
          }}>
            {isAdmin ? `All feedback (${entries.length})` : `Your submissions (${entries.length})`}
          </div>
          {[...entries].reverse().map((e, i) => (
            <div key={e.id} style={{
              padding: '14px 20px',
              borderBottom: i < entries.length - 1 ? '1px solid var(--line)' : 'none',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {isAdmin && (
                    <span style={{
                      fontSize: 12, fontWeight: 600, color: 'var(--ink)',
                      background: 'var(--bg)', border: '1px solid var(--line)',
                      borderRadius: 6, padding: '2px 7px',
                    }}>{e.display_name}</span>
                  )}
                  <span style={{
                    fontSize: 11, fontWeight: 500,
                    color: catColors[e.category] || 'var(--muted)',
                    background: (catColors[e.category] || '#94a3b8') + '18',
                    border: `1px solid ${(catColors[e.category] || '#94a3b8')}40`,
                    borderRadius: 10, padding: '2px 8px',
                  }}>{catLabel[e.category] || e.category}</span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {new Date(e.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6 }}>{e.message}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Admin Tab ────────────────────────────────────────────────────────────────
function AdminTab() {
  const { useState, useEffect, useRef } = React;

  // ── Shared styles aligned with app design system ───────────────────────────
  const input = {
    width: '100%', padding: '10px 14px', borderRadius: 10, boxSizing: 'border-box',
    border: '1px solid var(--line-2)', fontSize: 14, fontFamily: 'inherit',
    background: 'var(--surface)', color: 'var(--ink)', outline: 'none',
    transition: 'border-color 0.15s',
  };
  // Primary — green accent fill
  const btnPrimary = {
    background: 'var(--accent)', color: '#052015', border: 'none',
    borderRadius: 10, padding: '11px 20px', fontWeight: 600, fontSize: 14,
    fontFamily: 'inherit', cursor: 'pointer', width: '100%', transition: 'opacity 0.15s',
  };
  // Secondary — subtle surface fill with border
  const btnSecondary = {
    background: 'var(--surface-3)', color: 'var(--ink)', border: '1px solid var(--line-2)',
    borderRadius: 10, padding: '10px 20px', fontWeight: 500, fontSize: 14,
    fontFamily: 'inherit', cursor: 'pointer', width: '100%', transition: 'background 0.15s',
  };
  // Danger — terra tint
  const btnDanger = {
    background: 'none', border: '1px solid var(--terra)', color: 'var(--terra)',
    borderRadius: 8, padding: '5px 14px', fontSize: 12, fontWeight: 500,
    fontFamily: 'inherit', cursor: 'pointer', transition: 'background 0.15s',
  };

  const NAV = [
    { key: 'status',   label: 'System Status', icon: '◉' },
    { key: 'deploy',   label: 'Deploy',         icon: '↑' },
    { key: 'tests',    label: 'Tests',           icon: '✓' },
    { key: 'ai',       label: 'AI Provider',    icon: '◆' },
    { key: 'users',    label: 'User Accounts',  icon: '⊕' },
    { key: 'feedback', label: 'Feedback',        icon: '◎' },
    { key: 'logs',     label: 'Server Logs',     icon: '≡' },
  ];
  const [page, setPage] = useState('status');

  const [cfg, setCfg]             = useState(null);
  const [claudeKey, setClaudeKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [provider, setProvider]   = useState('gemini');
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);
  const [users, setUsers]         = useState([]);
  const [newUser, setNewUser]     = useState('');
  const [newPass, setNewPass]     = useState('');
  const [newAdmin, setNewAdmin]   = useState(false);
  const [userMsg, setUserMsg]     = useState('');

  const [healthChecks, setHealthChecks]   = useState([]);
  const [endpointPings, setEndpointPings] = useState([]);
  const [healthLoading, setHealthLoading] = useState(false);

  const [deployJobId, setDeployJobId]     = useState(null);
  const [deployOutput, setDeployOutput]   = useState('');
  const [deployDone, setDeployDone]       = useState(false);
  const [deployOk, setDeployOk]           = useState(false);
  const [deployRunning, setDeployRunning] = useState(false);
  const deployPollRef                     = useRef(null);

  const SUITES = [
    { key: 'unit',        label: 'Unit Tests',        desc: 'Categorization + session store — fast' },
    { key: 'integration', label: 'Integration Tests',  desc: 'Fin data + Plaid client — disk I/O' },
    { key: 'all',         label: 'Run All',            desc: 'All pytest suites' },
    { key: 'search',      label: 'Search Eval',        desc: 'ML model eval — slow (~30s+)' },
  ];
  const [testJobs, setTestJobs] = useState({});
  const testPollRefs            = useRef({});

  const [feedback, setFeedback] = useState([]);
  const [logs, setLogs]         = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);

  useEffect(() => {
    apiFetch('/api/config').then(r => r.json()).then(d => {
      setCfg(d);
      setProvider(d.preferred_provider || 'gemini');
    });
    apiFetch('/api/auth/users').then(r => r.json()).then(d => setUsers(d.users || [])).catch(() => {});
    runHealthChecks();
  }, []);

  useEffect(() => {
    if (page === 'feedback') {
      apiFetch('/api/feedback').then(r => r.json()).then(d => setFeedback(d.entries || [])).catch(() => {});
    }
    if (page === 'logs') {
      setLogsLoading(true);
      apiFetch('/api/admin/logs?lines=300').then(r => r.json()).then(d => {
        setLogs(d.lines || []);
        setLogsLoading(false);
      }).catch(() => setLogsLoading(false));
    }
  }, [page]);

  useEffect(() => {
    if (!deployJobId || deployDone) return;
    deployPollRef.current = setInterval(async () => {
      const d = await fetch(`/api/admin/job/${deployJobId}`).then(r => r.json()).catch(() => null);
      if (!d) return;
      setDeployOutput(d.output || '');
      if (d.done) {
        setDeployDone(true); setDeployOk(d.ok); setDeployRunning(false);
        clearInterval(deployPollRef.current);
      }
    }, 1500);
    return () => clearInterval(deployPollRef.current);
  }, [deployJobId, deployDone]);

  function startTestPoll(suite, jobId) {
    if (testPollRefs.current[suite]) clearInterval(testPollRefs.current[suite]);
    testPollRefs.current[suite] = setInterval(async () => {
      const d = await fetch(`/api/admin/job/${jobId}`).then(r => r.json()).catch(() => null);
      if (!d) return;
      setTestJobs(prev => ({ ...prev, [suite]: { ...prev[suite], output: d.output || '' } }));
      if (d.done) {
        setTestJobs(prev => ({ ...prev, [suite]: { ...prev[suite], done: true, ok: d.ok, running: false } }));
        clearInterval(testPollRefs.current[suite]);
      }
    }, 1500);
  }

  async function runHealthChecks() {
    setHealthLoading(true);
    const hd = await apiFetch('/api/admin/health').then(r => r.json()).catch(() => ({ checks: [] }));
    setHealthChecks(hd.checks || []);
    const endpoints = [
      { name: 'Transactions API', url: '/api/fin?months=1' },
      { name: 'Config API',       url: '/api/config' },
      { name: 'Accounts API',     url: '/api/plaid/accounts' },
      { name: 'Search API',       url: '/api/transactions/search?q=test' },
    ];
    const pings = await Promise.all(endpoints.map(async ({ name, url }) => {
      const t0 = performance.now();
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
        return { name, ok: r.ok, latency: Math.round(performance.now() - t0) };
      } catch {
        return { name, ok: false, latency: null };
      }
    }));
    setEndpointPings(pings);
    setHealthLoading(false);
  }

  async function triggerDeploy() {
    setDeployOutput(''); setDeployDone(false); setDeployOk(false); setDeployRunning(true);
    const d = await apiFetch('/api/admin/deploy', { method: 'POST' }).then(r => r.json());
    setDeployJobId(d.job_id);
  }

  async function triggerTest(suite) {
    setTestJobs(prev => ({ ...prev, [suite]: { jobId: null, output: '', done: false, ok: false, running: true } }));
    const d = await fetch(`/api/admin/test/${suite}`, { method: 'POST' }).then(r => r.json());
    setTestJobs(prev => ({ ...prev, [suite]: { ...prev[suite], jobId: d.job_id } }));
    startTestPoll(suite, d.job_id);
  }

  async function createUser() {
    if (!newUser || !newPass) return;
    const r = await apiFetch('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: newUser, password: newPass, is_admin: newAdmin }),
    });
    const d = await r.json();
    if (d.ok) {
      setUserMsg(`User "${newUser}" created.`);
      setNewUser(''); setNewPass(''); setNewAdmin(false);
      apiFetch('/api/auth/users').then(r => r.json()).then(d => setUsers(d.users || []));
    } else {
      setUserMsg(d.detail || 'Failed to create user.');
    }
    setTimeout(() => setUserMsg(''), 3000);
  }

  async function deleteUser(username) {
    if (!confirm(`Delete user "${username}"?`)) return;
    await fetch(`/api/auth/users/${username}`, { method: 'DELETE' });
    setUsers(u => u.filter(x => x.username !== username));
  }

  // ── Shared UI primitives ───────────────────────────────────────────────────

  const StatusDot = ({ ok }) => (
    <span style={{
      display: 'inline-block', width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
      marginRight: 9,
      background: ok == null ? 'var(--line-2)' : ok ? 'var(--accent)' : 'var(--terra)',
    }} />
  );

  const Pill = ({ ok, text }) => (
    <span style={{
      fontSize: 11, padding: '3px 9px', borderRadius: 999, fontWeight: 600, letterSpacing: '0.04em',
      background: ok
        ? 'color-mix(in srgb, var(--accent) 14%, transparent)'
        : 'color-mix(in srgb, var(--terra) 14%, transparent)',
      color: ok ? 'var(--accent)' : 'var(--terra)',
    }}>{text || (ok ? 'OK' : 'FAIL')}</span>
  );

  const Terminal = ({ output, done, ok }) => (
    <div style={{
      marginTop: 12, borderRadius: 12, overflow: 'hidden',
      border: '1px solid var(--line-2)',
    }}>
      <div style={{
        background: '#1a1a1a', padding: '10px 14px 0',
        display: 'flex', gap: 6, alignItems: 'center',
      }}>
        {['#ff5f57','#febc2e','#28c840'].map(c => (
          <span key={c} style={{ width: 10, height: 10, borderRadius: '50%', background: c, flexShrink: 0 }} />
        ))}
      </div>
      <div style={{
        background: '#1a1a1a', padding: '10px 16px 14px', fontFamily: 'var(--font-mono)', fontSize: 12,
        color: '#d4d4d4', whiteSpace: 'pre-wrap', maxHeight: 280, overflowY: 'auto', lineHeight: 1.65,
      }}>
        {output || '$ …'}
        {done && <div style={{ marginTop: 8, fontWeight: 700, color: ok ? '#4ade80' : '#f87171' }}>
          {ok ? '✓ exited 0' : '✗ exited non-zero'}
        </div>}
      </div>
    </div>
  );

  const Divider = () => (
    <div style={{ borderTop: '1px solid var(--line)', margin: '4px 0' }} />
  );

  const FieldLabel = ({ children }) => (
    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', marginBottom: 6,
      letterSpacing: '0.05em', textTransform: 'uppercase' }}>{children}</div>
  );

  const SectionHeading = ({ children }) => (
    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase',
      letterSpacing: '0.08em', marginBottom: 12 }}>{children}</div>
  );

  // ── Pages ──────────────────────────────────────────────────────────────────

  const pages = {
    status: (
      <div style={{ display: 'grid', gap: 28 }}>
        <div>
          <SectionHeading>API Endpoints</SectionHeading>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
            {endpointPings.length === 0 && healthLoading
              ? <div style={{ padding: '16px 20px', fontSize: 13, color: 'var(--ink-3)' }}>Checking…</div>
              : endpointPings.map(({ name, ok, latency }, i) => (
                <div key={name} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 20px', fontSize: 13,
                  borderTop: i > 0 ? '1px solid var(--line)' : 'none',
                }}>
                  <span style={{ display: 'flex', alignItems: 'center', color: 'var(--ink)' }}>
                    <StatusDot ok={ok} />{name}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {latency != null && <span style={{ color: 'var(--ink-3)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>{latency}ms</span>}
                    <Pill ok={ok} text={ok ? 'UP' : 'DOWN'} />
                  </span>
                </div>
              ))
            }
          </div>
        </div>

        <div>
          <SectionHeading>Subsystems</SectionHeading>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
            {healthChecks.map(({ name, ok, detail }, i) => (
              <div key={name} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 20px', fontSize: 13,
                borderTop: i > 0 ? '1px solid var(--line)' : 'none',
              }}>
                <span style={{ display: 'flex', alignItems: 'center', color: 'var(--ink)' }}>
                  <StatusDot ok={ok} />{name}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {detail && <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>{detail}</span>}
                  <Pill ok={ok} />
                </span>
              </div>
            ))}
          </div>
        </div>

        <button onClick={runHealthChecks} disabled={healthLoading}
          style={{ ...btnSecondary, opacity: healthLoading ? 0.5 : 1 }}>
          {healthLoading ? 'Checking…' : 'Refresh'}
        </button>
      </div>
    ),

    deploy: (
      <div style={{ display: 'grid', gap: 16 }}>
        <div style={{
          background: 'color-mix(in srgb, var(--terra) 8%, var(--surface))',
          border: '1px solid color-mix(in srgb, var(--terra) 25%, transparent)',
          borderRadius: 10, padding: '12px 16px', fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6,
        }}>
          <strong style={{ color: 'var(--terra)' }}>Heads up:</strong> This restarts the container (~10s downtime).
          Runs <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--surface-3)', padding: '1px 5px', borderRadius: 4 }}>git pull && docker compose up -d --build</code>.
        </div>
        <button onClick={triggerDeploy} disabled={deployRunning}
          style={{ ...btnPrimary, opacity: deployRunning ? 0.6 : 1 }}>
          {deployRunning ? 'Deploying…' : deployDone ? (deployOk ? '✓ Deployed — run again' : '✗ Failed — retry') : 'Deploy latest from GitHub'}
        </button>
        {(deployRunning || deployOutput) && <Terminal output={deployOutput} done={deployDone} ok={deployOk} />}
      </div>
    ),

    tests: (
      <div style={{ display: 'grid', gap: 20 }}>
        {SUITES.map(({ key, label, desc }) => {
          const job = testJobs[key] || {};
          const { running, done, ok, output } = job;
          const isPrimary = key === 'all';
          return (
            <div key={key} style={{
              background: 'var(--surface)', border: '1px solid var(--line)',
              borderRadius: 12, padding: '16px 20px', display: 'grid', gap: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{label}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3 }}>{desc}</div>
                </div>
                {done && <Pill ok={ok} text={ok ? 'PASSED' : 'FAILED'} />}
              </div>
              <button onClick={() => triggerTest(key)} disabled={running}
                style={{ ...(isPrimary ? btnPrimary : btnSecondary), opacity: running ? 0.6 : 1 }}>
                {running ? 'Running…' : done ? 'Run again' : `Run ${label}`}
              </button>
              {(running || output) && <Terminal output={output || ''} done={done} ok={ok} />}
            </div>
          );
        })}
      </div>
    ),

    ai: (
      <div style={{ display: 'grid', gap: 18 }}>
        <div>
          <FieldLabel>Preferred provider</FieldLabel>
          <div style={{ display: 'flex', gap: 10 }}>
            {['claude', 'gemini'].map(p => (
              <button key={p} onClick={() => setProvider(p)} style={{
                flex: 1, padding: '10px 0', borderRadius: 10, fontSize: 14, fontFamily: 'inherit',
                cursor: 'pointer', fontWeight: 500, transition: 'all 0.15s',
                border: provider === p ? '2px solid var(--accent)' : '1px solid var(--line-2)',
                background: provider === p ? 'color-mix(in srgb, var(--accent) 10%, var(--surface))' : 'var(--surface)',
                color: provider === p ? 'var(--accent)' : 'var(--ink-2)',
              }}>
                {p === 'claude' ? 'Claude (Anthropic)' : 'Gemini (Google)'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <FieldLabel>
            <StatusDot ok={cfg?.has_gemini} />
            Gemini API key {cfg?.has_gemini ? '(saved)' : '(not set)'}
          </FieldLabel>
          <input type="password" value={geminiKey} onChange={e => setGeminiKey(e.target.value)}
            placeholder="AIza…" style={input} />
        </div>

        <div>
          <FieldLabel>
            <StatusDot ok={cfg?.has_anthropic} />
            Anthropic API key {cfg?.has_anthropic ? '(saved)' : '(not set)'}
          </FieldLabel>
          <input type="password" value={claudeKey} onChange={e => setClaudeKey(e.target.value)}
            placeholder="sk-ant-…" style={input} />
        </div>

        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16, display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Notification Sender (Admin)
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
            The MoneyTalks Gmail account that sends alerts to all users.
          </div>
          <div>
            <FieldLabel>From Email (MoneyTalks Gmail)</FieldLabel>
            <input type="email" value={cfg?.alert_from_email || ''} onChange={e => setCfg(p => ({ ...p, alert_from_email: e.target.value }))}
              placeholder="moneytalks.alerts@gmail.com" style={input} />
          </div>
          <div>
            <FieldLabel>Gmail App Password</FieldLabel>
            <input type="password" placeholder="xxxx xxxx xxxx xxxx"
              onChange={e => setCfg(p => ({ ...p, _new_smtp_pass: e.target.value }))}
              style={input} />
          </div>
        </div>

        <button onClick={async () => {
          setSaving(true); setSaved(false);
          const body = { preferred_provider: provider };
          if (geminiKey) body.gemini_api_key    = geminiKey;
          if (claudeKey) body.anthropic_api_key = claudeKey;
          if (cfg?.alert_from_email) body.alert_from_email = cfg.alert_from_email;
          if (cfg?._new_smtp_pass)   body.alert_smtp_password = cfg._new_smtp_pass;
          await apiFetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          const d = await apiFetch('/api/config').then(r => r.json());
          setCfg(d); setGeminiKey(''); setClaudeKey('');
          setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2500);
        }} disabled={saving}
          style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
        </button>
      </div>
    ),

    users: (
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
          {users.map((u, i) => (
            <div key={u.username} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '13px 20px', fontSize: 14,
              borderTop: i > 0 ? '1px solid var(--line)' : 'none',
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontWeight: 500, color: 'var(--ink)' }}>{u.username}</span>
                {u.is_admin && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.06em',
                    background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                    borderRadius: 999, padding: '2px 8px', textTransform: 'uppercase',
                  }}>Admin</span>
                )}
              </span>
              {!u.is_admin && (
                <button onClick={() => deleteUser(u.username)} style={btnDanger}>Delete</button>
              )}
            </div>
          ))}
        </div>

        <div style={{
          background: 'var(--surface)', border: '1px solid var(--line)',
          borderRadius: 12, padding: '20px', display: 'grid', gap: 14,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Add user</div>
          <div style={{ display: 'grid', gap: 10 }}>
            <input type="text" value={newUser} onChange={e => setNewUser(e.target.value)}
              placeholder="Username" style={input} />
            <input type="password" value={newPass} onChange={e => setNewPass(e.target.value)}
              placeholder="Password" style={input} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, color: 'var(--ink-2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={newAdmin} onChange={e => setNewAdmin(e.target.checked)} />
            Make admin
          </label>
          <button onClick={createUser} style={btnPrimary}>Create user</button>
          {userMsg && <div style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 500 }}>{userMsg}</div>}
        </div>
      </div>
    ),

    feedback: (
      <div style={{ display: 'grid', gap: 12 }}>
        {feedback.length === 0
          ? <div style={{ fontSize: 14, color: 'var(--ink-3)', padding: '20px 0' }}>No feedback yet.</div>
          : [...feedback].reverse().map(entry => (
            <div key={entry.id} style={{
              background: 'var(--surface)', border: '1px solid var(--line)',
              borderRadius: 12, padding: '16px 20px', display: 'grid', gap: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                  {entry.display_name || entry.username}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {entry.category && entry.category !== 'general' && (
                    <span style={{
                      fontSize: 11, padding: '2px 9px', borderRadius: 999, fontWeight: 600,
                      background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                      color: 'var(--accent)',
                    }}>{entry.category}</span>
                  )}
                  <span style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
                    {new Date(entry.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </span>
              </div>
              <div style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6 }}>{entry.message}</div>
            </div>
          ))
        }
      </div>
    ),
    logs: (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <button onClick={() => {
            setLogsLoading(true);
            apiFetch('/api/admin/logs?lines=300').then(r => r.json()).then(d => {
              setLogs(d.lines || []); setLogsLoading(false);
            }).catch(() => setLogsLoading(false));
          }} style={{
            padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            background: 'var(--surface-3)', border: '1px solid var(--line)', color: 'var(--ink)',
          }}>↻ Refresh</button>
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Last 300 lines of server.log</span>
        </div>
        {logsLoading
          ? <div style={{ fontSize: 14, color: 'var(--ink-3)' }}>Loading…</div>
          : <div style={{
              background: '#0d0d0d', borderRadius: 10, padding: '14px 16px',
              fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.7,
              overflowX: 'auto', maxHeight: '65vh', overflowY: 'auto',
            }}>
              {logs.length === 0
                ? <span style={{ color: '#666' }}>No log entries.</span>
                : logs.map((line, i) => {
                    const color = line.includes('ERROR') || line.includes('CRITICAL') ? '#ff6b6b'
                                : line.includes('WARNING') ? '#ffd93d'
                                : line.includes('SLOW') ? '#ff9f43'
                                : '#a8d8a8';
                    return <div key={i} style={{ color, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{line}</div>;
                  })
              }
            </div>
        }
      </div>
    ),
  };

  const currentNav = NAV.find(n => n.key === page);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '210px 1fr', minHeight: '100vh' }}>

      {/* Sidebar */}
      <div style={{
        borderRight: '1px solid var(--line)', padding: '28px 12px',
        background: 'var(--surface)', display: 'flex', flexDirection: 'column', gap: 2,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase',
          letterSpacing: '0.08em', padding: '0 12px', marginBottom: 12,
        }}>Admin</div>
        {NAV.map(({ key, label, icon }) => {
          const active = page === key;
          return (
            <button key={key} onClick={() => setPage(key)} style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
              padding: '9px 12px', borderRadius: 9, border: 'none', fontFamily: 'inherit',
              fontSize: 13.5, cursor: 'pointer', transition: 'background 0.12s',
              fontWeight: active ? 600 : 400,
              background: active ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
              color: active ? 'var(--accent)' : 'var(--ink-2)',
            }}>
              <span style={{ fontSize: 11, opacity: active ? 1 : 0.5, width: 14, textAlign: 'center' }}>{icon}</span>
              {label}
            </button>
          );
        })}
      </div>

      {/* Main content */}
      <div style={{ padding: '36px 44px', overflowY: 'auto', background: 'var(--bg)' }}>
        <div style={{ maxWidth: 580 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', marginBottom: 28, letterSpacing: '-0.01em' }}>
            {currentNav?.label}
          </div>
          {pages[page]}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// PerformancePanel — statement-based portfolio analytics
// ═══════════════════════════════════════════════════════════════════

function PerformancePanel() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    apiFetch('/api/portfolio/performance')
      .then(r => r && r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)', fontSize: 14 }}>Analyzing statements…</div>;
  if (error)   return <div style={{ padding: 40, textAlign: 'center', color: 'var(--terra)', fontSize: 14 }}>{error}</div>;
  if (!data?.ok) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--terra)', fontSize: 14 }}>{data?.error || 'Could not load performance data.'}</div>;

  const perf         = data.performance || {};
  const monthly      = perf.monthly_returns || [];
  const deposits     = data.all_deposits || [];
  const balances     = data.balances || [];

  const totalInvested   = data.total_invested || 0;
  const cashDeposited   = data.total_deposits || 0;
  const transferIn      = data.transfer_in || 0;
  const currentValue    = data.current_value || 0;
  const totalFees       = data.total_fees || 0;
  const trueGain        = currentValue - totalInvested;
  const trueGainPct     = totalInvested > 0 ? (trueGain / totalInvested) * 100 : 0;

  // Quarterly buckets from monthly balances
  const quarters = {};
  balances.forEach((b, i) => {
    const [year, mon] = b.month.split('-').map(Number);
    const q = `${year} Q${Math.ceil(mon / 3)}`;
    quarters[q] = { end: b.value, label: q };
    if (i === 0) quarters[q].start = balances[0].value;
    else {
      const prevQ = quarters[q].start == null ? balances[i - 1].value : quarters[q].start;
      if (quarters[q].start == null) quarters[q].start = prevQ;
    }
  });
  // Compute quarter start properly: first balance of the quarter
  const qKeys = [];
  const qMap = {};
  balances.forEach((b, i) => {
    const [year, mon] = b.month.split('-').map(Number);
    const q = `${year} Q${Math.ceil(mon / 3)}`;
    if (!qMap[q]) { qMap[q] = { start: i > 0 ? balances[i-1].value : 0, end: b.value, label: q }; qKeys.push(q); }
    qMap[q].end = b.value;
  });
  const quarterList = qKeys.map(k => {
    const { start, end, label } = qMap[k];
    const gain = end - start;
    const pct  = start > 0 ? (gain / start) * 100 : 0;
    return { label, end, gain, pct };
  }).filter(q => q.end > 0);

  // SPY benchmark TWR for display
  const twrPort = perf.twr_portfolio;
  const twrSpy  = perf.twr_spy;
  const beta     = perf.beta;
  const alpha    = perf.alpha;
  const rSq      = perf.r_squared;

  // Monthly return bars — last 12 months
  const recentMonthly = monthly.slice(-12);
  const maxAbsReturn  = Math.max(...recentMonthly.map(m => Math.max(Math.abs(m.portfolio), Math.abs(m.spy || 0))), 1);

  const StatCard = ({ label, value, sub, positive, negative, small }) => (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{label}</div>
      <div style={{
        fontSize: small ? 18 : 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
        color: positive ? 'var(--accent)' : negative ? 'var(--terra)' : 'var(--ink)',
      }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Summary cards row 1 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        <StatCard label="Portfolio Value"    value={fmtMoney(currentValue)} />
        <StatCard label="Cash Deposited"     value={fmtMoney(cashDeposited)} sub={`${deposits.length} ACH deposits`} />
        <StatCard label="Transferred In"     value={fmtMoney(transferIn)}   sub="E*Trade stocks (May 2024)" />
        <StatCard label="Total Fees Paid"    value={`$${totalFees.toFixed(2)}`} sub={`0.25%/yr · ${data.statement_count} months`} negative />
      </div>

      {/* Summary cards row 2 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        <StatCard label="Total Invested"     value={fmtMoney(totalInvested)} sub="Cash + transfer-in" />
        <StatCard label="True Gain"
          value={`${trueGain >= 0 ? '+' : '−'}${fmtMoney(Math.abs(trueGain))}`}
          sub={`${trueGainPct >= 0 ? '+' : ''}${trueGainPct.toFixed(1)}% on total invested`}
          positive={trueGain > 0} negative={trueGain < 0} />
        <StatCard label="Your TWR"
          value={twrPort != null ? `${twrPort >= 0 ? '+' : ''}${twrPort.toFixed(1)}%` : '—'}
          sub="Time-weighted return" positive={twrPort > 0} negative={twrPort < 0} />
        <StatCard label="SPY (benchmark)"
          value={twrSpy != null ? `${twrSpy >= 0 ? '+' : ''}${twrSpy.toFixed(1)}%` : '—'}
          sub="Same period"
          positive={twrSpy > 0} negative={twrSpy < 0} />
      </div>

      {/* Beta / Alpha badges */}
      {(beta != null || alpha != null) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          {beta != null && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Beta vs SPY</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: beta < 1 ? 'var(--accent)' : 'var(--terra)', fontVariantNumeric: 'tabular-nums' }}>{beta.toFixed(2)}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.5 }}>
                {beta < 0.8 ? 'Much less volatile than the market — your portfolio moves more gently than SPY.'
                : beta < 1.0 ? 'Slightly less volatile than SPY — good for capital preservation.'
                : beta < 1.2 ? 'Moves roughly in step with the market.'
                : 'More volatile than SPY — bigger swings both up and down.'}
              </div>
            </div>
          )}
          {alpha != null && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Alpha (annualized)</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: alpha >= 0 ? 'var(--accent)' : 'var(--terra)', fontVariantNumeric: 'tabular-nums' }}>{alpha >= 0 ? '+' : ''}{alpha.toFixed(2)}%</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.5 }}>
                {alpha >= 1 ? `Outperforming SPY by ~${alpha.toFixed(1)}%/yr after adjusting for market moves.`
                : alpha >= 0 ? 'Roughly matching the market on a risk-adjusted basis.'
                : `Underperforming SPY by ~${Math.abs(alpha).toFixed(1)}%/yr after adjusting for market moves.`}
              </div>
            </div>
          )}
          {rSq != null && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>R² (vs SPY)</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{(rSq * 100).toFixed(0)}%</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.5 }}>
                {rSq > 0.9 ? 'Moves almost entirely with SPY — highly correlated.'
                : rSq > 0.7 ? 'Mostly tracks SPY with some independent variation.'
                : 'Meaningful portion of your return is independent of the market.'}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Monthly returns chart */}
      {recentMonthly.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: '20px 24px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>Monthly Returns — Last 12 Months vs SPY</div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 16 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginRight: 16 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--accent)', display: 'inline-block' }} /> Your portfolio
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: '#94a3b8', display: 'inline-block' }} /> SPY
            </span>
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 120 }}>
            {recentMonthly.map((m, i) => {
              const portH = Math.max(2, Math.abs(m.portfolio) / maxAbsReturn * 55);
              const spyH  = m.spy != null ? Math.max(2, Math.abs(m.spy) / maxAbsReturn * 55) : 0;
              const portPos = m.portfolio >= 0;
              const spyPos  = (m.spy || 0) >= 0;
              return (
                <div key={m.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  {/* positive bars above midline */}
                  <div style={{ height: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 2 }}>
                    <div style={{ width: 6, height: portPos ? portH : 0, background: 'var(--accent)', borderRadius: '2px 2px 0 0' }} />
                    <div style={{ width: 6, height: spyPos && m.spy != null ? spyH : 0, background: '#94a3b8', borderRadius: '2px 2px 0 0' }} />
                  </div>
                  {/* zero line */}
                  <div style={{ width: '100%', height: 1, background: 'var(--line)' }} />
                  {/* negative bars below midline */}
                  <div style={{ height: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 2 }}>
                    <div style={{ width: 6, height: !portPos ? portH : 0, background: 'var(--terra)', borderRadius: '0 0 2px 2px' }} />
                    <div style={{ width: 6, height: !spyPos && m.spy != null ? spyH : 0, background: '#f87171', borderRadius: '0 0 2px 2px' }} />
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--ink-3)', marginTop: 2 }}>{m.month.slice(5)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Quarterly growth */}
      {quarterList.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)', fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
            Quarterly Portfolio Growth
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface-3)' }}>
                {['Quarter', 'End Value', 'Gain / Loss', 'Return'].map(h => (
                  <th key={h} style={{ padding: '10px 20px', textAlign: h === 'Quarter' ? 'left' : 'right', fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {quarterList.map((q, i) => (
                <tr key={q.label} style={{ borderTop: i > 0 ? '1px solid var(--line)' : 'none' }}>
                  <td style={{ padding: '12px 20px', fontWeight: 600, color: 'var(--ink)' }}>{q.label}</td>
                  <td style={{ padding: '12px 20px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--ink-2)' }}>{fmtMoney(q.end)}</td>
                  <td style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: q.gain >= 0 ? 'var(--accent)' : 'var(--terra)' }}>
                    {q.gain >= 0 ? '+' : '−'}{fmtMoney(Math.abs(q.gain))}
                  </td>
                  <td style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: q.pct >= 0 ? 'var(--accent)' : 'var(--terra)' }}>
                    {q.pct >= 0 ? '+' : ''}{q.pct.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Cash contributions timeline */}
      {deposits.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>Cash Deposit History</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Total: {fmtMoney(cashDeposited)}</div>
          </div>
          {deposits.map((d, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 24px', borderTop: i > 0 ? '1px solid var(--line)' : 'none' }}>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', width: 100, flexShrink: 0 }}>{d.date}</div>
              <div style={{ flex: 1, height: 6, background: 'var(--line)', borderRadius: 99 }}>
                <div style={{ height: 6, borderRadius: 99, background: 'var(--accent)', width: `${(d.amount / cashDeposited) * 100}%` }} />
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', minWidth: 80, textAlign: 'right' }}>{fmtMoney(d.amount)}</div>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}

// InvestmentsTab — portfolio overview (mock data, real API coming soon)
// ═══════════════════════════════════════════════════════════════════


const ASSET_COLORS = {
  'Equities':    '#5ec98a',
  'ETF':         '#67e8f9',
  'Mutual Fund': '#38bdf8',
  'Bonds':       '#a78bfa',
  'Cash':        '#94a3b8',
  'Crypto':      '#fbbf24',
  'Real Estate': '#f97316',
  'Derivatives': '#f43f5e',
  'Other':       '#6b7280',
};

function AllocationDonut({ slices, total }) {
  // slices = [{label, value, color}]
  let cumPct = 0;
  const parts = slices.map(s => {
    const pct = (s.value / total) * 100;
    const start = cumPct;
    cumPct += pct;
    return `${s.color} ${start.toFixed(1)}% ${cumPct.toFixed(1)}%`;
  });
  return (
    <div style={{ position: 'relative', width: 160, height: 160, flexShrink: 0 }}>
      <div style={{
        width: 160, height: 160, borderRadius: '50%',
        background: `conic-gradient(${parts.join(', ')})`,
      }} />
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 88, height: 88, borderRadius: '50%',
        background: 'var(--surface)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(total)}</div>
      </div>
    </div>
  );
}

function InvestmentsTab() {
  const [invData, setInvData]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error,   setError]     = useState(null);

  useEffect(() => {
    apiFetch('/api/investments')
      .then(r => r && r.json())
      .then(d => { if (d) { setInvData(d); setLoading(false); } })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, []);

  const [invTab, setInvTab] = useState('holdings');
  const [hoveredBar, setHoveredBar] = useState(null);
  const [holdingSort, setHoldingSort] = useState({ col: 'value', dir: 'desc' });
  function toggleHoldingSort(col) {
    setHoldingSort(prev => prev.col === col
      ? { col, dir: prev.dir === 'desc' ? 'asc' : 'desc' }
      : { col, dir: 'desc' });
  }
  const SortIcon = ({ col }) => (
    holdingSort.col === col
      ? <span style={{ fontSize: 10, color: 'var(--accent)' }}>{holdingSort.dir === 'desc' ? '↓' : '↑'}</span>
      : <span style={{ fontSize: 10, opacity: 0.3 }}>↕</span>
  );

  const txnTypeLabel = (type, subtype) => {
    if (type === 'cash') return subtype || 'cash';
    return type;
  };
  const txnTypeStyle = (type) => {
    const map = {
      cash:     { bg: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--accent)' },
      buy:      { bg: 'color-mix(in srgb, #67e8f9 15%, transparent)',        color: '#22d3ee' },
      sell:     { bg: 'color-mix(in srgb, var(--terra) 12%, transparent)',   color: 'var(--terra)' },
      dividend: { bg: 'color-mix(in srgb, #fbbf24 15%, transparent)',        color: '#d97706' },
      fee:      { bg: 'color-mix(in srgb, var(--terra) 10%, transparent)',   color: 'var(--terra)' },
      transfer: { bg: 'color-mix(in srgb, var(--ink-4) 15%, transparent)',   color: 'var(--ink-3)' },
    };
    return map[type] || map.transfer;
  };

  if (loading) return (
    <div className="tab-body">
      {/* Summary cards skeleton */}
      <div className="grid-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="card" style={{ padding: 20 }}>
            <div className="skeleton" style={{ height: 11, width: 80, borderRadius: 4, marginBottom: 10 }} />
            <div className="skeleton" style={{ height: 26, width: 100, borderRadius: 5, marginBottom: 6 }} />
            <div className="skeleton" style={{ height: 11, width: 60, borderRadius: 4 }} />
          </div>
        ))}
      </div>
      {/* Holdings table skeleton */}
      <div className="card">
        <div className="card-head">
          <div className="skeleton" style={{ height: 16, width: 80, borderRadius: 4 }} />
        </div>
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
            <div className="skeleton" style={{ height: 32, width: 32, borderRadius: '50%', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div className="skeleton" style={{ height: 14, width: '40%', borderRadius: 4, marginBottom: 5 }} />
              <div className="skeleton" style={{ height: 11, width: '25%', borderRadius: 4 }} />
            </div>
            <div className="skeleton" style={{ height: 14, width: 72, borderRadius: 4 }} />
            <div className="skeleton" style={{ height: 14, width: 56, borderRadius: 4 }} />
          </div>
        ))}
      </div>
    </div>
  );
  if (error) return (
    <div style={{ padding: 48, textAlign: 'center', color: 'var(--terra)', fontSize: 14 }}>
      Failed to load: {error}
    </div>
  );
  if (!invData?.configured) return (
    <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-3)', fontSize: 14 }}>
      Connect a Plaid account in Settings to see investments.
    </div>
  );

  const holdings     = invData.holdings     || [];
  const transactions = invData.transactions || [];
  const snapshots    = invData.snapshots    || [];

  const thisYear   = new Date().getFullYear().toString();
  const totalValue = holdings.reduce((s, h) => s + h.value, 0);
  const totalCost  = holdings.reduce((s, h) => s + (h.cost_basis ?? 0), 0);
  const knownCost  = holdings.some(h => h.cost_basis != null);
  const totalGain  = knownCost ? totalValue - totalCost : null;
  const totalGainPct = (totalGain != null && totalCost > 0) ? (totalGain / totalCost) * 100 : null;
  // Real cash deposits have price < 0 (Plaid encodes them as 1 share @ -depositAmount).
  // Small positive-price cash/deposit entries are dividend reinvestments — exclude from contributions.
  const ytdContribs  = transactions.filter(t => t.type === 'cash' && t.price < 0 && t.date.startsWith(thisYear)).reduce((s, t) => s + Math.abs(t.amount), 0);
  const ytdDividends = transactions.filter(t => (t.type === 'dividend' || (t.type === 'cash' && t.price > 0 && t.amount < 0)) && t.date.startsWith(thisYear)).reduce((s, t) => s + Math.abs(t.amount), 0);

  // Asset allocation
  const byClass = {};
  holdings.forEach(h => { byClass[h.asset_class] = (byClass[h.asset_class] || 0) + h.value; });
  const allocSlices = Object.entries(byClass).map(([label, value]) => ({
    label, value, color: ASSET_COLORS[label] || '#94a3b8',
  })).sort((a, b) => b.value - a.value);

  // Monthly portfolio value chart — one point per month (latest snapshot in each month)
  const monthlyMap = {};
  snapshots.forEach(s => {
    const m = s.date.slice(0, 7); // "2026-05"
    monthlyMap[m] = s.value;       // last entry per month wins (sorted asc)
  });
  const monthlyValues = Object.entries(monthlyMap).sort(([a], [b]) => a.localeCompare(b));
  const maxMonthly    = Math.max(...monthlyValues.map(([, v]) => v), 1);

  const sortedHoldings = [...holdings].sort((a, b) => {
    const gainA = a.cost_basis != null ? a.value - a.cost_basis : 0;
    const gainB = b.cost_basis != null ? b.value - b.cost_basis : 0;
    const v = holdingSort.col === 'value'   ? b.value - a.value
            : holdingSort.col === 'gain'    ? gainB - gainA
            : holdingSort.col === 'gainPct' ? (b.cost_basis > 0 ? gainB / b.cost_basis : 0) - (a.cost_basis > 0 ? gainA / a.cost_basis : 0)
            : 0;
    return holdingSort.dir === 'desc' ? v : -v;
  });

  return (
    <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 24 }}>

      {invData.errors?.length > 0 && (
        <div style={{
          background: 'color-mix(in srgb, var(--terra) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--terra) 30%, transparent)',
          borderRadius: 10, padding: '10px 16px', fontSize: 13, color: 'var(--terra)',
        }}>
          {invData.errors.join(' · ')}
        </div>
      )}

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        {[
          { label: 'Portfolio Value',   value: fmtMoney(totalValue),                               sub: null },
          { label: 'Unrealized Gain',   value: totalGain != null ? fmtMoney(Math.abs(totalGain)) : '—',
            sub: totalGainPct != null ? `${totalGain >= 0 ? '+' : '−'}${Math.abs(totalGainPct).toFixed(1)}% all time` : 'Cost basis unavailable',
            positive: totalGain > 0, negative: totalGain < 0 },
          { label: 'YTD Contributions', value: fmtMoney(ytdContribs),  sub: thisYear },
          { label: 'YTD Dividends',     value: fmtMoney(ytdDividends), sub: thisYear },
        ].map(({ label, value, sub, positive, negative }) => (
          <div key={label} style={{
            background: 'var(--surface)', border: '1px solid var(--line)',
            borderRadius: 14, padding: '18px 20px',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{label}</div>
            <div style={{
              fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
              color: positive ? 'var(--accent)' : negative ? 'var(--terra)' : 'var(--ink)',
            }}>{value}</div>
            {sub && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>{sub}</div>}
          </div>
        ))}
      </div>

      {/* Allocation + Portfolio value chart */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

        {/* Asset Allocation */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: '20px 24px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 16 }}>Asset Allocation</div>
          {allocSlices.length > 0 ? (
            <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
              <AllocationDonut slices={allocSlices} total={totalValue} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                {allocSlices.map(({ label, value, color }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 3, background: color, flexShrink: 0 }} />
                    <div style={{ fontSize: 12, color: 'var(--ink-2)', flex: 1 }}>{label}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                      {((value / totalValue) * 100).toFixed(0)}%
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>No holdings data</div>}
        </div>

        {/* Portfolio value over time */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: '20px 24px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>Portfolio Value Over Time</div>
          {monthlyValues.length < 2 ? (
            <div style={{ color: 'var(--ink-3)', fontSize: 12, marginTop: 12 }}>
              History builds as you visit this tab over time. Check back next month.
            </div>
          ) : (
            <>
              <div style={{ position: 'relative' }}>
                {hoveredBar && (
                  <div style={{
                    position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
                    background: 'var(--surface-2)', border: '1px solid var(--line)',
                    borderRadius: 8, padding: '6px 12px', fontSize: 12, color: 'var(--ink)',
                    pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 10,
                  }}>
                    <span style={{ color: 'var(--ink-3)', marginRight: 6 }}>{hoveredBar.month}</span>
                    <span style={{ fontWeight: 700 }}>{fmtMoney(hoveredBar.value)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 100, marginTop: 36 }}>
                  {monthlyValues.map(([month, value]) => (
                    <div key={month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'pointer' }}
                      onMouseEnter={() => setHoveredBar({ month, value })}
                      onMouseLeave={() => setHoveredBar(null)}
                    >
                      <div style={{
                        width: '100%', borderRadius: 4,
                        background: hoveredBar?.month === month
                          ? 'var(--accent)'
                          : 'color-mix(in srgb, var(--accent) 70%, transparent)',
                        height: `${Math.max(4, (value / maxMonthly) * 80)}px`,
                        transition: 'background 0.1s',
                      }} />
                      <div style={{ fontSize: 9, color: hoveredBar?.month === month ? 'var(--ink)' : 'var(--ink-4)' }}>{month.slice(5)}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 11, color: 'var(--ink-3)' }}>
                <span>{fmtMoney(monthlyValues[0][1])}</span>
                {monthlyValues.length >= 2 && (() => {
                  const delta = monthlyValues[monthlyValues.length - 1][1] - monthlyValues[0][1];
                  const pct   = (delta / monthlyValues[0][1]) * 100;
                  return <span style={{ color: delta >= 0 ? 'var(--accent)' : 'var(--terra)', fontWeight: 600 }}>
                    {delta >= 0 ? '+' : '−'}{fmtMoney(Math.abs(delta))} ({pct >= 0 ? '+' : ''}{pct.toFixed(1)}%)
                  </span>;
                })()}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, padding: 4, alignSelf: 'flex-start' }}>
        {[['holdings', `Holdings (${holdings.length})`], ['transactions', `Transactions (${transactions.length})`], ['performance', 'Performance']].map(([key, label]) => (
          <button key={key} onClick={() => setInvTab(key)} style={{
            padding: '6px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            background: invTab === key ? 'var(--accent)' : 'transparent',
            color: invTab === key ? '#fff' : 'var(--ink-3)',
          }}>{label}</button>
        ))}
      </div>

      {/* Holdings table */}
      {invTab === 'holdings' && holdings.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>Holdings</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{holdings.length} positions</div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--surface-3)' }}>
                  {[
                    { label: 'Ticker',      col: null,       align: 'left'  },
                    { label: 'Asset Class', col: null,       align: 'left'  },
                    { label: 'Account',     col: null,       align: 'left'  },
                    { label: 'Shares',      col: null,       align: 'right' },
                    { label: 'Price',       col: null,       align: 'right' },
                    { label: 'Value',       col: 'value',    align: 'right' },
                    { label: 'Gain/Loss',   col: 'gain',     align: 'right' },
                    { label: '% Return',    col: 'gainPct',  align: 'right' },
                  ].map(({ label, col, align }) => (
                    <th key={label} onClick={() => col && toggleHoldingSort(col)} style={{
                      padding: '10px 16px', textAlign: align, fontWeight: 600,
                      fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em',
                      cursor: col ? 'pointer' : 'default', whiteSpace: 'nowrap',
                    }}>
                      {label} {col && <SortIcon col={col} />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedHoldings.map((h, i) => {
                  const hasCost  = h.cost_basis != null;
                  const gain     = hasCost ? h.value - h.cost_basis : null;
                  const gainPct  = (hasCost && h.cost_basis > 0) ? (gain / h.cost_basis) * 100 : null;
                  const isPos    = gain >= 0;
                  const color    = ASSET_COLORS[h.asset_class] || '#94a3b8';
                  return (
                    <tr key={i} style={{ borderTop: i > 0 ? '1px solid var(--line)' : 'none' }}>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontWeight: 700, color: 'var(--ink)' }}>{h.ticker}</div>
                        <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{h.name}</div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{
                          fontSize: 11, padding: '2px 8px', borderRadius: 99, fontWeight: 600,
                          background: `${color}22`, color,
                        }}>{h.asset_class}</span>
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--ink-3)' }}>{h.account}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}>
                        {h.shares ? h.shares.toFixed(3) : '—'}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}>
                        {h.price ? `$${h.price.toFixed(2)}` : '—'}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtMoney(h.value)}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: gain == null ? 'var(--ink-3)' : isPos ? 'var(--accent)' : 'var(--terra)' }}>
                        {gain == null ? '—' : `${isPos ? '+' : '−'}${fmtMoney(Math.abs(gain))}`}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: gainPct == null ? 'var(--ink-3)' : isPos ? 'var(--accent)' : 'var(--terra)' }}>
                        {gainPct == null ? '—' : `${isPos ? '+' : ''}${gainPct.toFixed(1)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {invTab === 'holdings' && holdings.length === 0 && (
        <div style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 32 }}>No holdings data — re-link your investment accounts in Settings.</div>
      )}

      {/* Investment transactions */}
      {invTab === 'transactions' && transactions.length === 0 && (
        <div style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 32 }}>No investment transactions found.</div>
      )}

      {invTab === 'performance' && <PerformancePanel />}

      {invTab === 'transactions' && transactions.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>Transaction History</div>
          </div>
          <div>
            {transactions.map((t, i) => {
              const style = txnTypeStyle(t.type);
              const label = txnTypeLabel(t.type, t.subtype);
              const isSell = t.type === 'sell' || (t.type === 'cash' && t.amount > 0);
              return (
                <div key={t.id || i} style={{
                  display: 'flex', alignItems: 'center', gap: 16,
                  padding: '12px 24px', borderTop: i > 0 ? '1px solid var(--line)' : 'none',
                }}>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums', width: 80, flexShrink: 0 }}>
                    {t.date.slice(5)}
                  </div>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 99,
                    background: style.bg, color: style.color, textTransform: 'capitalize',
                    flexShrink: 0, width: 100, textAlign: 'center',
                  }}>{label}</span>
                  <div style={{ flex: 1, fontSize: 13, color: 'var(--ink-2)' }}>{t.name}</div>
                  {t.shares != null && t.price != null && (
                    <div style={{ fontSize: 12, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>
                      {Math.abs(t.shares).toFixed(3)} sh @ ${t.price.toFixed(2)}
                    </div>
                  )}
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', textAlign: 'right', minWidth: 80 }}>
                    {isSell ? '−' : '+'}{fmtMoney(Math.abs(t.amount))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TRIPS TAB
// ═══════════════════════════════════════════════════════════════════
function TripsTab({ refreshFin, finVersion }) {
  const [trips, setTrips]       = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm]         = useState({ name: '', start_date: '', end_date: '', budget: '' });
  const [saving, setSaving]     = useState(false);
  const [saveMsg, setSaveMsg]   = useState(null);
  const [selectedCat, setSelectedCat] = useState(null);
  const [sortBy, setSortBy]     = useState('date');
  const [addSearch, setAddSearch] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [editSaving, setEditSaving] = useState(false);
  const [editMsg, setEditMsg]   = useState(null);

  function loadTrips() {
    apiFetch('/api/trips').then(r => r.json()).then(d => setTrips(d.trips || []));
  }
  useEffect(() => { loadTrips(); }, [finVersion]);

  const selectedTrip = trips.find(t => t.id === selectedId);

  // Derive trip transactions client-side from window.FIN.TRANSACTIONS
  const tripTxns = useMemo(() => {
    if (!selectedId) return [];
    return TRANSACTIONS.filter(t =>
      (t.tags || '').split(',').map(s => s.trim()).includes(`trip:${selectedId}`)
    );
  }, [selectedId, finVersion]);

  const expenses = useMemo(() => tripTxns.filter(t => t.amount < 0), [tripTxns]);
  const totalSpent = useMemo(() => expenses.reduce((s, t) => s - t.amount, 0), [expenses]);

  const catBreakdown = useMemo(() => {
    const map = {};
    expenses.forEach(t => {
      const c = catById(t.category);
      if (!map[t.category]) map[t.category] = { cat: t.category, name: c.name, color: c.color, amount: 0 };
      map[t.category].amount -= t.amount;
    });
    return Object.values(map).sort((a, b) => b.amount - a.amount);
  }, [expenses]);

  const dailyBreakdown = useMemo(() => {
    const map = {};
    expenses.forEach(t => {
      const d = (t.date || '').slice(0, 10);
      if (d) map[d] = (map[d] || 0) - t.amount;
    });
    return Object.entries(map).map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [expenses]);

  const topMerchants = useMemo(() => {
    const map = {};
    expenses.forEach(t => {
      const m = t.merchant || t.description || 'Unknown';
      if (!map[m]) map[m] = { name: m, amount: 0, count: 0 };
      map[m].amount -= t.amount;
      map[m].count++;
    });
    return Object.values(map).sort((a, b) => b.amount - a.amount).slice(0, 5);
  }, [expenses]);

  const displayTxns = useMemo(() => {
    const arr = selectedCat ? tripTxns.filter(t => t.category === selectedCat) : [...tripTxns];
    if (sortBy === 'amount') return arr.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    return arr.sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [tripTxns, selectedCat, sortBy]);

  const addCandidates = useMemo(() => {
    if (!selectedId || !addSearch.trim()) return [];
    const q = addSearch.toLowerCase();
    return TRANSACTIONS
      .filter(t => !(t.tags || '').split(',').map(s => s.trim()).includes(`trip:${selectedId}`))
      .filter(t => (t.merchant || t.description || '').toLowerCase().includes(q))
      .slice(0, 20);
  }, [selectedId, addSearch, finVersion]);

  async function createTrip() {
    if (!form.name || !form.start_date || !form.end_date) return;
    setSaving(true); setSaveMsg(null);
    const res = await apiFetch('/api/trips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.name, start_date: form.start_date, end_date: form.end_date,
        budget: form.budget ? parseFloat(form.budget) : null }),
    });
    const data = await res.json();
    setSaving(false);
    if (res.ok) {
      setSaveMsg(`Created! ${data.auto_tagged} transaction${data.auto_tagged !== 1 ? 's' : ''} auto-tagged.`);
      setForm({ name: '', start_date: '', end_date: '', budget: '' });
      setCreating(false);
      if (refreshFin) refreshFin();
    } else {
      setSaveMsg(`Error: ${data.detail || 'Failed'}`);
    }
  }

  async function removeFromTrip(txnId) {
    await apiFetch(`/api/trips/${selectedId}/transactions/${txnId}`, { method: 'DELETE' });
    if (refreshFin) refreshFin();
  }

  async function addToTrip(txnId) {
    await apiFetch(`/api/trips/${selectedId}/transactions/${txnId}`, { method: 'POST' });
    setAddSearch('');
    if (refreshFin) refreshFin();
  }

  async function deleteTrip() {
    if (!confirm('Delete this trip? Transactions will be un-tagged but not deleted.')) return;
    await apiFetch(`/api/trips/${selectedId}`, { method: 'DELETE' });
    setSelectedId(null); setSelectedCat(null);
    if (refreshFin) refreshFin();
  }

  async function saveEdit() {
    setEditSaving(true); setEditMsg(null);
    const res = await apiFetch(`/api/trips/${selectedId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    });
    setEditSaving(false);
    if (res.ok) { setEditMode(false); loadTrips(); }
    else { const d = await res.json(); setEditMsg(d.detail || 'Failed to save'); }
  }

  const recat = async (id, cat) => {
    try {
      await fetch(`/api/transactions/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: cat }),
      });
      if (refreshFin) refreshFin();
    } catch(e) {}
  };

  const inputStyle = {
    width: '100%', padding: '9px 12px', borderRadius: 9, border: '1px solid var(--line)',
    background: 'var(--bg)', color: 'var(--ink)', fontSize: 13, fontFamily: 'inherit',
    outline: 'none', boxSizing: 'border-box',
  };

  // ── Detail view ──────────────────────────────────────────────────
  if (selectedId) {
    if (!selectedTrip) return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-3)', fontSize: 14 }}>Loading…</div>
    );
    const trip = selectedTrip;
    const tripDays = trip.start_date && trip.end_date
      ? Math.max(1, Math.round((new Date(trip.end_date) - new Date(trip.start_date)) / 86400000) + 1) : 1;
    const budget    = trip.budget != null ? parseFloat(trip.budget) : null;
    const remaining = budget != null ? budget - totalSpent : null;
    const over      = budget != null && totalSpent > budget;
    const pct       = budget != null ? Math.min(totalSpent / budget * 100, 100) : null;
    const maxDay    = dailyBreakdown.length ? Math.max(...dailyBreakdown.map(d => d.amount), 1) : 1;

    return (
      <div className="tab-body">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <button onClick={() => { setSelectedId(null); setSelectedCat(null); setEditMode(false); }} style={{
            display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
            color: 'var(--ink-3)', fontSize: 13, cursor: 'pointer', padding: '6px 0',
          }}>← Back to trips</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => {
              setEditMode(v => !v);
              setEditForm({ name: trip.name, start_date: trip.start_date, end_date: trip.end_date, budget: trip.budget ?? '' });
              setEditMsg(null);
            }} style={{
              background: 'none', border: '1px solid var(--line)', borderRadius: 8,
              padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--ink-3)',
            }}>{editMode ? 'Cancel' : 'Edit trip'}</button>
            <button onClick={deleteTrip} style={{
              background: 'none', border: '1px solid color-mix(in srgb, var(--terra) 40%, transparent)',
              color: 'var(--terra)', borderRadius: 8, padding: '5px 12px', fontSize: 12, cursor: 'pointer',
            }}>Delete</button>
          </div>
        </div>

        {editMode && (
          <div className="card" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Edit trip</div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>Name</div>
                <input value={editForm.name || ''} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>Start date</div>
                <input type="date" value={editForm.start_date || ''} onChange={e => setEditForm(f => ({ ...f, start_date: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>End date</div>
                <input type="date" value={editForm.end_date || ''} onChange={e => setEditForm(f => ({ ...f, end_date: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>Budget</div>
                <input type="number" min="0" value={editForm.budget ?? ''} placeholder="optional"
                  onChange={e => setEditForm(f => ({ ...f, budget: e.target.value ? parseFloat(e.target.value) : null }))} style={inputStyle} />
              </div>
            </div>
            {editMsg && <div style={{ fontSize: 13, color: 'var(--terra)' }}>{editMsg}</div>}
            <button onClick={saveEdit} disabled={editSaving} style={{
              alignSelf: 'flex-start', background: 'var(--accent)', color: '#052015', border: 'none',
              borderRadius: 9, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              opacity: editSaving ? 0.6 : 1,
            }}>{editSaving ? 'Saving…' : 'Save changes'}</button>
          </div>
        )}

        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>{trip.name}</h2>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4 }}>
            {trip.start_date} → {trip.end_date} · {tripTxns.length} transactions · {tripDays} day{tripDays !== 1 ? 's' : ''}
          </div>
        </div>

        <div className="grid-4">
          <SummaryCard label="Total spent"   n={totalSpent}            accent="var(--terra)" />
          <SummaryCard label="Daily avg"     n={totalSpent / tripDays} accent="var(--accent)" />
          <SummaryCard label="Transactions"  value={`${tripTxns.length}`} />
          {budget != null
            ? <SummaryCard label={over ? 'Over budget' : 'Remaining'} n={Math.abs(remaining)} accent={over ? 'var(--terra)' : 'var(--green)'} />
            : <SummaryCard label="Trip days" value={`${tripDays}`} accent="var(--ink-3)" />
          }
        </div>

        {pct !== null && (
          <div className="card" style={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
              <span style={{ fontWeight: 600 }}>Budget: {fmtMoney2(budget)}</span>
              <span style={{ color: over ? 'var(--terra)' : 'var(--ink-3)' }}>
                {fmtMoney2(totalSpent)} spent ({pct.toFixed(0)}%)
              </span>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: 'var(--line)' }}>
              <div style={{ height: '100%', borderRadius: 4, width: `${pct}%`,
                background: over ? 'var(--terra)' : 'var(--accent)', transition: 'width .3s' }} />
            </div>
          </div>
        )}

        <div className="grid-2">
          {catBreakdown.length > 0 && (
            <div className="card">
              <div className="card-head"><h3>By category</h3></div>
              <div className="donut-row">
                <DonutChart data={catBreakdown} size={180} thickness={22} formatter={fmtMoney}
                  selectedCat={selectedCat}
                  onSliceClick={s => setSelectedCat(c => c === s.cat ? null : s.cat)} />
                <div className="donut-legend">
                  {catBreakdown.map(b => (
                    <div key={b.cat} className="legend-row"
                      style={{ cursor: 'pointer', opacity: selectedCat && selectedCat !== b.cat ? 0.4 : 1, transition: 'opacity .15s' }}
                      onClick={() => setSelectedCat(c => c === b.cat ? null : b.cat)}>
                      <span className="cat-dot" style={{ background: b.color }} />
                      <span className="legend-name">{b.name}</span>
                      <span className="legend-amt">{fmtMoney(b.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {dailyBreakdown.length > 0 && (
            <div className="card">
              <div className="card-head"><h3>Daily spending</h3></div>
              <div style={{ overflowX: 'auto', padding: '0 4px 8px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 130, minWidth: dailyBreakdown.length * 44 }}>
                  {dailyBreakdown.map(d => (
                    <div key={d.date} style={{ flex: 1, minWidth: 36, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <div style={{ fontSize: 10, color: 'var(--ink-3)' }}>{fmtMoney(d.amount)}</div>
                      <div style={{ width: '100%', borderRadius: 4, minHeight: 4,
                        height: `${Math.round((d.amount / maxDay) * 80)}px`,
                        background: 'var(--accent)', opacity: 0.85 }} />
                      <div style={{ fontSize: 10, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{d.date.slice(5)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {topMerchants.length > 0 && (
          <div className="card">
            <div className="card-head"><h3>Top merchants</h3></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {topMerchants.map((m, i) => (
                <div key={m.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0',
                  borderBottom: i < topMerchants.length - 1 ? '1px solid var(--line)' : 'none' }}>
                  <div style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--surface)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, color: 'var(--ink-3)', fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
                  <div style={{ flex: 1, fontSize: 14, color: 'var(--ink)', fontWeight: 500,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', marginRight: 8 }}>{m.count} txn{m.count !== 1 ? 's' : ''}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{fmtMoney2(m.amount)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-head">
            <h3>
              {selectedCat
                ? <><span className="cat-dot" style={{ background: catById(selectedCat).color, display: 'inline-block', marginRight: 6 }} />{catById(selectedCat).name}</>
                : 'Transactions'}
            </h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {['date', 'amount'].map(s => (
                <button key={s} onClick={() => setSortBy(s)} style={{
                  background: sortBy === s ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'none',
                  border: `1px solid ${sortBy === s ? 'var(--accent)' : 'var(--line)'}`,
                  borderRadius: 6, padding: '2px 10px', fontSize: 12, cursor: 'pointer',
                  color: sortBy === s ? 'var(--accent)' : 'var(--ink-3)', fontFamily: 'inherit',
                }}>{s === 'amount' ? '$ Amount' : '📅 Date'}</button>
              ))}
              {selectedCat && (
                <button onClick={() => setSelectedCat(null)} style={{
                  background: 'none', border: '1px solid var(--line)', borderRadius: 6,
                  padding: '2px 10px', fontSize: 12, color: 'var(--ink-3)', cursor: 'pointer',
                }}>Clear filter</button>
              )}
              <span className="muted">{displayTxns.length} transactions</span>
            </div>
          </div>
          <TxnList
            txns={displayTxns}
            compact
            presorted
            onRecategorize={recat}
            refreshFin={refreshFin}
            extraMenuItems={t => [{ label: 'Remove from trip', action: () => removeFromTrip(t.id) }]}
          />
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Add transactions</h3>
            <span className="muted">Search any transaction not yet in this trip</span>
          </div>
          <div style={{ padding: '0 0 12px' }}>
            <input value={addSearch} onChange={e => setAddSearch(e.target.value)}
              placeholder="Search by merchant name…"
              style={{ ...inputStyle, marginBottom: 8 }} />
            {addSearch.trim() && addCandidates.length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '8px 0' }}>No matching transactions found.</div>
            )}
            {addCandidates.map((t, i) => {
              const cat = catById(t.category);
              return (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0',
                  borderBottom: i < addCandidates.length - 1 ? '1px solid var(--line)' : 'none' }}>
                  <span className="cat-dot" style={{ background: cat.color, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t.merchant || t.description}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{(t.date || '').slice(0, 10)} · {cat.name}</div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: t.amount < 0 ? 'var(--ink)' : 'var(--green)', flexShrink: 0 }}>
                    {t.amount < 0 ? '-' : '+'}{fmtMoney2(Math.abs(t.amount))}
                  </div>
                  <button onClick={() => addToTrip(t.id)} style={{
                    background: 'var(--accent)', color: '#052015', border: 'none', borderRadius: 7,
                    padding: '4px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
                  }}>+ Add</button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ── List view ─────────────────────────────────────────────────────
  return (
    <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Track spending for a trip or event</div>
        <button onClick={() => { setCreating(v => !v); setSaveMsg(null); }} style={{
          background: 'var(--accent)', color: '#052015', border: 'none', borderRadius: 10,
          padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}>{creating ? 'Cancel' : '+ New Trip'}</button>
      </div>

      {creating && (
        <div className="card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>New trip</div>
          <input autoFocus value={form.name} placeholder="Trip name (e.g. Mexico City)"
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && createTrip()}
            style={inputStyle} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>Start date</div>
              <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>End date</div>
              <input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} style={inputStyle} />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>Budget (optional)</div>
            <input type="number" min="0" value={form.budget} placeholder="e.g. 1500"
              onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} style={inputStyle} />
          </div>
          {saveMsg && (
            <div style={{ fontSize: 13, color: saveMsg.startsWith('Error') ? 'var(--terra)' : 'var(--accent)' }}>{saveMsg}</div>
          )}
          <button onClick={createTrip} disabled={saving || !form.name || !form.start_date || !form.end_date} style={{
            background: 'var(--accent)', color: '#052015', border: 'none', borderRadius: 9,
            padding: '9px 0', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            opacity: (saving || !form.name || !form.start_date || !form.end_date) ? 0.6 : 1,
          }}>{saving ? 'Creating…' : 'Create Trip'}</button>
        </div>
      )}

      {trips.length === 0
        ? <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--ink-3)', fontSize: 14 }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>✈️</div>
            <div>No trips yet. Create one to track your travel spending.</div>
          </div>
        : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
            {trips.map(trip => {
              const b    = trip.budget != null ? parseFloat(trip.budget) : null;
              const pct  = b ? Math.min(trip.total_spent / b * 100, 100) : null;
              const over = b && trip.total_spent > b;
              return (
                <div key={trip.id} onClick={() => { setSelectedId(trip.id); setSelectedCat(null); }} style={{
                  background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16,
                  padding: '18px 20px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--ink)' }}>{trip.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3 }}>
                        {trip.start_date} → {trip.end_date}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, fontSize: 17, color: over ? 'var(--terra)' : 'var(--accent)' }}>
                        {fmtMoney2(trip.total_spent)}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{trip.txn_count} transactions</div>
                    </div>
                  </div>
                  {pct !== null && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>
                        <span>Budget {fmtMoney2(b)}</span>
                        <span style={{ color: over ? 'var(--terra)' : 'var(--ink-3)' }}>
                          {over ? `${fmtMoney2(trip.total_spent - b)} over` : `${fmtMoney2(b - trip.total_spent)} left`}
                        </span>
                      </div>
                      <div style={{ height: 5, borderRadius: 3, background: 'var(--line)' }}>
                        <div style={{ height: '100%', borderRadius: 3, width: `${pct}%`,
                          background: over ? 'var(--terra)' : 'var(--accent)' }} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
      }
    </div>
  );
}

// ─── Shared Spaces Tab ────────────────────────────────────────────────────────

const SHARED_CATS = [
  { id: 'groceries',      name: 'Groceries',       color: '#22c55e' },
  { id: 'eating-out',     name: 'Eating Out',      color: '#f97316' },
  { id: 'transport',      name: 'Transport',       color: '#3b82f6' },
  { id: 'accommodation',  name: 'Accommodation',   color: '#8b5cf6' },
  { id: 'entertainment',  name: 'Entertainment',   color: '#ec4899' },
  { id: 'shopping',       name: 'Shopping',        color: '#f59e0b' },
  { id: 'utilities',      name: 'Utilities',       color: '#6366f1' },
  { id: 'household',      name: 'Household',       color: '#14b8a6' },
  { id: 'activities',     name: 'Activities',      color: '#84cc16' },
  { id: 'other',          name: 'Other',           color: '#94a3b8' },
];
const SPACE_ICONS = ['✈️','🛒','🍽️','🏠','🎉','💡','🎬','📦','🏋️','🎵'];

function sharedCatById(id) {
  return SHARED_CATS.find(c => c.id === id) || { id, name: id, color: '#94a3b8' };
}

// Renders children into document.body so position:fixed modals are always
// relative to the viewport, regardless of ancestor CSS transforms.
function Portal({ children }) {
  return ReactDOM.createPortal(children, document.body);
}

function SharedMerchantDrawer({ merchant, expenses, participantColors = {}, onClose }) {
  const matching = expenses.filter(e => e.description === merchant)
    .sort((a, b) => b.date.localeCompare(a.date));
  const total = matching.reduce((s, e) => s + e.amount, 0);

  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    return d.toISOString().slice(0, 7);
  });
  const byMonth = {};
  matching.forEach(e => { const m = e.date.slice(0, 7); byMonth[m] = (byMonth[m] || 0) + e.amount; });
  const chartData = months.map(m => ({ label: m.slice(5), value: byMonth[m] || 0 }));
  const maxVal = Math.max(...chartData.map(d => d.value), 1);

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)' }} />
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 401, width: 420, background: 'var(--surface)', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 32px rgba(0,0,0,0.12)' }}>
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.01em' }}>{merchant}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3 }}>
                {matching.length} expense{matching.length !== 1 ? 's' : ''} in this space
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 16, color: 'var(--ink-3)', lineHeight: 1, flexShrink: 0 }}>✕</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
            {[
              { label: 'Total spent here', value: fmtMoney(total) },
              { label: 'Avg per visit', value: matching.length > 0 ? fmtMoney(total / matching.length) : '—' },
            ].map(({ label, value }) => (
              <div key={label} style={{ background: 'var(--surface-3)', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
        {chartData.some(d => d.value > 0) && (
          <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Monthly spend — last 12 months</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 72 }}>
              {chartData.map(({ label, value }) => (
                <BarCol key={label} label={label} value={value} maxVal={maxVal} />
              ))}
            </div>
          </div>
        )}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {matching.map(e => {
            const catI = sharedCatById(e.category);
            const userColor = participantColors[e.user] || catI.color;
            return (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 24px', borderBottom: '1px solid var(--line)' }}>
                <span className="cat-dot" style={{ background: userColor, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>{e.date}</div>
                  {e.notes && <div style={{ fontSize: 12, color: 'var(--accent)', fontStyle: 'italic', marginTop: 2 }}>{e.notes}</div>}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(e.amount)}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 1 }}>{e.display_name || e.user}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function SharedVibeBanner({ detail, myUsername, myTotal }) {
  if (!detail || !detail.expenses?.length) return null;
  const total   = detail.total_spent || 0;
  const budget  = detail.budget;
  const others  = (detail.per_user || []).filter(u => u.user !== myUsername);
  const topOther = [...others].sort((a, b) => b.total - a.total)[0];
  const myPct    = total > 0 ? (myTotal / total) * 100 : 0;

  let emoji = '', text = '', color = 'var(--accent)';
  if (budget && total > budget) {
    emoji = '⚠️'; color = 'var(--terra)';
    text  = `Over budget by ${fmtMoney(total - budget)}.`;
  } else if (budget) {
    const rem = budget - total;
    emoji = '✓'; color = 'var(--green)';
    text  = `${fmtMoney(rem)} left in budget — ${((rem / budget) * 100).toFixed(0)}% remaining.`;
  } else if (topOther && myPct < 25 && total > 0) {
    emoji = '👀'; color = 'var(--ink-3)';
    text  = `${topOther.display_name || topOther.user} is carrying most of the load so far.`;
  } else if (myPct > 70 && others.length > 0) {
    emoji = '💪'; color = 'var(--accent)';
    text  = `You're contributing the most to ${detail.name}.`;
  } else if (detail.expenses?.length >= 10) {
    emoji = '📊'; color = 'var(--ink-3)';
    text  = `${detail.expenses.length} expenses tracked · ${fmtMoney(total / detail.expenses.length)} avg per expense.`;
  } else {
    return null;
  }
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 16px', borderRadius: 12, marginBottom: 0,
      background: 'color-mix(in srgb, var(--surface) 80%, transparent)',
      border: '1px solid var(--line)', fontSize: 13, color: 'var(--ink)',
    }}>
      <span style={{ fontSize: 18 }}>{emoji}</span>
      <span style={{ color }}>{text}</span>
    </div>
  );
}

function SharedTab({ pendingJoin, clearPendingJoin, setTab }) {
  const [spaces, setSpaces]           = useState([]);
  const [loading, setLoading]         = useState(true);
  const [detail, setDetail]           = useState(null);   // {space, expenses, per_user, category_breakdown}
  const [detailLoading, setDetailLoading] = useState(false);

  // Modals
  const [createOpen, setCreateOpen]   = useState(false);
  const [shareModal, setShareModal]   = useState(null);   // {url, token}
  const [joinPrompt, setJoinPrompt]   = useState(null);   // {token, name, owner, type, icon}
  const [expenseModal, setExpenseModal] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [copied, setCopied]           = useState(false);

  // Create form
  const [createForm, setCreateForm]   = useState({ name: '', type: 'event', icon: '📦', start_date: '', end_date: '', budget: '' });
  const [createSaving, setCreateSaving] = useState(false);

  // Add expense form
  const [expForm, setExpForm]         = useState({ description: '', amount: '', date: new Date().toISOString().slice(0,10), category: 'other' });
  const [expSaving, setExpSaving]     = useState(false);
  const [txnSearch, setTxnSearch]     = useState('');
  const [addMode, setAddMode]         = useState('bulk'); // 'manual' | 'txn' | 'bulk'
  // Bulk add state
  const [bulkCat, setBulkCat]         = useState('');
  const [bulkFrom, setBulkFrom]       = useState('');
  const [bulkTo, setBulkTo]           = useState('');
  const [bulkTag, setBulkTag]         = useState('');
  const [bulkSelected, setBulkSelected] = useState(new Set());

  // Breakdown card view toggle ('category' | 'month') — persisted on the space object server-side
  const [breakdownView, setBreakdownView] = useState('category');
  useEffect(() => {
    if (!detail) return;
    setBreakdownView(detail.breakdown_view || (detail.type === 'recurring' ? 'month' : 'category'));
  }, [detail?.id]);
  async function setAndSaveBreakdownView(v) {
    setBreakdownView(v);
    if (!detail) return;
    try {
      await apiFetch(`/api/shared/${detail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ breakdown_view: v }),
      });
    } catch(e) { /* non-critical, ignore */ }
  }

  // Merchant drawer for shared expenses
  const [activeMerchantShared, setActiveMerchantShared] = useState(null);

  // Current user (for identifying own expenses)
  const [me, setMe]                   = useState(null);
  useEffect(() => {
    apiFetch('/api/auth/me').then(r => r.json()).then(setMe).catch(() => {});
  }, []);

  function loadSpaces() {
    setLoading(true);
    apiFetch('/api/shared').then(r => r.json()).then(d => {
      setSpaces(d.spaces || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }
  useEffect(() => { loadSpaces(); }, []);

  function loadDetail(space) {
    setDetailLoading(true);
    const isOwner = space.role === 'owner';
    const path = isOwner
      ? `/api/shared/${space.id}`
      : `/api/shared/${space.id}`;
    apiFetch(path).then(r => r.json()).then(d => {
      setDetail(d);
      setDetailLoading(false);
    }).catch(() => setDetailLoading(false));
  }

  // Handle ?join= URL param passed from App
  useEffect(() => {
    if (!pendingJoin) return;
    apiFetch(`/api/shared/join/${pendingJoin}`).then(r => r.json()).then(d => {
      if (d.already_joined || d.already_owner) {
        clearPendingJoin();
        loadSpaces();
        return;
      }
      setJoinPrompt({ token: pendingJoin, name: d.name, owner: d.owner, type: d.type, icon: d.icon });
      clearPendingJoin();
    }).catch(() => clearPendingJoin());
  }, [pendingJoin]);

  async function confirmJoin() {
    if (!joinPrompt) return;
    setJoinLoading(true);
    try {
      await apiFetch(`/api/shared/join/${joinPrompt.token}`, { method: 'POST' });
      setJoinPrompt(null);
      loadSpaces();
    } finally {
      setJoinLoading(false);
    }
  }

  async function createSpace() {
    if (!createForm.name.trim()) return;
    setCreateSaving(true);
    try {
      const res = await apiFetch('/api/shared', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:       createForm.name.trim(),
          type:       createForm.type,
          icon:       createForm.icon,
          start_date: createForm.start_date || null,
          end_date:   createForm.end_date || null,
          budget:     createForm.budget ? parseFloat(createForm.budget) : null,
        }),
      });
      const d = await res.json();
      if (d.ok) {
        setCreateOpen(false);
        setCreateForm({ name: '', type: 'event', icon: '📦', start_date: '', end_date: '', budget: '' });
        loadSpaces();
      }
    } finally {
      setCreateSaving(false);
    }
  }

  async function shareSpace(spaceId) {
    const res = await apiFetch(`/api/shared/${spaceId}/share`, { method: 'POST' });
    const d   = await res.json();
    if (d.ok) setShareModal({ url: d.url, token: d.token });
  }

  async function deleteSpace(spaceId) {
    if (!confirm('Delete this shared space and all its expenses?')) return;
    await apiFetch(`/api/shared/${spaceId}`, { method: 'DELETE' });
    loadSpaces();
  }

  async function addExpense() {
    if (!detail) return;
    setExpSaving(true);
    try {
      const body = addMode === 'manual'
        ? { description: expForm.description, amount: parseFloat(expForm.amount), date: expForm.date, category: expForm.category }
        : {};
      const res = await apiFetch(`/api/shared/${detail.id}/expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setExpenseModal(false);
        setExpForm({ description: '', amount: '', date: new Date().toISOString().slice(0,10), category: 'other' });
        setTxnSearch('');
        loadDetail(detail);
      }
    } finally {
      setExpSaving(false);
    }
  }

  async function addTxnRef(txn) {
    if (!detail) return;
    await apiFetch(`/api/shared/${detail.id}/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txn_id: txn.id }),
    });
    loadDetail(detail);
  }

  async function addBulk() {
    if (!detail || bulkSelected.size === 0) return;
    setExpSaving(true);
    try {
      await apiFetch(`/api/shared/${detail.id}/expenses/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txn_ids: [...bulkSelected] }),
      });
      setExpenseModal(false);
      setBulkSelected(new Set());
      loadDetail(detail);
    } finally {
      setExpSaving(false);
    }
  }

  async function deleteExpense(expenseId) {
    if (!detail) return;
    await apiFetch(`/api/shared/${detail.id}/expenses/${expenseId}`, { method: 'DELETE' });
    loadDetail(detail);
  }

  // Inline note editing
  const [editingNote, setEditingNote] = useState(null); // { id, value }
  async function saveNote(expenseId, value) {
    if (!detail) return;
    await apiFetch(`/api/shared/${detail.id}/expenses/${expenseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: value }),
    });
    setEditingNote(null);
    loadDetail(detail);
  }

  // Txn search candidates for single ref-add
  const txnCandidates = useMemo(() => {
    if (!txnSearch.trim() || !detail) return [];
    const q = txnSearch.toLowerCase();
    const alreadyAdded = new Set((detail.expenses || []).filter(e => e.type === 'ref').map(e => e.txn_id));
    return TRANSACTIONS
      .filter(t => !alreadyAdded.has(t.id) && (t.merchant || t.description || '').toLowerCase().includes(q))
      .slice(0, 15);
  }, [txnSearch, detail]);

  // Bulk filter candidates
  const bulkCandidates = useMemo(() => {
    if (!detail) return [];
    const alreadyAdded = new Set((detail.expenses || []).filter(e => e.type === 'ref').map(e => e.txn_id));
    return TRANSACTIONS.filter(t => {
      if (alreadyAdded.has(t.id)) return false;
      if (bulkCat  && t.category !== bulkCat) return false;
      if (bulkFrom && t.date < bulkFrom) return false;
      if (bulkTo   && t.date > bulkTo)   return false;
      if (bulkTag  && !(t.tags || '').toLowerCase().includes(bulkTag.toLowerCase())) return false;
      return true;
    });
  }, [detail, bulkCat, bulkFrom, bulkTo, bulkTag]);

  const myTotal    = detail ? (detail.per_user || []).find(u => u.user === me?.username)?.total || 0 : 0;
  const otherTotal = detail ? (detail.total_spent || 0) - myTotal : 0;

  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo]     = useState('');
  const [filterUser, setFilterUser] = useState('');
  const [sortBy, setSortBy]         = useState('date');   // 'date' | 'amount' | 'merchant'
  const [sortDir, setSortDir]       = useState('desc');

  // Per-user totals computed from currently date-filtered expenses
  const filteredPerUser = useMemo(() => {
    if (!detail?.per_user) return [];
    const allExpenses = detail?.expenses || [];
    const hasDateFilter = filterFrom || filterTo;
    if (!hasDateFilter) return detail.per_user.map(u => ({ ...u, filteredTotal: u.total }));
    const totals = {};
    for (const e of allExpenses) {
      if (filterFrom && e.date < filterFrom) continue;
      if (filterTo && e.date > filterTo) continue;
      totals[e.user] = (totals[e.user] || 0) + e.amount;
    }
    return detail.per_user.map(u => ({ ...u, filteredTotal: totals[u.user] || 0 }));
  }, [detail?.per_user, detail?.expenses, filterFrom, filterTo]);

  // Assign consistent colors to participants
  const participantColors = useMemo(() => {
    const palette = ['#10b981', '#f97316', '#6366f1', '#0ea5e9', '#f43f5e', '#eab308', '#8b5cf6', '#14b8a6'];
    const participants = detail?.participants || [];
    const map = {};
    participants.forEach((u, i) => { map[u] = palette[i % palette.length]; });
    return map;
  }, [detail?.participants]);

  const monthBreakdown = useMemo(() => {
    if (!detail) return [];
    const map = {};
    for (const e of detail.expenses || []) {
      const m = (e.date || '').slice(0, 7);
      if (!m) continue;
      if (!map[m]) map[m] = { amount: 0, byUser: {} };
      map[m].amount += e.amount;
      map[m].byUser[e.user] = (map[m].byUser[e.user] || 0) + e.amount;
    }
    return Object.entries(map)
      .map(([month, data]) => ({
        month,
        amount: Math.round(data.amount * 100) / 100,
        byUser: Object.entries(data.byUser)
          .map(([user, amt]) => ({
            user,
            amount: Math.round(amt * 100) / 100,
            displayName: (detail.per_user || []).find(u => u.user === user)?.display_name || user,
            color: participantColors[user] || 'var(--ink-3)',
          }))
          .sort((a, b) => b.amount - a.amount),
      }))
      .sort((a, b) => b.month.localeCompare(a.month));
  }, [detail, participantColors]);

  const fmtMonth = m => {
    const [y, mo] = m.split('-');
    return `${'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[+mo - 1]} ${y}`;
  };

  // ── List view ──
  if (!detail) {
    const mySpaces     = spaces.filter(s => s.role === 'owner');
    const joinedSpaces = spaces.filter(s => s.role === 'participant');

    return (
      <div className="tab-body">
        {/* Join prompt modal */}
        {joinPrompt && (
          <Portal>
          <div style={{ position: 'fixed', inset: 0, zIndex: 800, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="card" style={{ width: 340, margin: 0 }}>
              <div style={{ fontSize: 32, textAlign: 'center', marginBottom: 8 }}>{joinPrompt.icon}</div>
              <h3 style={{ textAlign: 'center', marginBottom: 4 }}>{joinPrompt.name}</h3>
              <p style={{ textAlign: 'center', color: 'var(--ink-3)', fontSize: 13, marginBottom: 20 }}>
                {joinPrompt.owner} invited you to this {joinPrompt.type}
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setJoinPrompt(null)} style={{ flex: 1, padding: '10px 0', border: '1px solid var(--line)', borderRadius: 10, background: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'inherit' }}>Cancel</button>
                <button onClick={confirmJoin} disabled={joinLoading} style={{ flex: 1, padding: '10px 0', border: 'none', borderRadius: 10, background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                  {joinLoading ? 'Joining…' : 'Join'}
                </button>
              </div>
            </div>
          </div>
          </Portal>
        )}

        {/* Share modal */}
        {shareModal && (
          <Portal>
          <div style={{ position: 'fixed', inset: 0, zIndex: 800, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShareModal(null)}>
            <div className="card" style={{ width: 380, margin: 0 }} onClick={e => e.stopPropagation()}>
              <h3 style={{ marginBottom: 12 }}>Share invite link</h3>
              <p style={{ color: 'var(--ink-3)', fontSize: 13, marginBottom: 12 }}>Anyone with this link who is logged in can join the space.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input readOnly value={shareModal.url} style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink)', fontSize: 13, fontFamily: 'monospace', outline: 'none' }} />
                <button onClick={() => { navigator.clipboard.writeText(shareModal.url); setCopied(true); setTimeout(() => setCopied(false), 2000); }} style={{ padding: '8px 16px', border: 'none', borderRadius: 8, background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              <button onClick={() => setShareModal(null)} style={{ marginTop: 14, width: '100%', padding: '9px 0', border: '1px solid var(--line)', borderRadius: 8, background: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'inherit' }}>Done</button>
            </div>
          </div>
          </Portal>
        )}

        {/* Create modal */}
        {createOpen && (
          <Portal>
          <div style={{ position: 'fixed', inset: 0, zIndex: 800, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setCreateOpen(false)}>
            <div className="card" style={{ width: 380, margin: 0 }} onClick={e => e.stopPropagation()}>
              <h3 style={{ marginBottom: 16 }}>New shared space</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>Name</label>
                  <input value={createForm.name} onChange={e => setCreateForm(f => ({...f, name: e.target.value}))}
                    placeholder="e.g. Groceries, Tokyo Trip…" style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>Type</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[['event','🎉 Event'], ['recurring','🔁 Recurring'], ['trip','✈️ Trip']].map(([val, lbl]) => (
                      <button key={val} onClick={() => setCreateForm(f => ({...f, type: val}))} style={{
                        flex: 1, padding: '8px 0', border: `1px solid ${createForm.type === val ? 'var(--accent)' : 'var(--line)'}`,
                        borderRadius: 8, background: createForm.type === val ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'none',
                        color: createForm.type === val ? 'var(--accent)' : 'var(--ink-3)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
                      }}>{lbl}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>Icon</label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {SPACE_ICONS.map(icon => (
                      <button key={icon} onClick={() => setCreateForm(f => ({...f, icon}))} style={{
                        width: 36, height: 36, fontSize: 20, border: `2px solid ${createForm.icon === icon ? 'var(--accent)' : 'var(--line)'}`,
                        borderRadius: 8, background: 'none', cursor: 'pointer',
                      }}>{icon}</button>
                    ))}
                  </div>
                </div>
                {(createForm.type === 'trip') && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>Start date</label>
                      <input type="date" value={createForm.start_date} onChange={e => setCreateForm(f => ({...f, start_date: e.target.value}))}
                        style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>End date</label>
                      <input type="date" value={createForm.end_date} onChange={e => setCreateForm(f => ({...f, end_date: e.target.value}))}
                        style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                  </div>
                )}
                <div>
                  <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>Budget (optional)</label>
                  <input type="number" value={createForm.budget} onChange={e => setCreateForm(f => ({...f, budget: e.target.value}))}
                    placeholder="0.00" style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button onClick={() => setCreateOpen(false)} style={{ flex: 1, padding: '10px 0', border: '1px solid var(--line)', borderRadius: 10, background: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'inherit' }}>Cancel</button>
                <button onClick={createSpace} disabled={createSaving || !createForm.name.trim()} style={{ flex: 1, padding: '10px 0', border: 'none', borderRadius: 10, background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                  {createSaving ? 'Creating…' : 'Create'}
                </button>
              </div>
            </div>
          </div>
          </Portal>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)' }}>Shared</h2>
          <button onClick={() => setCreateOpen(true)} style={{ padding: '8px 16px', border: 'none', borderRadius: 10, background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 14 }}>+ New space</button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 40 }}>Loading…</div>
        ) : spaces.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 48 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🤝</div>
            <h3 style={{ marginBottom: 8 }}>No shared spaces yet</h3>
            <p style={{ color: 'var(--ink-3)', fontSize: 14, marginBottom: 20 }}>Create a space to track shared expenses — groceries, trips, eating out, anything.</p>
            <button onClick={() => setCreateOpen(true)} style={{ padding: '9px 20px', border: 'none', borderRadius: 10, background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>Create your first space</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {mySpaces.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>My Spaces</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {mySpaces.map(space => (
                    <SpaceCard key={space.id} space={space} isOwner
                      onOpen={() => { loadDetail(space); }}
                      onShare={() => shareSpace(space.id)}
                      onDelete={() => deleteSpace(space.id)} />
                  ))}
                </div>
              </div>
            )}
            {joinedSpaces.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Joined</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {joinedSpaces.map(space => (
                    <SpaceCard key={space.id} space={space} isOwner={false}
                      onOpen={() => { loadDetail(space); }} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Detail view ──
  const isOwner     = detail.role === 'owner';
  const budget      = detail.budget;
  const budgetPct   = budget ? Math.min((detail.total_spent / budget) * 100, 100) : null;
  const overBudget  = budget && detail.total_spent > budget;
  const expenses    = detail.expenses || [];

  return (
    <div className="tab-body">
      {/* Add expense modal */}
      {expenseModal && (
        <Portal>
        <div style={{ position: 'fixed', inset: 0, zIndex: 800, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setExpenseModal(false)}>
          <div className="card" style={{ width: 400, margin: 0, maxHeight: '80vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 14 }}>Add expense</h3>
            {/* Mode toggle */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
              {[['bulk','⚡ Bulk add'], ['txn','🔍 Search'], ['manual','✏️ Manual']].map(([m, lbl]) => (
                <button key={m} onClick={() => setAddMode(m)} style={{
                  flex: 1, padding: '7px 0', border: `1px solid ${addMode === m ? 'var(--accent)' : 'var(--line)'}`,
                  borderRadius: 8, background: addMode === m ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'none',
                  color: addMode === m ? 'var(--accent)' : 'var(--ink-3)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
                }}>{lbl}</button>
              ))}
            </div>

            {addMode === 'bulk' ? (
              <div>
                {/* Filters */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, color: 'var(--ink-3)', display: 'block', marginBottom: 3 }}>Category</label>
                      <select value={bulkCat} onChange={e => { setBulkCat(e.target.value); setBulkSelected(new Set()); }}
                        style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 7, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13, outline: 'none' }}>
                        <option value="">All categories</option>
                        {[..._liveCategories].sort((a,b) => a.name.localeCompare(b.name)).map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, color: 'var(--ink-3)', display: 'block', marginBottom: 3 }}>Tag contains</label>
                      <input value={bulkTag} onChange={e => { setBulkTag(e.target.value); setBulkSelected(new Set()); }}
                        placeholder="e.g. trip:abc"
                        style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 7, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, color: 'var(--ink-3)', display: 'block', marginBottom: 3 }}>From date</label>
                      <input type="date" value={bulkFrom} onChange={e => { setBulkFrom(e.target.value); setBulkSelected(new Set()); }}
                        style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 7, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, color: 'var(--ink-3)', display: 'block', marginBottom: 3 }}>To date</label>
                      <input type="date" value={bulkTo} onChange={e => { setBulkTo(e.target.value); setBulkSelected(new Set()); }}
                        style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 7, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                  </div>
                </div>

                {/* Select all / count */}
                {bulkCandidates.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--line)' }}>
                    <input type="checkbox"
                      checked={bulkSelected.size === bulkCandidates.length}
                      onChange={e => setBulkSelected(e.target.checked ? new Set(bulkCandidates.map(t => t.id)) : new Set())}
                      style={{ cursor: 'pointer' }} />
                    <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                      {bulkSelected.size > 0 ? `${bulkSelected.size} selected` : `${bulkCandidates.length} matching`}
                    </span>
                    {bulkSelected.size > 0 && (
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginLeft: 'auto' }}>
                        ${bulkCandidates.filter(t => bulkSelected.has(t.id)).reduce((s,t) => s + Math.abs(t.amount), 0).toFixed(2)} total
                      </span>
                    )}
                  </div>
                )}

                {/* Transaction list with checkboxes */}
                <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {bulkCandidates.length === 0 ? (
                    <div style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
                      {bulkCat || bulkFrom || bulkTo || bulkTag ? 'No transactions match these filters' : 'All transactions already added, or no data'}
                    </div>
                  ) : bulkCandidates.map(t => {
                    const catI = catById(t.category);
                    const sel  = bulkSelected.has(t.id);
                    return (
                      <div key={t.id}
                        onClick={() => setBulkSelected(prev => { const n = new Set(prev); sel ? n.delete(t.id) : n.add(t.id); return n; })}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 7,
                          background: sel ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'var(--surface-2)',
                          border: `1px solid ${sel ? 'var(--accent)' : 'var(--line)'}`, cursor: 'pointer' }}>
                        <input type="checkbox" checked={sel} onChange={() => {}} style={{ pointerEvents: 'none', flexShrink: 0 }} />
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: catI.color, flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.merchant || t.description}</span>
                        <span style={{ fontSize: 11, color: 'var(--ink-3)', flexShrink: 0 }}>{t.date?.slice(0,10)}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', flexShrink: 0 }}>${Math.abs(t.amount).toFixed(2)}</span>
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button onClick={() => setExpenseModal(false)} style={{ flex: 1, padding: '9px 0', border: '1px solid var(--line)', borderRadius: 8, background: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'inherit' }}>Cancel</button>
                  <button onClick={addBulk} disabled={expSaving || bulkSelected.size === 0}
                    style={{ flex: 2, padding: '9px 0', border: 'none', borderRadius: 8, background: 'var(--accent)', color: '#fff', cursor: bulkSelected.size === 0 ? 'not-allowed' : 'pointer', opacity: bulkSelected.size === 0 ? 0.5 : 1, fontFamily: 'inherit', fontWeight: 600 }}>
                    {expSaving ? 'Adding…' : bulkSelected.size > 0 ? `Add ${bulkSelected.size} transaction${bulkSelected.size > 1 ? 's' : ''}` : 'Select transactions'}
                  </button>
                </div>
              </div>
            ) : addMode === 'manual' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>Description</label>
                  <input value={expForm.description} onChange={e => setExpForm(f => ({...f, description: e.target.value}))}
                    placeholder="e.g. Trader Joe's haul"
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>Amount ($)</label>
                    <input type="number" value={expForm.amount} onChange={e => setExpForm(f => ({...f, amount: e.target.value}))}
                      placeholder="0.00"
                      style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>Date</label>
                    <input type="date" value={expForm.date} onChange={e => setExpForm(f => ({...f, date: e.target.value}))}
                      style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>Category</label>
                  <select value={expForm.category} onChange={e => setExpForm(f => ({...f, category: e.target.value}))}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}>
                    {SHARED_CATS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                  <button onClick={() => setExpenseModal(false)} style={{ flex: 1, padding: '10px 0', border: '1px solid var(--line)', borderRadius: 10, background: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'inherit' }}>Cancel</button>
                  <button onClick={addExpense} disabled={expSaving || !expForm.description || !expForm.amount}
                    style={{ flex: 1, padding: '10px 0', border: 'none', borderRadius: 10, background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                    {expSaving ? 'Adding…' : 'Add'}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <input value={txnSearch} onChange={e => setTxnSearch(e.target.value)}
                  placeholder="Search your transactions…"
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: 10 }} />
                <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {txnCandidates.length === 0 && txnSearch.trim() && (
                    <div style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 20 }}>No transactions found</div>
                  )}
                  {txnCandidates.map(t => {
                    const catI = catById(t.category);
                    return (
                      <div key={t.id} onClick={() => { addTxnRef(t); setExpenseModal(false); setTxnSearch(''); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8,
                          border: '1px solid var(--line)', cursor: 'pointer', background: 'var(--surface-2)' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-3)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'var(--surface-2)'}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: catI.color, flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.merchant || t.description}</span>
                        <span style={{ fontSize: 12, color: 'var(--ink-3)', flexShrink: 0 }}>{t.date?.slice(0,10)}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', flexShrink: 0 }}>${Math.abs(t.amount).toFixed(2)}</span>
                      </div>
                    );
                  })}
                </div>
                <button onClick={() => setExpenseModal(false)} style={{ marginTop: 14, width: '100%', padding: '9px 0', border: '1px solid var(--line)', borderRadius: 8, background: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'inherit' }}>Cancel</button>
              </div>
            )}
          </div>
        </div>
        </Portal>
      )}

      {activeMerchantShared && (
        <SharedMerchantDrawer merchant={activeMerchantShared} expenses={expenses} participantColors={participantColors} onClose={() => setActiveMerchantShared(null)} />
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
        <button onClick={() => setDetail(null)} style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'inherit', fontSize: 13 }}>← Back</button>
        <span style={{ fontSize: 28 }}>{detail.icon}</span>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', marginBottom: 2 }}>{detail.name}</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--ink-3)', background: 'var(--surface-2)', borderRadius: 6, padding: '1px 8px' }}>{detail.type}</span>
            {detail.start_date && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{detail.start_date} → {detail.end_date || '…'}</span>}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {isOwner && <button onClick={() => shareSpace(detail.id)} style={{ padding: '7px 14px', border: '1px solid var(--line)', borderRadius: 8, background: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'inherit', fontSize: 13 }}>🔗 Share</button>}
          <button onClick={() => setExpenseModal(true)} style={{ padding: '7px 14px', border: 'none', borderRadius: 8, background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 13 }}>+ Expense</button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <SummaryCard label="Total spent" n={detail.total_spent || 0}
          sub={`${expenses.length} expense${expenses.length !== 1 ? 's' : ''}`} />
        <SummaryCard label="Your share" n={myTotal} accent="var(--accent)"
          sub={detail.total_spent > 0 ? `${((myTotal / detail.total_spent) * 100).toFixed(0)}% of total` : null} />
        <SummaryCard label="Others" n={otherTotal}
          sub={detail.per_user?.length > 1 ? `${detail.per_user.length - 1} other${detail.per_user.length > 2 ? 's' : ''}` : null} />
        {budget ? (
          <SummaryCard label="Budget" n={budget} accent={overBudget ? 'var(--terra)' : 'var(--ink)'}
            sub={overBudget ? `${fmtMoney(detail.total_spent - budget)} over` : `${fmtMoney(budget - detail.total_spent)} left`} />
        ) : (
          <SummaryCard label="Months active" value={String(monthBreakdown.length || '—')} accent="var(--ink)"
            sub={monthBreakdown.length > 0 ? `since ${fmtMonth(monthBreakdown[monthBreakdown.length - 1]?.month || '')}` : null} />
        )}
      </div>

      {/* Per-user + breakdown side-by-side */}
      {(detail.per_user?.length > 0 || expenses.length > 0) && (
        <div className="grid-2" style={{ marginBottom: 16 }}>
          {filteredPerUser.length > 0 && (
            <div className="card">
              <div className="card-head">
                <h3>By person</h3>
                {filterUser && <button onClick={() => setFilterUser('')} style={{ fontSize: 11, padding: '2px 8px', border: '1px solid var(--line)', borderRadius: 6, background: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'inherit' }}>Clear</button>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {filteredPerUser.map((u) => {
                  const filteredTotal = u.filteredTotal || 0;
                  const periodTotal = filteredPerUser.reduce((s, x) => s + (x.filteredTotal || 0), 0);
                  const pct = periodTotal > 0 ? (filteredTotal / periodTotal) * 100 : 0;
                  const isMe = u.user === me?.username;
                  const uColor = participantColors[u.user];
                  const isSelected = filterUser === u.user;
                  return (
                    <div key={u.user}
                      onClick={() => setFilterUser(isSelected ? '' : u.user)}
                      className={`month-row${isSelected ? ' active' : ''}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 6px', margin: '0 -6px', borderBottom: '1px solid var(--line)', cursor: 'pointer' }}>
                      <span className="cat-dot" style={{ background: uColor, flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 14, color: isSelected ? uColor : 'var(--ink)', fontWeight: isSelected ? 600 : 400 }}>{u.display_name || u.user}{isMe ? ' (you)' : ''}</span>
                      <div style={{ width: 120, height: 6, background: 'var(--line)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, borderRadius: 3, background: uColor }} />
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', minWidth: 70, textAlign: 'right' }}>{fmtMoney(filteredTotal)}</span>
                      <span style={{ fontSize: 12, color: 'var(--ink-3)', minWidth: 36, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="card">
            <div className="card-head">
              <h3>{breakdownView === 'month' ? 'By month' : 'By category'}</h3>
              <div style={{ display: 'flex', gap: 4 }}>
                {[['category', 'Category'], ['month', 'Month']].map(([v, lbl]) => (
                  <button key={v} onClick={() => setAndSaveBreakdownView(v)} style={{
                    padding: '3px 10px', border: '1px solid var(--line)', borderRadius: 6,
                    background: breakdownView === v ? 'var(--accent)' : 'none',
                    color: breakdownView === v ? '#fff' : 'var(--ink-3)',
                    cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
                  }}>{lbl}</button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {breakdownView === 'month' ? (
                monthBreakdown.length === 0
                  ? <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>No expenses yet</div>
                  : monthBreakdown.slice(0, 8).map(mb => {
                      const maxAmt = monthBreakdown[0]?.amount || 1;
                      const pct = (mb.amount / maxAmt) * 100;
                      const isActive = filterFrom === `${mb.month}-01`;
                      return (
                        <div key={mb.month}
                          onClick={() => {
                            if (isActive) { setFilterFrom(''); setFilterTo(''); }
                            else {
                              const [y, mo] = mb.month.split('-');
                              const last = new Date(+y, +mo, 0).getDate();
                              setFilterFrom(`${mb.month}-01`);
                              setFilterTo(`${mb.month}-${String(last).padStart(2,'0')}`);
                            }
                          }}
                          className={`month-row${isActive ? ' active' : ''}`}
                          style={{}}>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ flex: 1, fontSize: 14, color: isActive ? 'var(--accent)' : 'var(--ink)', fontWeight: isActive ? 600 : 400 }}>{fmtMonth(mb.month)}</span>
                            {/* Segmented bar */}
                            <div style={{ width: 120, height: 6, background: 'var(--line)', borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
                              {mb.byUser.map((u, i) => (
                                <div key={u.user} title={`${u.displayName}: ${fmtMoney(u.amount)}`}
                                  style={{ height: '100%', width: `${(u.amount / mb.amount) * pct}%`, background: u.color,
                                    borderRadius: i === 0 ? '3px 0 0 3px' : (i === mb.byUser.length-1 ? '0 3px 3px 0' : 0) }} />
                              ))}
                            </div>
                            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', minWidth: 70, textAlign: 'right' }}>{fmtMoney(mb.amount)}</span>
                            <span style={{ fontSize: 12, color: 'var(--ink-3)', minWidth: 36, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
                          </div>
                          {/* Per-user micro labels */}
                          {mb.byUser.length > 1 && (
                            <div style={{ display: 'flex', gap: 10, marginTop: 2 }}>
                              {mb.byUser.map(u => (
                                <span key={u.user} style={{ fontSize: 11, color: u.color }}>
                                  {u.displayName.split(' ')[0]} {fmtMoney(u.amount)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })
              ) : (
                detail.category_breakdown?.length === 0
                  ? <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>No expenses yet</div>
                  : (detail.category_breakdown || []).slice(0, 6).map(cb => {
                      const catI = sharedCatById(cb.category);
                      const pct  = detail.total_spent > 0 ? (cb.amount / detail.total_spent) * 100 : 0;
                      return (
                        <div key={cb.category} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                          <span className="cat-dot" style={{ background: catI.color, flexShrink: 0 }} />
                          <span style={{ flex: 1, fontSize: 14, color: 'var(--ink)' }}>{catI.name}</span>
                          <div style={{ width: 120, height: 6, background: 'var(--line)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${pct}%`, borderRadius: 3, background: catI.color }} />
                          </div>
                          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', minWidth: 70, textAlign: 'right' }}>{fmtMoney(cb.amount)}</span>
                          <span style={{ fontSize: 12, color: 'var(--ink-3)', minWidth: 36, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
                        </div>
                      );
                    })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Expense list */}
      <div className="card">
        <div className="card-head">
          <h3>Expenses</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="date" value={filterFrom} onChange={ev => setFilterFrom(ev.target.value)}
              style={{ padding: '4px 8px', border: '1px solid var(--line)', borderRadius: 7, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 12, outline: 'none' }} />
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>–</span>
            <input type="date" value={filterTo} onChange={ev => setFilterTo(ev.target.value)}
              style={{ padding: '4px 8px', border: '1px solid var(--line)', borderRadius: 7, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 12, outline: 'none' }} />
            {(filterFrom || filterTo) && (
              <button onClick={() => { setFilterFrom(''); setFilterTo(''); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 16, lineHeight: 1, padding: '0 2px' }} title="Clear filter">×</button>
            )}
            <button onClick={() => setExpenseModal(true)} style={{ padding: '5px 12px', border: 'none', borderRadius: 8, background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 13 }}>+ Add</button>
          </div>
        </div>
        {/* Sort controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 10, borderBottom: '1px solid var(--line)', marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--ink-3)', marginRight: 2 }}>Sort:</span>
          {[['date','Date'], ['amount','Amount'], ['merchant','Merchant']].map(([val, lbl]) => (
            <button key={val} onClick={() => {
              if (sortBy === val) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
              else { setSortBy(val); setSortDir(val === 'merchant' ? 'asc' : 'desc'); }
            }} style={{
              padding: '3px 10px', border: '1px solid var(--line)', borderRadius: 6,
              background: sortBy === val ? 'var(--accent)' : 'none',
              color: sortBy === val ? '#fff' : 'var(--ink-3)',
              cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
            }}>
              {lbl}{sortBy === val ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
            </button>
          ))}
        </div>
        {(() => {
          const filtered = expenses
            .filter(e => {
              if (filterFrom && e.date < filterFrom) return false;
              if (filterTo   && e.date > filterTo)   return false;
              if (filterUser && e.user !== filterUser) return false;
              return true;
            })
            .sort((a, b) => {
              let cmp = 0;
              if (sortBy === 'amount')   cmp = a.amount - b.amount;
              else if (sortBy === 'merchant') cmp = (a.description || '').localeCompare(b.description || '');
              else cmp = (a.date || '').localeCompare(b.date || '');
              return sortDir === 'asc' ? cmp : -cmp;
            });
          return filtered.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px 0', fontSize: 14 }}>
            {expenses.length === 0 ? 'No expenses yet — add one to get started.' : 'No expenses match this date range.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {filtered.map(e => {
              const catI = sharedCatById(e.category);
              const isMe = e.user === me?.username;
              const isEditingThis = editingNote?.id === e.id;
              return (
                <div key={e.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span className="cat-dot" style={{ background: catI.color, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div onClick={() => setActiveMerchantShared(e.description)} style={{ fontSize: 14, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: 2, textDecorationColor: 'var(--line-2)' }}>{e.description}</div>
                      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        <span style={{ flexShrink: 0 }}>{catI.name} · {e.date}</span>
                        {e.notes && !isEditingThis && (
                          <span onClick={ev => { ev.stopPropagation(); setEditingNote({ id: e.id, value: e.notes }); }}
                            style={{ color: 'var(--accent)', fontStyle: 'italic', cursor: 'text', overflow: 'hidden', textOverflow: 'ellipsis', marginLeft: 4 }}>
                            · {e.notes}
                          </span>
                        )}
                      </div>
                    </div>
                    <button onClick={() => setEditingNote(isEditingThis ? null : { id: e.id, value: e.notes || '' })}
                      title={e.notes ? 'Edit note' : 'Add note'}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: e.notes ? 'var(--accent)' : 'var(--ink-4)', fontSize: 14, lineHeight: 1, flexShrink: 0 }}>
                      💬
                    </button>
                    <div title={e.display_name || e.user} style={{ width: 26, height: 26, borderRadius: '50%', background: participantColors[e.user] || 'var(--ink-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                      {(e.display_name || e.user).slice(0,2).toUpperCase()}
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', minWidth: 72, textAlign: 'right' }}>{fmtMoney(e.amount)}</span>
                    {(isMe || isOwner) && (
                      <button onClick={() => deleteExpense(e.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', fontSize: 16, padding: '0 4px', lineHeight: 1 }} title="Delete">×</button>
                    )}
                  </div>
                  {isEditingThis && (
                    <div style={{ marginLeft: 20, marginTop: 6, display: 'flex', gap: 6 }}>
                      <input
                        autoFocus
                        value={editingNote.value}
                        onChange={ev => setEditingNote(n => ({ ...n, value: ev.target.value }))}
                        onKeyDown={ev => { if (ev.key === 'Enter') saveNote(e.id, editingNote.value); if (ev.key === 'Escape') setEditingNote(null); }}
                        placeholder="Add a note…"
                        maxLength={500}
                        style={{ flex: 1, padding: '5px 10px', border: '1px solid var(--accent)', borderRadius: 7, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13, outline: 'none' }}
                      />
                      <button onClick={() => saveNote(e.id, editingNote.value)}
                        style={{ padding: '5px 12px', border: 'none', borderRadius: 7, background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600 }}>Save</button>
                      <button onClick={() => setEditingNote(null)}
                        style={{ padding: '5px 10px', border: '1px solid var(--line)', borderRadius: 7, background: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'inherit', fontSize: 12 }}>Cancel</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
        })()}
      </div>

      {/* Share modal in detail view */}
      {shareModal && (
        <Portal>
        <div style={{ position: 'fixed', inset: 0, zIndex: 800, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShareModal(null)}>
          <div className="card" style={{ width: 380, margin: 0 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 12 }}>Share invite link</h3>
            <p style={{ color: 'var(--ink-3)', fontSize: 13, marginBottom: 12 }}>Anyone with this link who is logged in can join.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input readOnly value={shareModal.url} style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink)', fontSize: 13, fontFamily: 'monospace', outline: 'none' }} />
              <button onClick={() => { navigator.clipboard.writeText(shareModal.url); setCopied(true); setTimeout(() => setCopied(false), 2000); }} style={{ padding: '8px 16px', border: 'none', borderRadius: 8, background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, whiteSpace: 'nowrap' }}>
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <button onClick={() => setShareModal(null)} style={{ marginTop: 14, width: '100%', padding: '9px 0', border: '1px solid var(--line)', borderRadius: 8, background: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'inherit' }}>Done</button>
          </div>
        </div>
        </Portal>
      )}
    </div>
  );
}

function SpaceCard({ space, isOwner, onOpen, onShare, onDelete }) {
  return (
    <div className="card" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={onOpen}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 26, flexShrink: 0 }}>{space.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{space.name}</span>
            <span style={{ fontSize: 11, color: 'var(--ink-3)', background: 'var(--surface-2)', borderRadius: 4, padding: '1px 6px' }}>{space.type}</span>
            {!isOwner && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>by {space.owner_display_name || space.participants?.[0]}</span>}
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>
              {space.participants?.length > 1 ? `${space.participants.length} people` : 'just you'}
            </span>
            {space.last_activity && <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>{space.last_activity}</span>}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>${(space.total_spent || 0).toFixed(2)}</div>
        </div>
        {isOwner && (
          <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
            <button onClick={onShare} style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 13, color: 'var(--ink-3)' }} title="Share">🔗</button>
            <button onClick={onDelete} style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 13, color: 'var(--ink-3)' }} title="Delete">🗑</button>
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, {
  OverviewTab, MonthlyTab, TransactionsTab, FlowTab, SpendingTab, IncomeTab, CashFlowTab,
  NetWorthTab, AccountsTab, RecurringTab, CategoriesTab, TrendsTab,
  ChatTab, SettingsTab, AdminTab, TxnList, AccountList, ReviewTab, FlaggedTab, FeedbackTab,
  InvestmentsTab, TripsTab, SharedTab,
});
})();
