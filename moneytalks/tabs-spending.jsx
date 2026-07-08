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
