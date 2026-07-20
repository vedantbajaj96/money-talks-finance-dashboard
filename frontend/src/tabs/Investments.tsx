// Tab component — see frontend/AGENTS.md for context
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { TRANSACTIONS, CATEGORIES, ACCOUNTS, MONTHS, RECURRING, NET_WORTH_HISTORY } from '@/lib/fin';
import { fmtMoney, fmtMoney2, fmtAbbr, fmt, catById, acctById, txnsForMonth, sumByCategory, monthSummary } from '@/lib/helpers';
import { apiFetch } from '@/lib/api';
import { TabHero } from '@/components';

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

// PerformancePanel — statement-based portfolio analytics
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

      <TabHero
        value={totalValue}
        format={fmtMoney}
        label="Investment Portfolio"
        sublabel="total portfolio value"
        positive={totalGain == null ? undefined : totalGain >= 0}
        stats={[
          { val: totalGain != null ? `${totalGain >= 0 ? '+' : '−'}${fmtMoney(Math.abs(totalGain))}` : '—', key: 'Unrealized gain' },
          { val: fmtMoney(ytdContribs), key: `${new Date().getFullYear()} contributions` },
          { val: String(holdings.length), key: 'Positions' },
        ]}
      />

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

export default InvestmentsTab;
