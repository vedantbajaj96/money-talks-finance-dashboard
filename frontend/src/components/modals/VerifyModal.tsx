import React, { useState, useRef } from 'react';
import { apiFetch } from '@/lib/api';

interface VerifyResult {
  period:  { from: string; to: string };
  source:  string;
  summary: { statement_total: number; matched: number; missing: number; extra: number };
  missing: { date: string; description: string; amount: number }[];
  extra:   { date: string; description: string; amount: number; source: string }[];
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(n));
}

export default function VerifyModal({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error,  setError]  = useState('');
  const [section, setSection] = useState<'missing' | 'extra'>('missing');
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setState('loading');
    setError('');
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await apiFetch('/api/verify/statement', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.detail || 'Verification failed'); setState('error'); return; }
      setResult(data);
      setState('done');
    } catch {
      setError('Could not reach server'); setState('error');
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) upload(f);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) upload(f);
  }

  const shown = result ? (section === 'missing' ? result.missing : result.extra) : [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal verify-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 className="modal-title">Verify Statement</h2>
            <p className="modal-sub">Upload a CSV to check for gaps — nothing will be imported.</p>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {state === 'idle' && (
          <div className="verify-drop"
            onDrop={onDrop} onDragOver={e => e.preventDefault()}
            onClick={() => inputRef.current?.click()}>
            <div className="verify-drop-icon">📄</div>
            <div className="verify-drop-title">Drop your bank statement here</div>
            <div className="verify-drop-sub">Chase, Amex CSV supported · read-only, nothing saved</div>
            <input ref={inputRef} type="file" accept=".csv,.pdf" style={{ display: 'none' }} onChange={onFile} />
          </div>
        )}

        {state === 'loading' && (
          <div className="verify-loading">
            <div className="verify-spinner" />
            <div>Comparing against your transactions…</div>
          </div>
        )}

        {state === 'error' && (
          <div className="verify-error">
            <div style={{ fontSize: 32, marginBottom: 8 }}>⚠</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Could not verify</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 16 }}>{error}</div>
            <button className="upload-reminder-btn-primary" onClick={() => setState('idle')}>Try again</button>
          </div>
        )}

        {state === 'done' && result && (() => {
          const { summary, period, source } = result;
          const allGood = summary.missing === 0;
          return (
            <>
              <div className="verify-summary">
                <div className="verify-period">{source} · {period.from} → {period.to}</div>

                {summary.extra > 0 && (
                  <div className="verify-alert">
                    <div className="verify-alert-icon">⚠</div>
                    <div>
                      <div className="verify-alert-title">
                        {summary.extra} possible duplicate{summary.extra !== 1 ? 's' : ''} in Plaid
                      </div>
                      <div className="verify-alert-sub">
                        {summary.extra !== 1 ? 'These transactions are' : 'This transaction is'} in Plaid but not on your statement — Plaid may have synced {summary.extra !== 1 ? 'them' : 'it'} twice. Review and delete the extras.
                      </div>
                    </div>
                  </div>
                )}
                {summary.missing > 0 && (
                  <div className="verify-alert verify-alert-info">
                    <div className="verify-alert-icon">ℹ</div>
                    <div>
                      <div className="verify-alert-title" style={{ color: 'var(--blue)' }}>
                        {summary.missing} transaction{summary.missing !== 1 ? 's' : ''} not synced by Plaid
                      </div>
                      <div className="verify-alert-sub">
                        {summary.missing !== 1 ? 'These appear' : 'This appears'} on your statement but Plaid didn't sync {summary.missing !== 1 ? 'them' : 'it'} — possibly over-deduplicated. Add manually if needed.
                      </div>
                    </div>
                  </div>
                )}

                <div className="verify-stats">
                  <div className="verify-stat verify-stat-ok">
                    <span className="verify-stat-n">{summary.matched}</span>
                    <span className="verify-stat-l">matched</span>
                  </div>
                  <div className={`verify-stat ${summary.missing > 0 ? 'verify-stat-warn' : 'verify-stat-ok'}`}>
                    <span className="verify-stat-n">{summary.missing}</span>
                    <span className="verify-stat-l">missing from Plaid</span>
                  </div>
                  <div className="verify-stat verify-stat-muted">
                    <span className="verify-stat-n">{summary.extra}</span>
                    <span className="verify-stat-l">Plaid-only</span>
                  </div>
                </div>
                {allGood && (
                  <div className="verify-all-good">✓ All statement transactions found in Plaid</div>
                )}
              </div>

              {!allGood && (
                <>
                  <div className="verify-tabs">
                    <button className={`verify-tab ${section === 'missing' ? 'active' : ''}`}
                      onClick={() => setSection('missing')}>
                      Missing from Plaid ({summary.missing})
                    </button>
                    <button className={`verify-tab ${section === 'extra' ? 'active' : ''}`}
                      onClick={() => setSection('extra')}>
                      Plaid-only ({summary.extra})
                    </button>
                  </div>
                  <div className="verify-list">
                    {shown.length === 0
                      ? <div className="verify-empty">None</div>
                      : shown.map((r, i) => (
                        <div key={i} className="verify-row">
                          <span className="verify-row-date">{r.date}</span>
                          <span className="verify-row-desc">{r.description}</span>
                          <span className={`verify-row-amt ${r.amount < 0 ? 'pos' : ''}`}>
                            {r.amount < 0 ? '+' : ''}{fmt(r.amount)}
                          </span>
                        </div>
                      ))
                    }
                  </div>
                </>
              )}

              <div className="verify-footer">
                <button className="upload-reminder-btn-dismiss" onClick={() => { setState('idle'); setResult(null); }}>
                  Verify another
                </button>
                <button className="upload-reminder-btn-primary" onClick={onClose}>Done</button>
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}
