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
    const res  = await fetch('/api/categories');
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
    ? monthTxns.filter(t => t.category === selectedCat).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
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
        <SummaryCard label="Expenses" n={summary.expenses} accent="var(--terra)"
          trend={prev ? trend(summary.expenses, prev.expenses) : null}
          spark={expenseSeries.map((p) => p.value)} />
        <SummaryCard label="Net" n={summary.net} accent={summary.net >= 0 ? 'var(--green)' : 'var(--terra)'}
          sub={`${summary.income > 0 ? ((summary.net / summary.income) * 100).toFixed(0) : 0}% savings rate`} />
        <SummaryCard label="Saved" n={summary.savings} accent="var(--accent2)"
          sub="auto-transfers + IRA" />
      </div>
      <MonthVibeBanner summary={summary} prev={prev} />
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
      </div>
      <div className="card">
        <div className="card-head">
          <h3>
            {catInfo
              ? <><span className="cat-dot" style={{ background: catInfo.color, display: 'inline-block', marginRight: 6 }} />{catInfo.name}</>
              : 'Recent transactions'}
          </h3>
          {catInfo
            ? <button onClick={() => setSelectedCat(null)} style={{
                background: 'none', border: '1px solid var(--line)', borderRadius: 6,
                padding: '2px 10px', fontSize: 12, color: 'var(--ink-3)', cursor: 'pointer',
              }}>Clear</button>
            : <span className="muted">{monthTxns.length} this month · click a slice or Income to filter</span>
          }
        </div>
        <TxnList txns={catTxns} compact onRecategorize={recat} refreshFin={refreshFin} />
      </div>
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
      facts.push({ emoji: catInfo.icon || '💸', text: `${catInfo.name} is your #1 spending category at ${topPct}% of total spend.` });
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
    fetch('/api/review')
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
              <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>
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
        <TxnList txns={recentTxns} compact />
      </DragCard>
    );

    if (id === 'funfact') return (
      <DragCard key={id} id={id} index={index} order={order} onReorder={handleReorder} title="✨ Fun Fact">
        {!funFact ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>Not enough data yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 36, lineHeight: 1 }}>{funFact.emoji}</span>
              <p style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.6, margin: 0 }}>
                {funFact.text}
              </p>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', borderTop: '1px solid var(--line)', paddingTop: 10 }}>
              Fun facts update daily based on your spending patterns.
            </div>
          </div>
        )}
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
      const res = await fetch('/api/transactions', {
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

function TxnList({ txns, compact = false, onRecategorize, refreshFin }) {
  const [splitTxn, setSplitTxn]     = useState(null);
  const [editDateId, setEditDateId] = useState(null);
  const [editTxn, setEditTxn]       = useState(null);
  const [menuId, setMenuId]         = useState(null);
  const [sortCol, setSortCol]       = useState('date');
  const [sortDir, setSortDir]       = useState('desc');
  const [dateOverrides, setDateOverrides] = useState({});

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortCol(col); setSortDir('desc'); }
  }

  const sorted = [...txns].sort((a, b) => {
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
                        { label: 'Split', action: () => { setSplitTxn(t); setMenuId(null); } },
                        { label: 'Delete', action: async () => {
                          setMenuId(null);
                          if (!confirm(`Delete "${t.merchant}"?`)) return;
                          await fetch(`/api/transactions/${t.id}`, { method: 'DELETE' });
                          if (refreshFin) refreshFin();
                        }, danger: true },
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
          setSemMerchants(new Map(data.merchants.map(m => [m, data.scores?.[m] ?? 0])));
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
        <TxnList txns={filtered} onRecategorize={recat} refreshFin={refreshFin} />
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
    fetch('/api/budgets')
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
      const res = await fetch('/api/budgets', {
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
        setTimeout(() => { if (refreshFin) refreshFin(); }, 1200);
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
              {['claude', 'gemini', 'ollama'].map(p => (
                <button key={p} onClick={() => setProvider(p)} style={{
                  flex: 1, padding: '9px 0', borderRadius: 9, fontSize: 14,
                  fontFamily: 'inherit', cursor: 'pointer', fontWeight: 500,
                  border: provider === p ? '2px solid var(--accent)' : '1px solid var(--border)',
                  background: provider === p ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--bg)',
                  color: provider === p ? 'var(--accent)' : 'var(--muted)',
                }}>
                  {p === 'claude' ? 'Claude (Anthropic)' : p === 'gemini' ? 'Gemini (Google)' : 'Ollama (Local)'}
                </button>
              ))}
            </div>
            {provider === 'ollama' && (
              <div style={{ marginTop: 8, fontSize: 12, color: cfg?.has_ollama ? 'var(--accent)' : '#f87171', lineHeight: 1.5 }}>
                {cfg?.has_ollama ? '● Ollama is running (llama3.2)' : '● Ollama not detected — make sure it\'s running on localhost:11434'}
              </div>
            )}
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
// ALL-DONE CELEBRATION
// ═══════════════════════════════════════════════════════════════════
function AllDoneCelebration({ total, streak }) {
  const { useEffect, useState } = React;
  const [show, setShow] = useState(false);

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
          New transactions will appear here after your next sync.
        </div>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
// REVIEW TAB
// ═══════════════════════════════════════════════════════════════════
function ReviewTab({ refreshFin }) {
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
    if (!state?.batch?.length || approving) return;
    setApp(true);
    try {
      const ids = state.batch.map(t => t.id).filter(Boolean);
      // Rebuild overrides keyed by real txn_id (edits may use row-N fallback keys)
      const overrides = {};
      state.batch.forEach((t, i) => {
        const rowKey = t.id ?? `row-${i}`;
        if (edits[rowKey] && t.id) overrides[t.id] = edits[rowKey];
      });
      const res  = await fetch('/api/review/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, overrides }),
      });
      const data = await res.json();
      if (data.ok) {
        // Update counts immediately from the response so the UI reacts right away.
        // Only fetch the next batch if there are more transactions left.
        setState(prev => ({
          ...prev,
          approved:      data.approved,
          remaining:     data.remaining,
          streak:        data.streak,
          last_reviewed: data.last_reviewed,
          batch:         [],   // clear current batch; load() will fill it if needed
        }));
        setEdits({});
        if (refreshFin) refreshFin();
        if (data.remaining > 0) load();
      } else {
        load();  // fallback refresh on unexpected response
      }
    } catch (_) {
      load();    // fallback refresh on network error
    } finally {
      setApp(false);
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: 'var(--muted)', fontSize: 14 }}>
      Loading…
    </div>
  );

  const { batch = [], total = 0, approved = 0, remaining = 0,
          streak = 0, last_reviewed = null } = state || {};
  const pct = total > 0 ? Math.round((approved / total) * 100) : 100;
  const allDone = state !== null && remaining === 0;

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

      {allDone && total > 0 ? (
        <AllDoneCelebration total={total} streak={streak} />
      ) : allDone ? null : (
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
              const rowKey = t.id ?? `row-${i}`;
              const cat = edits[rowKey] || t.category;
              const catInfo = FIN.catById(cat);
              const isExpense = t.amount >= 0;
              return (
                <div key={rowKey} style={{
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
                      display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2,
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
                    {t.source && (
                      <div style={{
                        fontSize: 11, color: 'var(--muted)', marginBottom: 4,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>{t.source}</div>
                    )}
                    <CategoryPicker
                      value={cat}
                      onChange={(c) => setEdits(prev => ({ ...prev, [rowKey]: c }))}
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
            Change any category above, then approve to lock them in
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
