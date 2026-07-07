function sharedCatById(id) {
  return SHARED_CATS.find(c => c.id === id) || { id, name: id, color: '#94a3b8' };
}

// Renders children into document.body so position:fixed modals are always
// relative to the viewport, regardless of ancestor CSS transforms.
function Portal({ children }) {
  return ReactDOM.createPortal(children, document.body);
}

function SharedMerchantDrawer({ merchant, expenses, participantColors = {}, onClose }) {
  const matching = expenses.filter(e => e.description === merchant)
    .sort((a, b) => b.date.localeCompare(a.date));
  const total = matching.reduce((s, e) => s + e.amount, 0);

  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    return d.toISOString().slice(0, 7);
  });
  const byMonth = {};
  matching.forEach(e => { const m = e.date.slice(0, 7); byMonth[m] = (byMonth[m] || 0) + e.amount; });
  const chartData = months.map(m => ({ label: m.slice(5), value: byMonth[m] || 0 }));
  const maxVal = Math.max(...chartData.map(d => d.value), 1);

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)' }} />
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 401, width: 420, background: 'var(--surface)', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 32px rgba(0,0,0,0.12)' }}>
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.01em' }}>{merchant}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3 }}>
                {matching.length} expense{matching.length !== 1 ? 's' : ''} in this space
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 16, color: 'var(--ink-3)', lineHeight: 1, flexShrink: 0 }}>✕</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
            {[
              { label: 'Total spent here', value: fmtMoney(total) },
              { label: 'Avg per visit', value: matching.length > 0 ? fmtMoney(total / matching.length) : '—' },
            ].map(({ label, value }) => (
              <div key={label} style={{ background: 'var(--surface-3)', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
        {chartData.some(d => d.value > 0) && (
          <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Monthly spend — last 12 months</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 72 }}>
              {chartData.map(({ label, value }) => (
                <BarCol key={label} label={label} value={value} maxVal={maxVal} />
              ))}
            </div>
          </div>
        )}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {matching.map(e => {
            const catI = sharedCatById(e.category);
            const userColor = participantColors[e.user] || catI.color;
            return (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 24px', borderBottom: '1px solid var(--line)' }}>
                <span className="cat-dot" style={{ background: userColor, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>{e.date}</div>
                  {e.notes && <div style={{ fontSize: 12, color: 'var(--accent)', fontStyle: 'italic', marginTop: 2 }}>{e.notes}</div>}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(e.amount)}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 1 }}>{e.display_name || e.user}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function SharedVibeBanner({ detail, myUsername, myTotal }) {
  if (!detail || !detail.expenses?.length) return null;
  const total   = detail.total_spent || 0;
  const budget  = detail.budget;
  const others  = (detail.per_user || []).filter(u => u.user !== myUsername);
  const topOther = [...others].sort((a, b) => b.total - a.total)[0];
  const myPct    = total > 0 ? (myTotal / total) * 100 : 0;

  let emoji = '', text = '', color = 'var(--accent)';
  if (budget && total > budget) {
    emoji = '⚠️'; color = 'var(--terra)';
    text  = `Over budget by ${fmtMoney(total - budget)}.`;
  } else if (budget) {
    const rem = budget - total;
    emoji = '✓'; color = 'var(--green)';
    text  = `${fmtMoney(rem)} left in budget — ${((rem / budget) * 100).toFixed(0)}% remaining.`;
  } else if (topOther && myPct < 25 && total > 0) {
    emoji = '👀'; color = 'var(--ink-3)';
    text  = `${topOther.display_name || topOther.user} is carrying most of the load so far.`;
  } else if (myPct > 70 && others.length > 0) {
    emoji = '💪'; color = 'var(--accent)';
    text  = `You're contributing the most to ${detail.name}.`;
  } else if (detail.expenses?.length >= 10) {
    emoji = '📊'; color = 'var(--ink-3)';
    text  = `${detail.expenses.length} expenses tracked · ${fmtMoney(total / detail.expenses.length)} avg per expense.`;
  } else {
    return null;
  }
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 16px', borderRadius: 12, marginBottom: 0,
      background: 'color-mix(in srgb, var(--surface) 80%, transparent)',
      border: '1px solid var(--line)', fontSize: 13, color: 'var(--ink)',
    }}>
      <span style={{ fontSize: 18 }}>{emoji}</span>
      <span style={{ color }}>{text}</span>
    </div>
  );
}

function SharedTab({ pendingJoin, clearPendingJoin, setTab }) {
  const [spaces, setSpaces]           = useState([]);
  const [loading, setLoading]         = useState(true);
  const [detail, setDetail]           = useState(null);   // {space, expenses, per_user, category_breakdown}
  const [detailLoading, setDetailLoading] = useState(false);

  // Modals
  const [createOpen, setCreateOpen]   = useState(false);
  const [shareModal, setShareModal]   = useState(null);   // {url, token}
  const [joinPrompt, setJoinPrompt]   = useState(null);   // {token, name, owner, type, icon}
  const [expenseModal, setExpenseModal] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [copied, setCopied]           = useState(false);

  // Create form
  const [createForm, setCreateForm]   = useState({ name: '', type: 'event', icon: '📦', start_date: '', end_date: '', budget: '' });
  const [createSaving, setCreateSaving] = useState(false);

  // Add expense form
  const [expForm, setExpForm]         = useState({ description: '', amount: '', date: new Date().toISOString().slice(0,10), category: 'other' });
  const [expSaving, setExpSaving]     = useState(false);
  const [txnSearch, setTxnSearch]     = useState('');
  const [addMode, setAddMode]         = useState('bulk'); // 'manual' | 'txn' | 'bulk'
  // Bulk add state
  const [bulkCat, setBulkCat]         = useState('');
  const [bulkFrom, setBulkFrom]       = useState('');
  const [bulkTo, setBulkTo]           = useState('');
  const [bulkTag, setBulkTag]         = useState('');
  const [bulkSelected, setBulkSelected] = useState(new Set());

  // Breakdown card view toggle ('category' | 'month') — persisted on the space object server-side
  const [breakdownView, setBreakdownView] = useState('category');
  useEffect(() => {
    if (!detail) return;
    setBreakdownView(detail.breakdown_view || (detail.type === 'recurring' ? 'month' : 'category'));
  }, [detail?.id]);
  async function setAndSaveBreakdownView(v) {
    setBreakdownView(v);
    if (!detail) return;
    try {
      await apiFetch(`/api/shared/${detail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ breakdown_view: v }),
      });
    } catch(e) { /* non-critical, ignore */ }
  }

  // Merchant drawer for shared expenses
  const [activeMerchantShared, setActiveMerchantShared] = useState(null);

  // Current user (for identifying own expenses)
  const [me, setMe]                   = useState(null);
  useEffect(() => {
    apiFetch('/api/auth/me').then(r => r.json()).then(setMe).catch(() => {});
  }, []);

  function loadSpaces() {
    setLoading(true);
    apiFetch('/api/shared').then(r => r.json()).then(d => {
      setSpaces(d.spaces || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }
  useEffect(() => { loadSpaces(); }, []);

  function loadDetail(space) {
    setDetailLoading(true);
    const isOwner = space.role === 'owner';
    const path = isOwner
      ? `/api/shared/${space.id}`
      : `/api/shared/${space.id}`;
    apiFetch(path).then(r => r.json()).then(d => {
      setDetail(d);
      setDetailLoading(false);
    }).catch(() => setDetailLoading(false));
  }

  // Handle ?join= URL param passed from App
  useEffect(() => {
    if (!pendingJoin) return;
    apiFetch(`/api/shared/join/${pendingJoin}`).then(r => r.json()).then(d => {
      if (d.already_joined || d.already_owner) {
        clearPendingJoin();
        loadSpaces();
        return;
      }
      setJoinPrompt({ token: pendingJoin, name: d.name, owner: d.owner, type: d.type, icon: d.icon });
      clearPendingJoin();
    }).catch(() => clearPendingJoin());
  }, [pendingJoin]);

  async function confirmJoin() {
    if (!joinPrompt) return;
    setJoinLoading(true);
    try {
      await apiFetch(`/api/shared/join/${joinPrompt.token}`, { method: 'POST' });
      setJoinPrompt(null);
      loadSpaces();
    } finally {
      setJoinLoading(false);
    }
  }

  async function createSpace() {
    if (!createForm.name.trim()) return;
    setCreateSaving(true);
    try {
      const res = await apiFetch('/api/shared', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:       createForm.name.trim(),
          type:       createForm.type,
          icon:       createForm.icon,
          start_date: createForm.start_date || null,
          end_date:   createForm.end_date || null,
          budget:     createForm.budget ? parseFloat(createForm.budget) : null,
        }),
      });
      const d = await res.json();
      if (d.ok) {
        setCreateOpen(false);
        setCreateForm({ name: '', type: 'event', icon: '📦', start_date: '', end_date: '', budget: '' });
        loadSpaces();
      }
    } finally {
      setCreateSaving(false);
    }
  }

  async function shareSpace(spaceId) {
    const res = await apiFetch(`/api/shared/${spaceId}/share`, { method: 'POST' });
    const d   = await res.json();
    if (d.ok) setShareModal({ url: d.url, token: d.token });
  }

  async function deleteSpace(spaceId) {
    if (!confirm('Delete this shared space and all its expenses?')) return;
    await apiFetch(`/api/shared/${spaceId}`, { method: 'DELETE' });
    loadSpaces();
  }

  async function addExpense() {
    if (!detail) return;
    setExpSaving(true);
    try {
      const body = addMode === 'manual'
        ? { description: expForm.description, amount: parseFloat(expForm.amount), date: expForm.date, category: expForm.category }
        : {};
      const res = await apiFetch(`/api/shared/${detail.id}/expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setExpenseModal(false);
        setExpForm({ description: '', amount: '', date: new Date().toISOString().slice(0,10), category: 'other' });
        setTxnSearch('');
        loadDetail(detail);
      }
    } finally {
      setExpSaving(false);
    }
  }

  async function addTxnRef(txn) {
    if (!detail) return;
    await apiFetch(`/api/shared/${detail.id}/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txn_id: txn.id }),
    });
    loadDetail(detail);
  }

  async function addBulk() {
    if (!detail || bulkSelected.size === 0) return;
    setExpSaving(true);
    try {
      await apiFetch(`/api/shared/${detail.id}/expenses/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txn_ids: [...bulkSelected] }),
      });
      setExpenseModal(false);
      setBulkSelected(new Set());
      loadDetail(detail);
    } finally {
      setExpSaving(false);
    }
  }

  async function deleteExpense(expenseId) {
    if (!detail) return;
    await apiFetch(`/api/shared/${detail.id}/expenses/${expenseId}`, { method: 'DELETE' });
    loadDetail(detail);
  }

  // Inline note editing
  const [editingNote, setEditingNote] = useState(null); // { id, value }
  async function saveNote(expenseId, value) {
    if (!detail) return;
    await apiFetch(`/api/shared/${detail.id}/expenses/${expenseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: value }),
    });
    setEditingNote(null);
    loadDetail(detail);
  }

  // Txn search candidates for single ref-add
  const txnCandidates = useMemo(() => {
    if (!txnSearch.trim() || !detail) return [];
    const q = txnSearch.toLowerCase();
    const alreadyAdded = new Set((detail.expenses || []).filter(e => e.type === 'ref').map(e => e.txn_id));
    return TRANSACTIONS
      .filter(t => !alreadyAdded.has(t.id) && (t.merchant || t.description || '').toLowerCase().includes(q))
      .slice(0, 15);
  }, [txnSearch, detail]);

  // Bulk filter candidates
  const bulkCandidates = useMemo(() => {
    if (!detail) return [];
    const alreadyAdded = new Set((detail.expenses || []).filter(e => e.type === 'ref').map(e => e.txn_id));
    return TRANSACTIONS.filter(t => {
      if (alreadyAdded.has(t.id)) return false;
      if (bulkCat  && t.category !== bulkCat) return false;
      if (bulkFrom && t.date < bulkFrom) return false;
      if (bulkTo   && t.date > bulkTo)   return false;
      if (bulkTag  && !(t.tags || '').toLowerCase().includes(bulkTag.toLowerCase())) return false;
      return true;
    });
  }, [detail, bulkCat, bulkFrom, bulkTo, bulkTag]);

  const myTotal    = detail ? (detail.per_user || []).find(u => u.user === me?.username)?.total || 0 : 0;
  const otherTotal = detail ? (detail.total_spent || 0) - myTotal : 0;

  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo]     = useState('');
  const [filterUser, setFilterUser] = useState('');
  const [sortBy, setSortBy]         = useState('date');   // 'date' | 'amount' | 'merchant'
  const [sortDir, setSortDir]       = useState('desc');

  // Per-user totals computed from currently date-filtered expenses
  const filteredPerUser = useMemo(() => {
    if (!detail?.per_user) return [];
    const allExpenses = detail?.expenses || [];
    const hasDateFilter = filterFrom || filterTo;
    if (!hasDateFilter) return detail.per_user.map(u => ({ ...u, filteredTotal: u.total }));
    const totals = {};
    for (const e of allExpenses) {
      if (filterFrom && e.date < filterFrom) continue;
      if (filterTo && e.date > filterTo) continue;
      totals[e.user] = (totals[e.user] || 0) + e.amount;
    }
    return detail.per_user.map(u => ({ ...u, filteredTotal: totals[u.user] || 0 }));
  }, [detail?.per_user, detail?.expenses, filterFrom, filterTo]);

  // Assign consistent colors to participants
  const participantColors = useMemo(() => {
    const palette = ['#10b981', '#f97316', '#6366f1', '#0ea5e9', '#f43f5e', '#eab308', '#8b5cf6', '#14b8a6'];
    const participants = detail?.participants || [];
    const map = {};
    participants.forEach((u, i) => { map[u] = palette[i % palette.length]; });
    return map;
  }, [detail?.participants]);

  const monthBreakdown = useMemo(() => {
    if (!detail) return [];
    const map = {};
    for (const e of detail.expenses || []) {
      const m = (e.date || '').slice(0, 7);
      if (!m) continue;
      if (!map[m]) map[m] = { amount: 0, byUser: {} };
      map[m].amount += e.amount;
      map[m].byUser[e.user] = (map[m].byUser[e.user] || 0) + e.amount;
    }
    return Object.entries(map)
      .map(([month, data]) => ({
        month,
        amount: Math.round(data.amount * 100) / 100,
        byUser: Object.entries(data.byUser)
          .map(([user, amt]) => ({
            user,
            amount: Math.round(amt * 100) / 100,
            displayName: (detail.per_user || []).find(u => u.user === user)?.display_name || user,
            color: participantColors[user] || 'var(--ink-3)',
          }))
          .sort((a, b) => b.amount - a.amount),
      }))
      .sort((a, b) => b.month.localeCompare(a.month));
  }, [detail, participantColors]);

  const fmtMonth = m => {
    const [y, mo] = m.split('-');
    return `${'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[+mo - 1]} ${y}`;
  };

  // ── List view ──
  if (!detail) {
    const mySpaces     = spaces.filter(s => s.role === 'owner');
    const joinedSpaces = spaces.filter(s => s.role === 'participant');

    return (
      <div className="tab-body">
        {/* Join prompt modal */}
        {joinPrompt && (
          <Portal>
          <div style={{ position: 'fixed', inset: 0, zIndex: 800, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="card" style={{ width: 340, margin: 0 }}>
              <div style={{ fontSize: 32, textAlign: 'center', marginBottom: 8 }}>{joinPrompt.icon}</div>
              <h3 style={{ textAlign: 'center', marginBottom: 4 }}>{joinPrompt.name}</h3>
              <p style={{ textAlign: 'center', color: 'var(--ink-3)', fontSize: 13, marginBottom: 20 }}>
                {joinPrompt.owner} invited you to this {joinPrompt.type}
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setJoinPrompt(null)} style={{ flex: 1, padding: '10px 0', border: '1px solid var(--line)', borderRadius: 10, background: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'inherit' }}>Cancel</button>
                <button onClick={confirmJoin} disabled={joinLoading} style={{ flex: 1, padding: '10px 0', border: 'none', borderRadius: 10, background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                  {joinLoading ? 'Joining…' : 'Join'}
                </button>
              </div>
            </div>
          </div>
          </Portal>
        )}

        {/* Share modal */}
        {shareModal && (
          <Portal>
          <div style={{ position: 'fixed', inset: 0, zIndex: 800, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShareModal(null)}>
            <div className="card" style={{ width: 380, margin: 0 }} onClick={e => e.stopPropagation()}>
              <h3 style={{ marginBottom: 12 }}>Share invite link</h3>
              <p style={{ color: 'var(--ink-3)', fontSize: 13, marginBottom: 12 }}>Anyone with this link who is logged in can join the space.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input readOnly value={shareModal.url} style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink)', fontSize: 13, fontFamily: 'monospace', outline: 'none' }} />
                <button onClick={() => { navigator.clipboard.writeText(shareModal.url); setCopied(true); setTimeout(() => setCopied(false), 2000); }} style={{ padding: '8px 16px', border: 'none', borderRadius: 8, background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              <button onClick={() => setShareModal(null)} style={{ marginTop: 14, width: '100%', padding: '9px 0', border: '1px solid var(--line)', borderRadius: 8, background: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'inherit' }}>Done</button>
            </div>
          </div>
          </Portal>
        )}

        {/* Create modal */}
        {createOpen && (
          <Portal>
          <div style={{ position: 'fixed', inset: 0, zIndex: 800, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setCreateOpen(false)}>
            <div className="card" style={{ width: 380, margin: 0 }} onClick={e => e.stopPropagation()}>
              <h3 style={{ marginBottom: 16 }}>New shared space</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>Name</label>
                  <input value={createForm.name} onChange={e => setCreateForm(f => ({...f, name: e.target.value}))}
                    placeholder="e.g. Groceries, Tokyo Trip…" style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>Type</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[['event','🎉 Event'], ['recurring','🔁 Recurring'], ['trip','✈️ Trip']].map(([val, lbl]) => (
                      <button key={val} onClick={() => setCreateForm(f => ({...f, type: val}))} style={{
                        flex: 1, padding: '8px 0', border: `1px solid ${createForm.type === val ? 'var(--accent)' : 'var(--line)'}`,
                        borderRadius: 8, background: createForm.type === val ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'none',
                        color: createForm.type === val ? 'var(--accent)' : 'var(--ink-3)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
                      }}>{lbl}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>Icon</label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {SPACE_ICONS.map(icon => (
                      <button key={icon} onClick={() => setCreateForm(f => ({...f, icon}))} style={{
                        width: 36, height: 36, fontSize: 20, border: `2px solid ${createForm.icon === icon ? 'var(--accent)' : 'var(--line)'}`,
                        borderRadius: 8, background: 'none', cursor: 'pointer',
                      }}>{icon}</button>
                    ))}
                  </div>
                </div>
                {(createForm.type === 'trip') && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>Start date</label>
                      <input type="date" value={createForm.start_date} onChange={e => setCreateForm(f => ({...f, start_date: e.target.value}))}
                        style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>End date</label>
                      <input type="date" value={createForm.end_date} onChange={e => setCreateForm(f => ({...f, end_date: e.target.value}))}
                        style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                  </div>
                )}
                <div>
                  <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>Budget (optional)</label>
                  <input type="number" value={createForm.budget} onChange={e => setCreateForm(f => ({...f, budget: e.target.value}))}
                    placeholder="0.00" style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button onClick={() => setCreateOpen(false)} style={{ flex: 1, padding: '10px 0', border: '1px solid var(--line)', borderRadius: 10, background: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'inherit' }}>Cancel</button>
                <button onClick={createSpace} disabled={createSaving || !createForm.name.trim()} style={{ flex: 1, padding: '10px 0', border: 'none', borderRadius: 10, background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                  {createSaving ? 'Creating…' : 'Create'}
                </button>
              </div>
            </div>
          </div>
          </Portal>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)' }}>Shared</h2>
          <button onClick={() => setCreateOpen(true)} style={{ padding: '8px 16px', border: 'none', borderRadius: 10, background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 14 }}>+ New space</button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 40 }}>Loading…</div>
        ) : spaces.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 48 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🤝</div>
            <h3 style={{ marginBottom: 8 }}>No shared spaces yet</h3>
            <p style={{ color: 'var(--ink-3)', fontSize: 14, marginBottom: 20 }}>Create a space to track shared expenses — groceries, trips, eating out, anything.</p>
            <button onClick={() => setCreateOpen(true)} style={{ padding: '9px 20px', border: 'none', borderRadius: 10, background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>Create your first space</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {mySpaces.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>My Spaces</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {mySpaces.map(space => (
                    <SpaceCard key={space.id} space={space} isOwner
                      onOpen={() => { loadDetail(space); }}
                      onShare={() => shareSpace(space.id)}
                      onDelete={() => deleteSpace(space.id)} />
                  ))}
                </div>
              </div>
            )}
            {joinedSpaces.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Joined</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {joinedSpaces.map(space => (
                    <SpaceCard key={space.id} space={space} isOwner={false}
                      onOpen={() => { loadDetail(space); }} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Detail view ──
  const isOwner     = detail.role === 'owner';
  const budget      = detail.budget;
  const budgetPct   = budget ? Math.min((detail.total_spent / budget) * 100, 100) : null;
  const overBudget  = budget && detail.total_spent > budget;
  const expenses    = detail.expenses || [];

  return (
    <div className="tab-body">
      {/* Add expense modal */}
      {expenseModal && (
        <Portal>
        <div style={{ position: 'fixed', inset: 0, zIndex: 800, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setExpenseModal(false)}>
          <div className="card" style={{ width: 400, margin: 0, maxHeight: '80vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 14 }}>Add expense</h3>
            {/* Mode toggle */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
              {[['bulk','⚡ Bulk add'], ['txn','🔍 Search'], ['manual','✏️ Manual']].map(([m, lbl]) => (
                <button key={m} onClick={() => setAddMode(m)} style={{
                  flex: 1, padding: '7px 0', border: `1px solid ${addMode === m ? 'var(--accent)' : 'var(--line)'}`,
                  borderRadius: 8, background: addMode === m ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'none',
                  color: addMode === m ? 'var(--accent)' : 'var(--ink-3)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
                }}>{lbl}</button>
              ))}
            </div>

            {addMode === 'bulk' ? (
              <div>
                {/* Filters */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, color: 'var(--ink-3)', display: 'block', marginBottom: 3 }}>Category</label>
                      <select value={bulkCat} onChange={e => { setBulkCat(e.target.value); setBulkSelected(new Set()); }}
                        style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 7, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13, outline: 'none' }}>
                        <option value="">All categories</option>
                        {[..._liveCategories].sort((a,b) => a.name.localeCompare(b.name)).map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, color: 'var(--ink-3)', display: 'block', marginBottom: 3 }}>Tag contains</label>
                      <input value={bulkTag} onChange={e => { setBulkTag(e.target.value); setBulkSelected(new Set()); }}
                        placeholder="e.g. trip:abc"
                        style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 7, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, color: 'var(--ink-3)', display: 'block', marginBottom: 3 }}>From date</label>
                      <input type="date" value={bulkFrom} onChange={e => { setBulkFrom(e.target.value); setBulkSelected(new Set()); }}
                        style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 7, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, color: 'var(--ink-3)', display: 'block', marginBottom: 3 }}>To date</label>
                      <input type="date" value={bulkTo} onChange={e => { setBulkTo(e.target.value); setBulkSelected(new Set()); }}
                        style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 7, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                  </div>
                </div>

                {/* Select all / count */}
                {bulkCandidates.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--line)' }}>
                    <input type="checkbox"
                      checked={bulkSelected.size === bulkCandidates.length}
                      onChange={e => setBulkSelected(e.target.checked ? new Set(bulkCandidates.map(t => t.id)) : new Set())}
                      style={{ cursor: 'pointer' }} />
                    <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                      {bulkSelected.size > 0 ? `${bulkSelected.size} selected` : `${bulkCandidates.length} matching`}
                    </span>
                    {bulkSelected.size > 0 && (
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginLeft: 'auto' }}>
                        ${bulkCandidates.filter(t => bulkSelected.has(t.id)).reduce((s,t) => s + Math.abs(t.amount), 0).toFixed(2)} total
                      </span>
                    )}
                  </div>
                )}

                {/* Transaction list with checkboxes */}
                <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {bulkCandidates.length === 0 ? (
                    <div style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
                      {bulkCat || bulkFrom || bulkTo || bulkTag ? 'No transactions match these filters' : 'All transactions already added, or no data'}
                    </div>
                  ) : bulkCandidates.map(t => {
                    const catI = catById(t.category);
                    const sel  = bulkSelected.has(t.id);
                    return (
                      <div key={t.id}
                        onClick={() => setBulkSelected(prev => { const n = new Set(prev); sel ? n.delete(t.id) : n.add(t.id); return n; })}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 7,
                          background: sel ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'var(--surface-2)',
                          border: `1px solid ${sel ? 'var(--accent)' : 'var(--line)'}`, cursor: 'pointer' }}>
                        <input type="checkbox" checked={sel} onChange={() => {}} style={{ pointerEvents: 'none', flexShrink: 0 }} />
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: catI.color, flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.merchant || t.description}</span>
                        <span style={{ fontSize: 11, color: 'var(--ink-3)', flexShrink: 0 }}>{t.date?.slice(0,10)}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', flexShrink: 0 }}>${Math.abs(t.amount).toFixed(2)}</span>
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button onClick={() => setExpenseModal(false)} style={{ flex: 1, padding: '9px 0', border: '1px solid var(--line)', borderRadius: 8, background: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'inherit' }}>Cancel</button>
                  <button onClick={addBulk} disabled={expSaving || bulkSelected.size === 0}
                    style={{ flex: 2, padding: '9px 0', border: 'none', borderRadius: 8, background: 'var(--accent)', color: '#fff', cursor: bulkSelected.size === 0 ? 'not-allowed' : 'pointer', opacity: bulkSelected.size === 0 ? 0.5 : 1, fontFamily: 'inherit', fontWeight: 600 }}>
                    {expSaving ? 'Adding…' : bulkSelected.size > 0 ? `Add ${bulkSelected.size} transaction${bulkSelected.size > 1 ? 's' : ''}` : 'Select transactions'}
                  </button>
                </div>
              </div>
            ) : addMode === 'manual' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>Description</label>
                  <input value={expForm.description} onChange={e => setExpForm(f => ({...f, description: e.target.value}))}
                    placeholder="e.g. Trader Joe's haul"
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>Amount ($)</label>
                    <input type="number" value={expForm.amount} onChange={e => setExpForm(f => ({...f, amount: e.target.value}))}
                      placeholder="0.00"
                      style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>Date</label>
                    <input type="date" value={expForm.date} onChange={e => setExpForm(f => ({...f, date: e.target.value}))}
                      style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>Category</label>
                  <select value={expForm.category} onChange={e => setExpForm(f => ({...f, category: e.target.value}))}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}>
                    {SHARED_CATS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                  <button onClick={() => setExpenseModal(false)} style={{ flex: 1, padding: '10px 0', border: '1px solid var(--line)', borderRadius: 10, background: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'inherit' }}>Cancel</button>
                  <button onClick={addExpense} disabled={expSaving || !expForm.description || !expForm.amount}
                    style={{ flex: 1, padding: '10px 0', border: 'none', borderRadius: 10, background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                    {expSaving ? 'Adding…' : 'Add'}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <input value={txnSearch} onChange={e => setTxnSearch(e.target.value)}
                  placeholder="Search your transactions…"
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: 10 }} />
                <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {txnCandidates.length === 0 && txnSearch.trim() && (
                    <div style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 20 }}>No transactions found</div>
                  )}
                  {txnCandidates.map(t => {
                    const catI = catById(t.category);
                    return (
                      <div key={t.id} onClick={() => { addTxnRef(t); setExpenseModal(false); setTxnSearch(''); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8,
                          border: '1px solid var(--line)', cursor: 'pointer', background: 'var(--surface-2)' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-3)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'var(--surface-2)'}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: catI.color, flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.merchant || t.description}</span>
                        <span style={{ fontSize: 12, color: 'var(--ink-3)', flexShrink: 0 }}>{t.date?.slice(0,10)}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', flexShrink: 0 }}>${Math.abs(t.amount).toFixed(2)}</span>
                      </div>
                    );
                  })}
                </div>
                <button onClick={() => setExpenseModal(false)} style={{ marginTop: 14, width: '100%', padding: '9px 0', border: '1px solid var(--line)', borderRadius: 8, background: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'inherit' }}>Cancel</button>
              </div>
            )}
          </div>
        </div>
        </Portal>
      )}

      {activeMerchantShared && (
        <SharedMerchantDrawer merchant={activeMerchantShared} expenses={expenses} participantColors={participantColors} onClose={() => setActiveMerchantShared(null)} />
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
        <button onClick={() => setDetail(null)} style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'inherit', fontSize: 13 }}>← Back</button>
        <span style={{ fontSize: 28 }}>{detail.icon}</span>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', marginBottom: 2 }}>{detail.name}</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--ink-3)', background: 'var(--surface-2)', borderRadius: 6, padding: '1px 8px' }}>{detail.type}</span>
            {detail.start_date && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{detail.start_date} → {detail.end_date || '…'}</span>}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {isOwner && <button onClick={() => shareSpace(detail.id)} style={{ padding: '7px 14px', border: '1px solid var(--line)', borderRadius: 8, background: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'inherit', fontSize: 13 }}>🔗 Share</button>}
          <button onClick={() => setExpenseModal(true)} style={{ padding: '7px 14px', border: 'none', borderRadius: 8, background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 13 }}>+ Expense</button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <SummaryCard label="Total spent" n={detail.total_spent || 0}
          sub={`${expenses.length} expense${expenses.length !== 1 ? 's' : ''}`} />
        <SummaryCard label="Your share" n={myTotal} accent="var(--accent)"
          sub={detail.total_spent > 0 ? `${((myTotal / detail.total_spent) * 100).toFixed(0)}% of total` : null} />
        <SummaryCard label="Others" n={otherTotal}
          sub={detail.per_user?.length > 1 ? `${detail.per_user.length - 1} other${detail.per_user.length > 2 ? 's' : ''}` : null} />
        {budget ? (
          <SummaryCard label="Budget" n={budget} accent={overBudget ? 'var(--terra)' : 'var(--ink)'}
            sub={overBudget ? `${fmtMoney(detail.total_spent - budget)} over` : `${fmtMoney(budget - detail.total_spent)} left`} />
        ) : (
          <SummaryCard label="Months active" value={String(monthBreakdown.length || '—')} accent="var(--ink)"
            sub={monthBreakdown.length > 0 ? `since ${fmtMonth(monthBreakdown[monthBreakdown.length - 1]?.month || '')}` : null} />
        )}
      </div>

      {/* Per-user + breakdown side-by-side */}
      {(detail.per_user?.length > 0 || expenses.length > 0) && (
        <div className="grid-2" style={{ marginBottom: 16 }}>
          {filteredPerUser.length > 0 && (
            <div className="card">
              <div className="card-head">
                <h3>By person</h3>
                {filterUser && <button onClick={() => setFilterUser('')} style={{ fontSize: 11, padding: '2px 8px', border: '1px solid var(--line)', borderRadius: 6, background: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'inherit' }}>Clear</button>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {filteredPerUser.map((u) => {
                  const filteredTotal = u.filteredTotal || 0;
                  const periodTotal = filteredPerUser.reduce((s, x) => s + (x.filteredTotal || 0), 0);
                  const pct = periodTotal > 0 ? (filteredTotal / periodTotal) * 100 : 0;
                  const isMe = u.user === me?.username;
                  const uColor = participantColors[u.user];
                  const isSelected = filterUser === u.user;
                  return (
                    <div key={u.user}
                      onClick={() => setFilterUser(isSelected ? '' : u.user)}
                      className={`month-row${isSelected ? ' active' : ''}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 6px', margin: '0 -6px', borderBottom: '1px solid var(--line)', cursor: 'pointer' }}>
                      <span className="cat-dot" style={{ background: uColor, flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 14, color: isSelected ? uColor : 'var(--ink)', fontWeight: isSelected ? 600 : 400 }}>{u.display_name || u.user}{isMe ? ' (you)' : ''}</span>
                      <div style={{ width: 120, height: 6, background: 'var(--line)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, borderRadius: 3, background: uColor }} />
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', minWidth: 70, textAlign: 'right' }}>{fmtMoney(filteredTotal)}</span>
                      <span style={{ fontSize: 12, color: 'var(--ink-3)', minWidth: 36, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="card">
            <div className="card-head">
              <h3>{breakdownView === 'month' ? 'By month' : 'By category'}</h3>
              <div style={{ display: 'flex', gap: 4 }}>
                {[['category', 'Category'], ['month', 'Month']].map(([v, lbl]) => (
                  <button key={v} onClick={() => setAndSaveBreakdownView(v)} style={{
                    padding: '3px 10px', border: '1px solid var(--line)', borderRadius: 6,
                    background: breakdownView === v ? 'var(--accent)' : 'none',
                    color: breakdownView === v ? '#fff' : 'var(--ink-3)',
                    cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
                  }}>{lbl}</button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {breakdownView === 'month' ? (
                monthBreakdown.length === 0
                  ? <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>No expenses yet</div>
                  : monthBreakdown.slice(0, 8).map(mb => {
                      const maxAmt = monthBreakdown[0]?.amount || 1;
                      const pct = (mb.amount / maxAmt) * 100;
                      const isActive = filterFrom === `${mb.month}-01`;
                      return (
                        <div key={mb.month}
                          onClick={() => {
                            if (isActive) { setFilterFrom(''); setFilterTo(''); }
                            else {
                              const [y, mo] = mb.month.split('-');
                              const last = new Date(+y, +mo, 0).getDate();
                              setFilterFrom(`${mb.month}-01`);
                              setFilterTo(`${mb.month}-${String(last).padStart(2,'0')}`);
                            }
                          }}
                          className={`month-row${isActive ? ' active' : ''}`}
                          style={{}}>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ flex: 1, fontSize: 14, color: isActive ? 'var(--accent)' : 'var(--ink)', fontWeight: isActive ? 600 : 400 }}>{fmtMonth(mb.month)}</span>
                            {/* Segmented bar */}
                            <div style={{ width: 120, height: 6, background: 'var(--line)', borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
                              {mb.byUser.map((u, i) => (
                                <div key={u.user} title={`${u.displayName}: ${fmtMoney(u.amount)}`}
                                  style={{ height: '100%', width: `${(u.amount / mb.amount) * pct}%`, background: u.color,
                                    borderRadius: i === 0 ? '3px 0 0 3px' : (i === mb.byUser.length-1 ? '0 3px 3px 0' : 0) }} />
                              ))}
                            </div>
                            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', minWidth: 70, textAlign: 'right' }}>{fmtMoney(mb.amount)}</span>
                            <span style={{ fontSize: 12, color: 'var(--ink-3)', minWidth: 36, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
                          </div>
                          {/* Per-user micro labels */}
                          {mb.byUser.length > 1 && (
                            <div style={{ display: 'flex', gap: 10, marginTop: 2 }}>
                              {mb.byUser.map(u => (
                                <span key={u.user} style={{ fontSize: 11, color: u.color }}>
                                  {u.displayName.split(' ')[0]} {fmtMoney(u.amount)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })
              ) : (
                detail.category_breakdown?.length === 0
                  ? <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>No expenses yet</div>
                  : (detail.category_breakdown || []).slice(0, 6).map(cb => {
                      const catI = sharedCatById(cb.category);
                      const pct  = detail.total_spent > 0 ? (cb.amount / detail.total_spent) * 100 : 0;
                      return (
                        <div key={cb.category} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                          <span className="cat-dot" style={{ background: catI.color, flexShrink: 0 }} />
                          <span style={{ flex: 1, fontSize: 14, color: 'var(--ink)' }}>{catI.name}</span>
                          <div style={{ width: 120, height: 6, background: 'var(--line)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${pct}%`, borderRadius: 3, background: catI.color }} />
                          </div>
                          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', minWidth: 70, textAlign: 'right' }}>{fmtMoney(cb.amount)}</span>
                          <span style={{ fontSize: 12, color: 'var(--ink-3)', minWidth: 36, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
                        </div>
                      );
                    })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Expense list */}
      <div className="card">
        <div className="card-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>Expenses</h3>
            {/* Active filter chips */}
            {filterFrom && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '2px 8px 2px 10px', borderRadius: 20, background: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)' }}>
                📅 {filterFrom === filterTo ? filterFrom : `${filterFrom} – ${filterTo}`}
                <button onClick={() => { setFilterFrom(''); setFilterTo(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 13, lineHeight: 1, padding: 0, marginLeft: 2, opacity: 0.7 }}>×</button>
              </span>
            )}
            {filterUser && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '2px 8px 2px 10px', borderRadius: 20, background: `color-mix(in srgb, ${participantColors[filterUser] || 'var(--ink-3)'} 12%, transparent)`, color: participantColors[filterUser] || 'var(--ink-3)', border: `1px solid color-mix(in srgb, ${participantColors[filterUser] || 'var(--ink-3)'} 25%, transparent)` }}>
                👤 {(detail.per_user?.find(u => u.user === filterUser)?.display_name) || filterUser}
                <button onClick={() => setFilterUser('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: participantColors[filterUser] || 'var(--ink-3)', fontSize: 13, lineHeight: 1, padding: 0, marginLeft: 2, opacity: 0.7 }}>×</button>
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <input type="date" value={filterFrom} onChange={ev => setFilterFrom(ev.target.value)}
              style={{ padding: '4px 8px', border: '1px solid var(--line)', borderRadius: 7, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 12, outline: 'none' }} />
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>–</span>
            <input type="date" value={filterTo} onChange={ev => setFilterTo(ev.target.value)}
              style={{ padding: '4px 8px', border: '1px solid var(--line)', borderRadius: 7, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 12, outline: 'none' }} />
            <button onClick={() => setExpenseModal(true)} style={{ padding: '5px 12px', border: 'none', borderRadius: 8, background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 13 }}>+ Add</button>
          </div>
        </div>
        {/* Sort controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 10, borderBottom: '1px solid var(--line)', marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--ink-3)', marginRight: 2 }}>Sort:</span>
          {[['date','Date'], ['amount','Amount'], ['merchant','Merchant']].map(([val, lbl]) => (
            <button key={val} onClick={() => {
              if (sortBy === val) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
              else { setSortBy(val); setSortDir(val === 'merchant' ? 'asc' : 'desc'); }
            }} style={{
              padding: '3px 10px', border: '1px solid var(--line)', borderRadius: 6,
              background: sortBy === val ? 'var(--accent)' : 'none',
              color: sortBy === val ? '#fff' : 'var(--ink-3)',
              cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
            }}>
              {lbl}{sortBy === val ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
            </button>
          ))}
          {(filterFrom || filterTo || filterUser) && (
            <button onClick={() => { setFilterFrom(''); setFilterTo(''); setFilterUser(''); }}
              style={{ marginLeft: 'auto', padding: '3px 10px', border: '1px solid var(--line)', borderRadius: 6, background: 'none', color: 'var(--ink-3)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11 }}>
              Clear all filters
            </button>
          )}
        </div>
        {(() => {
          const filtered = expenses
            .filter(e => {
              if (filterFrom && e.date < filterFrom) return false;
              if (filterTo   && e.date > filterTo)   return false;
              if (filterUser && e.user !== filterUser) return false;
              return true;
            })
            .sort((a, b) => {
              let cmp = 0;
              if (sortBy === 'amount')   cmp = a.amount - b.amount;
              else if (sortBy === 'merchant') cmp = (a.description || '').localeCompare(b.description || '');
              else cmp = (a.date || '').localeCompare(b.date || '');
              return sortDir === 'asc' ? cmp : -cmp;
            });
          return filtered.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '32px 0', fontSize: 14 }}>
            {expenses.length === 0
              ? 'No expenses yet — add one to get started.'
              : filterUser && (filterFrom || filterTo)
                ? `No expenses from ${detail.per_user?.find(u => u.user === filterUser)?.display_name || filterUser} in this date range.`
                : filterUser
                  ? `No expenses from ${detail.per_user?.find(u => u.user === filterUser)?.display_name || filterUser} yet.`
                  : 'No expenses match this date range.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {filtered.map(e => {
              const catI = sharedCatById(e.category);
              const isMe = e.user === me?.username;
              const isEditingThis = editingNote?.id === e.id;
              return (
                <div key={e.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span className="cat-dot" style={{ background: catI.color, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div onClick={() => setActiveMerchantShared(e.description)} style={{ fontSize: 14, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: 2, textDecorationColor: 'var(--line-2)' }}>{e.description}</div>
                      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        <span style={{ flexShrink: 0 }}>{catI.name} · {e.date}</span>
                        {e.notes && !isEditingThis && (
                          <span onClick={ev => { ev.stopPropagation(); setEditingNote({ id: e.id, value: e.notes }); }}
                            style={{ color: 'var(--accent)', fontStyle: 'italic', cursor: 'text', overflow: 'hidden', textOverflow: 'ellipsis', marginLeft: 4 }}>
                            · {e.notes}
                          </span>
                        )}
                      </div>
                    </div>
                    <button onClick={() => setEditingNote(isEditingThis ? null : { id: e.id, value: e.notes || '' })}
                      title={e.notes ? 'Edit note' : 'Add note'}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: e.notes ? 'var(--accent)' : 'var(--ink-4)', fontSize: 14, lineHeight: 1, flexShrink: 0 }}>
                      💬
                    </button>
                    <div title={e.display_name || e.user} style={{ width: 26, height: 26, borderRadius: '50%', background: participantColors[e.user] || 'var(--ink-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                      {(e.display_name || e.user).slice(0,2).toUpperCase()}
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', minWidth: 72, textAlign: 'right' }}>{fmtMoney(e.amount)}</span>
                    {(isMe || isOwner) && (
                      <button onClick={() => deleteExpense(e.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', fontSize: 16, padding: '0 4px', lineHeight: 1 }} title="Delete">×</button>
                    )}
                  </div>
                  {isEditingThis && (
                    <div style={{ marginLeft: 20, marginTop: 6, display: 'flex', gap: 6 }}>
                      <input
                        autoFocus
                        value={editingNote.value}
                        onChange={ev => setEditingNote(n => ({ ...n, value: ev.target.value }))}
                        onKeyDown={ev => { if (ev.key === 'Enter') saveNote(e.id, editingNote.value); if (ev.key === 'Escape') setEditingNote(null); }}
                        placeholder="Add a note…"
                        maxLength={500}
                        style={{ flex: 1, padding: '5px 10px', border: '1px solid var(--accent)', borderRadius: 7, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13, outline: 'none' }}
                      />
                      <button onClick={() => saveNote(e.id, editingNote.value)}
                        style={{ padding: '5px 12px', border: 'none', borderRadius: 7, background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600 }}>Save</button>
                      <button onClick={() => setEditingNote(null)}
                        style={{ padding: '5px 10px', border: '1px solid var(--line)', borderRadius: 7, background: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'inherit', fontSize: 12 }}>Cancel</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
        })()}
      </div>

      {/* Share modal in detail view */}
      {shareModal && (
        <Portal>
        <div style={{ position: 'fixed', inset: 0, zIndex: 800, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShareModal(null)}>
          <div className="card" style={{ width: 380, margin: 0 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 12 }}>Share invite link</h3>
            <p style={{ color: 'var(--ink-3)', fontSize: 13, marginBottom: 12 }}>Anyone with this link who is logged in can join.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input readOnly value={shareModal.url} style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink)', fontSize: 13, fontFamily: 'monospace', outline: 'none' }} />
              <button onClick={() => { navigator.clipboard.writeText(shareModal.url); setCopied(true); setTimeout(() => setCopied(false), 2000); }} style={{ padding: '8px 16px', border: 'none', borderRadius: 8, background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, whiteSpace: 'nowrap' }}>
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <button onClick={() => setShareModal(null)} style={{ marginTop: 14, width: '100%', padding: '9px 0', border: '1px solid var(--line)', borderRadius: 8, background: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'inherit' }}>Done</button>
          </div>
        </div>
        </Portal>
      )}
    </div>
  );
}

function SpaceCard({ space, isOwner, onOpen, onShare, onDelete }) {
  return (
    <div className="card" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={onOpen}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 26, flexShrink: 0 }}>{space.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{space.name}</span>
            <span style={{ fontSize: 11, color: 'var(--ink-3)', background: 'var(--surface-2)', borderRadius: 4, padding: '1px 6px' }}>{space.type}</span>
            {!isOwner && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>by {space.owner_display_name || space.participants?.[0]}</span>}
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>
              {space.participants?.length > 1 ? `${space.participants.length} people` : 'just you'}
            </span>
            {space.last_activity && <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>{space.last_activity}</span>}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>${(space.total_spent || 0).toFixed(2)}</div>
        </div>
        {isOwner && (
          <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
            <button onClick={onShare} style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 13, color: 'var(--ink-3)' }} title="Share">🔗</button>
            <button onClick={onDelete} style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 13, color: 'var(--ink-3)' }} title="Delete">🗑</button>
          </div>
        )}
      </div>
    </div>
  );
}

