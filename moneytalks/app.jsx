// Main App component for MoneyTalks — wired to real data via /api/fin.
(function () {
const { useState, useEffect, useCallback } = React;

// ─── Helpers ──────────────────────────────────────────────────────
function avatarColor(name) {
  const palette = ['#5ec98a','#67e8f9','#a78bfa','#fbbf24','#f97316','#ec4899','#d97757'];
  let h = 0;
  for (const c of (name || '')) h = ((h << 5) - h) + c.charCodeAt(0);
  return palette[Math.abs(h) % palette.length];
}

// ─── Profile panel — defined outside TopBar so React identity is stable ──
function ProfilePanel({ me, onClose, onDisplayNameChange }) {
  const [section, setSection] = useState(null); // 'password' | 'family'
  const [users,   setUsers]   = useState(null);

  // Display name editing
  const [draftName, setDraftName] = useState('');
  const [nameBusy,  setNameBusy]  = useState(false);

  // Change-password state
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg,  setPwMsg]  = useState(null);

  // Add-user state
  const [uname,   setUname]   = useState('');
  const [upass,   setUpass]   = useState('');
  const [uadmin,  setUadmin]  = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addMsg,  setAddMsg]  = useState(null);

  // Load user list when family section opens
  useEffect(() => {
    if (section === 'family' && users === null) {
      fetch('/api/auth/users').then(r => r.json()).then(d => setUsers(d.users || []));
    }
  }, [section]);

  async function changePassword() {
    if (!oldPw || !newPw) return;
    setPwBusy(true); setPwMsg(null);
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ old_password: oldPw, new_password: newPw }),
    });
    const d = await res.json();
    setPwBusy(false);
    if (res.ok) { setPwMsg({ ok: true }); setOldPw(''); setNewPw(''); }
    else setPwMsg({ error: d.detail || 'Failed' });
  }

  async function addUser() {
    if (!uname || !upass) return;
    setAddBusy(true); setAddMsg(null);
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: uname, password: upass, is_admin: uadmin }),
    });
    const d = await res.json();
    setAddBusy(false);
    if (res.ok) {
      setAddMsg({ ok: true });
      setUname(''); setUpass(''); setUadmin(false);
      fetch('/api/auth/users').then(r => r.json()).then(d => setUsers(d.users || []));
    } else {
      setAddMsg({ error: d.detail || 'Failed' });
    }
  }

  async function deleteUser(username) {
    if (!confirm(`Remove "${username}"?`)) return;
    await fetch(`/api/auth/users/${username}`, { method: 'DELETE' });
    setUsers(prev => prev.filter(u => u.username !== username));
  }

  async function saveDisplayName() {
    if (!draftName.trim()) return;
    setNameBusy(true);
    const res = await fetch('/api/auth/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: draftName.trim() }),
    });
    setNameBusy(res.ok ? false : 'error');
    if (res.ok) {
      setSection(null);
      onDisplayNameChange && onDisplayNameChange(draftName.trim());
    }
  }

  const displayName = me?.display_name || me?.username || '?';
  const color       = avatarColor(me?.username || '');
  const initial     = displayName[0].toUpperCase();

  const inputStyle = {
    width: '100%', padding: '9px 12px', borderRadius: 9, border: '1px solid var(--line)',
    background: 'var(--bg)', color: 'var(--ink)', fontSize: 13,
    fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  };
  const btnStyle = (primary) => ({
    width: '100%', padding: '9px 0', borderRadius: 9, border: primary ? 'none' : '1px solid var(--line)',
    background: primary ? 'var(--accent)' : 'transparent',
    color: primary ? '#052015' : 'var(--ink-2)',
    fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
  });
  const msgStyle = (ok) => ({
    padding: '8px 12px', borderRadius: 8, fontSize: 12, marginTop: 8,
    background: ok ? 'rgba(94,201,138,0.1)' : 'rgba(239,68,68,0.08)',
    border: `1px solid ${ok ? 'rgba(94,201,138,0.3)' : 'rgba(239,68,68,0.3)'}`,
    color: ok ? 'var(--ink)' : '#f87171',
  });

  return (
    <div className="profile-panel">
      {/* ── Header ───────────────────────────────────────── */}
      <div className="profile-header">
        <div className="profile-avatar" style={{ background: color }}>{initial}</div>
        <div>
          <div className="profile-name">{displayName}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>@{me?.username}</div>
          {me?.is_admin && <div className="profile-badge">Admin</div>}
        </div>
      </div>

      <div className="profile-divider" />

      {/* ── Sections ─────────────────────────────────────── */}
      <div className="profile-sections">

        {/* Edit display name */}
        <button className="profile-section-btn" onClick={() => { setDraftName(displayName); setSection(s => s === 'name' ? null : 'name'); }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          Edit display name
          <span className="profile-chevron" style={{ transform: section === 'name' ? 'rotate(90deg)' : '' }}>›</span>
        </button>

        {section === 'name' && (
          <div className="profile-section-body">
            <input
              autoFocus
              value={draftName}
              onChange={e => setDraftName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveDisplayName(); if (e.key === 'Escape') setSection(null); }}
              placeholder="Your display name"
              style={{ ...inputStyle }}
            />
            {nameBusy === 'error' && <div style={msgStyle(false)}>⚠ Failed to save</div>}
            <button onClick={saveDisplayName} disabled={nameBusy === true || !draftName.trim() || draftName.trim() === displayName}
              style={{ ...btnStyle(true), marginTop: 2, opacity: (!draftName.trim() || draftName.trim() === displayName) ? 0.6 : 1 }}>
              {nameBusy === true ? 'Saving…' : 'Save name'}
            </button>
          </div>
        )}

        {/* Change password */}
        <button className="profile-section-btn" onClick={() => setSection(s => s === 'password' ? null : 'password')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          Change password
          <span className="profile-chevron" style={{ transform: section === 'password' ? 'rotate(90deg)' : '' }}>›</span>
        </button>

        {section === 'password' && (
          <div className="profile-section-body">
            <input type="password" value={oldPw} onChange={e => setOldPw(e.target.value)}
              placeholder="Current password" style={{ ...inputStyle, marginBottom: 8 }} />
            <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
              placeholder="New password" style={{ ...inputStyle, marginBottom: 10 }} />
            {pwMsg && <div style={msgStyle(pwMsg.ok)}>{pwMsg.ok ? '✓ Password updated' : `⚠ ${pwMsg.error}`}</div>}
            <button onClick={changePassword} disabled={pwBusy || !oldPw || !newPw}
              style={{ ...btnStyle(true), marginTop: 8, opacity: (pwBusy || !oldPw || !newPw) ? 0.6 : 1 }}>
              {pwBusy ? 'Updating…' : 'Update password'}
            </button>
          </div>
        )}

        {/* Family management — admin only */}
        {me?.is_admin && (
          <>
            <button className="profile-section-btn" onClick={() => setSection(s => s === 'family' ? null : 'family')}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              Manage family
              <span className="profile-chevron" style={{ transform: section === 'family' ? 'rotate(90deg)' : '' }}>›</span>
            </button>

            {section === 'family' && (
              <div className="profile-section-body">
                {/* User list */}
                {(users || []).map(u => (
                  <div key={u.username} className="profile-user-row">
                    <div className="profile-user-dot" style={{ background: avatarColor(u.username) }}>
                      {u.username[0].toUpperCase()}
                    </div>
                    <span className="profile-user-name">{u.username}</span>
                    {u.is_admin && <span className="profile-admin-pill">admin</span>}
                    {u.username !== me.username && (
                      <button className="profile-remove-btn" onClick={() => deleteUser(u.username)}>✕</button>
                    )}
                  </div>
                ))}

                {/* Add user */}
                <div style={{ marginTop: 14, display: 'grid', gap: 7 }}>
                  <input value={uname} onChange={e => setUname(e.target.value)}
                    placeholder="New username" style={inputStyle} />
                  <input type="password" value={upass} onChange={e => setUpass(e.target.value)}
                    placeholder="Password" style={inputStyle} />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--ink-3)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={uadmin} onChange={e => setUadmin(e.target.checked)} />
                    Make admin
                  </label>
                  {addMsg && <div style={msgStyle(addMsg.ok)}>{addMsg.ok ? '✓ Created' : `⚠ ${addMsg.error}`}</div>}
                  <button onClick={addUser} disabled={addBusy || !uname || !upass}
                    style={{ ...btnStyle(true), opacity: (addBusy || !uname || !upass) ? 0.6 : 1 }}>
                    {addBusy ? 'Creating…' : 'Add member'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="profile-divider" />

      {/* ── Sign out ─────────────────────────────────────── */}
      <div style={{ padding: '8px 16px 16px' }}>
        <button style={btnStyle(false)} onClick={async () => {
          await fetch('/api/auth/logout', { method: 'POST' });
          window.location.href = '/login';
        }}>Sign out</button>
      </div>
    </div>
  );
}
const { MONTHS } = window.FIN;
const {
  OverviewTab, TransactionsTab, SpendingTab, IncomeTab, CashFlowTab,
  NetWorthTab, AccountsTab, RecurringTab, CategoriesTab, TrendsTab, ChatTab, SettingsTab,
  ReviewTab, FeedbackTab, MonthlyTab,
  TweaksPanel, TweakSection, TweakRadio, TweakToggle,
  useTweaks,
} = window;

const TWEAK_DEFAULTS = {
  accent: 'emerald',
  density: 'regular',
  monoNumbers: true,
  sidebarLayout: 'labeled',
};

const ACCENT_PRESETS = {
  emerald: { accent: '#5ec98a', accent2: '#67e8f9', terra: '#d97757' },
  violet:  { accent: '#a78bfa', accent2: '#67e8f9', terra: '#f472b6' },
  amber:   { accent: '#fbbf24', accent2: '#a3e635', terra: '#f97316' },
  cyan:    { accent: '#22d3ee', accent2: '#34d399', terra: '#fb7185' },
};

// ─── SVG icons ────────────────────────────────────────────────────
const Icon = ({ name, size = 18 }) => {
  const paths = {
    sync:        'M4 12a8 8 0 0 1 14-5l3-3v6h-6M20 12a8 8 0 0 1-14 5l-3 3v-6h6',
    overview:    'M3 12h4l3-8 4 16 3-8h4',
    txns:        'M3 6h18M3 12h18M3 18h12',
    income:      'M7 17l5-5 4 4 5-9M16 7h5v5',
    spending:    'M21 17l-5-5-4 4-5-9M8 7H3v5',
    cashflow:    'M3 6c4 0 4 12 8 12s4-12 8-12M3 6h2m14 0h2',
    networth:    'M4 19V9l8-5 8 5v10M4 19h16M9 19v-6h6v6',
    accounts:    'M3 6h18v12H3zM3 10h18M7 14h2',
    recurring:   'M4 12a8 8 0 0 1 14-5l3-3v6h-6M20 12a8 8 0 0 1-14 5l-3 3v-6h6',
    categories:  'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    trends:      'M3 17l6-6 4 4 8-8M14 7h7v7',
    chat:        'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
    search:      'M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0M21 21l-4.5-4.5',
    bell:        'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0',
    chevron:     'M9 5l7 7-7 7',
    chevronL:    'M15 5l-7 7 7 7',
    upload:      'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
    feedback:    'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z',
    monthly:     'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z',
    review:      'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name] || ''} />
    </svg>
  );
};

const TABS = [
  { id: 'overview',    name: 'Overview',      icon: 'overview',   group: 'main' },
  { id: 'txns',        name: 'Transactions',  icon: 'txns',       group: 'main' },
  { id: 'monthly',     name: 'Monthly',       icon: 'monthly',    group: 'main' },
  { id: 'review',      name: 'Review',        icon: 'review',     group: 'main' },
  { id: 'cashflow',    name: 'Cash Flow',     icon: 'cashflow',   group: 'analysis' },
  { id: 'income',      name: 'Income',        icon: 'income',     group: 'analysis' },
  { id: 'spending',    name: 'Spending',      icon: 'spending',   group: 'analysis' },
  { id: 'categories',  name: 'Categories',    icon: 'categories', group: 'analysis' },
  { id: 'trends',      name: 'Trends',        icon: 'trends',     group: 'analysis' },
  { id: 'networth',    name: 'Net Worth',     icon: 'networth',   group: 'wealth' },
  { id: 'accounts',    name: 'Accounts',      icon: 'accounts',   group: 'wealth' },
  { id: 'recurring',   name: 'Recurring',     icon: 'recurring',  group: 'wealth' },
  { id: 'chat',        name: 'Chat',          icon: 'chat',       group: 'tools' },
  { id: 'settings',   name: 'Settings',      icon: 'upload',     group: 'tools' },
  { id: 'feedback',    name: 'Feedback',      icon: 'feedback',   group: 'tools' },
];

const TAB_GROUPS = [
  { id: 'main',     label: 'Money' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'wealth',   label: 'Wealth' },
  { id: 'tools',    label: 'Tools' },
];

// ─── Sidebar ──────────────────────────────────────────────────────
function Sidebar({ active, onChange, layout }) {
  const collapsed = layout === 'icons';
  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="brand">
        <div className="brand-mark">
          <svg width="22" height="22" viewBox="0 0 22 22">
            <path d="M3 18 L8 6 L11 13 L14 9 L19 16" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="3" cy="18" r="1.6" fill="currentColor" />
            <circle cx="19" cy="16" r="1.6" fill="currentColor" />
          </svg>
        </div>
        {!collapsed && <div className="brand-name">MoneyTalks</div>}
      </div>

      <nav className="nav">
        {TAB_GROUPS.map((g) => (
          <div key={g.id} className="nav-group">
            {!collapsed && <div className="nav-group-label">{g.label}</div>}
            {TABS.filter((t) => t.group === g.id).map((t) => (
              <button key={t.id}
                className={`nav-item ${active === t.id ? 'active' : ''}`}
                onClick={() => onChange(t.id)}
                title={collapsed ? t.name : ''}>
                <Icon name={t.icon} size={18} />
                {!collapsed && <span>{t.name}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-foot">
        <div className="sync-pill">
          <span className="sync-dot" />
          {!collapsed && <span>Live data</span>}
        </div>
      </div>
    </aside>
  );
}

// ─── Topbar ───────────────────────────────────────────────────────
function TopBar({ tab, monthKey, setMonthKey, search, setSearch, syncState, syncing, syncProgress, manualSync, fmtLastSync }) {
  const [me,          setMe]          = useState(null);
  const [showProfile, setShowProfile] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(setMe).catch(() => {});
  }, []);

  function fmtLastSync(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    const diffMin = Math.round((Date.now() - d) / 60000);
    if (diffMin < 2)  return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.round(diffMin / 60);
    if (diffH < 24)   return `${diffH}h ago`;
    return `${Math.round(diffH/24)}d ago`;
  }

  const idx      = MONTHS.findIndex((m) => m.key === monthKey);
  const showMonth = ['overview', 'txns', 'income', 'spending', 'categories', 'monthly'].includes(tab);
  const tabName  = TABS.find((t) => t.id === tab)?.name || '';
  const displayName = me?.display_name || me?.username || '?';
  const initial     = displayName[0].toUpperCase();
  const color       = avatarColor(me?.username || '');

  return (
    <>
    <header className="topbar">
      <div className="topbar-left">
        <h1 className="page-title">{tabName}</h1>
        {showMonth && (
          <div className="month-switcher">
            <button className="month-nav"
              disabled={idx === 0}
              onClick={() => idx > 0 && setMonthKey(MONTHS[idx - 1].key)}>
              <Icon name="chevronL" size={16} />
            </button>
            <div className="month-label">{MONTHS[idx]?.label}</div>
            <button className="month-nav"
              disabled={idx === MONTHS.length - 1}
              onClick={() => idx < MONTHS.length - 1 && setMonthKey(MONTHS[idx + 1].key)}>
              <Icon name="chevron" size={16} />
            </button>
          </div>
        )}
      </div>
      <div className="topbar-right">
        {/* Sync button */}
        <button className="icon-btn sync-btn" onClick={manualSync} disabled={syncing}
          title={syncState?.last_sync ? `Last synced ${fmtLastSync(syncState.last_sync)}` : 'Sync now'}>
          <span style={{ display: 'inline-flex', animation: syncing ? 'spin 1s linear infinite' : 'none' }}>
            <Icon name="sync" size={16} />
          </span>
          <span className="sync-btn-label">
            {syncing ? 'Syncing…' : syncState?.last_sync ? fmtLastSync(syncState.last_sync) : 'Sync'}
          </span>
        </button>
        <div className="topbar-search">
          <Icon name="search" size={14} />
          <input placeholder="Search transactions, merchants..." value={search}
            onChange={(e) => setSearch(e.target.value)} />
          <kbd>⌘K</kbd>
        </div>
        <button className="icon-btn" title="Notifications">
          <Icon name="bell" size={18} />
        </button>

        {/* Avatar button — opens profile panel */}
        <div className="user-chip" style={{ position: 'relative' }}>
          <button className="avatar" style={{ background: color, border: 'none', cursor: 'pointer' }}
            onClick={() => setShowProfile(v => !v)}
            title={displayName}>
            {initial}
          </button>
          {showProfile && (
            <>
              <div className="profile-overlay" onClick={() => setShowProfile(false)} />
              <ProfilePanel me={me} onClose={() => setShowProfile(false)}
                onDisplayNameChange={(name) => setMe(prev => ({ ...prev, display_name: name }))} />
            </>
          )}
        </div>
      </div>
    </header>
    </>
  );
}

// ─── Bottom nav (mobile) — 5 pinned tabs + "More" sheet ──────────
const BOTTOM_TABS = [
  { id: 'overview',  name: 'Overview',  icon: 'overview'  },
  { id: 'txns',      name: 'Txns',      icon: 'txns'      },
  { id: 'spending',  name: 'Spending',  icon: 'spending'  },
  { id: 'networth',  name: 'Net Worth', icon: 'networth'  },
  { id: '__more__',  name: 'More',      icon: 'more'      },
];

// Add a "more" icon to the existing Icon paths
const MORE_ICON_PATH = 'M5 12h.01M12 12h.01M19 12h.01';

function BottomNav({ active, onChange }) {
  const [showMore, setShowMore] = useState(false);

  // Tabs not already in the bottom strip
  const pinnedIds = new Set(BOTTOM_TABS.map(t => t.id).filter(id => id !== '__more__'));
  const moreTabs  = TABS.filter(t => !pinnedIds.has(t.id));

  const handleTab = (id) => {
    if (id === '__more__') { setShowMore(true); return; }
    onChange(id);
  };
  const handleMore = (id) => { onChange(id); setShowMore(false); };

  return (
    <>
      <nav className="bottom-nav">
        {BOTTOM_TABS.map(t => (
          <button key={t.id}
            className={`bottom-nav-item ${active === t.id ? 'active' : ''}`}
            onClick={() => handleTab(t.id)}>
            {t.icon === 'more'
              ? <svg width={22} height={22} viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d={MORE_ICON_PATH} />
                </svg>
              : <Icon name={t.icon} size={22} />
            }
            <span>{t.name}</span>
          </button>
        ))}
      </nav>

      {showMore && (
        <>
          <div className="more-sheet-overlay" onClick={() => setShowMore(false)} />
          <div className="more-sheet">
            <div className="more-sheet-handle" />
            {moreTabs.map(t => (
              <button key={t.id} className="more-sheet-item" onClick={() => handleMore(t.id)}>
                <Icon name={t.icon} size={20} />
                {t.name}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

// ─── Error Boundary ───────────────────────────────────────────────
// Catches render errors in any tab and shows a recovery UI instead of a
// white screen.  Must be a class component (React requirement).
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', color: 'var(--text-muted)' }}>
          <p style={{ fontWeight: 600, color: '#ef4444', marginBottom: 8 }}>
            Something went wrong in this tab.
          </p>
          <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', marginBottom: 16 }}>
            {this.state.error.message}
          </pre>
          <button
            className="btn-primary"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── App ──────────────────────────────────────────────────────────
function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [tab, setTab]           = useState(null); // resolved after checking review status
  // Default to most recent month in real data
  const [monthKey, setMonthKey] = useState(MONTHS[MONTHS.length - 1]?.key || '');
  const [search, setSearch]     = useState('');
  const [txnOverrides, setTxnOverrides] = useState({});
  const [finVersion, setFinVersion]     = useState(0);

  // Sync state — lifted here so AccountsTab can trigger the same sync UI
  const [syncState,    setSyncState]    = useState(null);
  const [syncing,      setSyncing]      = useState(false);
  const [syncProgress, setSyncProgress] = useState(null);

  useEffect(() => {
    fetch('/api/review').then(r => r.json()).then(d => {
      setTab(d.remaining === 0 ? 'monthly' : 'review');
    }).catch(() => setTab('review'));
    // Auto-sync on load if stale
    fetch('/api/plaid/sync_status').then(r => r.json()).then(d => {
      setSyncState(d);
      if (d.needs_sync) {
        setSyncing(true);
        fetch('/api/plaid/sync', { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' })
          .then(r => r.json())
          .then(res => {
            setSyncing(false);
            if (res.last_sync) setSyncState({ last_sync: res.last_sync, needs_sync: false });
            if ((res.stats?.added || 0) + (res.stats?.modified || 0) > 0) {
              setTimeout(() => window.location.reload(), 800);
            }
          })
          .catch(() => setSyncing(false));
      }
    }).catch(() => {});
  }, []);

  const manualSync = useCallback(async (full = false) => {
    if (syncing) return;
    setSyncing(true);
    setSyncProgress({ step: full ? 'Resetting cursors…' : 'Connecting to bank…', pct: 10, error: null });
    try {
      setSyncProgress({ step: 'Fetching transactions…', pct: 35, error: null });
      const r   = await fetch('/api/plaid/sync', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ full }) });
      setSyncProgress({ step: 'Categorizing…', pct: 70, error: null });
      if (r.status === 401) { window.location.href = '/login.html'; return; }
      const res = await r.json();
      if (!r.ok || res.error) {
        setSyncProgress({ step: res.error || res.detail || 'Sync failed', pct: 100, error: true });
        setTimeout(() => { setSyncing(false); setSyncProgress(null); }, 4000);
        return;
      }
      setSyncProgress({ step: 'Saving…', pct: 90, error: null });
      if (res.last_sync) setSyncState({ last_sync: res.last_sync, needs_sync: false });
      const added = (res.stats?.added || 0) + (res.stats?.modified || 0);
      setSyncProgress({ step: added > 0 ? `Done — ${added} new transactions` : 'Already up to date', pct: 100, error: null });
      setTimeout(() => {
        setSyncing(false);
        setSyncProgress(null);
        if (added > 0) window.location.reload();
      }, 1200);
    } catch (e) {
      setSyncProgress({ step: 'Connection failed. Check your internet.', pct: 100, error: true });
      setTimeout(() => { setSyncing(false); setSyncProgress(null); }, 4000);
    }
  }, [syncing]);

  // Re-fetch /api/fin and update window.FIN so all tabs see latest data.
  // Arrays are mutated in-place so module-level destructured references (TRANSACTIONS etc.) stay valid.
  const refreshFin = useCallback(() => {
    fetch('/api/fin').then(r => r.json()).then(data => {
      if (data.hasData === false) return;
      // Mutate arrays in-place so const destructurings at module scope stay in sync
      const arrayKeys = ['transactions', 'months', 'accounts', 'categories', 'recurring', 'net_worth_history'];
      arrayKeys.forEach(k => {
        if (Array.isArray(data[k]) && Array.isArray(window.FIN[k])) {
          window.FIN[k].length = 0;
          window.FIN[k].push(...data[k]);
        }
      });
      // Non-array fields (scalars, objects) can be assigned directly
      Object.keys(data).forEach(k => {
        if (!arrayKeys.includes(k)) window.FIN[k] = data[k];
      });
      setFinVersion(v => v + 1);
      // Only clear overrides that are now reflected in the fresh data.
      // If the write hasn't flushed yet, the refreshed data will be stale —
      // keep the override so the UI doesn't snap back to the old category.
      setTxnOverrides(prev => {
        if (!Object.keys(prev).length) return prev;
        const txnMap = {};
        (data.transactions || []).forEach(t => { txnMap[t.id] = t; });
        const next = { ...prev };
        Object.keys(next).forEach(id => {
          if (txnMap[id] && txnMap[id].category === next[id]) delete next[id];
        });
        return next;
      });
    }).catch(() => {});
  }, []);

  const accent  = ACCENT_PRESETS[t.accent] || ACCENT_PRESETS.emerald;
  const cssVars = {
    '--accent':  accent.accent,
    '--accent2': accent.accent2,
    '--terra':   accent.terra,
    '--green':   '#5ec98a',
  };

  const renderTab = () => {
    if (!tab) return null;
    const props = { monthKey, txnOverrides, setTxnOverrides, search, setSearch, refreshFin, finVersion };
    switch (tab) {
      case 'overview':    return <OverviewTab    {...props} />;
      case 'txns':        return <TransactionsTab {...props} />;
      case 'monthly':     return <MonthlyTab {...props} />;
      case 'review':      return <ReviewTab refreshFin={refreshFin} />;
      case 'cashflow':    return <CashFlowTab />;
      case 'income':      return <IncomeTab      {...props} />;
      case 'spending':    return <SpendingTab    {...props} />;
      case 'categories':  return <CategoriesTab  {...props} />;
      case 'trends':      return <TrendsTab />;
      case 'networth':    return <NetWorthTab />;
      case 'accounts':    return <AccountsTab onSync={manualSync} syncing={syncing} />;
      case 'recurring':   return <RecurringTab />;
      case 'chat':        return <ChatTab />;
      case 'settings':    return <SettingsTab refreshFin={refreshFin} />;
      case 'feedback':    return <FeedbackTab />;
      default:            return <OverviewTab    {...props} />;
    }
  };

  return (
    <div className={`app density-${t.density} ${t.monoNumbers ? 'mono' : ''}`} style={cssVars}>
      {syncProgress && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--surface)', borderRadius: 20,
            border: '1px solid var(--line)', padding: '36px 40px',
            minWidth: 320, textAlign: 'center', boxShadow: '0 24px 64px rgba(0,0,0,0.3)',
          }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>
              {syncProgress.error ? '⚠️' : '🔄'}
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>
              {syncProgress.error ? 'Sync failed' : 'Syncing your accounts'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
              {syncProgress.step}
            </div>
            <div style={{ height: 6, background: 'var(--line)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 3,
                width: `${syncProgress.pct}%`,
                background: syncProgress.error ? 'var(--terra)' : 'var(--accent)',
                transition: 'width 0.4s ease',
              }} />
            </div>
            {!syncProgress.error && (
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>
                Don't close the app — this takes a few seconds
              </div>
            )}
          </div>
        </div>
      )}
      <Sidebar active={tab} onChange={setTab} layout={t.sidebarLayout} />
      <main className="main">
        <TopBar tab={tab} monthKey={monthKey} setMonthKey={setMonthKey}
                search={search} setSearch={setSearch}
                syncState={syncState} syncing={syncing} syncProgress={syncProgress}
                manualSync={manualSync} />
        <div className={`page${tab ? ` tab-${tab}` : ''}`}>
          {/* key=tab resets the boundary whenever the user switches tabs */}
          <ErrorBoundary key={tab}>
            {renderTab()}
          </ErrorBoundary>
        </div>
      </main>

      {/* Bottom nav only visible on mobile via CSS */}
      <BottomNav active={tab} onChange={setTab} />

      <TweaksPanel title="Tweaks">
        <TweakSection label="Theme">
          <TweakRadio label="Accent" value={t.accent}
            options={[
              { label: 'Emerald', value: 'emerald' },
              { label: 'Violet',  value: 'violet'  },
              { label: 'Amber',   value: 'amber'   },
              { label: 'Cyan',    value: 'cyan'     },
            ]}
            onChange={(v) => setTweak('accent', v)} />
        </TweakSection>
        <TweakSection label="Layout">
          <TweakRadio label="Density" value={t.density}
            options={[
              { label: 'Compact', value: 'compact' },
              { label: 'Regular', value: 'regular' },
              { label: 'Comfy',   value: 'comfy'   },
            ]}
            onChange={(v) => setTweak('density', v)} />
          <TweakRadio label="Sidebar" value={t.sidebarLayout}
            options={[{ label: 'Icons', value: 'icons' }, { label: 'Labeled', value: 'labeled' }]}
            onChange={(v) => setTweak('sidebarLayout', v)} />
          <TweakToggle label="Mono numbers" value={t.monoNumbers}
            onChange={(v) => setTweak('monoNumbers', v)} />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
})();
