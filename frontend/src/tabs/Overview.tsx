// Tab component — see frontend/AGENTS.md for context
import { useState, useEffect, useRef, useMemo } from 'react';
import { MONTHS } from '@/lib/fin';
import { fmtMoney, fmtAbbr, fmt, txnsForMonth, sumByCategory, monthSummary, catById } from '@/lib/helpers';
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
// GROUPED TRANSACTION LIST
// Groups repeated merchants into collapsible rows
// ═══════════════════════════════════════════════════════════════════
function GroupedTxnList({ txns, sortBy, onRecategorize, refreshFin }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    // Group by merchant+category so "Costco Gas" and "Costco Grocery" stay separate
    const map = new Map<string, any[]>();
    txns.forEach(t => {
      const key = `${t.merchant}||${t.category}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    });
    const arr = [...map.entries()].map(([, items]) => {
      const total = items.reduce((s, t) => s + Math.abs(t.amount), 0);
      const lastDate = items.reduce((d, t) => t.date > d ? t.date : d, '');
      const cat = catById(items[0]?.category);
      const logo_url = items.find(t => (t as any).logo_url)?.logo_url as string | undefined;
      const merchant = items[0]?.merchant || '';
      return { merchant, items, total, lastDate, cat, logo_url };
    });
    if (sortBy === 'amount') return arr.sort((a, b) => b.total - a.total);
    return arr.sort((a, b) => b.lastDate.localeCompare(a.lastDate));
  }, [txns, sortBy]);

  function toggle(merchant: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(merchant) ? next.delete(merchant) : next.add(merchant);
      return next;
    });
  }

  return (
    <div className="txn-list compact">
      {groups.map(g => {
        const isOpen = expanded.has(g.merchant);
        const multi = g.items.length > 1;
        return (
          <div key={g.merchant}>
            {/* Group header row */}
            <div
              className="txn-row"
              style={{ cursor: multi ? 'pointer' : 'default' }}
              onClick={multi ? () => toggle(g.merchant) : undefined}
            >
              <div className="txn-icon" style={{ background: g.cat.color + '24', color: g.cat.color, overflow: 'hidden', padding: g.logo_url ? 0 : undefined }}>
                {g.logo_url
                  ? <img src={g.logo_url} alt="" width={36} height={36} style={{ display: 'block', borderRadius: 'inherit' }}
                      onError={e => { e.currentTarget.style.display = 'none'; (e.currentTarget.parentElement as HTMLElement).textContent = g.cat.icon; }} />
                  : g.cat.icon}
              </div>
              <div className="txn-main">
                <div className="txn-merchant">
                  <span>{g.merchant}</span>
                  {multi && (
                    <span style={{
                      marginLeft: 7, fontSize: 11, fontWeight: 600,
                      background: g.cat.color + '20', color: g.cat.color,
                      padding: '1px 7px', borderRadius: 20,
                    }}>
                      {g.items.length}×
                    </span>
                  )}
                </div>
                <div className="txn-meta">
                  <span className="cat-pill" style={{ color: g.cat.color }}>{g.cat.name}</span>
                </div>
              </div>
              <div className="txn-date">
                {g.lastDate.slice(5).replace('-', '/')}
              </div>
              <div className="txn-amt neg" style={{ fontWeight: multi ? 600 : undefined }}>
                -{fmtMoney(g.total)}
              </div>
              <div style={{ width: 20, textAlign: 'center', color: 'var(--ink-3)', fontSize: 12 }}>
                {multi ? (isOpen ? '▲' : '▼') : ''}
              </div>
            </div>

            {/* Expanded individual rows */}
            {isOpen && g.items
              .slice()
              .sort((a, b) => sortBy === 'date'
                ? b.date.localeCompare(a.date)
                : Math.abs(b.amount) - Math.abs(a.amount)
              )
              .map(t => (
                <div key={t.id} className="txn-row" style={{
                  paddingLeft: 28,
                  borderLeft: `3px solid ${g.cat.color}40`,
                  background: 'color-mix(in srgb, var(--surface) 60%, transparent)',
                }}>
                  <div className="txn-icon" style={{ background: g.cat.color + '14', color: g.cat.color, fontSize: 11 }}>
                    {g.cat.icon}
                  </div>
                  <div className="txn-main">
                    <div className="txn-merchant" style={{ fontSize: 13, color: 'var(--ink-2)' }}>{t.merchant}</div>
                    <div className="txn-meta">
                      {onRecategorize ? (
                        <span className="cat-pill" style={{ color: g.cat.color }}>{g.cat.name}</span>
                      ) : (
                        <span className="cat-pill" style={{ color: g.cat.color }}>{g.cat.name}</span>
                      )}
                      <span className="dot-sep">·</span>
                      <span style={{ fontSize: 11 }}>{t.account}</span>
                    </div>
                  </div>
                  <div className="txn-date">{t.date.slice(5).replace('-', '/')}</div>
                  <div className="txn-amt neg">{fmt(t.amount, { sign: true })}</div>
                  <div style={{ width: 20 }} />
                </div>
              ))
            }
          </div>
        );
      })}
    </div>
  );
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
        {/* "Where it went" — always visible; selected category is highlighted in the legend */}
        <div className="card">
          <div className="card-head"><h3>Where it went</h3><span className="muted">{MONTHS.find((m) => m.key === monthKey)?.label}</span></div>
          <div className="donut-row">
            <DonutChart data={breakdown} size={200} thickness={26} formatter={fmtMoney}
              selectedCat={selectedCat} onSliceClick={handleSliceClick} />
            <div className="donut-legend">
              {breakdown.map((b) => {
                const isSelected = selectedCat === b.cat;
                return (
                  <div key={b.cat} className="legend-row"
                    style={{
                      cursor: 'pointer',
                      opacity: selectedCat && !isSelected ? 0.35 : 1,
                      transition: 'opacity .15s',
                      background: isSelected ? b.color + '12' : undefined,
                      borderRadius: isSelected ? 6 : undefined,
                      padding: isSelected ? '1px 5px' : undefined,
                      margin: isSelected ? '0 -5px' : undefined,
                    }}
                    onClick={() => handleSliceClick(b)}>
                    <span className="cat-dot" style={{ background: b.color }} />
                    <span className="legend-name" style={{ fontWeight: isSelected ? 700 : undefined, color: isSelected ? 'var(--ink)' : undefined }}>{b.name}</span>
                    <span className="legend-amt" style={{ fontWeight: isSelected ? 700 : undefined, color: isSelected ? b.color : undefined }}>{fmtMoney(b.amount)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
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
          <GroupedTxnList txns={catTxns} sortBy={sortBy} onRecategorize={recat} refreshFin={refreshFin} />
        </div>
      )}
      {!selectedCat && (
        <div className="card">
          <div className="card-head">
            <h3>Transactions</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="muted">{monthTxns.length} this month · click a slice or Income to filter</span>
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
          <GroupedTxnList txns={catTxns} sortBy={sortBy} onRecategorize={recat} refreshFin={refreshFin} />
        </div>
      )}
    </div>
  );
}

export default MonthlyTab;
