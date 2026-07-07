function TransactionsTab({ monthKey, txnOverrides, setTxnOverrides, search: globalSearch = '', setSearch: setGlobalSearch, refreshFin, finVersion }) {
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState(globalSearch);
  const [catFilter, setCatFilter] = useState(() => {
    try { return sessionStorage.getItem('txns.catFilter') || 'all'; } catch { return 'all'; }
  });
  const [acctFilter, setAcctFilter] = useState(() => {
    try { return sessionStorage.getItem('txns.acctFilter') || 'all'; } catch { return 'all'; }
  });
  const [showFlagged, setShowFlagged] = useState(() => {
    try { return sessionStorage.getItem('txns.showFlagged') === 'true'; } catch { return false; }
  });

  // Persist filter state within session
  useEffect(() => { try { sessionStorage.setItem('txns.catFilter', catFilter); } catch {} }, [catFilter]);
  useEffect(() => { try { sessionStorage.setItem('txns.acctFilter', acctFilter); } catch {} }, [acctFilter]);
  useEffect(() => { try { sessionStorage.setItem('txns.showFlagged', String(showFlagged)); } catch {} }, [showFlagged]);

  // Semantic search state
  const [semMerchants, setSemMerchants] = useState(null); // null = not yet searched
  const [semLoading, setSemLoading]     = useState(false);
  const [isSemantic, setIsSemantic]     = useState(false);
  const semDebounce = React.useRef(null);

  // Keep in sync when the TopBar search changes
  React.useEffect(() => { setSearch(globalSearch); }, [globalSearch]);

  // Trigger semantic search with debounce
  React.useEffect(() => {
    clearTimeout(semDebounce.current);
    if (!search.trim()) {
      setSemMerchants(null);
      setIsSemantic(false);
      setSemLoading(false);
      return;
    }
    setSemLoading(true);
    semDebounce.current = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/transactions/search?q=${encodeURIComponent(search)}`);
        const data = await res.json();
        if (data.semantic && (data.matches || data.merchants)) {
          // New format: matches = [{merchant, category}] keyed as "merchant||category"
          // Legacy fallback: plain merchants list
          if (data.matches) {
            setSemMerchants(new Map(data.matches.map(m => [
              `${m.merchant}||${m.category}`,
              data.scores?.[`${m.merchant}||${m.category}`] ?? 0,
            ])));
          } else {
            setSemMerchants(new Map(data.merchants.map(m => [m, data.scores?.[m] ?? 0])));
          }
          setIsSemantic(true);
        } else {
          setSemMerchants(null);
          setIsSemantic(false);
        }
      } catch(e) {
        setSemMerchants(null);
        setIsSemantic(false);
      }
      setSemLoading(false);
    }, 350);
  }, [search]);

  // When a search term is active, search across ALL months not just the current one
  const isGlobalSearch = search.trim().length > 0;
  const baseTxns = (isGlobalSearch ? TRANSACTIONS : txnsForMonth(monthKey)).map((t) =>
    txnOverrides[t.id] ? { ...t, category: txnOverrides[t.id] } : t,
  );

  const filtered = baseTxns.filter((t) => {
    if (catFilter !== 'all' && t.category !== catFilter) return false;
    if (acctFilter !== 'all' && t.account !== acctFilter) return false;
    if (showFlagged && !t.flagged) return false;
    if (search) {
      if (semMerchants) {
        // Semantic results: match on merchant+category pair, or merchant alone (legacy),
        // with substring fallback for notes/tags
        const semKey = `${t.merchant}||${t.category}`;
        const legacyKey = t.merchant;
        if (!semMerchants.has(semKey) && !semMerchants.has(legacyKey)) {
          const q = search.toLowerCase();
          const substringHit = t.merchant.toLowerCase().includes(q) ||
                               (t.notes || '').toLowerCase().includes(q) ||
                               (t.tags  || '').toLowerCase().includes(q);
          if (!substringHit) return false;
        }
      } else {
        // Still loading or semantic unavailable: substring fallback
        const q = search.toLowerCase();
        const hit = t.merchant.toLowerCase().includes(q) ||
                    (t.notes || '').toLowerCase().includes(q) ||
                    (t.tags  || '').toLowerCase().includes(q) ||
                    t.date.includes(q);
        if (!hit) return false;
      }
    }
    return true;
  }).sort((a, b) => {
    if (search) {
      const q = search.toLowerCase();
      const exactA = a.merchant?.toLowerCase().includes(q) || (a.notes || '').toLowerCase().includes(q);
      const exactB = b.merchant?.toLowerCase().includes(q) || (b.notes || '').toLowerCase().includes(q);
      if (exactA !== exactB) return exactA ? -1 : 1;
    }
    return b.date > a.date ? 1 : -1;
  });

  const nonTransfer = filtered.filter((t) => t.category !== 'transfer');
  const totalIn  = nonTransfer.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const totalOut = nonTransfer.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

  const [autoMsg, setAutoMsg] = React.useState(null);

  const recat = async (id, cat) => {
    // Optimistic update
    setTxnOverrides(prev => ({ ...prev, [id]: cat }));
    try {
      const res = await fetch(`/api/transactions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: cat }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.auto_applied > 0) {
          setAutoMsg(`Also updated ${data.auto_applied} similar transaction${data.auto_applied > 1 ? 's' : ''}`);
        }
        // Small delay ensures the parquet write has flushed before we re-fetch
        setTimeout(() => { if (refreshFin) refreshFin(); }, 300);
      }
    } catch(e) { /* optimistic, ignore */ }
  };

  return (
    <div className="tab-body">
      <div className="card">
        {isGlobalSearch && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 16px', background: 'var(--accent-bg, #f0fdf4)',
            borderBottom: '1px solid var(--line)', fontSize: 12, color: 'var(--accent)',
            fontWeight: 500,
          }}>
            {semLoading
              ? <span style={{ animation: 'spin 0.7s linear infinite', display: 'inline-block' }}>◌</span>
              : <span>⌕</span>
            }
            <span>
              {semLoading ? 'Semantic search…' : (
                isSemantic
                  ? `Semantic · all months · ${filtered.length} result${filtered.length !== 1 ? 's' : ''}`
                  : `All months · ${filtered.length} result${filtered.length !== 1 ? 's' : ''}`
              )}
            </span>
            {isSemantic && !semLoading && (
              <span style={{ fontSize: 10, background: 'var(--accent)', color: '#fff',
                padding: '1px 6px', borderRadius: 8, fontWeight: 600 }}>AI</span>
            )}
            <button onClick={() => { setSearch(''); setGlobalSearch(''); setSemMerchants(null); setIsSemantic(false); }}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--muted)', fontSize: 11, padding: '2px 6px', borderRadius: 4 }}>
              Clear ×
            </button>
          </div>
        )}
        <div className="filter-bar">
          <div className="search-input">
            <span className="search-icon">⌕</span>
            <input
              placeholder="Search all months…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setGlobalSearch(e.target.value); }}
            />
          </div>
          <SearchableSelect
            value={catFilter}
            onChange={setCatFilter}
            placeholder="All categories"
            options={[
              { value: 'all', label: 'All categories' },
              ..._liveCategories.map(c => ({ value: c.id, label: c.name, dot: c.color })),
            ]}
          />
          <SearchableSelect
            value={acctFilter}
            onChange={setAcctFilter}
            placeholder="All accounts"
            options={[
              { value: 'all', label: 'All accounts' },
              ...ACCOUNTS.map(a => ({ value: a.id, label: a.name, dot: a.color })),
            ]}
          />
          <button
            onClick={() => setShowFlagged(f => !f)}
            title={showFlagged ? 'Show all transactions' : 'Show flagged only'}
            className={`filter-btn ${showFlagged ? 'active' : ''}`}
            style={showFlagged ? { borderColor: '#f97316', background: 'rgba(249,115,22,0.08)', color: '#c2410c' } : {}}
          >⚑ Flagged</button>
          <div className="filter-stats">
            <span><b>{filtered.length}</b> txns</span>
            <span className="pos">+{fmtMoney(totalIn)}</span>
            <span className="neg">−{fmtMoney(totalOut)}</span>
          </div>
          <button onClick={() => setShowAdd(true)} style={{
            padding: '6px 14px', borderRadius: 8, border: '1px solid var(--accent)',
            background: 'none', color: 'var(--accent)', cursor: 'pointer',
            fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
          }}>+ Add</button>
        </div>
        <TxnList
          key={isSemantic ? 'sem' : 'default'}
          txns={isSemantic && semMerchants
            ? [...filtered].sort((a, b) => {
                const scoreA = semMerchants.get(`${a.merchant}||${a.category}`) ?? semMerchants.get(a.merchant) ?? 0;
                const scoreB = semMerchants.get(`${b.merchant}||${b.category}`) ?? semMerchants.get(b.merchant) ?? 0;
                return scoreB - scoreA;
              })
            : filtered}
          presorted={isSemantic}
          onRecategorize={recat}
          refreshFin={refreshFin}
        />
        {filtered.length === 0 && <div className="empty">No transactions match your filters.</div>}
      </div>
      {showAdd && <AddTransactionModal onClose={() => setShowAdd(false)} refreshFin={refreshFin} />}
      {autoMsg && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--surface)', border: '1px solid var(--accent)',
          borderRadius: 12, padding: '10px 20px', fontSize: 13, fontWeight: 500,
          color: 'var(--ink)', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', zIndex: 9999,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ color: 'var(--accent)' }}>✓</span> {autoMsg}
        </div>
      )}
    </div>
  );
}

// ─── Budget Bars ──────────────────────────────────────────────────
// Shows spending vs budget for each category with inline editing.
