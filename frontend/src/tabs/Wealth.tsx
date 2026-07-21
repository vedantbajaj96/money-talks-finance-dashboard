// Tab component — see frontend/AGENTS.md for context
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { TRANSACTIONS, CATEGORIES, ACCOUNTS, MONTHS, RECURRING, NET_WORTH_HISTORY } from '@/lib/fin';
import { fmtMoney, fmtMoney2, fmtAbbr, fmt, catById, acctById, txnsForMonth, sumByCategory, monthSummary } from '@/lib/helpers';
import { apiFetch } from '@/lib/api';
import { SummaryCard, TabHero } from '@/components';
import { AreaChart } from '@/components/charts';

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

  const assetCount = ACCOUNTS.filter((a) => a.balance > 0).length;
  const liabCount  = ACCOUNTS.filter((a) => a.balance < 0).length;

  return (
    <div className="tab-body">
      <TabHero
        value={net}
        format={fmtMoney}
        label="Net Worth"
        sublabel={net >= 0 ? 'total assets minus liabilities' : 'liabilities exceed assets'}
        positive={net >= 0}
        stats={[
          { val: fmtMoney(assets),      key: 'Assets' },
          { val: fmtMoney(liabilities), key: 'Liabilities' },
          { val: `${assetCount + liabCount}`,  key: 'Accounts' },
        ]}
      />
      <div className="grid-3">
        <SummaryCard label="Net worth" n={net} accent="var(--accent2)"
          trend={netTrend} />
        <SummaryCard label="Total assets" n={assets} accent="var(--green)"
          sub={`${assetCount} accounts`} />
        <SummaryCard label="Total liabilities" n={liabilities} accent="var(--terra)"
          sub={`${liabCount} cards`} />
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
  const [plaidAccounts, setPlaidAccounts] = useState([]);
  const [balances, setBalances]           = useState([]);
  const [configured, setConfigured]       = useState(false);
  const [syncResult, setSyncResult]       = useState(null);
  const [linking, setLinking]             = useState(false);
  const [error, setError]                 = useState('');

  const loadAccounts = () =>
    apiFetch('/api/plaid/accounts').then(r => r.json()).then(d => {
      setConfigured(d.configured);
      setPlaidAccounts(d.accounts || []);
    });

  const loadBalances = () =>
    apiFetch('/api/plaid/balances').then(r => r.json()).then(d => {
      setBalances(d.accounts || []);
    }).catch(() => {});

  useEffect(() => { loadAccounts(); loadBalances(); }, []);

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

  const TYPE_COLOR: Record<string, string> = { depository: 'var(--green)', investment: '#818cf8', credit: '#f97316', loan: '#ef4444' };
  const TYPE_LABEL: Record<string, string> = { depository: 'Cash & Savings', investment: 'Investments', credit: 'Credit Cards', loan: 'Loans' };
  const TYPE_ORDER = ['depository', 'investment', 'credit', 'loan'];

  // Group live balances by type, then by institution
  const grouped: Record<string, any[]> = {};
  balances.forEach(b => {
    const t = b.account_type || 'other';
    if (!grouped[t]) grouped[t] = [];
    grouped[t].push(b);
  });

  const totalAssets = balances.filter(b => b.account_type !== 'credit' && b.account_type !== 'loan')
    .reduce((s, b) => s + (b.current_balance || 0), 0);
  const totalOwed = balances.filter(b => b.account_type === 'credit' || b.account_type === 'loan')
    .reduce((s, b) => s + (b.current_balance || 0), 0);

  return (
    <div className="tab-body">

      {/* Sync controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {plaidAccounts.length > 0 && (
            <>
              <button onClick={() => onSync && onSync()} disabled={syncing} style={{
                background: 'var(--accent)', color: '#052015', border: 'none',
                borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: 600,
                fontFamily: 'inherit', cursor: syncing ? 'default' : 'pointer', opacity: syncing ? 0.6 : 1,
              }}>{syncing ? 'Syncing…' : 'Sync now'}</button>
              <button onClick={() => onSync && onSync(true)} disabled={syncing} style={{
                background: 'transparent', color: 'var(--ink-3)', border: '1px solid var(--line)',
                borderRadius: 8, padding: '7px 14px', fontSize: 13,
                fontFamily: 'inherit', cursor: syncing ? 'default' : 'pointer', opacity: syncing ? 0.6 : 1,
              }}>Full re-sync</button>
            </>
          )}
        </div>
        <button onClick={configured ? openPlaidLink : undefined} disabled={!configured || linking} style={{
          background: 'transparent', color: 'var(--ink-2)', border: '1px solid var(--line)',
          borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 500,
          fontFamily: 'inherit', cursor: configured && !linking ? 'pointer' : 'default',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
          {linking ? 'Opening Plaid…' : 'Link account'}
        </button>
      </div>

      {syncResult && (
        <div style={{
          padding: '12px 16px', borderRadius: 10, fontSize: 13,
          background: syncResult.ok ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'color-mix(in srgb, #ef4444 8%, transparent)',
          border: `1px solid ${syncResult.ok ? 'var(--accent)' : '#ef4444'}`,
          color: syncResult.ok ? 'var(--ink)' : '#ef4444',
        }}>
          {syncResult.ok
            ? `✓ ${syncResult.full ? 'Full re-sync' : 'Synced'} — ${syncResult.stats?.added ?? 0} new, ${syncResult.stats?.modified ?? 0} updated, ${syncResult.stats?.removed ?? 0} removed`
            : `⚠ ${syncResult.error || 'Sync failed'}`}
        </div>
      )}
      {error && (
        <div style={{ padding: '12px 16px', borderRadius: 10, background: 'color-mix(in srgb, #ef4444 8%, transparent)', border: '1px solid #ef4444', fontSize: 13, color: '#ef4444' }}>
          ⚠ {error}
        </div>
      )}

      {/* Net summary strip */}
      {balances.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          {[
            { label: 'Total Assets',     val: totalAssets,              color: 'var(--green)' },
            { label: 'Total Owed',       val: totalOwed,                color: '#f97316'      },
            { label: 'Net Worth',        val: totalAssets - totalOwed,  color: 'var(--ink)'   },
          ].map(s => (
            <div key={s.label} className="card" style={{ padding: '14px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{s.label}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: s.color, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>{fmtMoney(s.val)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Account cards by type */}
      {balances.length === 0 && plaidAccounts.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px 24px', color: 'var(--ink-3)', fontSize: 14 }}>
          No accounts linked yet. Click "Link account" to connect via Plaid.
        </div>
      ) : (
        TYPE_ORDER.filter(t => grouped[t]?.length).map(type => (
          <div key={type}>
            <div style={{ fontSize: 11, fontWeight: 700, color: TYPE_COLOR[type], textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
              {TYPE_LABEL[type] || type}
            </div>
            <div className="grid-2" style={{ marginBottom: 6 }}>
              {grouped[type].map((b, i) => {
                const isCredit = type === 'credit' || type === 'loan';
                const bal = b.current_balance || 0;
                const avail = b.available_balance;
                const limit = isCredit && avail != null ? bal + avail : null;
                const util = limit ? bal / limit : null;
                const inst = plaidAccounts.find(a => a.institution_name === b.institution_name);
                return (
                  <div key={i} className="card" style={{ padding: '18px 20px', position: 'relative' }}>
                    {/* Top: name + institution */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 2 }}>{b.account_name}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: TYPE_COLOR[type] }} />
                          <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{b.institution_name}</span>
                        </div>
                      </div>
                      {inst && (
                        <button onClick={() => removeAccount(inst.item_id)} style={{
                          background: 'transparent', border: 'none', padding: '2px 4px',
                          fontSize: 11, color: 'var(--ink-4)', cursor: 'pointer', fontFamily: 'inherit',
                        }} title="Remove this institution">✕</button>
                      )}
                    </div>
                    {/* Balance */}
                    <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums',
                      color: isCredit ? '#f97316' : type === 'investment' ? 'var(--ink)' : 'var(--green)', marginBottom: 4 }}>
                      {isCredit && bal > 0 ? '-' : ''}{fmtMoney(bal)}
                    </div>
                    {avail != null && (
                      <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                        {isCredit ? `${fmtMoney(avail)} available` : `${fmtMoney(avail)} available`}
                      </div>
                    )}
                    {/* Utilization bar for credit */}
                    {util != null && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ height: 4, background: 'var(--line)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.min(util * 100, 100)}%`, borderRadius: 2,
                            background: util > 0.7 ? '#ef4444' : util > 0.4 ? '#f97316' : 'var(--green)',
                            transition: 'width 0.3s ease' }} />
                        </div>
                        {limit && (
                          <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
                            {(util * 100).toFixed(0)}% of {fmtMoney(limit)} limit used
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// RECURRING TAB
// ═══════════════════════════════════════════════════════════════════
function RecurringTab() {
  const subs = RECURRING.filter((r) => r.category === 'subs');
  const bills = RECURRING.filter((r) => r.category !== 'subs');
  const monthlyTotal = RECURRING.reduce((s, r) => s + r.est_monthly, 0);
  const subsTotal = subs.reduce((s, r) => s + r.est_monthly, 0);

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
      <TabHero
        value={monthlyTotal}
        format={fmtMoney}
        label="Recurring Charges"
        sublabel="estimated monthly recurring cost"
        positive={false}
        stats={[
          { val: fmtMoney(subsTotal),        key: 'Subscriptions' },
          { val: fmtMoney(monthlyTotal * 12), key: 'Annual' },
          { val: String(RECURRING.length),    key: 'Tracked' },
        ]}
      />
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

export { AccountsTab, RecurringTab, AccountList, SideBySideBars };
export default NetWorthTab;
