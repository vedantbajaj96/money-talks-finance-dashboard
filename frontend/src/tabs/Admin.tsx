// Tab component — see frontend/AGENTS.md for context
import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '@/lib/api';
import { fmtMoney } from '@/lib/helpers';

function AdminTab() {
  // ── Shared styles aligned with app design system ───────────────────────────
  const input = {
    width: '100%', padding: '10px 14px', borderRadius: 10, boxSizing: 'border-box',
    border: '1px solid var(--line-2)', fontSize: 14, fontFamily: 'inherit',
    background: 'var(--surface)', color: 'var(--ink)', outline: 'none',
    transition: 'border-color 0.15s',
  };
  // Primary — green accent fill
  const btnPrimary = {
    background: 'var(--accent)', color: '#052015', border: 'none',
    borderRadius: 10, padding: '11px 20px', fontWeight: 600, fontSize: 14,
    fontFamily: 'inherit', cursor: 'pointer', width: '100%', transition: 'opacity 0.15s',
  };
  // Secondary — subtle surface fill with border
  const btnSecondary = {
    background: 'var(--surface-3)', color: 'var(--ink)', border: '1px solid var(--line-2)',
    borderRadius: 10, padding: '10px 20px', fontWeight: 500, fontSize: 14,
    fontFamily: 'inherit', cursor: 'pointer', width: '100%', transition: 'background 0.15s',
  };
  // Danger — terra tint
  const btnDanger = {
    background: 'none', border: '1px solid var(--terra)', color: 'var(--terra)',
    borderRadius: 8, padding: '5px 14px', fontSize: 12, fontWeight: 500,
    fontFamily: 'inherit', cursor: 'pointer', transition: 'background 0.15s',
  };

  const NAV = [
    { key: 'status',   label: 'System Status', icon: '◉' },
    { key: 'deploy',   label: 'Deploy',         icon: '↑' },
    { key: 'tests',    label: 'Tests',           icon: '✓' },
    { key: 'ai',       label: 'AI Provider',    icon: '◆' },
    { key: 'users',    label: 'User Accounts',  icon: '⊕' },
    { key: 'feedback', label: 'Feedback',        icon: '◎' },
    { key: 'logs',     label: 'Server Logs',     icon: '≡' },
  ];
  const [page, setPage] = useState('status');

  const [cfg, setCfg]             = useState(null);
  const [claudeKey, setClaudeKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [provider, setProvider]   = useState('gemini');
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);
  const [users, setUsers]         = useState([]);
  const [newUser, setNewUser]     = useState('');
  const [newPass, setNewPass]     = useState('');
  const [newAdmin, setNewAdmin]   = useState(false);
  const [userMsg, setUserMsg]     = useState('');

  const [healthChecks, setHealthChecks]   = useState([]);
  const [endpointPings, setEndpointPings] = useState([]);
  const [healthLoading, setHealthLoading] = useState(false);

  const [deployJobId, setDeployJobId]     = useState(null);
  const [deployOutput, setDeployOutput]   = useState('');
  const [deployDone, setDeployDone]       = useState(false);
  const [deployOk, setDeployOk]           = useState(false);
  const [deployRunning, setDeployRunning] = useState(false);
  const deployPollRef                     = useRef(null);

  const SUITES = [
    { key: 'unit',        label: 'Unit Tests',        desc: 'Categorization + session store — fast' },
    { key: 'integration', label: 'Integration Tests',  desc: 'Fin data + Plaid client — disk I/O' },
    { key: 'all',         label: 'Run All',            desc: 'All pytest suites' },
    { key: 'search',      label: 'Search Eval',        desc: 'ML model eval — slow (~30s+)' },
  ];
  const [testJobs, setTestJobs] = useState({});
  const testPollRefs            = useRef({});

  const [feedback, setFeedback] = useState([]);
  const [logs, setLogs]         = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);

  useEffect(() => {
    apiFetch('/api/config').then(r => r.json()).then(d => {
      setCfg(d);
      setProvider(d.preferred_provider || 'gemini');
    });
    apiFetch('/api/auth/users').then(r => r.json()).then(d => setUsers(d.users || [])).catch(() => {});
    runHealthChecks();
  }, []);

  useEffect(() => {
    if (page === 'feedback') {
      apiFetch('/api/feedback').then(r => r.json()).then(d => setFeedback(d.entries || [])).catch(() => {});
    }
    if (page === 'logs') {
      setLogsLoading(true);
      apiFetch('/api/admin/logs?lines=300').then(r => r.json()).then(d => {
        setLogs(d.lines || []);
        setLogsLoading(false);
      }).catch(() => setLogsLoading(false));
    }
  }, [page]);

  useEffect(() => {
    if (!deployJobId || deployDone) return;
    deployPollRef.current = setInterval(async () => {
      const d = await fetch(`/api/admin/job/${deployJobId}`).then(r => r.json()).catch(() => null);
      if (!d) return;
      setDeployOutput(d.output || '');
      if (d.done) {
        setDeployDone(true); setDeployOk(d.ok); setDeployRunning(false);
        clearInterval(deployPollRef.current);
      }
    }, 1500);
    return () => clearInterval(deployPollRef.current);
  }, [deployJobId, deployDone]);

  function startTestPoll(suite, jobId) {
    if (testPollRefs.current[suite]) clearInterval(testPollRefs.current[suite]);
    testPollRefs.current[suite] = setInterval(async () => {
      const d = await fetch(`/api/admin/job/${jobId}`).then(r => r.json()).catch(() => null);
      if (!d) return;
      setTestJobs(prev => ({ ...prev, [suite]: { ...prev[suite], output: d.output || '' } }));
      if (d.done) {
        setTestJobs(prev => ({ ...prev, [suite]: { ...prev[suite], done: true, ok: d.ok, running: false } }));
        clearInterval(testPollRefs.current[suite]);
      }
    }, 1500);
  }

  async function runHealthChecks() {
    setHealthLoading(true);
    const hd = await apiFetch('/api/admin/health').then(r => r.json()).catch(() => ({ checks: [] }));
    setHealthChecks(hd.checks || []);
    const endpoints = [
      { name: 'Transactions API', url: '/api/fin?months=1' },
      { name: 'Config API',       url: '/api/config' },
      { name: 'Accounts API',     url: '/api/plaid/accounts' },
      { name: 'Search API',       url: '/api/transactions/search?q=test' },
    ];
    const pings = await Promise.all(endpoints.map(async ({ name, url }) => {
      const t0 = performance.now();
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
        return { name, ok: r.ok, latency: Math.round(performance.now() - t0) };
      } catch {
        return { name, ok: false, latency: null };
      }
    }));
    setEndpointPings(pings);
    setHealthLoading(false);
  }

  async function triggerDeploy() {
    setDeployOutput(''); setDeployDone(false); setDeployOk(false); setDeployRunning(true);
    const d = await apiFetch('/api/admin/deploy', { method: 'POST' }).then(r => r.json());
    setDeployJobId(d.job_id);
  }

  async function triggerTest(suite) {
    setTestJobs(prev => ({ ...prev, [suite]: { jobId: null, output: '', done: false, ok: false, running: true } }));
    const d = await fetch(`/api/admin/test/${suite}`, { method: 'POST' }).then(r => r.json());
    setTestJobs(prev => ({ ...prev, [suite]: { ...prev[suite], jobId: d.job_id } }));
    startTestPoll(suite, d.job_id);
  }

  async function createUser() {
    if (!newUser || !newPass) return;
    const r = await apiFetch('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: newUser, password: newPass, is_admin: newAdmin }),
    });
    const d = await r.json();
    if (d.ok) {
      setUserMsg(`User "${newUser}" created.`);
      setNewUser(''); setNewPass(''); setNewAdmin(false);
      apiFetch('/api/auth/users').then(r => r.json()).then(d => setUsers(d.users || []));
    } else {
      setUserMsg(d.detail || 'Failed to create user.');
    }
    setTimeout(() => setUserMsg(''), 3000);
  }

  async function deleteUser(username) {
    if (!confirm(`Delete user "${username}"?`)) return;
    await fetch(`/api/auth/users/${username}`, { method: 'DELETE' });
    setUsers(u => u.filter(x => x.username !== username));
  }

  // ── Shared UI primitives ───────────────────────────────────────────────────

  const StatusDot = ({ ok }) => (
    <span style={{
      display: 'inline-block', width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
      marginRight: 9,
      background: ok == null ? 'var(--line-2)' : ok ? 'var(--accent)' : 'var(--terra)',
    }} />
  );

  const Pill = ({ ok, text }) => (
    <span style={{
      fontSize: 11, padding: '3px 9px', borderRadius: 999, fontWeight: 600, letterSpacing: '0.04em',
      background: ok
        ? 'color-mix(in srgb, var(--accent) 14%, transparent)'
        : 'color-mix(in srgb, var(--terra) 14%, transparent)',
      color: ok ? 'var(--accent)' : 'var(--terra)',
    }}>{text || (ok ? 'OK' : 'FAIL')}</span>
  );

  const Terminal = ({ output, done, ok }) => (
    <div style={{
      marginTop: 12, borderRadius: 12, overflow: 'hidden',
      border: '1px solid var(--line-2)',
    }}>
      <div style={{
        background: '#1a1a1a', padding: '10px 14px 0',
        display: 'flex', gap: 6, alignItems: 'center',
      }}>
        {['#ff5f57','#febc2e','#28c840'].map(c => (
          <span key={c} style={{ width: 10, height: 10, borderRadius: '50%', background: c, flexShrink: 0 }} />
        ))}
      </div>
      <div style={{
        background: '#1a1a1a', padding: '10px 16px 14px', fontFamily: 'var(--font-mono)', fontSize: 12,
        color: '#d4d4d4', whiteSpace: 'pre-wrap', maxHeight: 280, overflowY: 'auto', lineHeight: 1.65,
      }}>
        {output || '$ …'}
        {done && <div style={{ marginTop: 8, fontWeight: 700, color: ok ? '#4ade80' : '#f87171' }}>
          {ok ? '✓ exited 0' : '✗ exited non-zero'}
        </div>}
      </div>
    </div>
  );

  const Divider = () => (
    <div style={{ borderTop: '1px solid var(--line)', margin: '4px 0' }} />
  );

  const FieldLabel = ({ children }) => (
    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', marginBottom: 6,
      letterSpacing: '0.05em', textTransform: 'uppercase' }}>{children}</div>
  );

  const SectionHeading = ({ children }) => (
    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase',
      letterSpacing: '0.08em', marginBottom: 12 }}>{children}</div>
  );

  // ── Pages ──────────────────────────────────────────────────────────────────

  const pages = {
    status: (
      <div style={{ display: 'grid', gap: 28 }}>
        <div>
          <SectionHeading>API Endpoints</SectionHeading>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
            {endpointPings.length === 0 && healthLoading
              ? <div style={{ padding: '16px 20px', fontSize: 13, color: 'var(--ink-3)' }}>Checking…</div>
              : endpointPings.map(({ name, ok, latency }, i) => (
                <div key={name} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 20px', fontSize: 13,
                  borderTop: i > 0 ? '1px solid var(--line)' : 'none',
                }}>
                  <span style={{ display: 'flex', alignItems: 'center', color: 'var(--ink)' }}>
                    <StatusDot ok={ok} />{name}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {latency != null && <span style={{ color: 'var(--ink-3)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>{latency}ms</span>}
                    <Pill ok={ok} text={ok ? 'UP' : 'DOWN'} />
                  </span>
                </div>
              ))
            }
          </div>
        </div>

        <div>
          <SectionHeading>Subsystems</SectionHeading>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
            {healthChecks.map(({ name, ok, detail }, i) => (
              <div key={name} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 20px', fontSize: 13,
                borderTop: i > 0 ? '1px solid var(--line)' : 'none',
              }}>
                <span style={{ display: 'flex', alignItems: 'center', color: 'var(--ink)' }}>
                  <StatusDot ok={ok} />{name}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {detail && <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>{detail}</span>}
                  <Pill ok={ok} />
                </span>
              </div>
            ))}
          </div>
        </div>

        <button onClick={runHealthChecks} disabled={healthLoading}
          style={{ ...btnSecondary, opacity: healthLoading ? 0.5 : 1 }}>
          {healthLoading ? 'Checking…' : 'Refresh'}
        </button>
      </div>
    ),

    deploy: (
      <div style={{ display: 'grid', gap: 16 }}>
        <div style={{
          background: 'color-mix(in srgb, var(--terra) 8%, var(--surface))',
          border: '1px solid color-mix(in srgb, var(--terra) 25%, transparent)',
          borderRadius: 10, padding: '12px 16px', fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6,
        }}>
          <strong style={{ color: 'var(--terra)' }}>Heads up:</strong> This restarts the container (~10s downtime).
          Runs <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--surface-3)', padding: '1px 5px', borderRadius: 4 }}>git pull && docker compose up -d --build</code>.
        </div>
        <button onClick={triggerDeploy} disabled={deployRunning}
          style={{ ...btnPrimary, opacity: deployRunning ? 0.6 : 1 }}>
          {deployRunning ? 'Deploying…' : deployDone ? (deployOk ? '✓ Deployed — run again' : '✗ Failed — retry') : 'Deploy latest from GitHub'}
        </button>
        {(deployRunning || deployOutput) && <Terminal output={deployOutput} done={deployDone} ok={deployOk} />}
      </div>
    ),

    tests: (
      <div style={{ display: 'grid', gap: 20 }}>
        {SUITES.map(({ key, label, desc }) => {
          const job = testJobs[key] || {};
          const { running, done, ok, output } = job;
          const isPrimary = key === 'all';
          return (
            <div key={key} style={{
              background: 'var(--surface)', border: '1px solid var(--line)',
              borderRadius: 12, padding: '16px 20px', display: 'grid', gap: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{label}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3 }}>{desc}</div>
                </div>
                {done && <Pill ok={ok} text={ok ? 'PASSED' : 'FAILED'} />}
              </div>
              <button onClick={() => triggerTest(key)} disabled={running}
                style={{ ...(isPrimary ? btnPrimary : btnSecondary), opacity: running ? 0.6 : 1 }}>
                {running ? 'Running…' : done ? 'Run again' : `Run ${label}`}
              </button>
              {(running || output) && <Terminal output={output || ''} done={done} ok={ok} />}
            </div>
          );
        })}
      </div>
    ),

    ai: (
      <div style={{ display: 'grid', gap: 18 }}>
        <div>
          <FieldLabel>Preferred provider</FieldLabel>
          <div style={{ display: 'flex', gap: 10 }}>
            {['claude', 'gemini'].map(p => (
              <button key={p} onClick={() => setProvider(p)} style={{
                flex: 1, padding: '10px 0', borderRadius: 10, fontSize: 14, fontFamily: 'inherit',
                cursor: 'pointer', fontWeight: 500, transition: 'all 0.15s',
                border: provider === p ? '2px solid var(--accent)' : '1px solid var(--line-2)',
                background: provider === p ? 'color-mix(in srgb, var(--accent) 10%, var(--surface))' : 'var(--surface)',
                color: provider === p ? 'var(--accent)' : 'var(--ink-2)',
              }}>
                {p === 'claude' ? 'Claude (Anthropic)' : 'Gemini (Google)'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <FieldLabel>
            <StatusDot ok={cfg?.has_gemini} />
            Gemini API key {cfg?.has_gemini ? '(saved)' : '(not set)'}
          </FieldLabel>
          <input type="password" value={geminiKey} onChange={e => setGeminiKey(e.target.value)}
            placeholder="AIza…" style={input} />
        </div>

        <div>
          <FieldLabel>
            <StatusDot ok={cfg?.has_anthropic} />
            Anthropic API key {cfg?.has_anthropic ? '(saved)' : '(not set)'}
          </FieldLabel>
          <input type="password" value={claudeKey} onChange={e => setClaudeKey(e.target.value)}
            placeholder="sk-ant-…" style={input} />
        </div>

        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16, display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Notification Sender (Admin)
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
            The MoneyTalks Gmail account that sends alerts to all users.
          </div>
          <div>
            <FieldLabel>From Email (MoneyTalks Gmail)</FieldLabel>
            <input type="email" value={cfg?.alert_from_email || ''} onChange={e => setCfg(p => ({ ...p, alert_from_email: e.target.value }))}
              placeholder="moneytalks.alerts@gmail.com" style={input} />
          </div>
          <div>
            <FieldLabel>Gmail App Password</FieldLabel>
            <input type="password" placeholder="xxxx xxxx xxxx xxxx"
              onChange={e => setCfg(p => ({ ...p, _new_smtp_pass: e.target.value }))}
              style={input} />
          </div>
        </div>

        <button onClick={async () => {
          setSaving(true); setSaved(false);
          const body = { preferred_provider: provider };
          if (geminiKey) body.gemini_api_key    = geminiKey;
          if (claudeKey) body.anthropic_api_key = claudeKey;
          if (cfg?.alert_from_email) body.alert_from_email = cfg.alert_from_email;
          if (cfg?._new_smtp_pass)   body.alert_smtp_password = cfg._new_smtp_pass;
          await apiFetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          const d = await apiFetch('/api/config').then(r => r.json());
          setCfg(d); setGeminiKey(''); setClaudeKey('');
          setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2500);
        }} disabled={saving}
          style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
        </button>
      </div>
    ),

    users: (
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
          {users.map((u, i) => (
            <div key={u.username} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '13px 20px', fontSize: 14,
              borderTop: i > 0 ? '1px solid var(--line)' : 'none',
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontWeight: 500, color: 'var(--ink)' }}>{u.username}</span>
                {u.is_admin && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.06em',
                    background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                    borderRadius: 999, padding: '2px 8px', textTransform: 'uppercase',
                  }}>Admin</span>
                )}
              </span>
              {!u.is_admin && (
                <button onClick={() => deleteUser(u.username)} style={btnDanger}>Delete</button>
              )}
            </div>
          ))}
        </div>

        <div style={{
          background: 'var(--surface)', border: '1px solid var(--line)',
          borderRadius: 12, padding: '20px', display: 'grid', gap: 14,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Add user</div>
          <div style={{ display: 'grid', gap: 10 }}>
            <input type="text" value={newUser} onChange={e => setNewUser(e.target.value)}
              placeholder="Username" style={input} />
            <input type="password" value={newPass} onChange={e => setNewPass(e.target.value)}
              placeholder="Password" style={input} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, color: 'var(--ink-2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={newAdmin} onChange={e => setNewAdmin(e.target.checked)} />
            Make admin
          </label>
          <button onClick={createUser} style={btnPrimary}>Create user</button>
          {userMsg && <div style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 500 }}>{userMsg}</div>}
        </div>
      </div>
    ),

    feedback: (
      <div style={{ display: 'grid', gap: 12 }}>
        {feedback.length === 0
          ? <div style={{ fontSize: 14, color: 'var(--ink-3)', padding: '20px 0' }}>No feedback yet.</div>
          : [...feedback].reverse().map(entry => (
            <div key={entry.id} style={{
              background: 'var(--surface)', border: '1px solid var(--line)',
              borderRadius: 12, padding: '16px 20px', display: 'grid', gap: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                  {entry.display_name || entry.username}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {entry.category && entry.category !== 'general' && (
                    <span style={{
                      fontSize: 11, padding: '2px 9px', borderRadius: 999, fontWeight: 600,
                      background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                      color: 'var(--accent)',
                    }}>{entry.category}</span>
                  )}
                  <span style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
                    {new Date(entry.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </span>
              </div>
              <div style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6 }}>{entry.message}</div>
            </div>
          ))
        }
      </div>
    ),
    logs: (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <button onClick={() => {
            setLogsLoading(true);
            apiFetch('/api/admin/logs?lines=300').then(r => r.json()).then(d => {
              setLogs(d.lines || []); setLogsLoading(false);
            }).catch(() => setLogsLoading(false));
          }} style={{
            padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            background: 'var(--surface-3)', border: '1px solid var(--line)', color: 'var(--ink)',
          }}>↻ Refresh</button>
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Last 300 lines of server.log</span>
        </div>
        {logsLoading
          ? <div style={{ fontSize: 14, color: 'var(--ink-3)' }}>Loading…</div>
          : <div style={{
              background: '#0d0d0d', borderRadius: 10, padding: '14px 16px',
              fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.7,
              overflowX: 'auto', maxHeight: '65vh', overflowY: 'auto',
            }}>
              {logs.length === 0
                ? <span style={{ color: '#666' }}>No log entries.</span>
                : logs.map((line, i) => {
                    const color = line.includes('ERROR') || line.includes('CRITICAL') ? '#ff6b6b'
                                : line.includes('WARNING') ? '#ffd93d'
                                : line.includes('SLOW') ? '#ff9f43'
                                : '#a8d8a8';
                    return <div key={i} style={{ color, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{line}</div>;
                  })
              }
            </div>
        }
      </div>
    ),
  };

  const currentNav = NAV.find(n => n.key === page);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '210px 1fr', minHeight: '100vh' }}>

      {/* Sidebar */}
      <div style={{
        borderRight: '1px solid var(--line)', padding: '28px 12px',
        background: 'var(--surface)', display: 'flex', flexDirection: 'column', gap: 2,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase',
          letterSpacing: '0.08em', padding: '0 12px', marginBottom: 12,
        }}>Admin</div>
        {NAV.map(({ key, label, icon }) => {
          const active = page === key;
          return (
            <button key={key} onClick={() => setPage(key)} style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
              padding: '9px 12px', borderRadius: 9, border: 'none', fontFamily: 'inherit',
              fontSize: 13.5, cursor: 'pointer', transition: 'background 0.12s',
              fontWeight: active ? 600 : 400,
              background: active ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
              color: active ? 'var(--accent)' : 'var(--ink-2)',
            }}>
              <span style={{ fontSize: 11, opacity: active ? 1 : 0.5, width: 14, textAlign: 'center' }}>{icon}</span>
              {label}
            </button>
          );
        })}
      </div>

      {/* Main content */}
      <div style={{ padding: '36px 44px', overflowY: 'auto', background: 'var(--bg)' }}>
        <div style={{ maxWidth: 580 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', marginBottom: 28, letterSpacing: '-0.01em' }}>
            {currentNav?.label}
          </div>
          {pages[page]}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// PerformancePanel — statement-based portfolio analytics
// ═══════════════════════════════════════════════════════════════════

function PerformancePanel() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    apiFetch('/api/portfolio/performance')
      .then(r => r && r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)', fontSize: 14 }}>Analyzing statements…</div>;
  if (error)   return <div style={{ padding: 40, textAlign: 'center', color: 'var(--terra)', fontSize: 14 }}>{error}</div>;
  if (!data?.ok) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--terra)', fontSize: 14 }}>{data?.error || 'Could not load performance data.'}</div>;

  const perf         = data.performance || {};
  const monthly      = perf.monthly_returns || [];
  const deposits     = data.all_deposits || [];
  const balances     = data.balances || [];

  const totalInvested   = data.total_invested || 0;
  const cashDeposited   = data.total_deposits || 0;
  const transferIn      = data.transfer_in || 0;
  const currentValue    = data.current_value || 0;
  const totalFees       = data.total_fees || 0;
  const trueGain        = currentValue - totalInvested;
  const trueGainPct     = totalInvested > 0 ? (trueGain / totalInvested) * 100 : 0;

  // Quarterly buckets from monthly balances
  const quarters = {};
  balances.forEach((b, i) => {
    const [year, mon] = b.month.split('-').map(Number);
    const q = `${year} Q${Math.ceil(mon / 3)}`;
    quarters[q] = { end: b.value, label: q };
    if (i === 0) quarters[q].start = balances[0].value;
    else {
      const prevQ = quarters[q].start == null ? balances[i - 1].value : quarters[q].start;
      if (quarters[q].start == null) quarters[q].start = prevQ;
    }
  });
  // Compute quarter start properly: first balance of the quarter
  const qKeys = [];
  const qMap = {};
  balances.forEach((b, i) => {
    const [year, mon] = b.month.split('-').map(Number);
    const q = `${year} Q${Math.ceil(mon / 3)}`;
    if (!qMap[q]) { qMap[q] = { start: i > 0 ? balances[i-1].value : 0, end: b.value, label: q }; qKeys.push(q); }
    qMap[q].end = b.value;
  });
  const quarterList = qKeys.map(k => {
    const { start, end, label } = qMap[k];
    const gain = end - start;
    const pct  = start > 0 ? (gain / start) * 100 : 0;
    return { label, end, gain, pct };
  }).filter(q => q.end > 0);

  // SPY benchmark TWR for display
  const twrPort = perf.twr_portfolio;
  const twrSpy  = perf.twr_spy;
  const beta     = perf.beta;
  const alpha    = perf.alpha;
  const rSq      = perf.r_squared;

  // Monthly return bars — last 12 months
  const recentMonthly = monthly.slice(-12);
  const maxAbsReturn  = Math.max(...recentMonthly.map(m => Math.max(Math.abs(m.portfolio), Math.abs(m.spy || 0))), 1);

  const StatCard = ({ label, value, sub, positive, negative, small }) => (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{label}</div>
      <div style={{
        fontSize: small ? 18 : 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
        color: positive ? 'var(--accent)' : negative ? 'var(--terra)' : 'var(--ink)',
      }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Summary cards row 1 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        <StatCard label="Portfolio Value"    value={fmtMoney(currentValue)} />
        <StatCard label="Cash Deposited"     value={fmtMoney(cashDeposited)} sub={`${deposits.length} ACH deposits`} />
        <StatCard label="Transferred In"     value={fmtMoney(transferIn)}   sub="E*Trade stocks (May 2024)" />
        <StatCard label="Total Fees Paid"    value={`$${totalFees.toFixed(2)}`} sub={`0.25%/yr · ${data.statement_count} months`} negative />
      </div>

      {/* Summary cards row 2 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        <StatCard label="Total Invested"     value={fmtMoney(totalInvested)} sub="Cash + transfer-in" />
        <StatCard label="True Gain"
          value={`${trueGain >= 0 ? '+' : '−'}${fmtMoney(Math.abs(trueGain))}`}
          sub={`${trueGainPct >= 0 ? '+' : ''}${trueGainPct.toFixed(1)}% on total invested`}
          positive={trueGain > 0} negative={trueGain < 0} />
        <StatCard label="Your TWR"
          value={twrPort != null ? `${twrPort >= 0 ? '+' : ''}${twrPort.toFixed(1)}%` : '—'}
          sub="Time-weighted return" positive={twrPort > 0} negative={twrPort < 0} />
        <StatCard label="SPY (benchmark)"
          value={twrSpy != null ? `${twrSpy >= 0 ? '+' : ''}${twrSpy.toFixed(1)}%` : '—'}
          sub="Same period"
          positive={twrSpy > 0} negative={twrSpy < 0} />
      </div>

      {/* Beta / Alpha badges */}
      {(beta != null || alpha != null) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          {beta != null && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Beta vs SPY</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: beta < 1 ? 'var(--accent)' : 'var(--terra)', fontVariantNumeric: 'tabular-nums' }}>{beta.toFixed(2)}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.5 }}>
                {beta < 0.8 ? 'Much less volatile than the market — your portfolio moves more gently than SPY.'
                : beta < 1.0 ? 'Slightly less volatile than SPY — good for capital preservation.'
                : beta < 1.2 ? 'Moves roughly in step with the market.'
                : 'More volatile than SPY — bigger swings both up and down.'}
              </div>
            </div>
          )}
          {alpha != null && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Alpha (annualized)</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: alpha >= 0 ? 'var(--accent)' : 'var(--terra)', fontVariantNumeric: 'tabular-nums' }}>{alpha >= 0 ? '+' : ''}{alpha.toFixed(2)}%</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.5 }}>
                {alpha >= 1 ? `Outperforming SPY by ~${alpha.toFixed(1)}%/yr after adjusting for market moves.`
                : alpha >= 0 ? 'Roughly matching the market on a risk-adjusted basis.'
                : `Underperforming SPY by ~${Math.abs(alpha).toFixed(1)}%/yr after adjusting for market moves.`}
              </div>
            </div>
          )}
          {rSq != null && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>R² (vs SPY)</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{(rSq * 100).toFixed(0)}%</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.5 }}>
                {rSq > 0.9 ? 'Moves almost entirely with SPY — highly correlated.'
                : rSq > 0.7 ? 'Mostly tracks SPY with some independent variation.'
                : 'Meaningful portion of your return is independent of the market.'}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Monthly returns chart */}
      {recentMonthly.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: '20px 24px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>Monthly Returns — Last 12 Months vs SPY</div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 16 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginRight: 16 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--accent)', display: 'inline-block' }} /> Your portfolio
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: '#94a3b8', display: 'inline-block' }} /> SPY
            </span>
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 120 }}>
            {recentMonthly.map((m, i) => {
              const portH = Math.max(2, Math.abs(m.portfolio) / maxAbsReturn * 55);
              const spyH  = m.spy != null ? Math.max(2, Math.abs(m.spy) / maxAbsReturn * 55) : 0;
              const portPos = m.portfolio >= 0;
              const spyPos  = (m.spy || 0) >= 0;
              return (
                <div key={m.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  {/* positive bars above midline */}
                  <div style={{ height: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 2 }}>
                    <div style={{ width: 6, height: portPos ? portH : 0, background: 'var(--accent)', borderRadius: '2px 2px 0 0' }} />
                    <div style={{ width: 6, height: spyPos && m.spy != null ? spyH : 0, background: '#94a3b8', borderRadius: '2px 2px 0 0' }} />
                  </div>
                  {/* zero line */}
                  <div style={{ width: '100%', height: 1, background: 'var(--line)' }} />
                  {/* negative bars below midline */}
                  <div style={{ height: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 2 }}>
                    <div style={{ width: 6, height: !portPos ? portH : 0, background: 'var(--terra)', borderRadius: '0 0 2px 2px' }} />
                    <div style={{ width: 6, height: !spyPos && m.spy != null ? spyH : 0, background: '#f87171', borderRadius: '0 0 2px 2px' }} />
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--ink-3)', marginTop: 2 }}>{m.month.slice(5)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Quarterly growth */}
      {quarterList.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)', fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
            Quarterly Portfolio Growth
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface-3)' }}>
                {['Quarter', 'End Value', 'Gain / Loss', 'Return'].map(h => (
                  <th key={h} style={{ padding: '10px 20px', textAlign: h === 'Quarter' ? 'left' : 'right', fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {quarterList.map((q, i) => (
                <tr key={q.label} style={{ borderTop: i > 0 ? '1px solid var(--line)' : 'none' }}>
                  <td style={{ padding: '12px 20px', fontWeight: 600, color: 'var(--ink)' }}>{q.label}</td>
                  <td style={{ padding: '12px 20px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--ink-2)' }}>{fmtMoney(q.end)}</td>
                  <td style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: q.gain >= 0 ? 'var(--accent)' : 'var(--terra)' }}>
                    {q.gain >= 0 ? '+' : '−'}{fmtMoney(Math.abs(q.gain))}
                  </td>
                  <td style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: q.pct >= 0 ? 'var(--accent)' : 'var(--terra)' }}>
                    {q.pct >= 0 ? '+' : ''}{q.pct.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Cash contributions timeline */}
      {deposits.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>Cash Deposit History</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Total: {fmtMoney(cashDeposited)}</div>
          </div>
          {deposits.map((d, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 24px', borderTop: i > 0 ? '1px solid var(--line)' : 'none' }}>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', width: 100, flexShrink: 0 }}>{d.date}</div>
              <div style={{ flex: 1, height: 6, background: 'var(--line)', borderRadius: 99 }}>
                <div style={{ height: 6, borderRadius: 99, background: 'var(--accent)', width: `${(d.amount / cashDeposited) * 100}%` }} />
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', minWidth: 80, textAlign: 'right' }}>{fmtMoney(d.amount)}</div>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}

export default AdminTab;
export { PerformancePanel };
