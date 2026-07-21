// Tab component — see frontend/AGENTS.md for context
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { TRANSACTIONS, CATEGORIES, ACCOUNTS, MONTHS, RECURRING, NET_WORTH_HISTORY } from '@/lib/fin';
import { fmtMoney, fmtMoney2, fmtAbbr, fmt, catById, acctById, txnsForMonth, sumByCategory, monthSummary } from '@/lib/helpers';
import { apiFetch } from '@/lib/api';
import { SummaryCard } from '@/components';
import { DonutChart, StackedBarChart } from '@/components/charts';
import { SHARED_CATS, SPACE_ICONS } from './Trips';
import { BarCol } from '@/components/modals';

const SHARED_ICONS = {
  groceries: '🛒', 'eating-out': '🍽️', transport: '🚗',
  accommodation: '🏨', entertainment: '🎬', shopping: '🛍️',
  utilities: '💡', household: '🏠', activities: '🎯', other: '📦',
};

function sharedCatById(id) {
  return SHARED_CATS.find(c => c.id === id) || { id, name: id, color: '#94a3b8' };
}

// Renders children into document.body so position:fixed modals are always
// relative to the viewport, regardless of ancestor CSS transforms.
function Portal({ children }) {
  return createPortal(children, document.body);
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
            const uColor = participantColors[e.user] || catI.color;
            return (
              <div key={e.id} className="txn-row" style={{ gridTemplateColumns: '38px 1fr 56px 80px', padding: '10px 16px' }}>
                <div className="txn-icon" style={{ background: `${uColor}22`, color: uColor, fontSize: 16 }}>
                  {SHARED_ICONS[e.category] || '📦'}
                </div>
                <div className="txn-main">
                  <div className="txn-merchant">{e.description}</div>
                  <div className="txn-meta">
                    <span className="cat-pill" style={{ color: catI.color }}>{catI.name}</span>
                    {e.notes && <><span className="dot-sep">·</span><span style={{ fontStyle: 'italic', color: 'var(--accent)' }}>{e.notes}</span></>}
                  </div>
                </div>
                <div className="txn-date">{e.date?.slice(5).replace('-', '/')}</div>
                <div className="txn-amt neg">{fmtMoney(e.amount)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function SharedVibeBanner({ detail, myUsername, myTotal, expenses }) {
  if (!detail) return null;
  const exps  = expenses || detail.expenses || [];
  const total = detail.total_spent || 0;
  const budget = detail.budget;
  const others = (detail.per_user || []).filter(u => u.user !== myUsername);
  const myPct  = total > 0 ? (myTotal / total) * 100 : 0;

  // Compute interesting stats from expenses
  const merchantCounts = {};
  exps.forEach(e => { merchantCounts[e.description] = (merchantCounts[e.description] || 0) + 1; });
  const topMerchant = Object.entries(merchantCounts).sort(([,a],[,b]) => b-a)[0];
  const biggestExp  = exps.length > 0 ? [...exps].sort((a,b) => b.amount - a.amount)[0] : null;
  const avgPerExp   = exps.length > 0 ? total / exps.length : 0;
  const firstDate   = exps.length > 0 ? exps.map(e=>e.date).sort()[0] : null;

  let emoji = '', text = '', color = 'var(--ink-3)';

  if (budget && total > budget) {
    emoji = '⚠️'; color = 'var(--terra)';
    text  = `Over budget by ${fmtMoney(total - budget)}.`;
  } else if (budget) {
    const rem = budget - total;
    emoji = '✓'; color = 'var(--green)';
    text  = `${fmtMoney(rem)} left in budget — ${((rem / budget) * 100).toFixed(0)}% remaining.`;
  } else if (exps.length === 0) {
    emoji = '👋'; color = 'var(--ink-3)';
    text  = `Add your first expense to start tracking together.`;
  } else if (topMerchant && topMerchant[1] >= 3) {
    emoji = '📍'; color = 'var(--accent)';
    text  = `You keep coming back to ${topMerchant[0]} — ${topMerchant[1]} times in this space.`;
  } else if (biggestExp && total > 0) {
    emoji = '💸'; color = 'var(--ink-3)';
    text  = `Biggest expense: ${biggestExp.description} · ${fmtMoney(biggestExp.amount)} (${((biggestExp.amount / total) * 100).toFixed(0)}% of total).`;
  } else if (exps.length >= 3) {
    emoji = '📊'; color = 'var(--ink-3)';
    text  = `${exps.length} expenses · ${fmtMoney(avgPerExp)} avg each${firstDate ? ` · since ${firstDate.slice(0,7)}` : ''}.`;
  } else if (myPct > 70 && others.length > 0) {
    emoji = '💪'; color = 'var(--accent)';
    text  = `You're contributing the most to ${detail.name} so far.`;
  } else if (exps.length > 0) {
    emoji = '🤝'; color = 'var(--ink-3)';
    text  = `${fmtMoney(total)} tracked together — ${exps.length} expense${exps.length !== 1 ? 's' : ''} so far.`;
  } else {
    return null;
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 16px', borderRadius: 12, marginBottom: 16,
      background: 'color-mix(in srgb, var(--surface) 80%, transparent)',
      border: '1px solid var(--line)', fontSize: 13, color: 'var(--ink)',
    }}>
      <span style={{ fontSize: 18 }}>{emoji}</span>
      <span style={{ color }}>{text}</span>
    </div>
  );
}

function SpaceCard({ space, isOwner, onOpen, onShare, onDelete }) {
  const palette = ['#10b981', '#f97316', '#6366f1', '#0ea5e9', '#f43f5e', '#eab308', '#8b5cf6', '#14b8a6'];
  const participants = space.participants || [];
  const budget = space.budget;
  const budgetPct = budget && space.total_spent ? Math.min((space.total_spent / budget) * 100, 100) : null;
  const overBudget = budget && space.total_spent > budget;

  return (
    <div className="card" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={onOpen}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 26, flexShrink: 0 }}>{space.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{space.name}</span>
            <span style={{ fontSize: 11, color: 'var(--ink-3)', background: 'var(--surface-2)', borderRadius: 4, padding: '1px 6px' }}>{space.type}</span>
            {!isOwner && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>by {space.owner_display_name || participants[0]}</span>}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {/* Stacked participant avatars */}
            {participants.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center' }}>
                {participants.slice(0, 4).map((p, i) => (
                  <div key={p} title={p} style={{
                    width: 20, height: 20, borderRadius: '50%',
                    background: palette[i % palette.length],
                    border: '2px solid var(--surface)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 8, fontWeight: 700, color: '#fff',
                    marginLeft: i > 0 ? -6 : 0, position: 'relative', zIndex: participants.length - i,
                  }}>
                    {p.slice(0,2).toUpperCase()}
                  </div>
                ))}
                <span style={{ fontSize: 12, color: 'var(--ink-3)', marginLeft: participants.length > 1 ? 8 : 4 }}>
                  {participants.length > 1 ? `${participants.length} people` : 'just you'}
                </span>
              </div>
            )}
            {space.last_activity && <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>{space.last_activity}</span>}
          </div>
          {/* Budget progress */}
          {budgetPct !== null && (
            <div style={{ marginTop: 7 }}>
              <div style={{ height: 3, background: 'var(--line)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${budgetPct}%`, background: overBudget ? 'var(--terra)' : 'var(--accent)', borderRadius: 2 }} />
              </div>
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--font-mono)', fontFeatureSettings: '"tnum"' }}>${(space.total_spent || 0).toFixed(2)}</div>
          {budget && <div style={{ fontSize: 11, color: overBudget ? 'var(--terra)' : 'var(--ink-3)' }}>of ${budget.toFixed(0)}</div>}
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

function SharedTab({ pendingJoin, clearPendingJoin, setTab }) {
  const [spaces, setSpaces]           = useState([]);
  const [loading, setLoading]         = useState(true);
  const [detail, setDetail]           = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Sub-tab navigation within a space
  const [detailTab, setDetailTab]     = useState('overview');
  const [expSearch, setExpSearch]     = useState('');
  const [menuExpId, setMenuExpId]     = useState(null);
  const [editExpModal, setEditExpModal] = useState(null); // { id, description, amount, date, category }
  const [editExpSaving, setEditExpSaving] = useState(false);

  // Modals
  const [createOpen, setCreateOpen]   = useState(false);
  const [shareModal, setShareModal]   = useState(null);
  const [joinPrompt, setJoinPrompt]   = useState(null);
  const [expenseModal, setExpenseModal] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [copied, setCopied]           = useState(false);
  const [appUsers, setAppUsers]       = useState<{username: string; display_name: string}[]>([]);
  const [inviteSearch, setInviteSearch] = useState('');
  const [inviteLoading, setInviteLoading] = useState<string | null>(null);
  const [invitedSet, setInvitedSet]   = useState<Set<string>>(new Set());

  // Create form
  const [createForm, setCreateForm]   = useState({ name: '', type: 'event', icon: '📦', start_date: '', end_date: '', budget: '' });
  const [createSaving, setCreateSaving] = useState(false);

  // Add expense form
  const [expForm, setExpForm]         = useState({ description: '', amount: '', date: new Date().toISOString().slice(0,10), category: 'other' });
  const [expSaving, setExpSaving]     = useState(false);
  const [txnSearch, setTxnSearch]     = useState('');
  const [addMode, setAddMode]         = useState('bulk');
  const [bulkCat, setBulkCat]         = useState('');
  const [bulkFrom, setBulkFrom]       = useState('');
  const [bulkTo, setBulkTo]           = useState('');
  const [bulkTag, setBulkTag]         = useState('');
  const [bulkSelected, setBulkSelected] = useState(new Set());

  const [detailSelectedCat, setDetailSelectedCat] = useState(null);
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
    } catch(e) {}
  }

  const [activeMerchantShared, setActiveMerchantShared] = useState(null);
  const [me, setMe] = useState(null);
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
    setDetailTab('overview');
    setExpSearch('');
    setMenuExpId(null);
    apiFetch(`/api/shared/${space.id}`).then(r => r.json()).then(d => {
      setDetail(d);
      setDetailLoading(false);
    }).catch(() => setDetailLoading(false));
  }

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
    const [res, usersRes] = await Promise.all([
      apiFetch(`/api/shared/${spaceId}/share`, { method: 'POST' }),
      apiFetch('/api/shared/users'),
    ]);
    const d = await res.json();
    const u = await usersRes.json();
    if (d.ok) {
      setShareModal({ url: d.url, token: d.token, spaceId });
      setAppUsers(u.users || []);
      setInviteSearch('');
      setInvitedSet(new Set());
    }
  }

  async function inviteUser(username: string) {
    if (!shareModal?.spaceId) return;
    setInviteLoading(username);
    try {
      await apiFetch(`/api/shared/${shareModal.spaceId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      setInvitedSet(prev => new Set([...prev, username]));
      loadSpaces();
    } finally {
      setInviteLoading(null);
    }
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
    setMenuExpId(null);
    loadDetail(detail);
  }

  async function saveEditedExpense() {
    if (!detail || !editExpModal) return;
    setEditExpSaving(true);
    try {
      await apiFetch(`/api/shared/${detail.id}/expenses/${editExpModal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: editExpModal.description,
          amount:      parseFloat(editExpModal.amount),
          date:        editExpModal.date,
          category:    editExpModal.category,
        }),
      });
      setEditExpModal(null);
      loadDetail(detail);
    } finally {
      setEditExpSaving(false);
    }
  }

  async function leaveSpace() {
    if (!detail) return;
    if (!confirm(`Leave "${detail.name}"? You won't be able to see it anymore.`)) return;
    await apiFetch(`/api/shared/${detail.id}/leave`, { method: 'POST' });
    setDetail(null);
    loadSpaces();
  }

  const [editingNote, setEditingNote] = useState(null);
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

  const txnCandidates = useMemo(() => {
    if (!txnSearch.trim() || !detail) return [];
    const q = txnSearch.toLowerCase();
    const alreadyAdded = new Set((detail.expenses || []).filter(e => e.type === 'ref').map(e => e.txn_id));
    return TRANSACTIONS
      .filter(t => !alreadyAdded.has(t.id) && (t.merchant || t.description || '').toLowerCase().includes(q))
      .slice(0, 15);
  }, [txnSearch, detail]);

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
  const [sortBy, setSortBy]         = useState('date');
  const [sortDir, setSortDir]       = useState('desc');

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

  // Per-member category breakdown (for Members tab)
  const memberCategories = useMemo(() => {
    if (!detail) return {};
    const result = {};
    for (const e of detail.expenses || []) {
      if (!result[e.user]) result[e.user] = {};
      result[e.user][e.category] = (result[e.user][e.category] || 0) + e.amount;
    }
    return result;
  }, [detail?.expenses]);

  // Spending velocity — current month only
  const velocityStats = useMemo(() => {
    if (!detail) return null;
    const thisMonthKey = new Date().toISOString().slice(0, 7);
    const thisMonthExps = (detail.expenses || []).filter(e => e.date?.startsWith(thisMonthKey));
    if (thisMonthExps.length < 3) return null;
    const totalThisMonth = thisMonthExps.reduce((s, e) => s + e.amount, 0);
    const daysElapsed = new Date().getDate();
    const dailyRate = totalThisMonth / daysElapsed;
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const projected = dailyRate * daysInMonth;
    return { dailyRate, projected, totalThisMonth, count: thisMonthExps.length };
  }, [detail?.expenses]);

  const dailyBreakdown = useMemo(() => {
    if (!detail) return [];
    const map = {};
    (detail.expenses || []).forEach(e => {
      const d = (e.date || '').slice(0, 10);
      if (d) map[d] = (map[d] || 0) + e.amount;
    });
    return Object.entries(map)
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [detail?.expenses]);

  const fmtMonth = m => {
    const [y, mo] = m.split('-');
    return `${'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[+mo - 1]} ${y}`;
  };

  // ── Space list view ──────────────────────────────────────────────────────────
  if (!detail) {
    const mySpaces     = spaces.filter(s => s.role === 'owner');
    const joinedSpaces = spaces.filter(s => s.role === 'participant');
    return (
      <div className="tab-body">
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

        {shareModal && (
          <Portal>
          <div style={{ position: 'fixed', inset: 0, zIndex: 800, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShareModal(null)}>
            <div className="card" style={{ width: 400, margin: 0 }} onClick={e => e.stopPropagation()}>
              <h3 style={{ marginBottom: 16 }}>Add people</h3>
              {appUsers.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <input
                    placeholder="Search by name…"
                    value={inviteSearch}
                    onChange={e => setInviteSearch(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink)', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', marginBottom: 8 }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
                    {appUsers.filter(u => !inviteSearch || u.display_name.toLowerCase().includes(inviteSearch.toLowerCase()) || u.username.toLowerCase().includes(inviteSearch.toLowerCase())).map(u => (
                      <div key={u.username} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', borderRadius: 8, background: 'var(--surface-3)' }}>
                        <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>{u.display_name}</div>
                        <button
                          onClick={() => inviteUser(u.username)}
                          disabled={inviteLoading === u.username || invitedSet.has(u.username)}
                          style={{ padding: '4px 12px', border: 'none', borderRadius: 6, background: invitedSet.has(u.username) ? 'var(--surface-2)' : 'var(--accent)', color: invitedSet.has(u.username) ? 'var(--ink-3)' : '#fff', cursor: invitedSet.has(u.username) ? 'default' : 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit' }}
                        >
                          {invitedSet.has(u.username) ? '✓ Added' : inviteLoading === u.username ? '…' : 'Add'}
                        </button>
                      </div>
                    ))}
                  </div>
                  <div style={{ height: 1, background: 'var(--line)', margin: '14px 0' }} />
                </div>
              )}
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 7 }}>Or share invite link</div>
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

        {createOpen && (
          <Portal>
          <div style={{ position: 'fixed', inset: 0, zIndex: 800, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setCreateOpen(false)}>
            <div className="card" style={{ width: 420, margin: 0, maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
              <h3 style={{ marginBottom: 16 }}>New shared space</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>Name</label>
                  <input value={createForm.name} onChange={e => setCreateForm(f => ({...f, name: e.target.value}))}
                    placeholder="e.g. Groceries, Tokyo Trip…" style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', marginBottom: 6 }}>What kind of space is this?</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {([
                      { val: 'recurring', emoji: '🔁', name: 'Recurring', desc: 'Ongoing shared expenses you track month-over-month', examples: 'Groceries · Eating out · Utilities' },
                      { val: 'trip',      emoji: '✈️', name: 'Trip',      desc: 'Travel with a start and end date', examples: 'Tokyo trip · Weekend getaway · Road trip' },
                      { val: 'event',     emoji: '🎉', name: 'Event',     desc: 'One-off gathering or occasion', examples: 'Birthday dinner · Group outing · Party' },
                    ] as const).map(({ val, emoji, name, desc, examples }) => {
                      const sel = createForm.type === val;
                      return (
                        <button key={val} onClick={() => setCreateForm(f => ({...f, type: val}))} style={{
                          display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px',
                          border: `1.5px solid ${sel ? 'var(--accent)' : 'var(--line)'}`,
                          borderRadius: 10,
                          background: sel ? 'color-mix(in srgb, var(--accent) 8%, var(--surface-2))' : 'var(--surface-2)',
                          cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%',
                        }}>
                          <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>{emoji}</span>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: sel ? 'var(--accent)' : 'var(--ink)', marginBottom: 2 }}>{name}</div>
                            <div style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 3 }}>{desc}</div>
                            <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{examples}</div>
                          </div>
                          {sel && <span style={{ marginLeft: 'auto', flexShrink: 0, color: 'var(--accent)', fontSize: 16, alignSelf: 'center' }}>✓</span>}
                        </button>
                      );
                    })}
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
                {(createForm.type === 'trip' || createForm.type === 'event') && (
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
                      onOpen={() => loadDetail(space)}
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
                      onOpen={() => loadDetail(space)} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Detail view ──────────────────────────────────────────────────────────────
  const isOwner    = detail.role === 'owner';
  const budget     = detail.budget;
  const budgetPct  = budget ? Math.min((detail.total_spent / budget) * 100, 100) : null;
  const overBudget = budget && detail.total_spent > budget;
  const expenses   = detail.expenses || [];

  // Build filtered + sorted expense list (used in Expenses tab)
  const filteredExpenses = expenses
    .filter(e => {
      if (filterFrom && e.date < filterFrom) return false;
      if (filterTo   && e.date > filterTo)   return false;
      if (filterUser && e.user !== filterUser) return false;
      if (expSearch.trim() && !`${e.description || ''} ${e.notes || ''}`.toLowerCase().includes(expSearch.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'amount')   cmp = a.amount - b.amount;
      else if (sortBy === 'merchant') cmp = (a.description || '').localeCompare(b.description || '');
      else cmp = (a.date || '').localeCompare(b.date || '');
      return sortDir === 'asc' ? cmp : -cmp;
    });

  const filteredTotal = filteredExpenses.reduce((s, e) => s + e.amount, 0);

  const hasAnyFilter = filterFrom || filterTo || filterUser || expSearch.trim();

  return (
    <div className="tab-body">
      {/* Add expense modal */}
      {expenseModal && (
        <Portal>
        <div style={{ position: 'fixed', inset: 0, zIndex: 800, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setExpenseModal(false)}>
          <div className="card" style={{ width: 400, margin: 0, maxHeight: '80vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 14 }}>Add expense</h3>
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, color: 'var(--ink-3)', display: 'block', marginBottom: 3 }}>Category</label>
                      <select value={bulkCat} onChange={e => { setBulkCat(e.target.value); setBulkSelected(new Set()); }}
                        style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 7, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13, outline: 'none' }}>
                        <option value="">All categories</option>
                        {[...CATEGORIES].sort((a,b) => a.name.localeCompare(b.name)).map(c => (
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

      {/* Share modal in detail view */}
      {shareModal && (
        <Portal>
        <div style={{ position: 'fixed', inset: 0, zIndex: 800, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShareModal(null)}>
          <div className="card" style={{ width: 400, margin: 0 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 16 }}>Add people</h3>
            {appUsers.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <input
                  placeholder="Search by name…"
                  value={inviteSearch}
                  onChange={e => setInviteSearch(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink)', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', marginBottom: 8 }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
                  {appUsers.filter(u => !inviteSearch || u.display_name.toLowerCase().includes(inviteSearch.toLowerCase()) || u.username.toLowerCase().includes(inviteSearch.toLowerCase())).map(u => (
                    <div key={u.username} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', borderRadius: 8, background: 'var(--surface-3)' }}>
                      <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>{u.display_name}</div>
                      <button
                        onClick={() => inviteUser(u.username)}
                        disabled={inviteLoading === u.username || invitedSet.has(u.username)}
                        style={{ padding: '4px 12px', border: 'none', borderRadius: 6, background: invitedSet.has(u.username) ? 'var(--surface-2)' : 'var(--accent)', color: invitedSet.has(u.username) ? 'var(--ink-3)' : '#fff', cursor: invitedSet.has(u.username) ? 'default' : 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit' }}
                      >
                        {invitedSet.has(u.username) ? '✓ Added' : inviteLoading === u.username ? '…' : 'Add'}
                      </button>
                    </div>
                  ))}
                </div>
                <div style={{ height: 1, background: 'var(--line)', margin: '14px 0' }} />
              </div>
            )}
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 7 }}>Or share invite link</div>
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

      {/* Edit expense modal */}
      {editExpModal && (
        <Portal>
        <div style={{ position: 'fixed', inset: 0, zIndex: 800, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setEditExpModal(null)}>
          <div className="card" style={{ width: 380, margin: 0 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 16 }}>Edit expense</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>Description</label>
                <input value={editExpModal.description} onChange={e => setEditExpModal(m => ({ ...m, description: e.target.value }))}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>Amount ($)</label>
                  <input type="number" value={editExpModal.amount} onChange={e => setEditExpModal(m => ({ ...m, amount: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>Date</label>
                  <input type="date" value={editExpModal.date} onChange={e => setEditExpModal(m => ({ ...m, date: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>Category</label>
                <select value={editExpModal.category} onChange={e => setEditExpModal(m => ({ ...m, category: e.target.value }))}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}>
                  {SHARED_CATS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button onClick={() => setEditExpModal(null)} style={{ flex: 1, padding: '10px 0', border: '1px solid var(--line)', borderRadius: 10, background: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={saveEditedExpense} disabled={editExpSaving || !editExpModal.description || !editExpModal.amount}
                style={{ flex: 1, padding: '10px 0', border: 'none', borderRadius: 10, background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                {editExpSaving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
        </Portal>
      )}

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <button onClick={() => setDetail(null)} style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'inherit', fontSize: 13 }}>← Back</button>
        <span style={{ fontSize: 28 }}>{detail.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', marginBottom: 2 }}>{detail.name}</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--ink-3)', background: 'var(--surface-2)', borderRadius: 6, padding: '1px 8px' }}>{detail.type}</span>
            {detail.start_date && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{detail.start_date} → {detail.end_date || '…'}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {isOwner && <button onClick={() => shareSpace(detail.id)} style={{ padding: '7px 14px', border: '1px solid var(--line)', borderRadius: 8, background: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'inherit', fontSize: 13 }}>🔗 Share</button>}
          {!isOwner && <button onClick={leaveSpace} style={{ padding: '7px 14px', border: '1px solid var(--line)', borderRadius: 8, background: 'none', cursor: 'pointer', color: 'var(--terra)', fontFamily: 'inherit', fontSize: 13 }}>Leave</button>}
          <button onClick={() => setExpenseModal(true)} style={{ padding: '7px 14px', border: 'none', borderRadius: 8, background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 13 }}>+ Expense</button>
        </div>
      </div>

      {/* ── Sub-tab switcher ── */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 20, background: 'var(--surface-2)', borderRadius: 10, padding: 3 }}>
        {[
          ['overview', 'Overview'],
          ['expenses', `Expenses${expenses.length ? ` (${expenses.length})` : ''}`],
          ['members', `Members${detail.per_user?.length ? ` (${detail.per_user.length})` : ''}`],
        ].map(([tab, label]) => (
          <button key={tab} onClick={() => setDetailTab(tab)} style={{
            flex: 1, padding: '8px 0', border: 'none', borderRadius: 8,
            background: detailTab === tab ? 'var(--surface)' : 'none',
            color: detailTab === tab ? 'var(--ink)' : 'var(--ink-3)',
            cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
            fontWeight: detailTab === tab ? 600 : 400,
            boxShadow: detailTab === tab ? 'var(--shadow-sm)' : 'none',
            transition: 'all .15s',
          }}>{label}</button>
        ))}
      </div>

      {/* ── Overview tab ── */}
      {detailTab === 'overview' && (() => {
        const isRecurring = detail.type === 'recurring';

        // Category breakdown for trips/events
        const catBreakdown = (detail.category_breakdown || []).map(cb => ({
          cat: cb.category,
          name: sharedCatById(cb.category).name,
          color: sharedCatById(cb.category).color,
          amount: cb.amount,
        }));

        // Monthly stacked chart for recurring
        const monthlyChartData = [...monthBreakdown].reverse().slice(-8).map(mb => ({
          label: fmtMonth(mb.month).slice(0, 3),
          segments: (detail.per_user || []).map(u => {
            const found = mb.byUser.find(bu => bu.user === u.user);
            return { key: u.user, name: u.display_name || u.user, value: found?.amount || 0, color: participantColors[u.user] || '#94a3b8' };
          }),
        }));

        const tripDays = detail.start_date && detail.end_date
          ? Math.max(1, Math.round((new Date(detail.end_date) - new Date(detail.start_date)) / 86400000) + 1)
          : null;
        const avgPerMonth = monthBreakdown.length > 0
          ? monthBreakdown.reduce((s, m) => s + m.amount, 0) / monthBreakdown.length
          : 0;
        const maxDailySpend = dailyBreakdown.length ? Math.max(...dailyBreakdown.map(d => d.amount)) : 1;

        const RecentStrip = () => {
          if (!expenses.length) return null;
          const recent = [...expenses].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
          return (
            <div className="card">
              <div className="card-head" style={{ marginBottom: 8 }}>
                <h3>Recent</h3>
                <button onClick={() => setDetailTab('expenses')} style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>See all →</button>
              </div>
              <div className="txn-list">
                {recent.map(e => {
                  const catI = sharedCatById(e.category);
                  const uColor = participantColors[e.user] || '#94a3b8';
                  return (
                    <div key={e.id} className="txn-row" style={{ gridTemplateColumns: '30px 1fr 28px 56px 80px' }}>
                      <div className="txn-icon" style={{ background: `${uColor}22`, color: uColor, fontSize: 14, width: 30, height: 30 }}>
                        {SHARED_ICONS[e.category] || '📦'}
                      </div>
                      <div className="txn-main">
                        <div className="txn-merchant" style={{ fontSize: 13 }}>{e.description}</div>
                        <div className="txn-meta">
                          <span className="cat-pill" style={{ color: catI.color }}>{catI.name}</span>
                        </div>
                      </div>
                      <div title={e.display_name || e.user} style={{ width: 24, height: 24, borderRadius: '50%', background: uColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                        {(e.display_name || e.user).slice(0, 2).toUpperCase()}
                      </div>
                      <div className="txn-date">{e.date?.slice(5).replace('-', '/')}</div>
                      <div className="txn-amt neg">{fmtMoney(e.amount)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        };

        return (
          <div>
            {/* M/M delta headline */}
            {monthBreakdown.length >= 2 && (() => {
              const cur = monthBreakdown[0];
              const prev = monthBreakdown[1];
              if (!cur || !prev || prev.amount === 0) return null;
              const delta = cur.amount - prev.amount;
              const pct = Math.abs((delta / prev.amount) * 100).toFixed(0);
              return (
                <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{isRecurring ? 'Together this month:' : 'This trip so far:'}</span>
                  <span style={{ fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--font-mono)' }}>{fmtMoney(cur.amount)}</span>
                  <span style={{ color: delta >= 0 ? 'var(--terra)' : 'var(--green)', fontWeight: 600 }}>
                    {delta >= 0 ? '↑' : '↓'} {pct}% vs {fmtMonth(prev.month)}
                  </span>
                </div>
              );
            })()}

            {/* Summary cards */}
            <div className="grid-4" style={{ marginBottom: 16 }}>
              <SummaryCard label="Total spent" n={detail.total_spent || 0}
                sub={`${expenses.length} expense${expenses.length !== 1 ? 's' : ''}`} />
              <SummaryCard label="Your share" n={myTotal} accent="var(--accent)"
                sub={detail.total_spent > 0 ? `${((myTotal / detail.total_spent) * 100).toFixed(0)}% of total` : null} />
              <SummaryCard label={detail.per_user?.length === 2
                ? ((detail.per_user.find(u => u.user !== me?.username)?.display_name) || 'Others')
                : 'Others'} n={otherTotal}
                sub={detail.per_user?.length > 1 ? `${detail.per_user.length - 1} other${detail.per_user.length > 2 ? 's' : ''}` : null} />
              {budget ? (
                <SummaryCard label="Budget" n={budget} accent={overBudget ? 'var(--terra)' : 'var(--ink)'}
                  sub={overBudget ? `${fmtMoney(detail.total_spent - budget)} over` : `${fmtMoney(budget - detail.total_spent)} left`} />
              ) : isRecurring ? (
                <SummaryCard label="Avg / month" n={avgPerMonth} accent="var(--ink)"
                  sub={`over ${monthBreakdown.length} month${monthBreakdown.length !== 1 ? 's' : ''}`} />
              ) : (
                <SummaryCard label="Daily avg"
                  n={(detail.total_spent || 0) / Math.max(tripDays || dailyBreakdown.length || 1, 1)}
                  accent="var(--ink)"
                  sub={tripDays ? `${tripDays} day trip` : `${dailyBreakdown.length} days`} />
              )}
            </div>

            <SharedVibeBanner detail={detail} myUsername={me?.username} myTotal={myTotal} expenses={expenses} />

            {/* Budget progress */}
            {budget && (
              <div className="card" style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Budget progress</span>
                  <span style={{ fontSize: 13, color: overBudget ? 'var(--terra)' : 'var(--ink-3)' }}>
                    {fmtMoney(detail.total_spent || 0)} / {fmtMoney(budget)}
                  </span>
                </div>
                <div style={{ height: 8, background: 'var(--line)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(budgetPct, 100)}%`, borderRadius: 4, background: overBudget ? 'var(--terra)' : 'var(--accent)', transition: 'width .3s' }} />
                </div>
              </div>
            )}

            {/* ── RECURRING: monthly chart + table ── */}
            {isRecurring && (
              <>
                {velocityStats && (
                  <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 14, padding: '8px 14px', background: 'var(--surface-2)', borderRadius: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span>📈</span>
                    <span><b style={{ color: 'var(--ink)' }}>{fmtMoney(velocityStats.dailyRate)}/day</b> together this month · on pace for <b style={{ color: 'var(--ink)' }}>{fmtMoney(velocityStats.projected)}</b></span>
                  </div>
                )}

                {monthlyChartData.length > 0 && (
                  <div className="card">
                    <div className="card-head">
                      <h3>Monthly spending</h3>
                      <div className="legend-inline">
                        {(detail.per_user || []).map(u => (
                          <span key={u.user}><i style={{ background: participantColors[u.user] || '#94a3b8' }} />{u.display_name || u.user}</span>
                        ))}
                      </div>
                    </div>
                    <StackedBarChart data={monthlyChartData} height={220} formatter={fmtAbbr} />
                  </div>
                )}

                {monthBreakdown.length > 0 && (
                  <div className="card">
                    <div className="card-head"><h3>Month by month</h3></div>
                    <table className="trend-table">
                      <thead>
                        <tr>
                          <th>Month</th>
                          {(detail.per_user || []).map(u => (
                            <th key={u.user} style={{ textAlign: 'right' }}>{u.display_name || u.user}</th>
                          ))}
                          <th style={{ textAlign: 'right' }}>Combined</th>
                          <th style={{ textAlign: 'right' }}>MoM</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthBreakdown.slice(0, 10).map((mb, i) => {
                          const prev = monthBreakdown[i + 1];
                          const moDelta = prev && prev.amount > 0
                            ? ((mb.amount - prev.amount) / prev.amount) * 100
                            : null;
                          const isCurrentMonth = mb.month === new Date().toISOString().slice(0, 7);
                          return (
                            <tr key={mb.month}
                              onClick={() => {
                                const [y, mo] = mb.month.split('-');
                                const last = new Date(+y, +mo, 0).getDate();
                                setFilterFrom(`${mb.month}-01`);
                                setFilterTo(`${mb.month}-${String(last).padStart(2, '0')}`);
                                setDetailTab('expenses');
                              }}
                              style={{ cursor: 'pointer', fontWeight: isCurrentMonth ? 600 : undefined }}>
                              <td style={{ fontWeight: 500 }}>{fmtMonth(mb.month)}{isCurrentMonth ? ' ·' : ''}</td>
                              {(detail.per_user || []).map(u => {
                                const found = mb.byUser.find(bu => bu.user === u.user);
                                return (
                                  <td key={u.user} style={{ textAlign: 'right', color: found ? participantColors[u.user] || 'var(--ink)' : 'var(--ink-4)' }}>
                                    {found ? fmtMoney(found.amount) : '—'}
                                  </td>
                                );
                              })}
                              <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtMoney(mb.amount)}</td>
                              <td style={{ textAlign: 'right', fontWeight: moDelta != null ? 600 : 400, color: moDelta == null ? 'var(--ink-4)' : moDelta >= 0 ? 'var(--terra)' : 'var(--green)' }}>
                                {moDelta == null ? '—' : `${moDelta >= 0 ? '↑' : '↓'}${Math.abs(moDelta).toFixed(0)}%`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <RecentStrip />
              </>
            )}

            {/* ── TRIP/EVENT: category donut + daily bars + per-person ── */}
            {!isRecurring && (
              <>
                {/* Category donut — the main view for trips */}
                {catBreakdown.length > 0 && (
                  <div className="card">
                    <div className="card-head"><h3>Spending by category</h3></div>
                    <div className="donut-row">
                      <DonutChart
                        data={catBreakdown}
                        size={180}
                        thickness={22}
                        formatter={fmtMoney}
                        selectedCat={detailSelectedCat}
                        onSliceClick={s => setDetailSelectedCat(c => c === s.cat ? null : s.cat)}
                      />
                      <div className="donut-legend">
                        {catBreakdown.map(b => (
                          <div key={b.cat} className="legend-row"
                            style={{ cursor: 'pointer', opacity: detailSelectedCat && detailSelectedCat !== b.cat ? 0.4 : 1, transition: 'opacity .15s' }}
                            onClick={() => setDetailSelectedCat(c => c === b.cat ? null : b.cat)}>
                            <span className="cat-dot" style={{ background: b.color }} />
                            <span className="legend-name">{SHARED_ICONS[b.cat] || '📦'} {b.name}</span>
                            <span className="legend-amt">{fmtMoney(b.amount)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Daily spending bars */}
                {dailyBreakdown.length > 1 && (
                  <div className="card">
                    <div className="card-head">
                      <h3>Daily spending</h3>
                      <span className="muted">{fmtMoney((detail.total_spent || 0) / Math.max(dailyBreakdown.length, 1))} avg/day</span>
                    </div>
                    <div style={{ overflowX: 'auto', padding: '0 4px 8px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 120, minWidth: dailyBreakdown.length * 42 }}>
                        {dailyBreakdown.map(d => (
                          <div key={d.date} style={{ flex: 1, minWidth: 34, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                            <div style={{ fontSize: 9, color: 'var(--ink-3)', textAlign: 'center' }}>{fmtAbbr(d.amount)}</div>
                            <div style={{ width: '100%', borderRadius: 4, minHeight: 4, height: `${Math.max(4, Math.round((d.amount / maxDailySpend) * 80))}px`, background: 'var(--accent)', opacity: 0.85 }} />
                            <div style={{ fontSize: 9, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{d.date.slice(5)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Per-person for trips */}
                {filteredPerUser.length > 0 && (
                  <div className="card">
                    <div className="card-head">
                      <h3>By person</h3>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {filteredPerUser.map(u => {
                        const uTotal = u.filteredTotal || 0;
                        const periodTotal = filteredPerUser.reduce((s, x) => s + (x.filteredTotal || 0), 0);
                        const pct = periodTotal > 0 ? (uTotal / periodTotal) * 100 : 0;
                        const isMe = u.user === me?.username;
                        const uColor = participantColors[u.user];
                        return (
                          <div key={u.user}
                            onClick={() => { setFilterUser(u.user); setDetailTab('expenses'); }}
                            className="month-row"
                            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 6px', margin: '0 -6px', borderBottom: '1px solid var(--line)', cursor: 'pointer' }}>
                            <div style={{ width: 28, height: 28, borderRadius: '50%', background: uColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                              {(u.display_name || u.user).slice(0, 2).toUpperCase()}
                            </div>
                            <span style={{ flex: 1, fontSize: 14, color: 'var(--ink)' }}>{u.display_name || u.user}{isMe ? ' (you)' : ''}</span>
                            <div style={{ width: 100, height: 5, background: 'var(--line)', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${pct}%`, borderRadius: 3, background: uColor }} />
                            </div>
                            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', minWidth: 70, textAlign: 'right', fontFamily: 'var(--font-mono)', fontFeatureSettings: '"tnum"' }}>{fmtMoney(uTotal)}</span>
                            <span style={{ fontSize: 12, color: 'var(--ink-3)', minWidth: 32, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <RecentStrip />
              </>
            )}
          </div>
        );
      })()}

      {/* ── Expenses tab ── */}
      {detailTab === 'expenses' && (
        <div className="card">
          {/* Filter bar — matches .filter-bar pattern from TransactionsTab */}
          <div className="filter-bar">
            <div className="search-input">
              <span className="search-icon">⌕</span>
              <input
                placeholder="Search expenses…"
                value={expSearch}
                onChange={e => setExpSearch(e.target.value)}
              />
            </div>
            {detail.per_user?.length > 1 && (
              <select value={filterUser} onChange={e => setFilterUser(e.target.value)}
                style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: '0 30px 0 12px', height: 36, color: 'var(--ink)', fontSize: 13, fontFamily: 'inherit', outline: 'none', appearance: 'none', boxShadow: 'var(--shadow-sm)' }}>
                <option value="">All people</option>
                {(detail.per_user || []).map(u => (
                  <option key={u.user} value={u.user}>{u.display_name || u.user}</option>
                ))}
              </select>
            )}
            <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)}
              title="From date"
              style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: '0 10px', height: 36, color: filterFrom ? 'var(--ink)' : 'var(--ink-4)', fontSize: 12, fontFamily: 'inherit', outline: 'none', boxShadow: 'var(--shadow-sm)' }} />
            <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)}
              title="To date"
              style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: '0 10px', height: 36, color: filterTo ? 'var(--ink)' : 'var(--ink-4)', fontSize: 12, fontFamily: 'inherit', outline: 'none', boxShadow: 'var(--shadow-sm)' }} />
            <div className="filter-stats">
              <span><b>{filteredExpenses.length}</b> expenses</span>
              <span className="neg">{fmtMoney(filteredTotal)}</span>
            </div>
            <button onClick={() => setExpenseModal(true)} style={{
              padding: '6px 14px', borderRadius: 8, border: '1px solid var(--accent)',
              background: 'none', color: 'var(--accent)', cursor: 'pointer',
              fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
            }}>+ Add</button>
          </div>

          {/* Active filter chips */}
          {hasAnyFilter && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
              {filterUser && (
                <span onClick={() => setFilterUser('')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: `color-mix(in srgb, ${participantColors[filterUser] || 'var(--ink-3)'} 12%, transparent)`, color: participantColors[filterUser] || 'var(--ink-3)', border: `1px solid color-mix(in srgb, ${participantColors[filterUser] || 'var(--ink-3)'} 25%, transparent)`, cursor: 'pointer' }}>
                  <div style={{ width: 14, height: 14, borderRadius: '50%', background: participantColors[filterUser] || '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: '#fff' }}>
                    {((detail.per_user?.find(u => u.user === filterUser)?.display_name) || filterUser).slice(0,2).toUpperCase()}
                  </div>
                  {(detail.per_user?.find(u => u.user === filterUser)?.display_name) || filterUser} ×
                </span>
              )}
              {filterFrom && (
                <span onClick={() => { setFilterFrom(''); setFilterTo(''); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)', cursor: 'pointer' }}>
                  📅 {filterFrom === filterTo ? filterFrom : `${filterFrom} – ${filterTo}`} ×
                </span>
              )}
              {expSearch.trim() && (
                <span onClick={() => setExpSearch('')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: 'color-mix(in srgb, var(--ink-3) 10%, transparent)', color: 'var(--ink-3)', border: '1px solid var(--line)', cursor: 'pointer' }}>
                  "{expSearch}" ×
                </span>
              )}
              <button onClick={() => { setFilterUser(''); setFilterFrom(''); setFilterTo(''); setExpSearch(''); }}
                style={{ fontSize: 11, padding: '3px 10px', border: '1px solid var(--line)', borderRadius: 20, background: 'none', color: 'var(--ink-4)', cursor: 'pointer', fontFamily: 'inherit' }}>
                Clear all
              </button>
            </div>
          )}

          {/* Column headers — matching txn-list header style */}
          <div style={{
            display: 'grid', gridTemplateColumns: '38px 1fr 32px 56px 90px 20px',
            gap: 10, padding: '6px 4px 5px',
            borderBottom: '2px solid var(--line)',
            fontSize: 11, fontWeight: 600, color: 'var(--muted)',
            textTransform: 'uppercase', letterSpacing: '0.04em', userSelect: 'none',
          }}>
            <div />
            <div>Description</div>
            <div />
            <div style={{ cursor: 'pointer' }} onClick={() => { if (sortBy === 'date') setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortBy('date'); setSortDir('desc'); } }}>
              Date {sortBy === 'date' ? (sortDir === 'desc' ? '↓' : '↑') : <span style={{ opacity: 0.25 }}>↕</span>}
            </div>
            <div style={{ cursor: 'pointer', textAlign: 'right' }} onClick={() => { if (sortBy === 'amount') setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortBy('amount'); setSortDir('desc'); } }}>
              {sortBy === 'amount' ? (sortDir === 'desc' ? '↓' : '↑') : <span style={{ opacity: 0.25 }}>↕</span>} Amount
            </div>
            <div />
          </div>

          {/* Expense rows — matching txn-row pattern */}
          {filteredExpenses.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '32px 0', fontSize: 14 }}>
              {expenses.length === 0
                ? 'No expenses yet — add one to get started.'
                : hasAnyFilter
                  ? 'No expenses match your filters.'
                  : 'No expenses yet.'}
            </div>
          ) : (
            <div className="txn-list">
              {filteredExpenses.map(e => {
                const catI = sharedCatById(e.category);
                const uColor = participantColors[e.user] || '#94a3b8';
                const isMe = e.user === me?.username;
                const isOwnerUser = detail.role === 'owner';
                const isEditingThis = editingNote?.id === e.id;
                const isMenuOpen = menuExpId === e.id;
                return (
                  <div key={e.id} className="txn-row" style={{ gridTemplateColumns: '38px 1fr 32px 56px 90px 20px' }}>
                    {/* Category icon, colored by person */}
                    <div className="txn-icon" style={{ background: `${uColor}22`, color: uColor, fontSize: 18 }}>
                      {SHARED_ICONS[e.category] || '📦'}
                    </div>
                    {/* Main content */}
                    <div className="txn-main">
                      <div className="txn-merchant">
                        <span
                          onClick={() => setActiveMerchantShared(e.description)}
                          style={{ cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: 2, textDecorationColor: 'var(--line-2)' }}
                        >{e.description}</span>
                        {e.notes && !isEditingThis && (
                          <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 6, fontWeight: 400, fontStyle: 'italic' }}>{e.notes}</span>
                        )}
                      </div>
                      <div className="txn-meta">
                        <span className="cat-pill" style={{ color: catI.color }}>{catI.name}</span>
                      </div>
                      {isEditingThis && (
                        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
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
                    {/* Person avatar */}
                    <div title={e.display_name || e.user} style={{ width: 28, height: 28, borderRadius: '50%', background: uColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                      {(e.display_name || e.user).slice(0,2).toUpperCase()}
                    </div>
                    {/* Date */}
                    <div className="txn-date">{e.date?.slice(5).replace('-', '/')}</div>
                    {/* Amount */}
                    <div className="txn-amt neg">{fmtMoney(e.amount)}</div>
                    {/* Actions menu */}
                    <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
                      <button
                        className="txn-menu-btn"
                        onClick={ev => { ev.stopPropagation(); setMenuExpId(isMenuOpen ? null : e.id); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 15, padding: '0 2px', lineHeight: 1, width: 20 }}
                      >⋮</button>
                      {isMenuOpen && (
                        <div style={{
                          position: 'absolute', right: 0, top: '100%', zIndex: 300,
                          background: 'var(--surface)', border: '1px solid var(--line)',
                          borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
                          minWidth: 140, overflow: 'hidden',
                        }} onClick={ev => ev.stopPropagation()}>
                          {[
                            {
                              label: e.notes ? '✏️ Edit note' : '💬 Add note',
                              action: () => { setEditingNote({ id: e.id, value: e.notes || '' }); setMenuExpId(null); },
                            },
                            ...(!e.txn_id ? [{
                              label: '✏️ Edit expense',
                              action: () => { setEditExpModal({ id: e.id, description: e.description, amount: e.amount, date: e.date, category: e.category || 'other' }); setMenuExpId(null); },
                            }] : []),
                            ...(isMe || isOwnerUser ? [{
                              label: 'Delete',
                              action: () => deleteExpense(e.id),
                              danger: true,
                            }] : []),
                          ].map(item => (
                            <button key={item.label}
                              onClick={item.action}
                              style={{
                                display: 'block', width: '100%', textAlign: 'left',
                                padding: '9px 14px', border: 'none', background: 'none',
                                cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
                                color: item.danger ? 'var(--terra)' : 'var(--ink)',
                              }}
                              onMouseEnter={ev => ev.currentTarget.style.background = 'var(--surface-2)'}
                              onMouseLeave={ev => ev.currentTarget.style.background = 'none'}
                            >{item.label}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Members tab ── */}
      {detailTab === 'members' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(detail.per_user || []).length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '40px 0', color: 'var(--ink-3)', fontSize: 14 }}>
              No members yet — share this space to invite others.
            </div>
          ) : (detail.per_user || []).map(u => {
            const uColor = participantColors[u.user] || '#94a3b8';
            const isMe = u.user === me?.username;
            const pct = detail.total_spent > 0 ? (u.total / detail.total_spent) * 100 : 0;
            const userCats = memberCategories[u.user] || {};
            const topCats = Object.entries(userCats)
              .sort(([,a],[,b]) => b - a)
              .slice(0, 4)
              .map(([catId, amt]) => ({ ...sharedCatById(catId), amt }));
            const userExpenseCount = expenses.filter(e => e.user === u.user).length;

            return (
              <div key={u.user} className="card" style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                {/* Avatar */}
                <div style={{ width: 52, height: 52, borderRadius: '50%', background: uColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                  {(u.display_name || u.user).slice(0,2).toUpperCase()}
                </div>
                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{u.display_name || u.user}</span>
                    {isMe && <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 8, background: `${uColor}22`, color: uColor }}>you</span>}
                    <span style={{ fontSize: 12, color: 'var(--ink-4)', marginLeft: 'auto' }}>{userExpenseCount} expense{userExpenseCount !== 1 ? 's' : ''}</span>
                  </div>
                  {/* Contribution bar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <div style={{ flex: 1, height: 6, background: 'var(--line)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: uColor, borderRadius: 3, transition: 'width .3s' }} />
                    </div>
                    <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--font-mono)', fontFeatureSettings: '"tnum"', minWidth: 70, textAlign: 'right' }}>{fmtMoney(u.total)}</span>
                    <span style={{ fontSize: 12, color: 'var(--ink-3)', minWidth: 36, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
                  </div>
                  {/* Top categories */}
                  {topCats.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {topCats.map(c => (
                        <span key={c.id} className="cat-pill" style={{ color: c.color }}>
                          {SHARED_ICONS[c.id] || '📦'} {c.name} {fmtMoney(c.amt)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {/* View their expenses button */}
                <button
                  onClick={() => { setFilterUser(u.user); setDetailTab('expenses'); }}
                  style={{ padding: '6px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'inherit', fontSize: 12, flexShrink: 0 }}
                >View →</button>
              </div>
            );
          })}

          {/* Settlement helper for 2-person spaces */}
          {(detail.per_user || []).length === 2 && detail.total_spent > 0 && (() => {
            const [p1, p2] = detail.per_user;
            const diff = Math.abs(p1.total - p2.total) / 2;
            if (diff < 0.01) return null;
            const payer = p1.total > p2.total ? p2 : p1;
            const payee = p1.total > p2.total ? p1 : p2;
            return (
              <div className="card" style={{ background: 'color-mix(in srgb, var(--accent) 6%, var(--surface))', border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 20 }}>⚖️</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
                      {payer.display_name || payer.user} owes {payee.display_name || payee.user}
                      <span style={{ color: 'var(--accent)', marginLeft: 6 }}>{fmtMoney(diff)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
                      to split costs evenly ({fmtMoney(detail.total_spent / 2)} each)
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

export { SharedMerchantDrawer, SharedVibeBanner, SpaceCard, Portal, sharedCatById };
export default SharedTab;
