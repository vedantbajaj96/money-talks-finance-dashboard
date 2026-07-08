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

