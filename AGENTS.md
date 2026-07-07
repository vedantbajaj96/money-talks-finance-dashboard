# MoneyTalks — Agent Guide

## Frontend file map

Each tab is its own file. Read only the file you need — never load tabs.jsx (deleted).

| File | Components |
|---|---|
| `moneytalks/tabs-shared.jsx` | `SummaryCard`, `TxnList`, `CategoryPicker`, `SearchableSelect`, `SplitModal`, `EditTransactionModal`, `AddTransactionModal`, `DateEditor`, `MerchantDrawer`, `MapPopover`, `BarCol` — shared primitives used across tabs |
| `moneytalks/tabs-overview.jsx` | `MonthlyTab`, `MonthVibeBanner`, `useCountUp` |
| `moneytalks/tabs-overview-widgets.jsx` | `OverviewTab`, `DragCard`, `OVERVIEW_WIDGETS` |
| `moneytalks/tabs-transactions.jsx` | `TransactionsTab`, `BudgetBars`, `WeeklySpendChart` |
| `moneytalks/tabs-analysis.jsx` | `SpendingTab`, `IncomeTab`, `FlowTab`, `CashFlowTab`, `NetWorthTab`, `AccountList`, `AccountsTab`, `RecurringTab`, `CategoriesTab`, `TrendsTab`, `SideBySideBars` |
| `moneytalks/tabs-chat.jsx` | `ChatTab` |
| `moneytalks/tabs-settings.jsx` | `SettingsTab`, `PlaidSyncCard`, `SettingsCard`, `SettingsLabel`, `StatusDot`, `CategoriesManagerCard`, `NotificationsCard` |
| `moneytalks/tabs-review.jsx` | `ReviewTab`, `FlaggedTab`, `FeedbackTab`, `AllDoneCelebration` |
| `moneytalks/tabs-admin.jsx` | `AdminTab`, `PerformancePanel` |
| `moneytalks/tabs-investments.jsx` | `InvestmentsTab`, `AllocationDonut` |
| `moneytalks/tabs-trips.jsx` | `TripsTab` |
| `moneytalks/tabs-shared-space.jsx` | `SharedTab`, `SharedMerchantDrawer`, `SharedVibeBanner`, `SpaceCard`, `Portal`, `sharedCatById` |
| `moneytalks/app.jsx` | `App`, `Sidebar`, `TopBar`, `BottomNav`, routing |
| `moneytalks/charts.jsx` | Reusable chart components |
| `moneytalks/styles.css` | All CSS — variables under `:root` at the top |

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
