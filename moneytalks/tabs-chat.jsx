function ChatTab() {
  const [messages, setMessages]     = React.useState([]);
  const [sqlLog, setSqlLog]         = React.useState({});
  const [input, setInput]           = React.useState('');
  const [loading, setLoading]       = React.useState(false);
  const [configOk, setConfigOk]     = React.useState(null);
  const [isRecording, setIsRecording] = React.useState(false);
  const [speakEnabled, setSpeakEnabled] = React.useState(false);
  const [isSpeaking, setIsSpeaking] = React.useState(false);
  const recognitionRef = React.useRef(null);
  const bottomRef = React.useRef(null);

  const hasVoiceInput  = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const hasVoiceOutput = !!window.speechSynthesis;

  // Check if AI is configured
  React.useEffect(() => {
    apiFetch('/api/config').then((r) => r.json()).then((cfg) => {
      setConfigOk(cfg.has_anthropic || cfg.has_gemini);
    });
  }, []);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const SUGGESTIONS = [
    "What's my biggest spending category?",
    "Am I spending more than I earn?",
    "What are my recurring charges?",
    "How has my spending changed month over month?",
    "Where am I overspending?",
  ];

  // Auto-speak new assistant messages when speaker is on
  React.useEffect(() => {
    if (!speakEnabled || !hasVoiceOutput || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role !== 'assistant') return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(last.content);
    utt.onstart = () => setIsSpeaking(true);
    utt.onend   = () => setIsSpeaking(false);
    utt.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utt);
  }, [messages, speakEnabled]);

  function toggleSpeaker() {
    if (isSpeaking) { window.speechSynthesis.cancel(); setIsSpeaking(false); }
    setSpeakEnabled(v => !v);
  }

  function toggleMic() {
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous      = false;
    rec.interimResults  = true;
    rec.lang            = 'en-US';
    rec.onresult = (e) => {
      const transcript = Array.from(e.results).map(r => r[0].transcript).join('');
      setInput(transcript);
      if (e.results[e.results.length - 1].isFinal) {
        rec.stop();
        setIsRecording(false);
        // slight delay so state settles before send
        setTimeout(() => send(transcript), 50);
      }
    };
    rec.onerror = () => setIsRecording(false);
    rec.onend   = () => setIsRecording(false);
    recognitionRef.current = rec;
    rec.start();
    setIsRecording(true);
  }

  const send = async (text) => {
    if (!text.trim() || loading) return;
    const userMsg = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    try {
      const res = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Only send conversation history — no raw financial data
        body: JSON.stringify({ messages: newMessages }),
      });
      const data = await res.json();
      const assistantIdx = newMessages.length; // index the assistant reply will land at
      setMessages([...newMessages, { role: 'assistant', content: data.reply }]);
      if (data.sql) setSqlLog(prev => ({ ...prev, [assistantIdx]: { sql: data.sql, rows: data.rows } }));
    } catch (e) {
      setMessages([...newMessages, { role: 'assistant', content: `Error: ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  if (configOk === false) {
    return (
      <div className="tab-body">
        <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔑</div>
          <h3 style={{ margin: '0 0 8px' }}>No AI provider configured</h3>
          <p style={{ color: 'var(--muted)', margin: '0 0 20px' }}>
            Add a Claude or Gemini API key in Settings.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="tab-body" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' }}>
      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 16 }}>
        {messages.length === 0 && (
          <div style={{ padding: '32px 0' }}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>💬</div>
              <h3 style={{ margin: '0 0 6px', color: 'var(--ink)' }}>Ask about your finances</h3>
              <p style={{ color: 'var(--muted)', margin: 0, fontSize: 14 }}>
                Your real transaction data is the context.
              </p>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 20, padding: '8px 16px', fontSize: 13,
                  color: 'var(--ink)', cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'border-color 0.12s',
                }}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{
            display: 'flex', flexDirection: 'column',
            alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
          }}>
            <div style={{
              maxWidth: '72%',
              padding: '12px 16px',
              borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
              background: m.role === 'user' ? 'var(--accent)' : 'var(--surface)',
              color: m.role === 'user' ? '#052015' : 'var(--ink)',
              border: m.role === 'user' ? 'none' : '1px solid var(--border)',
              fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap',
            }}>{m.content}</div>
            {m.role === 'assistant' && sqlLog[i] && (
              <details style={{ maxWidth: '72%', marginTop: 4 }}>
                <summary style={{
                  fontSize: 11, color: 'var(--muted)', cursor: 'pointer',
                  userSelect: 'none', listStyle: 'none', paddingLeft: 4,
                }}>
                  ▸ Query ran locally · {sqlLog[i].rows} row{sqlLog[i].rows !== 1 ? 's' : ''}
                </summary>
                <pre style={{
                  margin: '6px 0 0', padding: '10px 14px', borderRadius: 8,
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
                  color: 'var(--muted)', whiteSpace: 'pre-wrap', overflowX: 'auto',
                }}>{sqlLog[i].sql}</pre>
              </details>
            )}
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{
              padding: '12px 16px', borderRadius: '16px 16px 16px 4px',
              background: 'var(--surface)', border: '1px solid var(--border)',
              color: 'var(--muted)', fontSize: 13,
            }}>Thinking…</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        display: 'flex', gap: 8, paddingTop: 12,
        borderTop: '1px solid var(--border)',
      }}>
        {/* Mic button */}
        {hasVoiceInput && (
          <button
            onClick={toggleMic}
            title={isRecording ? 'Stop recording' : 'Speak your question'}
            style={{
              background: isRecording ? '#ef4444' : 'var(--surface)',
              color: isRecording ? '#fff' : 'var(--muted)',
              border: `1px solid ${isRecording ? '#ef4444' : 'var(--border)'}`,
              borderRadius: 10, padding: '10px 12px', fontSize: 16,
              cursor: 'pointer', flexShrink: 0,
              animation: isRecording ? 'pulse 1s infinite' : 'none',
            }}
          >🎙</button>
        )}

        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send(input))}
          placeholder={isRecording ? 'Listening…' : 'Ask about your spending, income, trends…'}
          style={{
            flex: 1, padding: '10px 14px', borderRadius: 10,
            border: `1px solid ${isRecording ? '#ef4444' : 'var(--border)'}`,
            fontSize: 14, fontFamily: 'inherit', background: 'var(--surface)',
            outline: 'none',
          }}
        />

        {/* Speaker toggle */}
        {hasVoiceOutput && (
          <button
            onClick={toggleSpeaker}
            title={isSpeaking ? 'Stop speaking' : speakEnabled ? 'Voice replies on — click to turn off' : 'Turn on voice replies'}
            style={{
              background: speakEnabled ? 'var(--accent)' : 'var(--surface)',
              color: speakEnabled ? '#052015' : 'var(--muted)',
              border: `1px solid ${speakEnabled ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 10, padding: '10px 12px', fontSize: 16,
              cursor: 'pointer', flexShrink: 0,
            }}
          >{isSpeaking ? '⏹' : '🔊'}</button>
        )}

        <button onClick={() => send(input)} disabled={!input.trim() || loading} style={{
          background: 'var(--accent)', color: '#052015', border: 'none',
          borderRadius: 10, padding: '10px 18px', fontWeight: 600,
          fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
          opacity: (!input.trim() || loading) ? 0.5 : 1,
        }}>Send</button>
        {messages.length > 0 && (
          <button onClick={() => { setMessages([]); setSqlLog({}); window.speechSynthesis?.cancel(); }} style={{
            background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '10px 14px', fontSize: 13,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>Clear</button>
        )}
      </div>
    </div>
  );
}

// ─── Plaid sync card — lives in Settings, defined outside to avoid remounting
