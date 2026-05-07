// Tab components for the finance dashboard.
// Loaded after data.js, charts.jsx, and React.
(function () {
const { useState, useMemo, useEffect } = React;
const { ACCOUNTS, CATEGORIES, MONTHS, TRANSACTIONS, RECURRING, NET_WORTH_HISTORY,
  txnsForMonth, sumByCategory, monthSummary, fmt, catById, acctById } = window.FIN;
const { DonutChart, StackedBarChart, AreaChart, Sparkline, BarList } = window;

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
function OverviewTab({ monthKey }) {
  const summary = monthSummary(monthKey);
  const monthTxns = txnsForMonth(monthKey);
  const breakdown = sumByCategory(monthTxns).slice(0, 6);
  const recent = monthTxns.slice(0, 6);

  // Cash flow series: 6 months
  const incomeSeries = MONTHS.map((m) => ({ label: m.short, value: monthSummary(m.key).income }));
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
          sub={`${((summary.net / summary.income) * 100).toFixed(0)}% savings rate`} />
        <SummaryCard label="Saved" value={fmtMoney(summary.savings)} accent="var(--accent2)"
          sub="auto-transfers + IRA" />
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <h3>Cash flow</h3>
            <span className="muted">Last 6 months</span>
          </div>
          <AreaChart
            series={[
              { key: 'inc', name: 'Income', color: '#5ec98a', points: incomeSeries },
              { key: 'exp', name: 'Expenses', color: '#d97757', points: expenseSeries },
            ]}
            height={240}
            formatter={fmtAbbr}
          />
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Where it went</h3>
            <span className="muted">{MONTHS.find((m) => m.key === monthKey).label}</span>
          </div>
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
          <div className="card-head">
            <h3>Recent transactions</h3>
            <span className="muted">{monthTxns.length} this month</span>
          </div>
          <TxnList txns={recent} compact />
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Top categories</h3>
            <span className="muted">This month</span>
          </div>
          <BarList data={breakdown} formatter={fmtMoney} />
        </div>
      </div>
    </div>
  );
}

// ─── Transaction List ─────────────────────────────────────────────
function TxnList({ txns, compact = false, onRecategorize }) {
  return (
    <div className={`txn-list ${compact ? 'compact' : ''}`}>
      {txns.map((t) => {
        const cat = catById(t.category);
        const acct = acctById(t.account);
        return (
          <div key={t.id} className="txn-row">
            <div className="txn-icon" style={{ background: cat.color + '24', color: cat.color }}>
              {cat.icon}
            </div>
            <div className="txn-main">
              <div className="txn-merchant">
                {t.merchant}
                {t.pending && <span className="pending-pill">pending</span>}
              </div>
              <div className="txn-meta">
                {onRecategorize ? (
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
          </div>
        );
      })}
    </div>
  );
}

// ─── Inline category picker ────────────────────────────────────────
function CategoryPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const cat = catById(value);
  return (
    <div className="cat-picker">
      <button className="cat-pill cat-pill-btn" style={{ color: cat.color, borderColor: cat.color + '50' }}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
        {cat.name} <span className="caret">⌄</span>
      </button>
      {open && (
        <>
          <div className="cat-overlay" onClick={() => setOpen(false)} />
          <div className="cat-menu">
            {CATEGORIES.filter((c) => c.id !== 'transfer').map((c) => (
              <button key={c.id} className="cat-menu-item" onClick={() => { onChange(c.id); setOpen(false); }}>
                <span className="cat-dot" style={{ background: c.color }} />
                {c.name}
              </button>
            ))}
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

  // Keep in sync when the TopBar search changes
  React.useEffect(() => { setSearch(globalSearch); }, [globalSearch]);
  const [acctFilter, setAcctFilter] = useState('all');

  const baseTxns = txnsForMonth(monthKey).map((t) =>
    txnOverrides[t.id] ? { ...t, category: txnOverrides[t.id] } : t,
  );

  const filtered = baseTxns.filter((t) => {
    if (catFilter !== 'all' && t.category !== catFilter) return false;
    if (acctFilter !== 'all' && t.account !== acctFilter) return false;
    if (search && !t.merchant.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const totalIn = filtered.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const totalOut = filtered.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

  const recat = (id, cat) => setTxnOverrides({ ...txnOverrides, [id]: cat });

  return (
    <div className="tab-body">
      <div className="card">
        <div className="filter-bar">
          <div className="search-input">
            <span className="search-icon">⌕</span>
            <input
              placeholder="Search merchants..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setGlobalSearch(e.target.value); }}
            />
          </div>
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select value={acctFilter} onChange={(e) => setAcctFilter(e.target.value)}>
            <option value="all">All accounts</option>
            {ACCOUNTS.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <div className="filter-stats">
            <span><b>{filtered.length}</b> txns</span>
            <span className="pos">+{fmtMoney(totalIn)}</span>
            <span className="neg">−{fmtMoney(totalOut)}</span>
          </div>
        </div>
        <TxnList txns={filtered} onRecategorize={recat} />
        {filtered.length === 0 && <div className="empty">No transactions match your filters.</div>}
      </div>
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
            <h3>Spend distribution</h3>
            <span className="muted">All categories</span>
          </div>
          <div className="donut-row centered">
            <DonutChart data={breakdown} size={240} thickness={32} formatter={fmtMoney} />
          </div>
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

  const RecRow = ({ r }) => {
    const cat = catById(r.category);
    const acct = acctById(r.account);
    return (
      <div className="rec-row">
        <div className="rec-icon" style={{ background: cat.color + '24', color: cat.color }}>{cat.icon}</div>
        <div className="rec-main">
          <div className="rec-name">{r.merchant}</div>
          <div className="rec-meta">
            <span style={{ color: cat.color }}>{cat.name}</span>
            <span className="dot-sep">·</span>
            <span>{acct.name}</span>
          </div>
        </div>
        <div className="rec-next">
          <div className="rec-next-label">Next charge</div>
          <div className="rec-next-date">{r.next.slice(5).replace('-', '/')}</div>
        </div>
        <div className="rec-amt">{fmt(r.amount, { decimals: 2 })}<span className="rec-freq">/mo</span></div>
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
  const [plaidId, setPlaidId]       = useState('');
  const [plaidSecret, setPlaidSecret] = useState('');
  const [plaidEnv, setPlaidEnv]     = useState('sandbox');
  const [saving, setSaving]         = useState(false);
  const [saved, setSaved]           = useState(false);
  const [repairing, setRepairing]   = useState(false);
  const [repairResult, setRepairResult] = useState(null);

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(d => {
      setCfg(d);
      setProvider(d.preferred_provider || 'claude');
      if (d.plaid_environment) setPlaidEnv(d.plaid_environment);
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
    if (claudeKey)   body.anthropic_api_key = claudeKey;
    if (geminiKey)   body.gemini_api_key    = geminiKey;
    if (plaidId)     body.plaid_client_id   = plaidId;
    if (plaidSecret) body.plaid_secret      = plaidSecret;
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

  const Card = ({ title, children }) => (
    <div style={{
      background: 'var(--surface)', borderRadius: 16,
      border: '1px solid var(--border)', padding: '24px 28px', marginBottom: 20,
    }}>
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 20, color: 'var(--text)' }}>
        {title}
      </div>
      {children}
    </div>
  );

  const Label = ({ children }) => (
    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)', marginBottom: 6, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
      {children}
    </div>
  );

  const StatusDot = ({ active }) => (
    <span style={{
      display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
      background: active ? 'var(--accent)' : 'var(--border)', marginRight: 6,
    }} />
  );

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

Object.assign(window, {
  OverviewTab, TransactionsTab, SpendingTab, IncomeTab, CashFlowTab,
  NetWorthTab, AccountsTab, RecurringTab, CategoriesTab, TrendsTab,
  ChatTab, SettingsTab, TxnList, AccountList,
});
})();
