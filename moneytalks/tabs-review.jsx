function AllDoneCelebration({ total, streak, setTab }) {
  const { useEffect, useState } = React;
  const [show, setShow] = useState(false);
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { clearInterval(interval); if (setTab) setTab('monthly'); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [setTab]);

  useEffect(() => {
    if (!document.getElementById('review-done-css')) {
      const s = document.createElement('style');
      s.id = 'review-done-css';
      s.textContent = `
        @keyframes confettiFall {
          0%   { transform: translateY(-10px) rotate(0deg);  opacity: 1; }
          100% { transform: translateY(90px)  rotate(390deg);opacity: 0; }
        }
        @keyframes popIn {
          0%   { transform: scale(0.4); opacity: 0; }
          65%  { transform: scale(1.12); }
          100% { transform: scale(1);   opacity: 1; }
        }
        .rdone-emoji { animation: confettiFall linear forwards; position: absolute; top: 0; pointer-events: none; }
        .rdone-pop   { animation: popIn 0.55s cubic-bezier(.2,.8,.3,1.3) forwards; }
      `;
      document.head.appendChild(s);
    }
    const t = setTimeout(() => setShow(true), 30);
    return () => clearTimeout(t);
  }, []);

  const CONFETTI = ['🎉','✨','🎊','💸','🌟','🏆','💚','🎈','🥳','💰'];
  const streakMsg = streak >= 7 ? "7+ week streak — absolute legend! 🏆"
    : streak >= 4 ? `${streak} weeks running — you're on fire! 🔥`
    : streak >= 2 ? `${streak} weeks in a row! Keep it going 🔥`
    : null;
  const reviewedMsg = total > 500 ? `${total} transactions? You're practically a CPA.`
    : total > 200 ? `${total} transactions reviewed. Seriously impressive.`
    : total > 50  ? `${total} transactions reviewed. Finance goals: unlocked.`
    : `All ${total} transactions reviewed.`;

  return (
    <div style={{
      background: 'var(--surface)', borderRadius: 16,
      border: '1px solid var(--line)', padding: '52px 24px',
      textAlign: 'center', position: 'relative', overflow: 'hidden',
    }}>
      {show && CONFETTI.map((em, i) => (
        <span key={i} className="rdone-emoji" style={{
          left: `${5 + i * 9}%`,
          fontSize: 18 + (i % 3) * 4,
          animationDuration: `${1.3 + i * 0.13}s`,
          animationDelay: `${i * 0.12}s`,
        }}>{em}</span>
      ))}
      <div className="rdone-pop" style={{ opacity: 0 }}>
        <div style={{ fontSize: 60, marginBottom: 10, lineHeight: 1 }}>🎉</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)', marginBottom: 8, letterSpacing: '-0.02em' }}>
          You're all caught up!
        </div>
        <div style={{ fontSize: 14, color: 'var(--muted)', marginBottom: streakMsg ? 20 : 0, maxWidth: 340, margin: '0 auto', lineHeight: 1.5 }}>
          {reviewedMsg}
        </div>
        {streakMsg && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 20,
            background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
            border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
            borderRadius: 20, padding: '8px 18px',
            fontSize: 13, fontWeight: 600, color: 'var(--accent)',
          }}>
            {streakMsg}
          </div>
        )}
        <div style={{ marginTop: 24, fontSize: 12, color: 'var(--muted)' }}>
          Redirecting to Monthly tab in {countdown}s…
        </div>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
// REVIEW TAB
// ═══════════════════════════════════════════════════════════════════
function ReviewTab({ refreshFin, setTab }) {
  const { useState, useEffect, useCallback, useMemo } = React;

  const [state, setState]         = useState(null);
  const [loading, setLoading]     = useState(true);
  const [groupIdx, setGroupIdx]   = useState(() => {
    try { return parseInt(localStorage.getItem('review.groupIdx') || '0', 10) || 0; } catch { return 0; }
  });
  const [groupCats, setGroupCats] = useState({});   // vendorKey → group fill category
  const [itemCats, setItemCats]   = useState(() => {
    try { return JSON.parse(localStorage.getItem('review.itemCats') || '{}'); } catch { return {}; }
  });   // txnId → per-row category override
  const [localFlags, setLocalFlags] = useState({});
  const [approving, setApproving]   = useState(false);

  // Persist groupIdx and itemCats across sessions
  useEffect(() => {
    try { localStorage.setItem('review.groupIdx', String(groupIdx)); } catch {}
  }, [groupIdx]);
  useEffect(() => {
    try { localStorage.setItem('review.itemCats', JSON.stringify(itemCats)); } catch {}
  }, [itemCats]);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch('/api/review')
      .then(r => r.json())
      .then(d => {
        setState(d);
        setGroupCats({});
        // Keep itemCats — they may still be valid for transactions in the new batch
        const flags = {};
        (d.batch || []).forEach(t => { if (t.id) flags[t.id] = !!t.flagged; });
        setLocalFlags(flags);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Group batch by normalized merchant description
  const groups = useMemo(() => {
    if (!state?.batch?.length) return [];
    const map = {};
    state.batch.forEach(t => {
      const key = t.description.trim().toLowerCase().replace(/\s+/g, ' ');
      if (!map[key]) map[key] = { key, name: t.description, txns: [] };
      map[key].txns.push(t);
    });
    return Object.values(map)
      .sort((a, b) => b.txns.length - a.txns.length || a.name.localeCompare(b.name))
      .map(g => ({
        ...g,
        txns: g.txns.slice().sort((a, b) => (b.date > a.date ? 1 : -1)),
        total: g.txns.reduce((s, t) => s + Math.abs(t.amount), 0),
        suggestedCat: g.txns[0].category,
        isExpense: g.txns[0].amount >= 0,
      }));
  }, [state?.batch]);

  // Clamp groupIdx to valid range after groups change
  const safeIdx = Math.max(0, Math.min(groupIdx, groups.length - 1));

  function getGroupCat(g)   { return groupCats[g.key] ?? g.suggestedCat; }
  function getItemCat(g, t) { return itemCats[t.id] ?? getGroupCat(g); }

  function toggleFlag(txnId) {
    const next = !localFlags[txnId];
    setLocalFlags(prev => ({ ...prev, [txnId]: next }));
    apiFetch(`/api/transactions/${txnId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flagged: next }),
    }).catch(() => setLocalFlags(prev => ({ ...prev, [txnId]: !next })));
  }

  async function deleteRow(txnId) {
    const r = await apiFetch(`/api/transactions/${txnId}`, { method: 'DELETE' });
    if (!r.ok) return;
    setState(prev => ({
      ...prev,
      batch:     (prev.batch || []).filter(t => t.id !== txnId),
      remaining: Math.max(0, (prev.remaining || 1) - 1),
      total:     Math.max(0, (prev.total || 1) - 1),
    }));
    setItemCats(prev => { const n = {...prev}; delete n[txnId]; return n; });
  }

  async function doApprove(ids, overrides) {
    const r = await apiFetch('/api/review/approve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, overrides }),
    });
    return r.json();
  }

  async function approveGroup(g) {
    if (approving) return;
    setApproving(true);
    try {
      const overrides = {};
      g.txns.forEach(t => { if (t.id) overrides[t.id] = getItemCat(g, t); });
      const ids = g.txns.map(t => t.id).filter(Boolean);
      const data = await doApprove(ids, overrides);
      if (data.ok) {
        const gone = new Set(ids);
        const newBatch = (state.batch || []).filter(t => !gone.has(t.id));
        setState(prev => ({
          ...prev,
          total: data.total ?? prev.total,
          approved: data.approved,
          remaining: data.remaining,
          streak: data.streak,
          last_reviewed: data.last_reviewed,
          batch: newBatch,
        }));
        window.showToast?.(`Approved ${ids.length} transaction${ids.length !== 1 ? 's' : ''}`);
        // Clamp to valid index — groups will re-derive with one fewer entry
        if (groupIdx >= groups.length - 1 && groupIdx > 0) setGroupIdx(groups.length - 2);
        if (refreshFin) refreshFin();
        if (newBatch.length === 0 && data.remaining > 0) load();
      }
    } catch(_) {}
    finally { setApproving(false); }
  }

  async function approveAll() {
    if (approving || !state?.batch?.length) return;
    setApproving(true);
    try {
      const overrides = {};
      groups.forEach(g => g.txns.forEach(t => { if (t.id) overrides[t.id] = getItemCat(g, t); }));
      const ids = state.batch.map(t => t.id).filter(Boolean);
      const data = await doApprove(ids, overrides);
      if (data.ok) {
        setState(prev => ({
          ...prev,
          total: data.total ?? prev.total,
          approved: data.approved,
          remaining: data.remaining,
          streak: data.streak,
          last_reviewed: data.last_reviewed,
          batch: [],
        }));
        window.showToast?.(`Approved all ${ids.length} transaction${ids.length !== 1 ? 's' : ''}`);
        if (refreshFin) refreshFin();
        if (data.remaining > 0) load();
      }
    } catch(_) {}
    finally { setApproving(false); }
  }

  if (loading) return (
    <div className="tab-body review-tab-body">
      {/* Progress header skeleton */}
      <div className="review-progress-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="skeleton" style={{ height: 10, width: 130, borderRadius: 4 }} />
            <div className="skeleton" style={{ height: 16, width: 100, borderRadius: 4 }} />
            <div className="skeleton" style={{ height: 12, width: 80, borderRadius: 4 }} />
          </div>
          <div className="skeleton" style={{ height: 40, width: 64, borderRadius: 6 }} />
        </div>
        <div className="skeleton" style={{ height: 5, width: '100%', borderRadius: 3 }} />
      </div>
      {/* Group card skeleton */}
      <div className="review-group-card" style={{ marginTop: 20 }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="skeleton" style={{ height: 18, width: 160, borderRadius: 4 }} />
            <div className="skeleton" style={{ height: 12, width: 100, borderRadius: 4 }} />
          </div>
          <div className="skeleton" style={{ height: 22, width: 80, borderRadius: 11 }} />
        </div>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '90px 1fr auto auto auto', gap: 12, padding: '14px 24px', borderBottom: '1px solid var(--line)' }}>
            <div className="skeleton" style={{ height: 14, width: 50, borderRadius: 4 }} />
            <div className="skeleton" style={{ height: 24, width: 120, borderRadius: 6 }} />
            <div className="skeleton" style={{ height: 16, width: 64, borderRadius: 4, justifySelf: 'end' }} />
            <div className="skeleton" style={{ height: 18, width: 18, borderRadius: '50%' }} />
            <div className="skeleton" style={{ height: 18, width: 18, borderRadius: '50%' }} />
          </div>
        ))}
      </div>
    </div>
  );

  const { total = 0, approved = 0, remaining = 0, streak = 0, last_reviewed = null } = state || {};
  const pct = total > 0 ? Math.round((approved / total) * 100) : 100;
  const allDone = state !== null && remaining === 0 && total > 0;
  const g = groups[safeIdx] || null;
  const catInfo = g ? FIN.catById(getGroupCat(g)) : null;
  const batchCount = state?.batch?.length || 0;

  // Detect if current group looks like a duplicate pair
  const dupGroup = g && g.txns.length >= 2 && g.txns.every(t =>
    Math.abs(Math.abs(t.amount) - Math.abs(g.txns[0].amount)) < 0.01 &&
    Math.abs(new Date(t.date) - new Date(g.txns[0].date)) / 86400000 <= 7
  );
  const dupOlder = dupGroup ? [...g.txns].sort((a, b) => a.date < b.date ? -1 : 1)[0] : null;
  const dupNewer = dupGroup ? [...g.txns].sort((a, b) => a.date > b.date ? -1 : 1)[0] : null;

  async function resolveDup(keepId) {
    if (!g) return;
    const deleteIds = g.txns.filter(t => t.id !== keepId).map(t => t.id);
    // Delete the others
    await Promise.all(deleteIds.map(id => apiFetch(`/api/transactions/${id}`, { method: 'DELETE' })));
    // Approve the kept one
    const overrides = {};
    overrides[keepId] = getItemCat(g, g.txns.find(t => t.id === keepId));
    await doApprove([keepId], overrides);
    setState(prev => {
      const removed = new Set([...deleteIds]);
      const batch = (prev.batch || []).filter(t => !removed.has(t.id) && t.id !== keepId);
      return { ...prev, batch, remaining: Math.max(0, (prev.remaining || 0) - g.txns.length) };
    });
    setItemCats(prev => {
      const n = {...prev};
      g.txns.forEach(t => delete n[t.id]);
      return n;
    });
    if (groupIdx >= groups.length - 1 && groupIdx > 0) setGroupIdx(groups.length - 2);
  }

  return (
    <div className="tab-body review-tab-body">

      {/* ── Progress header ─────────────────────────────────────────── */}
      <div className="review-progress-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 5 }}>
              Transaction Review
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
              {allDone ? 'All caught up!' : `${remaining} to review`}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
              {approved} of {total} approved
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
            <div style={{
              fontSize: 36, fontWeight: 800,
              color: pct >= 90 ? 'var(--green)' : pct >= 70 ? '#fbbf24' : 'var(--accent)',
              letterSpacing: '-0.05em', fontFamily: 'var(--font-display)', lineHeight: 1,
            }}>{pct}%</div>
            {streak > 0 && (
              <div style={{ fontSize: 11.5, fontWeight: 700, color: streak >= 4 ? '#f97316' : streak >= 2 ? '#fbbf24' : 'var(--ink-3)' }}>
                {streak >= 2 ? '🔥' : '✓'} {streak} week{streak !== 1 ? 's' : ''} streak
              </div>
            )}
          </div>
        </div>
        <div style={{ height: 5, background: 'var(--line)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${pct}%`, borderRadius: 3,
            background: 'linear-gradient(90deg, var(--accent), var(--accent-2, var(--accent)))',
            transition: 'width 0.5s cubic-bezier(0.22,1,0.36,1)',
          }} />
        </div>
      </div>

      {allDone ? (
        <AllDoneCelebration total={total} streak={streak} setTab={setTab} />
      ) : !g ? null : (
        <>
          {/* ── Group navigator chips ──────────────────────────────── */}
          {groups.length > 1 && (
            <div className="review-chips">
              {groups.map((grp, i) => {
                const isActive = i === safeIdx;
                const gc = FIN.catById(getGroupCat(grp));
                return (
                  <button key={grp.key} className={`review-chip ${isActive ? 'active' : ''}`}
                    style={{
                      borderColor: isActive ? gc.color : undefined,
                      background: isActive ? gc.color + '16' : undefined,
                    }}
                    onClick={() => setGroupIdx(i)}>
                    <span style={{ color: gc.color }}>{gc.icon}</span>
                    <span style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {grp.name}
                    </span>
                    <span className="review-chip-count" style={{
                      background: isActive ? gc.color : 'var(--line)',
                      color: isActive ? '#fff' : 'var(--ink-3)',
                    }}>{grp.txns.length}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* ── Main group card ────────────────────────────────────── */}
          <div className="review-group-card">

            {/* Group header */}
            <div className="review-group-header" style={{ background: catInfo.color + '09' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                {/* Vendor icon + name */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div className="review-vendor-icon" style={{ background: catInfo.color + '20', color: catInfo.color }}>
                    {catInfo.icon}
                  </div>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-0.025em', marginBottom: 3 }}>
                      {g.name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                      {g.txns.length} transaction{g.txns.length !== 1 ? 's' : ''}
                      <span style={{ color: 'var(--ink-4)', margin: '0 6px' }}>·</span>
                      <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--ink-2)' }}>
                        {fmtMoney2(g.total)}
                      </span> total
                    </div>
                  </div>
                </div>

                {/* Prev / count / Next */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <button className="review-nav-btn"
                    onClick={() => setGroupIdx(i => Math.max(0, i - 1))}
                    style={{ opacity: safeIdx === 0 ? 0.3 : 1, cursor: safeIdx === 0 ? 'default' : 'pointer' }}
                    disabled={safeIdx === 0}>←</button>
                  <span style={{ fontSize: 11, color: 'var(--ink-3)', padding: '0 4px', fontFamily: 'var(--font-mono)' }}>
                    {safeIdx + 1} / {groups.length}
                  </span>
                  <button className="review-nav-btn"
                    onClick={() => setGroupIdx(i => Math.min(groups.length - 1, i + 1))}
                    style={{ opacity: safeIdx === groups.length - 1 ? 0.3 : 1, cursor: safeIdx === groups.length - 1 ? 'default' : 'pointer' }}
                    disabled={safeIdx === groups.length - 1}>→</button>
                </div>
              </div>

              {/* "Fill all" shortcut — sets every row's category at once, individually still editable */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10, background: 'rgba(20,24,32,0.04)' }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
                  Fill all →
                </span>
                <CategoryPicker
                  value={getGroupCat(g)}
                  onChange={cat => {
                    setGroupCats(prev => ({ ...prev, [g.key]: cat }));
                    // Push the chosen category to every item that hasn't been individually overridden yet
                    setItemCats(prev => {
                      const next = { ...prev };
                      g.txns.forEach(t => { next[t.id] = cat; });
                      return next;
                    });
                  }}
                />
                <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>overwrites all rows</span>
              </div>
            </div>

            {/* Column header */}
            <div style={{
              display: 'grid', gridTemplateColumns: '90px 1fr auto auto auto',
              gap: 12, padding: '7px 24px',
              borderBottom: '2px solid var(--line)',
              fontSize: 10.5, fontWeight: 700, color: 'var(--ink-3)',
              textTransform: 'uppercase', letterSpacing: '0.07em',
            }}>
              <div>Date</div>
              <div>Category</div>
              <div style={{ textAlign: 'right' }}>Amount</div>
              <div />
              <div />
            </div>

            {/* Transaction rows — each has its own category picker, always visible */}
            {g.txns.map((t, i) => {
              const isFlagged   = !!localFlags[t.id];
              const currentCat  = getItemCat(g, t);
              const currentInfo = FIN.catById(currentCat);
              const isExpense   = t.amount >= 0;
              const isIndividual = !!itemCats[t.id] && itemCats[t.id] !== getGroupCat(g);
              // Detect if this row is a possible duplicate within its group
              const isPossibleDup = t.notes?.includes('Possible duplicate') || g.txns.some((other, oi) =>
                oi !== i &&
                Math.abs(Math.abs(other.amount) - Math.abs(t.amount)) < 0.01 &&
                Math.abs(new Date(other.date) - new Date(t.date)) / 86400000 <= 7
              );
              return (
                <div key={t.id || i}
                  style={{
                    display: 'grid', gridTemplateColumns: '90px 1fr auto auto auto',
                    alignItems: 'center', gap: 12, padding: '10px 24px',
                    borderBottom: i < g.txns.length - 1 ? '1px solid var(--line)' : 'none',
                    background: isPossibleDup ? 'rgba(234,179,8,0.04)' : isFlagged ? 'rgba(249,115,22,0.04)' : i % 2 === 1 ? 'rgba(20,24,32,0.012)' : undefined,
                    transition: 'background 0.1s',
                  }}>

                  {/* Date + source */}
                  <div>
                    <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--ink)', fontWeight: 500 }}>
                      {t.date.slice(5).replace('-', '/')}
                    </div>
                    {t.source && (
                      <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.source}
                      </div>
                    )}
                    {isPossibleDup && (
                      <div style={{ fontSize: 9.5, color: '#ca8a04', fontWeight: 700, marginTop: 2, letterSpacing: '0.03em' }}>
                        ⚠ dup?
                      </div>
                    )}
                  </div>

                  {/* Per-row category picker — always visible */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <CategoryPicker
                        value={currentCat}
                        onChange={cat => {
                          setItemCats(prev => ({ ...prev, [t.id]: cat }));
                        }}
                      />
                      {/* Fill below: apply this category to all rows after this one */}
                      {i < g.txns.length - 1 && (
                        <button
                          title="Apply this category to all rows below"
                          onClick={() => {
                            const below = g.txns.slice(i + 1);
                            setItemCats(prev => {
                              const n = { ...prev };
                              below.forEach(bt => { n[bt.id] = currentCat; });
                              return n;
                            });
                          }}
                          style={{
                            background: 'none', border: '1px solid var(--line)', borderRadius: 4,
                            cursor: 'pointer', color: 'var(--ink-4)', fontSize: 10, padding: '1px 4px',
                            lineHeight: 1.4, fontFamily: 'inherit', flexShrink: 0,
                          }}>
                          ↓ fill
                        </button>
                      )}
                    </div>
                    {isIndividual && (
                      <button
                        onClick={() => setItemCats(prev => { const n = {...prev}; delete n[t.id]; return n; })}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--ink-4)', fontSize: 10, padding: '1px 0',
                          fontFamily: 'inherit', textDecoration: 'underline dotted',
                        }}>
                        reset
                      </button>
                    )}
                  </div>

                  {/* Amount */}
                  <div style={{
                    fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)',
                    color: isExpense ? 'var(--ink)' : 'var(--green)',
                    whiteSpace: 'nowrap', textAlign: 'right', letterSpacing: '-0.02em',
                  }}>
                    {isExpense ? '−' : '+'}{FIN.fmt(Math.abs(t.amount))}
                  </div>

                  {/* Flag */}
                  <button
                    onClick={() => t.id && toggleFlag(t.id)}
                    title={isFlagged ? 'Remove flag' : 'Flag for later review'}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
                      fontSize: 14, lineHeight: 1,
                      color: isFlagged ? '#f97316' : 'var(--ink-4)',
                      opacity: isFlagged ? 1 : 0.45,
                      transition: 'color 0.12s, opacity 0.12s',
                    }}
                    onMouseEnter={e => { if (!isFlagged) e.currentTarget.style.opacity = '1'; }}
                    onMouseLeave={e => { if (!isFlagged) e.currentTarget.style.opacity = '0.45'; }}
                  >⚑</button>

                  {/* Delete */}
                  <button
                    onClick={() => t.id && deleteRow(t.id)}
                    title="Delete this transaction"
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
                      fontSize: 15, lineHeight: 1, color: 'var(--ink-4)',
                      opacity: 0.3, transition: 'color 0.12s, opacity 0.12s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = '#dc2626'; }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = '0.3'; e.currentTarget.style.color = 'var(--ink-4)'; }}
                  >×</button>
                </div>
              );
            })}

            {/* Footer — dup resolution or normal approve */}
            {dupGroup ? (
              <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line)', background: 'rgba(234,179,8,0.04)' }}>
                <div style={{ fontSize: 11, color: '#92400e', fontWeight: 600, marginBottom: 8, letterSpacing: '0.02em' }}>
                  ⚠ Possible duplicate — which charge is real?
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="review-skip-btn"
                    onClick={() => setGroupIdx(i => (i + 1) % groups.length)}>
                    Skip →
                  </button>
                  <button
                    disabled={approving}
                    onClick={() => dupOlder && resolveDup(dupOlder.id)}
                    style={{
                      flex: 1, padding: '10px 14px', borderRadius: 10, border: 'none',
                      background: 'var(--surface-2)', color: 'var(--ink)',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                    Keep {dupOlder?.date.slice(5).replace('-', '/')} · delete newer
                  </button>
                  <button
                    disabled={approving}
                    onClick={() => dupNewer && resolveDup(dupNewer.id)}
                    style={{
                      flex: 1, padding: '10px 14px', borderRadius: 10, border: 'none',
                      background: catInfo?.color || 'var(--accent)', color: '#fff',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                    Keep {dupNewer?.date.slice(5).replace('-', '/')} · delete older
                  </button>
                </div>
              </div>
            ) : (
              <div className="review-group-footer">
                <button className="review-skip-btn"
                  onClick={() => setGroupIdx(i => (i + 1) % groups.length)}>
                  Skip →
                </button>
                <button className="review-approve-btn" disabled={approving}
                  onClick={() => approveGroup(g)}
                  style={{ background: catInfo.color || 'var(--accent)' }}>
                  {approving ? 'Saving…' : `✓ Approve ${g.txns.length} · ${fmtMoney2(g.total)}`}
                </button>
              </div>
            )}
          </div>

          {/* Approve all */}
          {groups.length > 0 && batchCount > (g?.txns?.length || 0) && (
            <div style={{ textAlign: 'center' }}>
              <button className="review-approve-all-btn" disabled={approving} onClick={approveAll}>
                Approve all {batchCount} transactions ({groups.length} group{groups.length !== 1 ? 's' : ''})
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
// FLAGGED TAB — possible duplicates + manually flagged transactions
// ═══════════════════════════════════════════════════════════════════
function FlaggedTab() {
  const { useState, useEffect, useCallback } = React;
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
                        {FIN.fmt(Math.abs(pair.txn1.amount))}
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
                    {txn.amount >= 0 ? '−' : '+'}{FIN.fmt(Math.abs(txn.amount))}
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
  const { useState, useEffect } = React;

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

// ─── Admin Tab ────────────────────────────────────────────────────────────────
