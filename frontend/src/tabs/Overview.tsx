// Tab component — see frontend/AGENTS.md for context
import { useState, useEffect, useRef } from 'react';
import { MONTHS } from '@/lib/fin';
import { fmtMoney, fmtAbbr, txnsForMonth, sumByCategory, monthSummary } from '@/lib/helpers';
import { SummaryCard, TxnList } from '@/components';
import { DonutChart, AreaChart, Sparkline } from '@/components/charts';

function MonthHero({ summary, monthLabel }) {
  const netVal = useCountUp(summary?.net ?? 0);
  if (!summary || summary.income === 0) return null;
  const isPositive = summary.net >= 0;
  const savingsRate = summary.income > 0 ? (summary.net / summary.income) * 100 : 0;
  return (
    <div className="month-hero">
      <div className="hero-eyebrow">{monthLabel} · Monthly Summary</div>
      <div className={`hero-net ${isPositive ? 'positive' : 'negative'}`}>
        {isPositive ? '' : '–'}{fmtMoney(Math.abs(netVal))}
      </div>
      <div className="hero-sublabel">{isPositive ? 'net saved this month' : 'spent over income this month'}</div>
      <div className="hero-stats">
        <div className="hero-stat">
          <span className="hero-stat-val">{fmtMoney(summary.income)}</span>
          <span className="hero-stat-key">Income</span>
        </div>
        <div className="hero-stat-divider" />
        <div className="hero-stat">
          <span className="hero-stat-val">{fmtMoney(summary.expenses)}</span>
          <span className="hero-stat-key">Expenses</span>
        </div>
        <div className="hero-stat-divider" />
        <div className="hero-stat">
          <span className="hero-stat-val">{savingsRate.toFixed(0)}%</span>
          <span className="hero-stat-key">Saved</span>
        </div>
      </div>
    </div>
  );
}

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
  const [val, setVal] = useState(0);
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

// ═══════════════════════════════════════════════════════════════════
// OVERVIEW TAB
// ═══════════════════════════════════════════════════════════════════
function MonthlyTab({ monthKey, txnOverrides, setTxnOverrides, refreshFin }) {
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

  const monthLabel = MONTHS.find(m => m.key === monthKey)?.label ?? monthKey;

  return (
    <div className="tab-body">
      <MonthHero summary={summary} monthLabel={monthLabel} />
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

export default MonthlyTab;
