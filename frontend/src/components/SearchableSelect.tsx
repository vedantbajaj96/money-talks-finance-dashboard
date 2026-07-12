// Chart component — see frontend/AGENTS.md for context
import { useState } from 'react';

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

export default SearchableSelect;
