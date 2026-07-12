// Modal component — see frontend/AGENTS.md for context
import { useState } from 'react';
import { CategoryPicker } from '@/components';

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

export default EditTransactionModal;
