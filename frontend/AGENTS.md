# MoneyTalks Frontend — Agent Guide

## Stack
React 18 + TypeScript + Vite 6. No Redux, no router library — tab switching is manual state in `App.tsx`.

## Path alias
`@/` maps to `src/`. Use it everywhere: `import { apiFetch } from '@/lib/api'`

## File map — read only what you need

### Data layer (read these first for any data-related task)
| File | What's in it |
|---|---|
| `src/lib/fin.ts` | Exported data singleton: `TRANSACTIONS`, `CATEGORIES`, `ACCOUNTS`, etc. Populated once at boot from `/api/fin`. |
| `src/lib/api.ts` | `apiFetch(url, opts)` — authenticated fetch; redirects to `/login` on 401. |
| `src/lib/helpers.ts` | `fmt`, `fmtMoney`, `fmtMoney2`, `fmtAbbr`, `catById`, `acctById`, `txnsForMonth`, `sumByCategory`, `monthSummary` |
| `src/types.ts` | TypeScript interfaces for `Transaction`, `Category`, `Account`, `FinData`, etc. |

### Shared UI components (read for layout/UI bugs or shared component changes)
| File | Components |
|---|---|
| `src/components/SummaryCard.tsx` | `SummaryCard` — animated number card used on overview screens |
| `src/components/TxnList.tsx` | `TxnList` — the transaction row list used in Transactions, Monthly, etc. |
| `src/components/CategoryPicker.tsx` | `CategoryPicker` — portalled dropdown for recategorising transactions |
| `src/components/SearchableSelect.tsx` | `SearchableSelect` — filterable select used in filter bars |
| `src/components/charts/` | `DonutChart`, `AreaChart`, `Sparkline`, `BarList`, `StackedBarChart` |
| `src/components/modals/` | `SplitModal`, `EditTransactionModal`, `AddTransactionModal`, `MerchantDrawer`, `MapPopover` |

### Tabs (read only the one file relevant to your task)
| File | Tab |
|---|---|
| `src/tabs/Overview.tsx` | MonthlyTab, MonthVibeBanner |
| `src/tabs/OverviewWidgets.tsx` | OverviewTab, DragCard, OVERVIEW_WIDGETS |
| `src/tabs/Transactions.tsx` | TransactionsTab, BudgetBars, WeeklySpendChart |
| `src/tabs/Spending.tsx` | SpendingTab, IncomeTab, FlowTab, CashFlowTab |
| `src/tabs/Wealth.tsx` | NetWorthTab, AccountList, AccountsTab, RecurringTab |
| `src/tabs/Categories.tsx` | CategoriesTab |
| `src/tabs/Trends.tsx` | TrendsTab, SideBySideBars |
| `src/tabs/Chat.tsx` | ChatTab |
| `src/tabs/Settings.tsx` | SettingsTab, PlaidSyncCard, CategoriesManagerCard, NotificationsCard |
| `src/tabs/Review.tsx` | ReviewTab, AllDoneCelebration |
| `src/tabs/Flagged.tsx` | FlaggedTab, FeedbackTab |
| `src/tabs/Admin.tsx` | AdminTab, PerformancePanel |
| `src/tabs/Investments.tsx` | InvestmentsTab, AllocationDonut |
| `src/tabs/Trips.tsx` | TripsTab |
| `src/tabs/Shared.tsx` | SharedTab, SharedMerchantDrawer, SharedVibeBanner, SpaceCard |

### App shell
| File | What's in it |
|---|---|
| `src/App.tsx` | `App`, `Sidebar`, `TopBar`, `BottomNav` — tab routing lives here |
| `src/main.tsx` | Boot: fetch `/api/fin` → populate `fin.ts` singleton → render `<App/>` |

## CSS
CSS files live in `src/styles/` and are imported in `src/main.tsx`. Same class names as before — no CSS modules. See `src/styles/STYLES.md` for file map.

## Key patterns

### Accessing data in a component
```tsx
import { TRANSACTIONS, CATEGORIES } from '@/lib/fin';
import { fmtMoney, catById } from '@/lib/helpers';
// Use directly — no hook needed, populated before any component renders
```

### API calls
```tsx
import { apiFetch } from '@/lib/api';
const res = await apiFetch('/api/transactions/123', { method: 'PATCH', ... });
```

### Lazy-loaded tabs (done in App.tsx — do not change)
```tsx
const Transactions = lazy(() => import('@/tabs/Transactions'));
```
Each tab is a separate chunk — only loads when first visited.

### Portals (for dropdowns and drawers that must escape overflow/z-index)
```tsx
import { createPortal } from 'react-dom';
// Render into document.body so position:fixed always works
{open && createPortal(<Menu />, document.body)}
```

## Backend
- FastAPI on port 8502 (dev) / same port (prod)
- All routes are `/api/*` — proxied by Vite in dev
- Auth: cookie session; `apiFetch` handles 401 automatically
- Backend files: `server.py`, `routes/`, `core/` — unchanged by this migration

## Dev workflow
```bash
# Terminal 1 — backend
cd /Users/vedantbajaj/finance_dashboard
.venv/bin/python server.py

# Terminal 2 — frontend
cd /Users/vedantbajaj/finance_dashboard/frontend
npm run dev
# → http://localhost:5173 (proxies /api to :8502)
```

## Production build
```bash
cd frontend && npm run build
# Output: frontend/dist/
# server.py serves dist/ for non-api routes
```
