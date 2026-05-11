// Tab components for the finance dashboard.
// Loaded after data.js, charts.jsx, and React.
(function () {
const { useState, useMemo, useEffect } = React;
const { ACCOUNTS, CATEGORIES, MONTHS, TRANSACTIONS, RECURRING, NET_WORTH_HISTORY,
  txnsForMonth, sumByCategory, monthSummary, fmt, catById, acctById } = window.FIN;
const { DonutChart, StackedBarChart, AreaChart, Sparkline, BarList } = window;

// Live categories cache — initialized from bootstrap data, refreshed after edits.
// CategoryPicker reads this so reorders/renames show immediately without page reload.
let _liveCategories = [...CATEGORIES];
async function refreshLiveCategories() {
  try {
    const res  = await fetch('/api/categories');
    const data = await res.json();
    if (data.categories) {
      _liveCategories = data.categories.filter(c => c.id !== 'transfer' && c.id !== 'savings');
    }
  } catch(e) { /* keep existing */ }
}

const fmtMoney = (v) => fmt(v, { decimals: 0 });
const fmtMoney2 = (v) => fmt(v, { decimals: 2 });
const fmtAbbr = (v) => fmt(v, { decimals: 0, abbr: true });

// ─── Reusable: Summary card ────────────────────────────────────────
function SummaryCard({ label, value, sub, trend, accent, spark }) {
  return (
    <div className="card sum-card">
      <div className="sum-label">{label}</div>
      <div className="sum-value" style={{ color: accent || 'var(--ink)' }}>{value}</div>
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
function MonthlyTab({ monthKey }) {
  const summary = monthSummary(monthKey);
  const monthTxns = txnsForMonth(monthKey);
  const breakdown = sumByCategory(monthTxns).slice(0, 6);
  const recent = monthTxns.slice(0, 6);
  const incomeSeries  = MONTHS.map((m) => ({ label: m.short, value: monthSummary(m.key).income }));
  const expenseSeries = MONTHS.map((m) => ({ label: m.short, value: monthSummary(m.key).expenses }));
  const prevIdx = MONTHS.findIndex((m) => m.key === monthKey) - 1;
  const prev = prevIdx >= 0 ? monthSummary(MONTHS[prevIdx].key) : null;
  const trend = (cur, prv) => prv ? ((cur - prv) / prv) * 100 : 0;
  return (
    <div className="tab-body">
      <div className="grid-4">
        <SummaryCard label="Income" value={fmtMoney(summary.income)} accent="var(--green)"
          trend={prev ? trend(summary.income, prev.income) : null}
          spark={incomeSeries.map((p) => p.value)} />
        <SummaryCard label="Expenses" value={fmtMoney(summary.expenses)} accent="var(--terra)"
          trend={prev ? trend(summary.expenses, prev.expenses) : null}
          spark={expenseSeries.map((p) => p.value)} />
        <SummaryCard label="Net" value={fmtMoney(summary.net)} accent={summary.net >= 0 ? 'var(--green)' : 'var(--terra)'}
          sub={`${summary.income > 0 ? ((summary.net / summary.income) * 100).toFixed(0) : 0}% savings rate`} />
        <SummaryCard label="Saved" value={fmtMoney(summary.savings)} accent="var(--accent2)"
          sub="auto-transfers + IRA" />
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h3>Cash flow</h3><span className="muted">Last 6 months</span></div>
          <AreaChart series={[
            { key: 'inc', name: 'Income',   color: '#5ec98a', points: incomeSeries },
            { key: 'exp', name: 'Expenses', color: '#d97757', points: expenseSeries },
          ]} height={240} formatter={fmtAbbr} />
        </div>
        <div className="card">
          <div className="card-head"><h3>Where it went</h3><span className="muted">{MONTHS.find((m) => m.key === monthKey)?.label}</span></div>
          <div className="donut-row">
            <DonutChart data={breakdown} size={200} thickness={26} formatter={fmtMoney} />
            <div className="donut-legend">
              {breakdown.map((b) => (
                <div key={b.cat} className="legend-row">
                  <span className="cat-dot" style={{ background: b.color }} />
                  <span className="legend-name">{b.name}</span>
                  <span className="legend-amt">{fmtMoney(b.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h3>Recent transactions</h3><span className="muted">{monthTxns.length} this month</span></div>
          <TxnList txns={recent} compact />
        </div>
        <div className="card">
          <div className="card-head"><h3>Top categories</h3><span className="muted">This month</span></div>
          <BarList data={breakdown} formatter={fmtMoney} />
        </div>
      </div>
    </div>
  );
}

// ─── Overview Tab (month-agnostic, draggable widgets) ──────────────────────
const OVERVIEW_WIDGETS = [
  { id: 'networth',  label: 'Net Worth'          },
  { id: 'quality',   label: 'Data Quality'       },
  { id: 'anomalies', label: 'Spending Alerts'    },
  { id: 'merchants', label: 'Top Merchants'      },
  { id: 'trends',    label: 'Spending Trends'    },
  { id: 'recurring', label: 'Upcoming Bills'     },
  { id: 'recent',    label: 'Recent Transactions'},
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
        {children}
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

  // Net worth from account balances
  const netWorth = useMemo(() => {
    let assets = 0, liabilities = 0;
    ACCOUNTS.forEach(a => {
      if (a.type === 'credit') liabilities += Math.abs(a.balance);
      else assets += Math.max(a.balance, 0);
    });
    return { total: assets - liabilities, assets, liabilities };
  }, []);

  // Top merchants last 30 days
  const topMerchants = useMemo(() => {
    const map = {};
    allTxns.filter(t => t.date >= ago30 && t.amount > 0).forEach(t => {
      map[t.merchant] = (map[t.merchant] || 0) + t.amount;
    });
    return Object.entries(map).sort((a,b) => b[1]-a[1]).slice(0, 8)
      .map(([name, amt]) => ({ name, amt }));
  }, []);

  // Spending anomalies: current month vs 3-month avg
  const anomalies = useMemo(() => {
    const curMonth = today.slice(0, 7);
    const catTotals = (from, to) => {
      const map = {};
      allTxns.filter(t => t.date >= from && t.date <= to && t.amount > 0).forEach(t => {
        map[t.category] = (map[t.category] || 0) + t.amount;
      });
      return map;
    };
    const cur = catTotals(curMonth + '-01', today);
    const prev3 = catTotals(ago90, (new Date(curMonth + '-01') - 1).toISOString ? ago90 : ago90);
    // avg = prev 90 days / 3
    const alerts = [];
    Object.entries(cur).forEach(([cat, curAmt]) => {
      const p3Total = allTxns.filter(t => t.date >= ago90 && t.date < curMonth + '-01'
        && t.category === cat && t.amount > 0).reduce((s, t) => s + t.amount, 0);
      const avg = p3Total / 3;
      if (avg > 20 && curAmt > avg * 1.25 && curAmt - avg > 50) {
        const catInfo = catById(cat);
        alerts.push({ cat, name: catInfo.name, color: catInfo.color, cur: curAmt, avg, pct: Math.round((curAmt/avg-1)*100) });
      }
    });
    return alerts.sort((a,b) => b.pct - a.pct).slice(0, 4);
  }, []);

  // Spending trends: last 6 months per top category
  const trends = useMemo(() => {
    const last6 = MONTHS.slice(-6);
    const topCats = [...new Set(
      allTxns.filter(t => t.amount > 0).sort((a,b) => b.amount - a.amount)
        .slice(0, 100).map(t => t.category)
    )].slice(0, 5);
    return topCats.map(cat => {
      const catInfo = catById(cat);
      const points = last6.map(m => ({
        label: m.short,
        value: allTxns.filter(t => t.date.startsWith(m.key) && t.category === cat && t.amount > 0)
          .reduce((s,t) => s + t.amount, 0),
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

  // Data quality stats — fetched from /api/review
  const [reviewStats, setReviewStats] = useState(null);
  useEffect(() => {
    fetch('/api/review')
      .then(r => r.json())
      .then(d => setReviewStats(d))
      .catch(() => {});
  }, []);

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
              <span style={{ fontWeight: 500, color: a.type === 'credit' ? 'var(--terra)' : 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                {a.type === 'credit' ? '−' : ''}{fmt(Math.abs(a.balance), { decimals: 0 })}
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
        <TxnList txns={recentTxns} compact />
      </DragCard>
    );

    return null;
  }

  return (
    <div className="tab-body">
      <div className="grid-2">
        {order.map((id, idx) => renderWidget(id, idx))}
      </div>
      <div style={{ textAlign: 'center', marginTop: 8, fontSize: 11, color: 'var(--line-2)' }}>
        Drag widgets to reorder
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

function TxnList({ txns, compact = false, onRecategorize }) {
  const [splitTxn, setSplitTxn] = useState(null);

  function handleSplitClose(reload) {
    setSplitTxn(null);
    if (reload) window.location.reload();
  }

  return (
    <>
      <div className={`txn-list ${compact ? 'compact' : ''}`}>
        {txns.map((t) => {
          const cat = catById(t.category);
          const acct = acctById(t.account);
          const isSplit = t.is_split;
          return (
            <div key={t.id} className="txn-row" style={isSplit ? { paddingLeft: 28, borderLeft: `3px solid ${cat.color}40` } : {}}>
              <div className="txn-icon" style={{ background: cat.color + '24', color: cat.color }}>
                {isSplit ? '⋮' : cat.icon}
              </div>
              <div className="txn-main">
                <div className="txn-merchant">
                  {t.merchant}
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
                </div>
              </div>
              <div className="txn-date">{t.date.slice(5).replace('-', '/')}</div>
              <div className={`txn-amt ${t.amount >= 0 ? 'pos' : 'neg'}`}>
                {fmt(t.amount, { sign: true })}
              </div>
              {onRecategorize && !isSplit && !compact && (
                <button
                  title="Split transaction"
                  onClick={() => setSplitTxn(t)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--muted)', fontSize: 14, padding: '0 4px',
                    opacity: 0.5, marginLeft: 4, lineHeight: 1,
                  }}
                >⋮</button>
              )}
            </div>
          );
        })}
      </div>
      {splitTxn && <SplitModal txn={splitTxn} onClose={handleSplitClose} />}
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
function TransactionsTab({ monthKey, txnOverrides, setTxnOverrides, search: globalSearch = '', setSearch: setGlobalSearch }) {
  const [search, setSearch] = useState(globalSearch);
  const [catFilter, setCatFilter] = useState('all');
  const [acctFilter, setAcctFilter] = useState('all');

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
        if (data.semantic && data.merchants) {
          setSemMerchants(new Set(data.merchants));
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
    if (search) {
      if (semMerchants) {
        // Semantic results: match against server-returned merchants OR substring fallback
        if (!semMerchants.has(t.merchant)) {
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
          // Reload after a moment so auto-applied changes are visible
          setTimeout(() => window.location.reload(), 2000);
        }
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
          <div className="filter-stats">
            <span><b>{filtered.length}</b> txns</span>
            <span className="pos">+{fmtMoney(totalIn)}</span>
            <span className="neg">−{fmtMoney(totalOut)}</span>
          </div>
        </div>
        <TxnList txns={filtered} onRecategorize={recat} />
        {filtered.length === 0 && <div className="empty">No transactions match your filters.</div>}
      </div>
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

// ═══════════════════════════════════════════════════════════════════
// SPENDING TAB
// ═══════════════════════════════════════════════════════════════════
function SpendingTab({ monthKey }) {
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
        <SummaryCard label="Total spend" value={fmtMoney(total)} accent="var(--terra)" />
        <SummaryCard label="Daily average"
          value={fmtMoney(total / 30)} accent="var(--ink)"
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
        <div className="card-head">
          <h3>Spend distribution</h3>
          <span className="muted">By category</span>
        </div>
        <div className="donut-row centered">
          <DonutChart data={breakdown} size={240} thickness={32} formatter={fmtMoney} />
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// INCOME TAB
// ═══════════════════════════════════════════════════════════════════
function IncomeTab({ monthKey }) {
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
        <SummaryCard label="Income this month" value={fmtMoney(total)} accent="var(--green)" />
        <SummaryCard label="6-month average" value={fmtMoney(avg)} accent="var(--ink)" />
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
        <SummaryCard label="6-mo income" value={fmtMoney(totalIn)} accent="var(--green)" />
        <SummaryCard label="6-mo expenses" value={fmtMoney(totalOut)} accent="var(--terra)" />
        <SummaryCard label="6-mo net" value={fmtMoney(totalNet)}
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

  return (
    <div className="tab-body">
      <div className="grid-3">
        <SummaryCard label="Net worth" value={fmtMoney(net)} accent="var(--accent2)"
          trend={3.2} />
        <SummaryCard label="Total assets" value={fmtMoney(assets)} accent="var(--green)"
          sub={`${ACCOUNTS.filter((a) => a.balance > 0).length} accounts`} />
        <SummaryCard label="Total liabilities" value={fmtMoney(liabilities)} accent="var(--terra)"
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

function AccountsTab() {
  const { useState, useEffect } = React;
  const [plaidAccounts, setPlaidAccounts] = useState([]);
  const [configured, setConfigured]       = useState(false);
  const [syncing, setSyncing]             = useState(false);
  const [syncResult, setSyncResult]       = useState(null);
  const [linking, setLinking]             = useState(false);
  const [error, setError]                 = useState('');

  const loadAccounts = () =>
    fetch('/api/plaid/accounts').then(r => r.json()).then(d => {
      setConfigured(d.configured);
      setPlaidAccounts(d.accounts || []);
    });

  useEffect(() => { loadAccounts(); }, []);

  async function openPlaidLink() {
    setError('');
    setLinking(true);
    try {
      const res = await fetch('/api/plaid/link-token', { method: 'POST' });
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
          await fetch('/api/plaid/exchange', {
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

  async function syncNow(full = false) {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res  = await fetch('/api/plaid/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full }),
      });
      const data = await res.json();
      setSyncResult({ ...data, full });
      // Reload the page after a successful sync so window.FIN reflects new transactions
      if (data.ok && (data.stats?.added > 0 || data.stats?.modified > 0 || data.stats?.removed > 0)) {
        setTimeout(() => window.location.reload(), 1200);
      }
    } catch (e) {
      setSyncResult({ ok: false, error: String(e) });
    } finally {
      setSyncing(false);
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
              <button onClick={() => syncNow(false)} disabled={syncing} style={{
                background: 'var(--accent)', color: '#052015', border: 'none',
                borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 600,
                fontFamily: 'inherit', cursor: syncing ? 'default' : 'pointer',
                opacity: syncing ? 0.6 : 1,
              }}>{syncing ? 'Syncing…' : 'Sync now'}</button>
              <button onClick={() => syncNow(true)} disabled={syncing} title="Reset cursors and re-pull full transaction history" style={{
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
        <SummaryCard label="Monthly recurring" value={fmtMoney(monthlyTotal)} accent="var(--accent)" />
        <SummaryCard label="Subscriptions" value={fmtMoney(subsTotal)} accent="#a78bfa"
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
function CategoriesTab({ monthKey }) {
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
function TrendsTab() {
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
        <div className="card-head"><h3>Month-by-month</h3></div>
        <table className="trend-table">
          <thead>
            <tr>
              <th>Month</th><th>Income</th><th>Expenses</th><th>Net</th><th>Savings rate</th>
            </tr>
          </thead>
          <tbody>
            {[...data].reverse().map((d) => (
              <tr key={d.key}>
                <td>{d.label}</td>
                <td className="pos">{fmtMoney(d.income)}</td>
                <td className="neg">{fmtMoney(d.expenses)}</td>
                <td className={d.net >= 0 ? 'pos' : 'neg'}>{fmt(d.net, { sign: true, decimals: 0 })}</td>
                <td>{d.savingsRate.toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
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
  const [messages, setMessages] = React.useState([]);
  const [sqlLog, setSqlLog] = React.useState({});
  const [input, setInput] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [configOk, setConfigOk] = React.useState(null);
  const bottomRef = React.useRef(null);

  // Check if AI is configured
  React.useEffect(() => {
    fetch('/api/config').then((r) => r.json()).then((cfg) => {
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

  const send = async (text) => {
    if (!text.trim() || loading) return;
    const userMsg = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    try {
      const res = await fetch('/api/chat', {
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
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send(input))}
          placeholder="Ask about your spending, income, trends…"
          style={{
            flex: 1, padding: '10px 14px', borderRadius: 10,
            border: '1px solid var(--border)', fontSize: 14,
            fontFamily: 'inherit', background: 'var(--surface)',
            outline: 'none',
          }}
        />
        <button onClick={() => send(input)} disabled={!input.trim() || loading} style={{
          background: 'var(--accent)', color: '#052015', border: 'none',
          borderRadius: 10, padding: '10px 18px', fontWeight: 600,
          fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
          opacity: (!input.trim() || loading) ? 0.5 : 1,
        }}>Send</button>
        {messages.length > 0 && (
          <button onClick={() => { setMessages([]); setSqlLog({}); }} style={{
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
  const [syncing, setSyncing]   = useState(false);
  const [result,  setResult]    = useState(null);

  async function sync(full = false) {
    setSyncing(true); setResult(null);
    try {
      const res  = await fetch('/api/plaid/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full }),
      });
      const data = await res.json();
      setResult({ ...data, full });
      if (data.ok && (data.stats?.added > 0 || data.stats?.modified > 0 || data.stats?.removed > 0)) {
        setTimeout(() => window.location.reload(), 1200);
      }
    } catch (e) {
      setResult({ ok: false, error: String(e) });
    } finally {
      setSyncing(false);
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
          <button onClick={() => sync(false)} disabled={syncing} style={{
            flex: 1, background: 'var(--accent)', color: '#052015', border: 'none',
            borderRadius: 10, padding: '11px 0', fontWeight: 600, fontSize: 14,
            fontFamily: 'inherit', cursor: syncing ? 'default' : 'pointer', opacity: syncing ? 0.6 : 1,
          }}>{syncing ? 'Syncing…' : 'Sync now'}</button>
          <button onClick={() => sync(true)} disabled={syncing} style={{
            flex: 1, background: 'transparent', color: 'var(--ink-2)',
            border: '1px solid var(--line)', borderRadius: 10, padding: '11px 0',
            fontWeight: 500, fontSize: 14, fontFamily: 'inherit',
            cursor: syncing ? 'default' : 'pointer', opacity: syncing ? 0.6 : 1,
          }}>Full re-sync</button>
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
    fetch('/api/categories').then(r => r.json()).then(d => {
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
    await fetch('/api/categories/reorder', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ order: next.map(c => c.id) }),
    });
    refreshLiveCategories();
  }

  async function addCat() {
    if (!newName.trim()) return;
    setAddErr('');
    const res  = await fetch('/api/categories', {
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
function SettingsTab() {
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

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(d => {
      setCfg(d);
      setProvider(d.preferred_provider || 'claude');
      if (d.plaid_environment) setPlaidEnv(d.plaid_environment);
      if (d.plaid_redirect_uri) setPlaidRedirect(d.plaid_redirect_uri);
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
      const res = await fetch('/api/upload', { method: 'POST', body: form });
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
    const body = { preferred_provider: provider, plaid_environment: plaidEnv };
    if (claudeKey)    body.anthropic_api_key  = claudeKey;
    if (geminiKey)    body.gemini_api_key     = geminiKey;
    if (plaidId)      body.plaid_client_id    = plaidId;
    if (plaidSecret)  body.plaid_secret       = plaidSecret;
    body.plaid_redirect_uri = plaidRedirect.trim() || null;
    await fetch('/api/config', {
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

      <Card title="AI Provider">
        <div style={{ display: 'grid', gap: 16 }}>
          <div>
            <Label>Preferred provider</Label>
            <div style={{ display: 'flex', gap: 10 }}>
              {['claude', 'gemini'].map(p => (
                <button key={p} onClick={() => setProvider(p)} style={{
                  flex: 1, padding: '9px 0', borderRadius: 9, fontSize: 14,
                  fontFamily: 'inherit', cursor: 'pointer', fontWeight: 500,
                  border: provider === p ? '2px solid var(--accent)' : '1px solid var(--border)',
                  background: provider === p ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--bg)',
                  color: provider === p ? 'var(--accent)' : 'var(--muted)',
                }}>
                  {p === 'claude' ? 'Claude (Anthropic)' : 'Gemini (Google)'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label><StatusDot active={cfg?.has_anthropic} />Anthropic API key {cfg?.has_anthropic ? '(saved)' : '(not set)'}</Label>
            <input type="password" value={claudeKey} onChange={e => setClaudeKey(e.target.value)}
              placeholder="sk-ant-…"
              style={{ width: '100%', padding: '10px 14px', borderRadius: 10, boxSizing: 'border-box',
                border: '1px solid var(--border)', fontSize: 14, fontFamily: 'inherit',
                background: 'var(--bg)', color: 'var(--text)', outline: 'none' }} />
          </div>

          <div>
            <Label><StatusDot active={cfg?.has_gemini} />Gemini API key {cfg?.has_gemini ? '(saved)' : '(not set)'}</Label>
            <input type="password" value={geminiKey} onChange={e => setGeminiKey(e.target.value)}
              placeholder="AIza…"
              style={{ width: '100%', padding: '10px 14px', borderRadius: 10, boxSizing: 'border-box',
                border: '1px solid var(--border)', fontSize: 14, fontFamily: 'inherit',
                background: 'var(--bg)', color: 'var(--text)', outline: 'none' }} />
          </div>

          <button onClick={saveConfig} disabled={saving} style={{
            background: 'var(--accent)', color: '#052015', border: 'none',
            borderRadius: 10, padding: '11px 0', fontWeight: 600, fontSize: 14,
            fontFamily: 'inherit', cursor: 'pointer', opacity: saving ? 0.6 : 1, width: '100%',
          }}>
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save settings'}
          </button>
        </div>
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
              const res = await fetch('/api/repair', { method: 'POST' });
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
// REVIEW TAB
// ═══════════════════════════════════════════════════════════════════
function ReviewTab() {
  const { useState, useEffect, useCallback } = React;

  const [state, setState]     = useState(null);   // {batch, total, approved, remaining}
  const [edits, setEdits]     = useState({});      // {txn_id: new_category}
  const [approving, setApp]   = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/review')
      .then(r => r.json())
      .then(d => { setState(d); setEdits({}); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function approveBatch() {
    if (!state?.batch?.length) return;
    setApp(true);
    const ids = state.batch.map(t => t.id);
    await fetch('/api/review/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, overrides: edits }),
    });
    setApp(false);
    load();
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: 'var(--muted)', fontSize: 14 }}>
      Loading…
    </div>
  );

  const { batch = [], total = 0, approved = 0, remaining = 0,
          streak = 0, last_reviewed = null } = state || {};
  const pct = total > 0 ? Math.round((approved / total) * 100) : 100;
  const allDone = remaining === 0;

  // Days since last review
  const daysSince = last_reviewed
    ? Math.floor((Date.now() - new Date(last_reviewed)) / 864e5)
    : null;
  const lastReviewedLabel = daysSince === null ? 'Never reviewed'
    : daysSince === 0 ? 'Reviewed today'
    : daysSince === 1 ? 'Reviewed yesterday'
    : `Last reviewed ${daysSince}d ago`;

  return (
    <div className="tab-body" style={{ maxWidth: 680, margin: '0 auto' }}>

      {/* Progress header */}
      <div style={{
        background: 'var(--surface)', borderRadius: 16,
        border: '1px solid var(--line)', padding: '20px 24px',
        marginBottom: 20,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Transaction Review</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
              {allDone ? 'All caught up!' : `${approved} of ${total} approved · ${remaining} remaining`}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
              {pct}%
            </div>
            {streak > 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 4,
                fontSize: 12, fontWeight: 600,
                color: streak >= 4 ? '#f97316' : streak >= 2 ? '#fbbf24' : 'var(--muted)',
              }}>
                {streak >= 2 ? '🔥' : '✓'} {streak} week{streak !== 1 ? 's' : ''} in a row
              </div>
            )}
            {daysSince !== null && (
              <div style={{ fontSize: 11, color: daysSince > 7 ? 'var(--terra)' : 'var(--muted)' }}>
                {lastReviewedLabel}
              </div>
            )}
          </div>
        </div>
        {/* Progress bar */}
        <div style={{ height: 6, background: 'var(--line)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${pct}%`, borderRadius: 3,
            background: 'linear-gradient(90deg, var(--accent), var(--accent2, var(--accent)))',
            transition: 'width 0.4s ease',
          }} />
        </div>
      </div>

      {allDone ? (
        <div style={{
          background: 'var(--surface)', borderRadius: 16,
          border: '1px solid var(--line)', padding: '48px 24px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
          <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>You're all caught up!</div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            All {total} transactions reviewed. New ones will appear here after your next sync.
          </div>
        </div>
      ) : (
        <>
          {/* Batch card */}
          <div style={{
            background: 'var(--surface)', borderRadius: 16,
            border: '1px solid var(--line)', overflow: 'hidden',
            marginBottom: 16,
          }}>
            <div style={{
              padding: '14px 20px',
              borderBottom: '1px solid var(--line)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                Next {batch.length} transactions
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                Set category, then approve
              </div>
            </div>

            {batch.map((t, i) => {
              const cat = edits[t.id] || t.category;
              const catInfo = FIN.catById(cat);
              const isExpense = t.amount >= 0;
              return (
                <div key={t.id} style={{
                  display: 'grid',
                  gridTemplateColumns: '80px 1fr auto',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 20px',
                  borderBottom: i < batch.length - 1 ? '1px solid var(--line)' : 'none',
                  background: i % 2 === 0 ? 'transparent' : 'color-mix(in srgb, var(--line) 30%, transparent)',
                }}>
                  {/* Date */}
                  <div style={{ fontSize: 12, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {t.date.slice(5)}
                  </div>

                  {/* Description + category picker */}
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4,
                    }}>
                      <div style={{
                        fontSize: 13, fontWeight: 500, color: 'var(--ink)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        flex: 1, minWidth: 0,
                      }}>{t.description}</div>
                      {t.confidence === 'low' && (
                        <span title="Needs your attention — category uncertain" style={{
                          fontSize: 10, padding: '1px 6px', borderRadius: 8, flexShrink: 0,
                          background: '#fef3c7', color: '#d97706', fontWeight: 600,
                        }}>?</span>
                      )}
                    </div>
                    <CategoryPicker
                      value={cat}
                      onChange={(c) => setEdits(prev => ({ ...prev, [t.id]: c }))}
                    />
                  </div>

                  {/* Amount */}
                  <div style={{
                    fontSize: 14, fontWeight: 600,
                    color: isExpense ? 'var(--ink)' : 'var(--accent)',
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
                  }}>
                    {isExpense ? '−' : '+'}{FIN.fmt(Math.abs(t.amount))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Approve button */}
          <button onClick={approveBatch} disabled={approving} style={{
            width: '100%', padding: '14px 0',
            background: 'var(--accent)', color: '#052015',
            border: 'none', borderRadius: 14,
            fontSize: 15, fontWeight: 700,
            fontFamily: 'inherit', cursor: approving ? 'default' : 'pointer',
            opacity: approving ? 0.7 : 1,
            letterSpacing: '0.01em',
          }}>
            {approving ? 'Saving…' : `✓ Approve these ${batch.length} transactions`}
          </button>
          <div style={{ textAlign: 'center', marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
            Approved transactions are locked and won't be changed by the system
          </div>
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
    fetch('/api/feedback')
      .then(r => r.json())
      .then(d => { setEntries(d.entries || []); setIsAdmin(d.is_admin); });
  }, [sent]);

  async function submit() {
    if (!msg.trim()) return;
    setSending(true); setErr('');
    try {
      const res = await fetch('/api/feedback', {
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

Object.assign(window, {
  OverviewTab, MonthlyTab, TransactionsTab, SpendingTab, IncomeTab, CashFlowTab,
  NetWorthTab, AccountsTab, RecurringTab, CategoriesTab, TrendsTab,
  ChatTab, SettingsTab, TxnList, AccountList, ReviewTab, FeedbackTab,
});
})();
