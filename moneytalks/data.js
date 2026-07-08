// data.js — Real data layer for MoneyTalks.
// Fetches live transaction data from the FastAPI backend (/api/fin),
// populates window.FIN with the same interface as the original mock data.js,
// then dynamically loads and transpiles tabs.jsx + app.jsx so they see real data.

// ── Helper functions (same interface as original data.js) ──────────────────

function txnsForMonth(monthKey) {
  return (window.FIN.TRANSACTIONS || []).filter((t) => t.date.startsWith(monthKey));
}

function sumByCategory(txns) {
  const EXCLUDE = new Set(['income', 'transfer', 'refund', 'savings']);
  const map = {};
  txns.forEach((t) => {
    if (EXCLUDE.has(t.category)) return;
    // Expenses (negative amount) add to the total; refunds tagged with a
    // spending category (positive amount) subtract — giving net spend per cat.
    if (t.amount < 0) {
      map[t.category] = (map[t.category] || 0) + Math.abs(t.amount);
    } else if (t.amount > 0) {
      map[t.category] = (map[t.category] || 0) - t.amount;
    }
  });
  return Object.entries(map)
    .filter(([, amt]) => amt > 0) // hide categories that net to zero or negative
    .map(([cat, amt]) => ({
      cat,
      amount: amt,
      ...((window.FIN.CATEGORIES || []).find((c) => c.id === cat) || {
        id: cat, name: cat, color: '#94a3b8', icon: '○', group: 'variable',
      }),
    }))
    .sort((a, b) => b.amount - a.amount);
}

function monthSummary(monthKey) {
  const EXCLUDE = new Set(['income', 'transfer', 'refund', 'savings']);
  const txns = txnsForMonth(monthKey);
  const income   = txns.filter((t) => t.category === 'income').reduce((s, t) => s + t.amount, 0);
  // Net expenses: spending minus any refunds tagged with a spending category
  const expenses = Math.max(0, txns
    .filter((t) => !EXCLUDE.has(t.category))
    .reduce((s, t) => t.amount < 0 ? s + Math.abs(t.amount) : s - t.amount, 0));
  const savings  = txns
    .filter((t) => t.category === 'savings')
    .reduce((s, t) => s + Math.abs(t.amount), 0);
  return { income, expenses, savings, net: income - expenses };
}

function fmt(amount, opts = {}) {
  const { sign = false, decimals = 2, abbr = false } = opts;
  const abs = Math.abs(amount);
  let str;
  if (abbr && abs >= 1000) {
    str = abs >= 1e6 ? (abs / 1e6).toFixed(1) + 'M' : (abs / 1000).toFixed(1) + 'k';
  } else {
    str = abs.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  const prefix = sign ? (amount >= 0 ? '+' : '−') : amount < 0 ? '−' : '';
  return prefix + '$' + str;
}

function catById(id) {
  return (window.FIN.CATEGORIES || []).find((c) => c.id === id) || {
    id, name: id, color: '#94a3b8', icon: '○', group: 'variable',
  };
}
function acctById(id) {
  return (window.FIN.ACCOUNTS || []).find((a) => a.id === id) || { id, name: id, color: '#94a3b8' };
}

// ── Authenticated API fetch — redirects to /login on 401 ───────────────────
window.apiFetch = async function apiFetch(url, options) {
  const r = await fetch(url, options);
  if (r.status === 401) { window.location.href = '/login'; return null; }
  // Handle session-expired redirects: server sends 307 → browser follows → HTML page with 200
  if (r.redirected && r.url.includes('/login')) { window.location.href = '/login'; return null; }
  return r;
};

// ── Dynamic script loader ─────────────────────────────────────────────────

// Injects a <script src> tag instead of eval()ing fetched text.
// Benefits: CSP-compatible, real source URLs in browser devtools, no eval.
function loadJSX(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src   = url;
    script.onload  = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${url}`));
    document.head.appendChild(script);
  });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────

async function bootstrap() {
  // Show loading screen
  const _loadingQuips = [
    "Hiding your Uber Eats receipts from yourself…",
    "Confirming you are, in fact, not rich yet…",
    "Calculating exactly how many lattes stand between you and a house…",
    "Asking Plaid why it takes this long…",
    "Rounding up your Costco trips to 'groceries'…",
    "Discovering new and exciting ways you spent $47…",
    "Tallying up the 'treat yourself' tax…",
    "Your accountant would not approve of this…",
    "Locating the 47 transactions labeled 'misc'…",
    "Filing your dining spend under 'investment in happiness'…",
    "Notifying your future self…",
    "Reminding you that Wealthfront is not a personality…",
    "Performing a financial wellness check. Initial results: concerning…",
    "Loading the part where you swore you'd spend less this month…",
    "Calculating your Costco cost-per-visit. It's not good…",
    "Cross-referencing your budget with your actual behaviour. Yikes…",
    "Summoning the ghost of every impulse purchase…",
    "Gently suggesting you maybe cook at home once…",
    "Counting how many times 'just this once' appeared this month…",
    "Building a case for why dining out is technically self-care…",
    "Estimating time until financial freedom. Recalculating…",
    "Consulting the oracle of past transactions. It is not pleased…",
    "Aggregating your vibes into actionable insights…",
    "Detecting suspicious activity: 4 Costco trips in one week…",
    "Inflating your net worth by rounding generously…",
    "Measuring the gap between your goals and your DoorDash history…",
    "Preparing the numbers. You may want to sit down…",
    "Running the math on that 'small treat' that was $80…",
    "Compiling evidence that you really do love Costco…",
    "Checking if 'investment' and 'dinner' can be the same thing. Jury's out…",
  ];
  const _shuffle = (arr) => arr.map(v => [Math.random(), v]).sort((a,b) => a[0]-b[0]).map(v => v[1]);
  const _shuffled = _shuffle(_loadingQuips);
  let _qi = 0;
  document.getElementById('root').innerHTML = `
    <style>
      @keyframes _mt_bounce {
        0%,100% { transform: translateY(0); }
        50%      { transform: translateY(-12px); }
      }
      @keyframes _mt_quipfade {
        0%   { opacity: 0; transform: translateY(6px); }
        15%  { opacity: 1; transform: translateY(0); }
        85%  { opacity: 1; transform: translateY(0); }
        100% { opacity: 0; transform: translateY(-6px); }
      }
      ._mt_coin { display:inline-block; font-size:36px; animation: _mt_bounce 1s ease-in-out infinite; }
      ._mt_coin:nth-child(2) { animation-delay:.15s; }
      ._mt_coin:nth-child(3) { animation-delay:.30s; }
    </style>
    <div style="
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      height:100vh;gap:20px;font-family:Inter,sans-serif;background:#f6f5f2;
    ">
      <div style="display:flex;gap:8px;">
        <span class="_mt_coin">💰</span>
        <span class="_mt_coin">📈</span>
        <span class="_mt_coin">💸</span>
      </div>
      <div style="text-align:center;">
        <div style="font-size:18px;font-weight:700;color:#14181f;margin-bottom:6px;">MoneyTalks</div>
        <div id="_mt_quip_el" style="font-size:14px;color:#7a8090;font-weight:500;min-height:1.4em;"></div>
      </div>
    </div>
  `;
  function _showNextQuip() {
    const el = document.getElementById('_mt_quip_el');
    if (!el) return;
    el.style.animation = 'none';
    el.textContent = _shuffled[_qi % _shuffled.length];
    el.style.animation = 'none';
    void el.offsetWidth; // force reflow
    el.style.animation = `_mt_quipfade ${_QUIP_INTERVAL}ms ease both`;
    _qi++;
  }
  const _QUIP_INTERVAL = 5000 + Math.random() * 2000;
  _showNextQuip();
  const _quipTimer = setInterval(_showNextQuip, _QUIP_INTERVAL);

  let data;
  try {
    const res = await fetch('/api/fin');
    if (res.status === 401) { window.location.href = '/login'; return; }
    data = await res.json();
    clearInterval(_quipTimer);
  } catch (e) {
    document.getElementById('root').innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
        height:100vh;gap:12px;font-family:Inter,sans-serif;background:#f6f5f2;">
        <div style="font-size:40px;">⚠️</div>
        <h2 style="color:#14181f;margin:0;">Could not connect to server</h2>
        <p style="color:#7a8090;margin:0;">Make sure <code>python3 server.py</code> is running.</p>
      </div>
    `;
    return;
  }

  // Populate window.FIN — use empty arrays when there's no data yet so the
  // full app loads and the user can reach Settings to upload or connect Plaid.
  window.FIN = {
    ACCOUNTS:          data.ACCOUNTS          || [],
    CATEGORIES:        data.CATEGORIES        || [],
    MONTHS:            data.MONTHS            || [{ key: '', label: 'No data', short: '—' }],
    TRANSACTIONS:      data.TRANSACTIONS      || [],
    RECURRING:         data.RECURRING         || [],
    NET_WORTH_HISTORY: data.NET_WORTH_HISTORY || [],
    txnsForMonth,
    sumByCategory,
    monthSummary,
    fmt,
    catById,
    acctById,
  };

  // Load React components now that FIN is ready
  const files = [
    'tweaks-panel.jsx',
    'charts.jsx',
    'tabs-modals.jsx',
    'tabs-shared.jsx',
    'tabs-overview.jsx',
    'tabs-overview-widgets.jsx',
    'tabs-transactions.jsx',
    'tabs-spending.jsx',
    'tabs-wealth.jsx',
    'tabs-chat.jsx',
    'tabs-settings.jsx',
    'tabs-review.jsx',
    'tabs-flagged.jsx',
    'tabs-admin.jsx',
    'tabs-investments.jsx',
    'tabs-trips.jsx',
    'tabs-shared-space.jsx',
    'app.jsx',
  ];
  for (const file of files) {
    try {
      await loadJSX(file);
    } catch (e) {
      document.getElementById('root').innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
          height:100vh;gap:12px;font-family:Inter,sans-serif;background:#f6f5f2;padding:20px;box-sizing:border-box;">
          <div style="font-size:32px;">⚠️</div>
          <h2 style="color:#14181f;margin:0;">Failed to load ${file}</h2>
          <pre style="color:#ef4444;font-size:12px;background:#fff;padding:16px;border-radius:8px;
            max-width:600px;overflow:auto;white-space:pre-wrap;">${String(e)}</pre>
        </div>
      `;
      return;
    }
  }
}

bootstrap();
