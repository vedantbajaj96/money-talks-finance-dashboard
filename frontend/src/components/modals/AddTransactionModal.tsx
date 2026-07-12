// Modal component — see frontend/AGENTS.md for context
import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { CategoryPicker } from '@/components';

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

export default AddTransactionModal;
