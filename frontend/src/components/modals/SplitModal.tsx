// Modal component — see frontend/AGENTS.md for context
import { useState } from 'react';
import { fmt } from '@/lib/helpers';
import { CategoryPicker } from '@/components';

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

export default SplitModal;
