// App shell — ported from moneytalks/app.jsx in Phase 5.
// Stub for Phases 1-4 so the build compiles.

import { TRANSACTIONS } from '@/lib/fin';

export default function App() {
  return (
    <div style={{ padding: 32, fontFamily: 'sans-serif' }}>
      <h1>MoneyTalks — Phase 1 ✓</h1>
      <p style={{ color: '#7a8090', marginTop: 8 }}>
        Data loaded: {TRANSACTIONS.length} transactions
      </p>
    </div>
  );
}
