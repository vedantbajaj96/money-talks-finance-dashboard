// Tab component — see frontend/AGENTS.md for context
import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';
import { fmtMoney, fmtMoney2, fmtAbbr, fmt, catById, acctById, txnsForMonth, sumByCategory, monthSummary } from '@/lib/helpers';
import { TRANSACTIONS, CATEGORIES, ACCOUNTS, MONTHS, RECURRING, NET_WORTH_HISTORY } from '@/lib/fin';
import { SummaryCard, TxnList } from '@/components';
import { AreaChart, StackedBarChart, BarList } from '@/components/charts';
import { AccountList, RecurringTab } from './Wealth';
import { BudgetBars, WeeklySpendChart } from './Transactions';
import { SpendingTab, IncomeTab, FlowTab, CashFlowTab } from './Spending';

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
// CATEGORIES TAB
// ═══════════════════════════════════════════════════════════════════
// Clickable monthly bar chart for category detail
function CatHistoryBars({ months, color, onBarClick, activeMonthKey }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = months.map(m => m.value);
  const max = Math.max(...values, 1);
  const pad = { top: 20, right: 12, bottom: 32, left: 56 };
  const W = 720, H = 220;
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const barW = innerW / months.length * 0.55;
  const gap = innerW / months.length;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => max * f);

  return (
    <div className="chart-wrap" style={{ cursor: 'pointer' }}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        {ticks.map((v, i) => {
          const y = pad.top + innerH - (v / max) * innerH;
          return (
            <g key={i}>
              <line x1={pad.left} x2={W - pad.right} y1={y} y2={y}
                stroke={i === 0 ? 'rgba(20,24,32,0.12)' : 'rgba(20,24,32,0.05)'}
                strokeWidth="1" strokeDasharray={i === 0 ? undefined : '4 4'} />
              <text x={pad.left - 8} y={y + 4} textAnchor="end" className="chart-axis-label">
                {fmtAbbr(v)}
              </text>
            </g>
          );
        })}
        {months.map((m, i) => {
          const cx = pad.left + gap * i + gap / 2;
          const barH = (m.value / max) * innerH;
          const isActive = m.key === activeMonthKey;
          const isHover = hover === i;
          return (
            <g key={m.key}>
              {/* bar */}
              <rect
                x={cx - barW / 2} y={pad.top + innerH - barH}
                width={barW} height={barH}
                fill={color} rx={3}
                opacity={isActive ? 1 : isHover ? 0.85 : (activeMonthKey ? 0.35 : 0.7)}
                style={{ transition: 'opacity 0.12s' }}
              />
              {/* active indicator dot */}
              {isActive && m.value > 0 && (
                <circle cx={cx} cy={pad.top + innerH - barH - 7} r={3} fill={color} />
              )}
              {/* hover + click target */}
              <rect
                x={cx - gap / 2} y={pad.top} width={gap} height={innerH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onBarClick(m.key)}
                style={{ cursor: 'pointer' }}
              />
              <text x={cx} y={H - 10} textAnchor="middle" className="chart-axis-label"
                style={{ fontWeight: isActive ? 700 : 400, fill: isActive ? 'var(--ink)' : undefined }}>
                {m.short}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && months[hover]?.value > 0 && (
        <div className="chart-tooltip" style={{ left: pad.left + gap * hover + gap / 2, top: 12 }}>
          <div className="tt-title">{months[hover].label}</div>
          <div className="tt-total">{fmtMoney(months[hover].value)}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>Click to see transactions</div>
        </div>
      )}
    </div>
  );
}

function CategoriesTab({ monthKey, finVersion }) {
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [detailMonthKey, setDetailMonthKey] = useState<string | null>(null);

  // Reset detail month when category changes
  function selectCat(cat: string) {
    const next = selectedCat === cat ? null : cat;
    setSelectedCat(next);
    setDetailMonthKey(next ? monthKey : null);
    if (next) {
      setTimeout(() => {
        document.getElementById('cat-detail-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
    }
  }

  const txns = txnsForMonth(monthKey);
  const breakdown = sumByCategory(txns);
  const total = breakdown.reduce((s, b) => s + b.amount, 0);
  const catMonthLabel = MONTHS.find((m) => m.key === monthKey)?.label ?? monthKey;

  const selInfo = selectedCat
    ? (breakdown.find(b => b.cat === selectedCat) || catById(selectedCat))
    : null;

  const chartMonths = MONTHS.slice(-24).map(m => ({
    key: m.key, short: m.short, label: m.label,
    value: txnsForMonth(m.key).filter(t => t.category === selectedCat).reduce((s, t) => s + Math.abs(t.amount), 0),
  }));

  const activeDmKey = detailMonthKey || monthKey;
  const detailMonthLabel = MONTHS.find(m => m.key === activeDmKey)?.label ?? activeDmKey;
  const detailTxns = selectedCat
    ? txnsForMonth(activeDmKey).filter(t => t.category === selectedCat)
    : [];

  const allTimeTotal = chartMonths.reduce((s, m) => s + m.value, 0);
  const activeMonthCount = chartMonths.filter(m => m.value > 0).length;
  const monthlyAvg = activeMonthCount > 0 ? allTimeTotal / activeMonthCount : 0;
  const peakMonth = chartMonths.reduce((best, m) => m.value > best.value ? m : best, chartMonths[0] || { value: 0, label: '—' });

  return (
    <div className="tab-body">
      <div className="card">
        <div className="card-head">
          <h3>Category breakdown</h3>
          <span className="muted">{fmtMoney(total)} total · {catMonthLabel}</span>
        </div>
        {!selectedCat && (
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 14 }}>
            Click any category to see month-by-month history
          </div>
        )}
        <div className="cat-grid">
          {breakdown.map((b) => {
            const isSelected = selectedCat === b.cat;
            return (
              <div key={b.cat} className="cat-card"
                onClick={() => selectCat(b.cat)}
                style={{
                  borderColor: isSelected ? b.color : b.color + '30',
                  cursor: 'pointer',
                  background: isSelected ? b.color + '10' : undefined,
                  outline: isSelected ? `2px solid ${b.color}` : undefined,
                  transition: 'all 0.15s',
                }}
              >
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
            );
          })}
        </div>
      </div>

      {selectedCat && selInfo && (
        <div id="cat-detail-panel" className="card">
          <div className="card-head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 32, height: 32, borderRadius: 9, background: selInfo.color + '22',
                color: selInfo.color, display: 'grid', placeItems: 'center', fontSize: 16, flexShrink: 0 }}>
                {selInfo.icon}
              </span>
              <h3>{selInfo.name}</h3>
            </div>
            <button onClick={() => setSelectedCat(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)',
                fontSize: 18, lineHeight: 1, padding: '4px 6px' }}>
              ✕
            </button>
          </div>

          {/* Stats strip */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderRadius: 10, overflow: 'hidden',
            border: '1px solid var(--line)' }}>
            {[
              { label: `Total (${chartMonths.length}mo)`, value: fmtMoney(allTimeTotal) },
              { label: 'Monthly avg', value: fmtMoney(monthlyAvg) },
              { label: catMonthLabel, value: fmtMoney(breakdown.find(b => b.cat === selectedCat)?.amount || 0) },
              { label: 'Peak month', value: peakMonth?.label || '—' },
            ].map((s, i, arr) => (
              <div key={s.label} style={{ flex: 1, padding: '10px 14px',
                borderRight: i < arr.length - 1 ? '1px solid var(--line)' : undefined }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-3)',
                  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{s.label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)',
                  fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Clickable monthly bar chart */}
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 8 }}>
            Click a bar to see that month's transactions
          </div>
          <CatHistoryBars
            months={chartMonths}
            color={selInfo.color}
            activeMonthKey={activeDmKey}
            onBarClick={(key) => setDetailMonthKey(key)}
          />

          {/* Transactions for selected month */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            margin: '20px 0 10px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)',
              textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Transactions · {detailMonthLabel}
            </div>
            {detailTxns.length > 0 && (
              <span style={{ fontSize: 12, fontWeight: 600, color: selInfo.color }}>
                {fmtMoney(detailTxns.reduce((s, t) => s + Math.abs(t.amount), 0))}
              </span>
            )}
          </div>
          {detailTxns.length > 0
            ? <TxnList txns={detailTxns} />
            : <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>No {selInfo.name} transactions in {detailMonthLabel}.</div>
          }
        </div>
      )}

      {!selectedCat && (
        <div className="card">
          <div className="card-head">
            <h3>Top 5 categories — trend</h3>
          </div>
          <AreaChart series={breakdown.slice(0, 5).map(b => ({
            key: b.cat, name: b.name, color: b.color,
            points: MONTHS.map(m => ({
              label: m.short,
              value: txnsForMonth(m.key).filter(t => t.category === b.cat).reduce((s, t) => s + Math.abs(t.amount), 0),
            })),
          }))} height={260} formatter={fmtAbbr} fill={false} />
          <div className="legend-row-inline">
            {breakdown.slice(0, 5).map(b => (
              <span key={b.cat} style={{ cursor: 'pointer' }} onClick={() => selectCat(b.cat)}>
                <i style={{ background: b.color }} />{b.name}
              </span>
            ))}
          </div>
        </div>
      )}
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

  const activeMonths = data.filter(d => d.income > 0);
  const avgSavingsRate = activeMonths.length > 0
    ? activeMonths.reduce((s, d) => s + d.savingsRate, 0) / activeMonths.length
    : 0;
  const totalIncome6mo   = data.reduce((s, d) => s + d.income, 0);
  const totalExpenses6mo = data.reduce((s, d) => s + d.expenses, 0);

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

// The main exported component for the Analysis tab is TrendsTab
// (the function that accepts { setTab, setMonthKey } props).
const AnalysisTab = TrendsTab;

export default AnalysisTab;
export { TrendsTab, CategoriesTab, NetWorthTab, SideBySideBars };
