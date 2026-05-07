// Main App component for MoneyTalks — wired to real data via /api/fin.
(function () {
const { useState } = React;
const { MONTHS } = window.FIN;
const {
  OverviewTab, TransactionsTab, SpendingTab, IncomeTab, CashFlowTab,
  NetWorthTab, AccountsTab, RecurringTab, CategoriesTab, TrendsTab, ChatTab, SettingsTab,
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
function TopBar({ tab, monthKey, setMonthKey, search, setSearch }) {
  const idx = MONTHS.findIndex((m) => m.key === monthKey);
  const showMonth = ['overview', 'txns', 'income', 'spending', 'categories'].includes(tab);
  const tabName = TABS.find((t) => t.id === tab)?.name || '';
  return (
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
        <div className="topbar-search">
          <Icon name="search" size={14} />
          <input placeholder="Search transactions, merchants..." value={search}
            onChange={(e) => setSearch(e.target.value)} />
          <kbd>⌘K</kbd>
        </div>
        <button className="icon-btn" title="Notifications">
          <Icon name="bell" size={18} />
        </button>
        <div className="user-chip">
          <div className="avatar">ME</div>
        </div>
      </div>
    </header>
  );
}

// ─── App ──────────────────────────────────────────────────────────
function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [tab, setTab]           = useState('overview');
  // Default to most recent month in real data
  const [monthKey, setMonthKey] = useState(MONTHS[MONTHS.length - 1]?.key || '');
  const [search, setSearch]     = useState('');
  const [txnOverrides, setTxnOverrides] = useState({});

  const accent  = ACCENT_PRESETS[t.accent] || ACCENT_PRESETS.emerald;
  const cssVars = {
    '--accent':  accent.accent,
    '--accent2': accent.accent2,
    '--terra':   accent.terra,
    '--green':   '#5ec98a',
  };

  const renderTab = () => {
    const props = { monthKey, txnOverrides, setTxnOverrides, search, setSearch };
    switch (tab) {
      case 'overview':    return <OverviewTab    {...props} />;
      case 'txns':        return <TransactionsTab {...props} />;
      case 'cashflow':    return <CashFlowTab />;
      case 'income':      return <IncomeTab      {...props} />;
      case 'spending':    return <SpendingTab    {...props} />;
      case 'categories':  return <CategoriesTab  {...props} />;
      case 'trends':      return <TrendsTab />;
      case 'networth':    return <NetWorthTab />;
      case 'accounts':    return <AccountsTab />;
      case 'recurring':   return <RecurringTab />;
      case 'chat':        return <ChatTab />;
      case 'settings':    return <SettingsTab />;
      default:            return <OverviewTab    {...props} />;
    }
  };

  return (
    <div className={`app density-${t.density} ${t.monoNumbers ? 'mono' : ''}`} style={cssVars}>
      <Sidebar active={tab} onChange={setTab} layout={t.sidebarLayout} />
      <main className="main">
        <TopBar tab={tab} monthKey={monthKey} setMonthKey={setMonthKey}
                search={search} setSearch={setSearch} />
        <div className="page">
          {renderTab()}
        </div>
      </main>

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
