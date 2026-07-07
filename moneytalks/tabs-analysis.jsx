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
