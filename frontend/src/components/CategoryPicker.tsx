// Chart component — see frontend/AGENTS.md for context
import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CATEGORIES } from '@/lib/fin';
import { apiFetch } from '@/lib/api';

// Live categories cache — initialized from bootstrap data, refreshed after edits.
// CategoryPicker reads this so reorders/renames show immediately without page reload.
let _liveCategories = [...CATEGORIES];
export async function refreshLiveCategories() {
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
export function liveCatById(id) {
  return _liveCategories.find(c => c.id === id)
    || CATEGORIES.find(c => c.id === id)
    || { id, name: id, color: '#94a3b8', icon: '○', group: 'variable' };
}

// ─── Inline category picker (with semantic search) ────────────────
function CategoryPicker({ value, onChange }) {
  const [open, setOpen]       = useState(false);
  const [q, setQ]             = useState('');
  const [results, setResults] = useState(null);   // null = show _liveCategories
  const [loading, setLoading] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const btnRef      = useRef(null);
  const debounceRef = useRef(null);
  const cat = liveCatById(value);

  function handleOpen(e) {
    e.stopPropagation();
    const opening = !open;
    if (opening && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 6, left: r.left });
    }
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
      <button ref={btnRef} className="cat-pill cat-pill-btn" style={{ color: cat.color, borderColor: cat.color + '50' }}
        onClick={handleOpen}>
        {cat.name} <span className="caret">⌄</span>
      </button>
      {open && createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 8999 }} onClick={() => { setOpen(false); setQ(''); setResults(null); }} />
          <div className="cat-menu" style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, zIndex: 9000 }}>
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
        </>,
        document.body
      )}
    </div>
  );
}

export default CategoryPicker;
