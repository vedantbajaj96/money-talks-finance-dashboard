// Modal component — see frontend/AGENTS.md for context
import { useState, useRef, useEffect } from 'react';

function DateEditor({ currentDate, onSave, onCancel }) {
  const [value, setValue] = useState(currentDate);
  const savedRef = useRef(false);
  const inputRef = useRef(null);

  useEffect(() => {
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

export default DateEditor;
