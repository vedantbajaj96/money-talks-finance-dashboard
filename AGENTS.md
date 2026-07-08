# MoneyTalks — Agent Guide

## Frontend file map

Each tab is its own file. Read only the file you need — `tabs.jsx` no longer exists.

| File | Components / Purpose |
|---|---|
| `moneytalks/tabs-modals.jsx` | `SplitModal`, `EditTransactionModal`, `AddTransactionModal`, `DateEditor`, `BarCol`, `MerchantDrawer`, `MapPopover` |
| `moneytalks/tabs-shared.jsx` | `SummaryCard`, `TxnList`, `CategoryPicker`, `SearchableSelect` — global setup (React hooks, FIN globals) |
| `moneytalks/tabs-overview.jsx` | `MonthlyTab`, `MonthVibeBanner`, `useCountUp` |
| `moneytalks/tabs-overview-widgets.jsx` | `OverviewTab`, `DragCard`, `OVERVIEW_WIDGETS` |
| `moneytalks/tabs-transactions.jsx` | `TransactionsTab`, `BudgetBars`, `WeeklySpendChart` |
| `moneytalks/tabs-spending.jsx` | `SpendingTab`, `IncomeTab`, `FlowTab`, `CashFlowTab` |
| `moneytalks/tabs-wealth.jsx` | `NetWorthTab`, `AccountList`, `AccountsTab`, `RecurringTab`, `CategoriesTab`, `TrendsTab`, `SideBySideBars` |
| `moneytalks/tabs-chat.jsx` | `ChatTab` |
| `moneytalks/tabs-settings.jsx` | `SettingsTab`, `PlaidSyncCard`, `SettingsCard`, `SettingsLabel`, `StatusDot`, `CategoriesManagerCard`, `NotificationsCard` |
| `moneytalks/tabs-review.jsx` | `ReviewTab`, `AllDoneCelebration` |
| `moneytalks/tabs-flagged.jsx` | `FlaggedTab`, `FeedbackTab` |
| `moneytalks/tabs-admin.jsx` | `AdminTab`, `PerformancePanel` |
| `moneytalks/tabs-investments.jsx` | `InvestmentsTab`, `AllocationDonut` |
| `moneytalks/tabs-trips.jsx` | `TripsTab` |
| `moneytalks/tabs-shared-space.jsx` | `SharedTab`, `SharedMerchantDrawer`, `SharedVibeBanner`, `SpaceCard`, `Portal`, `sharedCatById` |
| `moneytalks/app.jsx` | `App`, `Sidebar`, `TopBar`, `BottomNav`, routing |
| `moneytalks/charts.jsx` | Reusable chart components |

## CSS file map

Split by concern — read only the file relevant to your change.

| File | What's in it | Lines |
|---|---|---|
| `moneytalks/styles-base.css` | CSS variables (`:root`), color palette, typography, spacing tokens | 60 |
| `moneytalks/styles-nav.css` | App layout, Sidebar, Topbar, Avatar | 268 |
| `moneytalks/styles-layout.css` | Tab body, card accents, Cards, Grids, Summary cards | 117 |
| `moneytalks/styles-components.css` | TxnList, Donut, Charts, Bar list, Filter bar, CategoryPicker, Accounts, Recurring, Categories, Trends table, Profile panel | 714 |
| `moneytalks/styles-mobile.css` | Bottom nav, mobile (≤640px), tablet (641–1024px) responsive overrides | 102 |
| `moneytalks/styles-tabs.css` | Review tab flow, filter buttons, loading spinner, skeleton shimmer, tab fade-in, month picker, FlowTab toggle, toast | 423 |
| `moneytalks/styles-dark.css` | All `.app.dark` overrides | 268 |

## Backend file map

| File | Routes / Purpose |
|---|---|
| `routes/data_routes.py` | `/api/fin`, `/api/transactions/*`, `/api/search`, `/api/notifications/*` |
| `routes/shared_routes.py` | `/api/shared/*` (shared spaces) |
| `routes/trips_routes.py` | `/api/trips/*` |
| `routes/plaid_routes.py` | `/api/plaid/*` |
| `routes/portfolio_routes.py` | `/api/portfolio/*` |
| `routes/auth_routes.py` | `/api/auth/*`, `/api/users` |
| `routes/categories_routes.py` | `/api/categories/*` |
| `routes/chat_routes.py` | `/api/chat/*` |
| `routes/upload_routes.py` | `/api/upload/*` |
| `routes/admin_routes.py` | `/api/admin/*` |
| `core/store.py` | Transaction read/write (Parquet via DuckDB) |
| `core/plaid_client.py` | Plaid sync logic |
| `core/fin_data.py` | `/api/fin` aggregation |
| `core/categories.py` | Category definitions and helpers |
| `core/search.py` | Semantic transaction search |

## Build system

- JSX files are compiled by Babel on first request → cached as `*.js.compiled`
- Load order in `data.js` matters: `tabs-shared.jsx` must load before any file that uses its components
- No bundler, no npm build step — edit `.jsx` directly, reload browser
- To add a new JSX file: add to `JSX_FILES` in `server.py` AND to the `files` array in `moneytalks/data.js`

## Editing guidelines

- **Specific tab**: read only that tab's file (e.g. `tabs-shared-space.jsx` for the Shared tab)
- **Shared UI primitives** (TxnList, modals, CategoryPicker): `tabs-shared.jsx`
- **CSS**: `styles.css` — grep for the selector before reading the whole file
- **API + frontend change**: edit `routes/*.py` + the relevant `tabs-*.jsx` together
- **Do not read `tabs.jsx`** — it no longer exists
