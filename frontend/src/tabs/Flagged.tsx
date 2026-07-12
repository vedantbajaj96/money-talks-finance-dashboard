// Tab component — see frontend/AGENTS.md for context
import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { fmtMoney, fmt, catById } from '@/lib/helpers';

function FlaggedTab() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState('dups'); // 'dups' | 'flagged'
  const [filter, setFilter]   = useState('all');  // 'all' | 'high'
  const [deleting, setDeleting] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('mt_dismissed_dups') || '[]')); }
    catch { return new Set(); }
  });
  const [trash, setTrash]     = useState(null);
  const [restoring, setRestoring] = useState(null);

  function dismissPair(id1, id2) {
    const key = [id1, id2].sort().join('|');
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(key);
      try { localStorage.setItem('mt_dismissed_dups', JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  const load = useCallback(() => {
    setLoading(true);
    apiFetch('/api/flagged')
      .then(r => r.json())
      .then(d => setData(d))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (section === 'trash' && trash === null) {
      apiFetch('/api/transactions/trash').then(r => r.json()).then(d => setTrash(d.items || [])).catch(() => setTrash([]));
    }
  }, [section]);

  async function deleteTxn(txnId) {
    setDeleting(txnId);
    try {
      const r = await apiFetch(`/api/transactions/${txnId}`, { method: 'DELETE' });
      if (!r.ok) return;
      setData(prev => ({
        ...prev,
        pairs:   (prev.pairs   || []).filter(p => p.txn1.id !== txnId && p.txn2.id !== txnId),
        flagged: (prev.flagged || []).filter(t => t.id !== txnId),
      }));
      // Refresh trash list so the newly deleted item appears immediately
      setTrash(null);
    } finally {
      setDeleting(null);
    }
  }

  async function restoreTxn(txnId) {
    setRestoring(txnId);
    try {
      const r = await apiFetch(`/api/transactions/${txnId}/restore`, { method: 'POST' });
      if (r.ok) {
        setTrash(prev => prev.filter(t => t.id !== txnId));
        window.showToast?.('Transaction restored');
      }
    } finally {
      setRestoring(null);
    }
  }

  async function unflagTxn(txnId) {
    await apiFetch(`/api/transactions/${txnId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flagged: false }),
    });
    setData(prev => ({ ...prev, flagged: (prev.flagged || []).filter(t => t.id !== txnId) }));
  }

  if (loading) return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 24px' }}>
      <div style={{ marginBottom: 20 }}>
        <div className="skeleton" style={{ height: 26, width: 180, borderRadius: 6, marginBottom: 10 }} />
        <div className="skeleton" style={{ height: 13, width: 320, borderRadius: 4 }} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <div className="skeleton" style={{ height: 34, width: 160, borderRadius: 8 }} />
        <div className="skeleton" style={{ height: 34, width: 100, borderRadius: 8 }} />
      </div>
      {[1, 2, 3].map(i => (
        <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: 20, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div className="skeleton" style={{ height: 14, width: 80, borderRadius: 4 }} />
            <div className="skeleton" style={{ height: 20, width: 50, borderRadius: 10 }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ padding: 12, border: '1px solid var(--line)', borderRadius: 8 }}>
              <div className="skeleton" style={{ height: 12, width: '70%', borderRadius: 4, marginBottom: 6 }} />
              <div className="skeleton" style={{ height: 16, width: '50%', borderRadius: 4 }} />
            </div>
            <div style={{ padding: 12, border: '1px solid var(--line)', borderRadius: 8 }}>
              <div className="skeleton" style={{ height: 12, width: '70%', borderRadius: 4, marginBottom: 6 }} />
              <div className="skeleton" style={{ height: 16, width: '50%', borderRadius: 4 }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  const pairs       = data?.pairs   || [];
  const flaggedList = data?.flagged || [];
  const activePairs = pairs.filter(p => !dismissed.has([p.txn1.id, p.txn2.id].sort().join('|')));
  const highCount   = activePairs.filter(p => p.confidence === 'high').length;
  const visiblePairs = filter === 'high' ? activePairs.filter(p => p.confidence === 'high') : activePairs;

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 24px' }}>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: 'var(--ink)' }}>Needs Attention</h2>
        <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: '5px 0 0' }}>
          Possible duplicate charges and transactions you flagged for review.
        </p>
      </div>

      {/* Section toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[
          { id: 'dups',    label: `Possible Duplicates (${activePairs.length})` },
          { id: 'flagged', label: `Flagged (${flaggedList.length})` },
          { id: 'trash',   label: `🗑 Trash` },
        ].map(s => (
          <button key={s.id} onClick={() => setSection(s.id)}
            style={{
              padding: '7px 16px', borderRadius: 8, border: '1px solid var(--line)',
              background: section === s.id ? 'var(--ink)' : 'var(--surface)',
              color: section === s.id ? 'var(--bg)' : 'var(--ink)',
              fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              transition: 'all 0.15s',
            }}>
            {s.label}
          </button>
        ))}
      </div>

      {/* ── Duplicates section ── */}
      {section === 'dups' && (
        <>
          <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12, lineHeight: 1.5 }}>
            Same merchant · same amount · within 7 days. Check your bank statement before deleting.
          </p>
          {pairs.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {[
                { id: 'all',  label: `All (${pairs.length})`,           color: null },
                { id: 'high', label: `High confidence (${highCount})`,  color: '#dc2626' },
              ].map(f => (
                <button key={f.id} onClick={() => setFilter(f.id)}
                  style={{
                    padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'inherit', border: '1px solid',
                    background: filter === f.id
                      ? (f.color ? 'rgba(220,38,38,0.08)' : 'var(--surface-2)')
                      : 'var(--surface)',
                    color:       filter === f.id ? (f.color || 'var(--ink)') : 'var(--ink-3)',
                    borderColor: filter === f.id ? (f.color ? 'rgba(220,38,38,0.3)' : 'var(--line)') : 'var(--line)',
                  }}>
                  {f.label}
                </button>
              ))}
            </div>
          )}
          {visiblePairs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--ink-3)' }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>✓</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-3)' }}>No duplicates found</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>Your transactions look clean!</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {visiblePairs.map(pair => (
                <div key={`${pair.txn1.id}-${pair.txn2.id}`} className="card" style={{ overflow: 'hidden', padding: 0 }}>
                  {/* Pair header */}
                  <div style={{
                    padding: '12px 18px', borderBottom: '1px solid var(--line)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: '50%', background: 'var(--surface-2)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 800, color: 'var(--ink-3)',
                        flexShrink: 0,
                      }}>
                        {(pair.txn1.description.trim()[0] || '?').toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
                          {pair.txn1.description}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 1 }}>
                          {pair.delta_days === 0 ? 'Same day' : `${pair.delta_days}d apart`}
                          {' · '}
                          <span style={{ color: pair.confidence === 'high' ? '#dc2626' : '#d97706', fontWeight: 600 }}>
                            {pair.confidence === 'high' ? 'high' : 'medium'} confidence
                          </span>
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ fontSize: 15, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>
                        {fmt(Math.abs(pair.txn1.amount))}
                      </div>
                      <button onClick={() => dismissPair(pair.txn1.id, pair.txn2.id)} style={{
                        padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                        cursor: 'pointer', fontFamily: 'inherit', border: '1px solid var(--line)',
                        background: 'var(--surface-2)', color: 'var(--ink-3)',
                      }} title="Mark as not a duplicate and hide this pair">
                        Keep both
                      </button>
                    </div>
                  </div>
                  {/* Two rows */}
                  {[pair.txn1, pair.txn2].map((txn, ti) => (
                    <div key={txn.id} style={{
                      display: 'grid', gridTemplateColumns: '100px 1fr auto',
                      alignItems: 'center', gap: 12, padding: '10px 18px',
                      borderBottom: ti === 0 ? '1px solid var(--line)' : 'none',
                      background: ti === 1 ? 'rgba(20,24,32,0.015)' : undefined,
                    }}>
                      <div>
                        <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                          {txn.date.slice(5).replace('-', '/')}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 1 }}>{txn.source}</div>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                        {txn.category}
                        {txn.approved && <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--green)', fontWeight: 700 }}>✓ approved</span>}
                        {txn.pending  && <span style={{ marginLeft: 8, fontSize: 10, color: '#d97706', fontWeight: 700 }}>pending</span>}
                        {txn.notes?.includes('Possible duplicate') && <span style={{ marginLeft: 8, fontSize: 10, color: '#d97706', fontWeight: 700 }}>⚠ flagged</span>}
                      </div>
                      <button onClick={() => deleteTxn(txn.id)} disabled={!!deleting}
                        style={{
                          padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                          cursor: deleting ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                          border: '1px solid rgba(220,38,38,0.25)', background: 'rgba(220,38,38,0.06)',
                          color: '#dc2626', opacity: deleting === txn.id ? 0.5 : 1, transition: 'opacity 0.1s',
                        }}>
                        {deleting === txn.id ? '…' : 'Delete'}
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Flagged transactions section ── */}
      {section === 'flagged' && (
        <>
          <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12 }}>
            Transactions you flagged for manual review from the Review tab.
          </p>
          {flaggedList.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--ink-3)' }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>⚑</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-3)' }}>Nothing flagged</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>
                Flag transactions in Review to see them here.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {flaggedList.map(txn => (
                <div key={txn.id} className="card" style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {txn.description}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
                      {txn.date.slice(5).replace('-', '/')} · {txn.source} · {txn.category}
                      {txn.approved && <span style={{ marginLeft: 8, color: 'var(--green)', fontWeight: 600 }}>✓ approved</span>}
                    </div>
                    {txn.notes && <div style={{ fontSize: 11, color: '#d97706', marginTop: 2 }}>{txn.notes}</div>}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--ink)', whiteSpace: 'nowrap' }}>
                    {txn.amount >= 0 ? '−' : '+'}{fmt(Math.abs(txn.amount))}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => unflagTxn(txn.id)}
                      style={{
                        padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                        cursor: 'pointer', fontFamily: 'inherit',
                        border: '1px solid var(--line)', background: 'var(--surface)',
                        color: 'var(--ink-3)',
                      }}>
                      Unflag
                    </button>
                    <button onClick={() => deleteTxn(txn.id)} disabled={!!deleting}
                      style={{
                        padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                        cursor: deleting ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                        border: '1px solid rgba(220,38,38,0.25)', background: 'rgba(220,38,38,0.06)',
                        color: '#dc2626', opacity: deleting === txn.id ? 0.5 : 1,
                      }}>
                      {deleting === txn.id ? '…' : 'Delete'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Trash section ── */}
      {section === 'trash' && (
        <>
          <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 16, lineHeight: 1.5 }}>
            Deleted transactions are kept for 7 days, then permanently removed. Click Restore to bring one back.
          </p>
          {trash === null ? (
            <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>Loading…</div>
          ) : trash.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--ink-3)' }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>🗑</div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Trash is empty</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>Deleted transactions will appear here for 7 days.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {trash.map(t => {
                const cat = catById(t.category);
                return (
                  <div key={t.id} className="card" style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 9, background: cat.color + '22', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: cat.color }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.merchant}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
                        {t.date} · {cat.name}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginRight: 8 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: t.amount >= 0 ? 'var(--green)' : 'var(--ink)' }}>
                        {fmtMoney(Math.abs(t.amount))}
                      </div>
                      <div style={{ fontSize: 10, color: t.expires_in <= 1 ? 'var(--terra)' : 'var(--ink-4)', marginTop: 2 }}>
                        {t.expires_in === 0 ? 'expires today' : `${t.expires_in}d left`}
                      </div>
                    </div>
                    <button onClick={() => restoreTxn(t.id)} disabled={restoring === t.id}
                      style={{
                        padding: '5px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                        cursor: restoring === t.id ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                        border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
                        background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
                        color: 'var(--accent)', flexShrink: 0,
                        opacity: restoring === t.id ? 0.5 : 1,
                      }}>
                      {restoring === t.id ? '…' : 'Restore'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
// FEEDBACK TAB
// ═══════════════════════════════════════════════════════════════════
function FeedbackTab() {
  const CATS = [
    { id: 'bug',     label: '🐛 Bug',            desc: 'Something is broken or wrong' },
    { id: 'feature', label: '✨ Feature request', desc: "Something you'd like to see" },
    { id: 'general', label: '💬 General',         desc: 'Anything else' },
  ];

  const [cat, setCat]         = useState('general');
  const [msg, setMsg]         = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent]       = useState(false);
  const [err, setErr]         = useState('');
  const [entries, setEntries] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    apiFetch('/api/feedback')
      .then(r => r.json())
      .then(d => { setEntries(d.entries || []); setIsAdmin(d.is_admin); });
  }, [sent]);

  async function submit() {
    if (!msg.trim()) return;
    setSending(true); setErr('');
    try {
      const res = await apiFetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: cat, message: msg.trim() }),
      });
      if (res.ok) { setSent(true); setMsg(''); setTimeout(() => setSent(false), 3000); }
      else { const d = await res.json(); setErr(d.detail || 'Failed to send'); }
    } catch(e) { setErr(String(e)); }
    finally { setSending(false); }
  }

  const catColors = { bug: '#ef4444', feature: '#a78bfa', general: '#67e8f9' };
  const catLabel  = { bug: 'Bug', feature: 'Feature', general: 'General' };

  return (
    <div className="tab-body" style={{ maxWidth: 680, margin: '0 auto' }}>

      {/* Submit form */}
      <div style={{
        background: 'var(--surface)', borderRadius: 16,
        border: '1px solid var(--line)', padding: '24px 28px', marginBottom: 20,
      }}>
        <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--ink)', marginBottom: 18 }}>
          Share feedback
        </div>

        {/* Category selector */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {CATS.map(c => (
            <button key={c.id} onClick={() => setCat(c.id)} style={{
              padding: '7px 14px', borderRadius: 20, fontSize: 13, fontWeight: 500,
              border: `1px solid ${cat === c.id ? catColors[c.id] : 'var(--line)'}`,
              background: cat === c.id ? catColors[c.id] + '18' : 'transparent',
              color: cat === c.id ? catColors[c.id] : 'var(--muted)',
              cursor: 'pointer', fontFamily: 'inherit',
            }}>{c.label}</button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          {CATS.find(c => c.id === cat)?.desc}
        </div>

        <textarea
          value={msg}
          onChange={e => setMsg(e.target.value)}
          placeholder="Describe what you'd like to share…"
          rows={4}
          style={{
            width: '100%', padding: '12px 14px', borderRadius: 10, fontSize: 14,
            border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)',
            fontFamily: 'inherit', resize: 'vertical', outline: 'none',
            boxSizing: 'border-box', lineHeight: 1.5,
          }}
        />

        {err && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 6 }}>{err}</div>}

        <button onClick={submit} disabled={sending || !msg.trim()} style={{
          marginTop: 12, width: '100%', padding: '12px 0',
          background: sent ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'var(--accent)',
          color: sent ? 'var(--accent)' : '#052015',
          border: sent ? '1px solid var(--accent)' : 'none',
          borderRadius: 10, fontSize: 14, fontWeight: 600,
          fontFamily: 'inherit', cursor: sending || !msg.trim() ? 'default' : 'pointer',
          opacity: sending || !msg.trim() ? 0.5 : 1,
        }}>
          {sending ? 'Sending…' : sent ? '✓ Sent — thanks!' : 'Send feedback'}
        </button>
      </div>

      {/* Inbox — admin sees all, users see their own */}
      {entries.length > 0 && (
        <div style={{
          background: 'var(--surface)', borderRadius: 16,
          border: '1px solid var(--line)', overflow: 'hidden',
        }}>
          <div style={{
            padding: '14px 20px', borderBottom: '1px solid var(--line)',
            fontSize: 13, fontWeight: 600, color: 'var(--ink)',
          }}>
            {isAdmin ? `All feedback (${entries.length})` : `Your submissions (${entries.length})`}
          </div>
          {[...entries].reverse().map((e, i) => (
            <div key={e.id} style={{
              padding: '14px 20px',
              borderBottom: i < entries.length - 1 ? '1px solid var(--line)' : 'none',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {isAdmin && (
                    <span style={{
                      fontSize: 12, fontWeight: 600, color: 'var(--ink)',
                      background: 'var(--bg)', border: '1px solid var(--line)',
                      borderRadius: 6, padding: '2px 7px',
                    }}>{e.display_name}</span>
                  )}
                  <span style={{
                    fontSize: 11, fontWeight: 500,
                    color: catColors[e.category] || 'var(--muted)',
                    background: (catColors[e.category] || '#94a3b8') + '18',
                    border: `1px solid ${(catColors[e.category] || '#94a3b8')}40`,
                    borderRadius: 10, padding: '2px 8px',
                  }}>{catLabel[e.category] || e.category}</span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {new Date(e.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6 }}>{e.message}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default FlaggedTab;
export { FeedbackTab };
