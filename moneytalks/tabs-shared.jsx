// Shared primitives — loaded first; sets up globals used by all other tab files.
const { useState, useMemo, useEffect, useRef } = React;
const { ACCOUNTS, CATEGORIES, MONTHS, TRANSACTIONS, RECURRING, NET_WORTH_HISTORY,
  txnsForMonth, sumByCategory, monthSummary, fmt, acctById } = window.FIN;
const { DonutChart, StackedBarChart, AreaChart, Sparkline, BarList } = window;

// Live categories cache — initialized from bootstrap data, refreshed after edits.
// CategoryPicker reads this so reorders/renames show immediately without page reload.
let _liveCategories = [...CATEGORIES];
async function refreshLiveCategories() {
  try {
    const res  = await apiFetch('/api/categories');
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
      const res = await apiFetch('/api/transactions', {
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


function BarCol({ label, value, maxVal }) {
  const [hovered, setHovered] = React.useState(false);
  const amt = value >= 1000 ? `$${(value / 1000).toFixed(1)}k` : value > 0 ? `$${Math.round(value)}` : '';
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, position: 'relative' }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div style={{ height: 24, flexShrink: 0 }} />
      <div style={{
        position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
        fontSize: 20, color: 'var(--accent)', fontWeight: 700, lineHeight: '24px',
        opacity: hovered && value > 0 ? 1 : 0, transition: 'opacity 0.15s', whiteSpace: 'nowrap', zIndex: 2,
      }}>{amt}</div>
      <div style={{
        width: '100%', borderRadius: 3,
        background: value > 0 ? (hovered ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 70%, transparent)') : 'var(--line)',
        height: value > 0 ? `${Math.max(4, (value / maxVal) * 44)}px` : '3px',
        transition: 'height 0.2s, background 0.15s',
      }} />
      <div style={{ fontSize: 9, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>{label}</div>
    </div>
  );
}

function MerchantDrawer({ merchant, category, onClose }) {
  const { useState: useStateD } = React;
  const [drawerSort, setDrawerSort] = useStateD('date');
  const allTxns = TRANSACTIONS.filter(t => t.merchant === merchant && t.category === category)
    .sort((a, b) => drawerSort === 'date'
      ? b.date.localeCompare(a.date)
      : Math.abs(b.amount) - Math.abs(a.amount));

  const allTimeTotal = allTxns.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const thisYear     = new Date().getFullYear().toString();
  const yearTotal    = allTxns.filter(t => t.amount < 0 && t.date.startsWith(thisYear))
                              .reduce((s, t) => s + Math.abs(t.amount), 0);
  const avgTxn       = allTxns.length > 0 ? allTimeTotal / allTxns.filter(t => t.amount < 0).length : 0;

  // Monthly spend for bar chart — last 12 months
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    return d.toISOString().slice(0, 7);
  });
  const byMonth = {};
  allTxns.filter(t => t.amount < 0).forEach(t => {
    const m = t.date.slice(0, 7);
    byMonth[m] = (byMonth[m] || 0) + Math.abs(t.amount);
  });
  const chartData = months.map(m => ({ label: m.slice(5), value: byMonth[m] || 0 }));
  const maxVal = Math.max(...chartData.map(d => d.value), 1);

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, zIndex: 400,
        background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)',
      }} />

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 401,
        width: 420, background: 'var(--surface)', borderLeft: '1px solid var(--line)',
        display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 32px rgba(0,0,0,0.12)',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
                {merchant}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3 }}>
                {category} · {allTxns.length} transaction{allTxns.length !== 1 ? 's' : ''}
              </div>
            </div>
            <button onClick={onClose} style={{
              background: 'none', border: '1px solid var(--line)', borderRadius: 8,
              padding: '5px 10px', cursor: 'pointer', fontSize: 16, color: 'var(--ink-3)',
              lineHeight: 1, flexShrink: 0,
            }}>✕</button>
          </div>

          {/* Stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 16 }}>
            {[
              { label: 'All time',    value: fmtMoney(allTimeTotal) },
              { label: thisYear,      value: fmtMoney(yearTotal) },
              { label: 'Avg / txn',  value: fmtMoney(avgTxn) },
            ].map(({ label, value }) => (
              <div key={label} style={{
                background: 'var(--surface-3)', borderRadius: 10, padding: '10px 12px',
              }}>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600,
                  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Monthly bar chart */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase',
            letterSpacing: '0.07em', marginBottom: 10 }}>Monthly spend — last 12 months</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 96 }}>
            {chartData.map(({ label, value }) => (
              <BarCol key={label} label={label} value={value} maxVal={maxVal} />
            ))}
          </div>
        </div>

        {/* Transaction list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0' }}>
          <div style={{ display: 'flex', gap: 6, padding: '10px 24px', borderBottom: '1px solid var(--line)' }}>
            {['date', 'amount'].map(s => (
              <button key={s} onClick={() => setDrawerSort(s)} style={{
                background: drawerSort === s ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'none',
                border: `1px solid ${drawerSort === s ? 'var(--accent)' : 'var(--line)'}`,
                borderRadius: 6, padding: '3px 10px', fontSize: 12, cursor: 'pointer',
                color: drawerSort === s ? 'var(--accent)' : 'var(--ink-3)', fontFamily: 'inherit',
              }}>{s === 'date' ? '📅 Date' : '$ Amount'}</button>
            ))}
          </div>
          {allTxns.map(t => {
            const cat = catById(t.category);
            return (
              <div key={t.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 24px', borderBottom: '1px solid var(--line)',
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                  background: cat.color + '24', color: cat.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15,
                }}>{cat.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>{t.date.slice(5).replace('-', '/')}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 1 }}>
                    <span className="cat-pill" style={{ color: cat.color }}>{cat.name}</span>
                  </div>
                </div>
                <div style={{
                  fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                  color: t.amount >= 0 ? 'var(--green)' : 'var(--ink)',
                }}>{fmt(t.amount, { sign: true })}</div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ─── Inline map popover (OpenStreetMap, no API key needed) ─────────
function MapPopover({ txn, onClose }) {
  useEffect(() => {
    // Inject animation once
    if (!document.getElementById('map-popover-css')) {
      const s = document.createElement('style');
      s.id = 'map-popover-css';
      s.textContent = `
        @keyframes mapPopIn {
          from { opacity: 0; transform: translate(-50%, -48%) scale(0.94); }
          to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
      `;
      document.head.appendChild(s);
    }
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const hasCoords = txn.lat != null && txn.lon != null;
  const fullAddress = [txn.location_address, txn.location_city, txn.location_region]
    .filter(Boolean).join(', ');
  const coordLabel = [txn.location_city, txn.location_region].filter(Boolean).join(', ');

  const delta = 0.007;
  const osmSrc = hasCoords
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${txn.lon - delta},${txn.lat - delta},${txn.lon + delta},${txn.lat + delta}&layer=mapnik&marker=${txn.lat},${txn.lon}`
    : null;
  // Use Apple Maps on iOS/macOS (opens natively), Google Maps elsewhere
  const isApple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) && !window.MSStream;
  const mapsUrl = hasCoords
    ? (isApple
        ? `https://maps.apple.com/?q=${txn.lat},${txn.lon}`
        : `https://www.google.com/maps?q=${txn.lat},${txn.lon}`)
    : (isApple
        ? `https://maps.apple.com/?q=${encodeURIComponent(fullAddress || txn.merchant)}`
        : `https://www.google.com/maps/search/${encodeURIComponent(fullAddress || txn.merchant)}`);

  const cat = catById(txn.category);

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, zIndex: 800,
        background: 'rgba(0,0,0,0.28)', backdropFilter: 'blur(2px)',
      }} />
      <div style={{
        position: 'fixed', zIndex: 801,
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 340,
        background: 'var(--surface)',
        borderRadius: 20, overflow: 'hidden',
        border: '1px solid var(--line)',
        boxShadow: '0 32px 80px rgba(0,0,0,0.4)',
        animation: 'mapPopIn 0.22s cubic-bezier(0.2, 0.8, 0.3, 1.15) forwards',
      }}>
        {/* Category accent bar */}
        <div style={{ height: 3, background: cat.color }} />

        {/* Header */}
        <div style={{ padding: '14px 16px 10px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.01em', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {txn.merchant}
            </div>
            {fullAddress && (
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {fullAddress}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{
            background: 'var(--surface-2)', border: 'none', borderRadius: 8,
            cursor: 'pointer', color: 'var(--ink-3)', fontSize: 13, lineHeight: 1,
            padding: '5px 8px', flexShrink: 0, fontFamily: 'inherit',
          }}>✕</button>
        </div>

        {/* Map */}
        {hasCoords ? (
          <div style={{ position: 'relative', height: 224 }}>
            <iframe
              src={osmSrc}
              title={`Map: ${txn.merchant}`}
              style={{ width: '100%', height: '100%', border: 'none', display: 'block', filter: 'saturate(0.8) brightness(0.9)' }}
              loading="lazy"
            />
            {/* Inner vignette */}
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', boxShadow: 'inset 0 0 24px rgba(0,0,0,0.18)' }} />
          </div>
        ) : (
          <div style={{
            height: 110, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 7,
            background: 'var(--surface-2)', color: 'var(--ink-3)', fontSize: 13,
          }}>
            <span style={{ fontSize: 28 }}>📍</span>
            <span>No exact coordinates — city-level only</span>
          </div>
        )}

        {/* Footer */}
        <div style={{
          padding: '10px 16px', borderTop: '1px solid var(--line)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
            {hasCoords ? `${txn.lat.toFixed(5)}, ${txn.lon.toFixed(5)}` : (coordLabel || '—')}
          </span>
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', textDecoration: 'none', letterSpacing: '-0.01em' }}>
            {isApple ? 'Open in Apple Maps ↗' : 'Open in Google Maps ↗'}
          </a>
        </div>
      </div>
    </>
  );
}

function TxnList({ txns, compact = false, onRecategorize, refreshFin, sortCol: initSortCol, sortDir: initSortDir, presorted = false, extraMenuItems }) {
  const [splitTxn, setSplitTxn]     = useState(null);
  const [editDateId, setEditDateId] = useState(null);
  const [editTxn, setEditTxn]       = useState(null);
  const [menuId, setMenuId]         = useState(null);
  const [activeMerchant, setActiveMerchant] = useState(null);
  const [mapTxn, setMapTxn]         = useState(null);
  const [sortCol, setSortCol]       = useState(presorted ? null : (initSortCol || 'date'));
  const [sortDir, setSortDir]       = useState(initSortDir || 'desc');
  const [dateOverrides, setDateOverrides] = useState({});
  const [localFlags, setLocalFlags] = useState(() => {
    const flags = {};
    txns.forEach(t => { if (t.flagged) flags[t.id] = true; });
    return flags;
  });

  async function toggleFlag(txnId, current) {
    const next = !current;
    setLocalFlags(prev => ({ ...prev, [txnId]: next }));
    try {
      await apiFetch(`/api/transactions/${txnId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flagged: next }),
      });
      window.showToast?.(next ? '⚑ Flagged for review' : 'Flag removed');
      if (refreshFin) refreshFin();
    } catch(e) {
      setLocalFlags(prev => ({ ...prev, [txnId]: current }));
    }
  }

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortCol(col); setSortDir('desc'); }
  }

  const sorted = sortCol === null ? txns : [...txns].sort((a, b) => {
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
      {mapTxn && <MapPopover txn={mapTxn} onClose={() => setMapTxn(null)} />}
      {activeMerchant && <MerchantDrawer merchant={activeMerchant.merchant} category={activeMerchant.category} onClose={() => setActiveMerchant(null)} />}
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
          const isFlagged = !!localFlags[t.id];
          return (
            <div key={t.id} className="txn-row" style={isSplit ? { paddingLeft: 28, borderLeft: `3px solid ${cat.color}40` } : isFlagged ? { background: 'rgba(249,115,22,0.035)' } : {}}>
              <div className="txn-icon" style={{ background: cat.color + '24', color: cat.color }}>
                {isSplit ? '⋮' : cat.icon}
              </div>
              <div className="txn-main">
                <div className="txn-merchant">
                  <span onClick={() => !isSplit && setActiveMerchant({ merchant: t.merchant, category: t.category })} style={{
                    cursor: isSplit ? 'default' : 'pointer',
                    textDecoration: isSplit ? 'none' : 'underline dotted',
                    textUnderlineOffset: 2,
                    textDecorationColor: 'var(--line-2)',
                  }}>{t.merchant}</span>
                  {isFlagged && <span style={{ fontSize: 11, color: '#f97316', marginLeft: 6 }} title="Flagged for review">⚑</span>}
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
                  {(t.location_city || (t.lat != null && t.lon != null)) && (() => {
                    const label = [t.location_city, t.location_region].filter(Boolean).join(', ');
                    return <>
                      <span className="dot-sep">·</span>
                      <button
                        onClick={e => { e.stopPropagation(); setMapTxn(t); }}
                        title={[t.location_address, label].filter(Boolean).join(' · ')}
                        style={{
                          background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                          border: 'none', borderRadius: 5, cursor: 'pointer',
                          color: 'var(--accent)', fontSize: 10.5, fontWeight: 600,
                          padding: '1px 6px 1px 4px', fontFamily: 'inherit', lineHeight: 1.6,
                          display: 'inline-flex', alignItems: 'center', gap: 2,
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 18%, transparent)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 10%, transparent)'}
                      >📍 {label || 'View map'}</button>
                    </>;
                  })()}
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
                    className="txn-menu-btn"
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
                        { label: isFlagged ? '⚑ Unflag' : '⚑ Flag for review', action: async () => { setMenuId(null); await toggleFlag(t.id, isFlagged); } },
                        { label: 'Split', action: () => { setSplitTxn(t); setMenuId(null); } },
                        { label: 'Delete', action: async () => {
                          setMenuId(null);
                          if (!confirm(`Delete "${t.merchant}"?`)) return;
                          await fetch(`/api/transactions/${t.id}`, { method: 'DELETE' });
                          window.showToast?.('Transaction deleted');
                          if (refreshFin) refreshFin();
                        }, danger: true },
                        ...(extraMenuItems ? extraMenuItems(t).map(item => ({
                          ...item,
                          action: () => { setMenuId(null); item.action(); },
                        })) : []),
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
