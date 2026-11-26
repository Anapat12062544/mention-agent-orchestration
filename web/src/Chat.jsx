import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, modelLabel } from './api.js';
import { t, loc } from './i18n.js';

const ICONS = {
  pie: 'M12 3v9h9M12 3a9 9 0 1 0 9 9M15 3.5A9 9 0 0 1 20.5 9H15z',
  repeat: 'M4 9h13l-3-3M20 15H7l3 3',
  box: 'M4 7.5 12 3l8 4.5v9L12 21l-8-4.5zM4 7.5l8 4.5 8-4.5M12 12v9',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 7.5h.01',
  plus: 'M12 5v14M5 12h14',
  up: 'M12 19V5M6 11l6-6 6 6',
  chev: 'M9 6l6 6-6 6',
};
const Icon = ({ name }) => (
  <svg className="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={ICONS[name] || ICONS.pie} />
  </svg>
);

// ---------------------------------------------------------------- composer with @ picker
function Composer({ onSend, disabled, seed, big }) {
  const [text, setText] = useState('');
  const [tags, setTags] = useState([]);
  const [meta, setMeta] = useState({ agents: [], types: [] });
  const [picker, setPicker] = useState(null); // {mode:'root', query, start, idx} | {mode:'values', type, label, q, items, idx}
  const ta = useRef(null);
  const search = useRef(null);

  useEffect(() => { api('/ai/tags').then(setMeta).catch(() => {}); }, []);
  useEffect(() => {
    if (seed) { setText(seed.text); setTags(seed.tags || []); setTimeout(() => ta.current?.focus(), 0); }
  }, [seed]);
  useEffect(() => { // fetch tag values
    if (picker?.mode !== 'values') return;
    const t = setTimeout(() => {
      api(`/ai/tags?type=${encodeURIComponent(picker.type)}&q=${encodeURIComponent(picker.q)}`)
        .then(r => setPicker(p => (p?.mode === 'values' && p.type === picker.type ? { ...p, items: r.items, idx: 0 } : p)))
        .catch(() => {});
    }, 150);
    return () => clearTimeout(t);
  }, [picker?.mode, picker?.type, picker?.q]);

  const rootItems = picker?.mode === 'root' ? [
    ...meta.agents.filter(a => a.handle.includes(picker.query.toLowerCase())).map(a => ({ kind: 'agent', key: a.handle, title: `@${a.handle}`, sub: a.description || a.name })),
    ...meta.types.filter(x => x.type.includes(picker.query.toLowerCase())).map(x => ({ kind: 'tag', key: x.type, title: `@${x.type}`, sub: t('pickTag', { label: x.label }) })),
  ] : [];
  const items = picker?.mode === 'values' ? (picker.items || []).map(i => ({ kind: 'value', key: i.value, title: i.label, value: i })) : rootItems;

  const onChange = e => {
    const v = e.target.value;
    setText(v);
    const caret = e.target.selectionStart;
    const m = /(^|\s)@([a-z0-9_]*)$/i.exec(v.slice(0, caret));
    if (m) setPicker({ mode: 'root', query: m[2], start: caret - m[2].length - 1, end: caret, idx: 0 });
    else if (picker?.mode === 'root') setPicker(null);
  };

  const choose = item => {
    if (!item) return;
    if (item.kind === 'agent') {
      const t = text.slice(0, picker.start) + `@${item.key} ` + text.slice(picker.end);
      setText(t);
      setPicker(null);
      setTimeout(() => { ta.current.focus(); ta.current.selectionStart = ta.current.selectionEnd = picker.start + item.key.length + 2; }, 0);
    } else if (item.kind === 'tag') {
      setText(text.slice(0, picker.start) + text.slice(picker.end));
      const type = meta.types.find(t => t.type === item.key);
      setPicker({ mode: 'values', type: item.key, label: type.label, q: '', items: [], idx: 0 });
      setTimeout(() => search.current?.focus(), 0);
    } else {
      setTags(ts => [...ts.filter(t => !(t.type === picker.type && t.value === item.value.value)), { type: picker.type, value: item.value.value, label: item.value.label }]);
      setPicker(null);
      setTimeout(() => ta.current?.focus(), 0);
    }
  };

  const nav = e => {
    if (!picker) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setPicker(p => ({ ...p, idx: Math.max(0, Math.min(items.length - 1, p.idx + d)) }));
      return true;
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && items.length) { e.preventDefault(); choose(items[picker.idx]); return true; }
    if (e.key === 'Escape') { e.preventDefault(); setPicker(null); setTimeout(() => ta.current?.focus(), 0); return true; }
    return false;
  };

  const openPicker = () => { // "+" = type an @ at the end
    const t = text && !/\s$/.test(text) ? `${text} @` : `${text}@`;
    setText(t);
    setPicker({ mode: 'root', query: '', start: t.length - 1, end: t.length, idx: 0 });
    setTimeout(() => { ta.current.focus(); ta.current.selectionStart = ta.current.selectionEnd = t.length; }, 0);
  };

  const submit = async () => {
    if (!text.trim() || disabled) return;
    const ok = await onSend(text.trim(), tags);
    if (ok) { setText(''); setTags([]); }
  };

  return (
    <div className={`composer ${big ? 'big' : ''}`}>
      {picker && (
        <div className="picker" role="listbox">
          {picker.mode === 'values' && (
            <div className="picker-search">
              <span className="chip-type">@{picker.type}</span>
              <input ref={search} placeholder={t('searchTag', { label: picker.label })} value={picker.q}
                onChange={e => setPicker(p => ({ ...p, q: e.target.value }))} onKeyDown={nav} />
            </div>
          )}
          {picker.mode === 'root' && <div className="picker-head">{t('pickerHead')}</div>}
          {items.map((it, i) => (
            <button key={it.kind + it.key} className={`picker-item ${i === picker.idx ? 'on' : ''}`}
              onMouseDown={e => { e.preventDefault(); choose(it); }}>
              <span className={`pi-kind ${it.kind}`}>{it.kind === 'agent' ? 'agent' : it.kind === 'tag' ? 'tag' : ''}</span>
              <span className="pi-title">{it.title}</span>
              {it.sub && <span className="pi-sub">{it.sub}</span>}
            </button>
          ))}
          {!items.length && <div className="picker-empty">{t('noMatch')}</div>}
        </div>
      )}
      {!!tags.length && (
        <div className="chips">
          {tags.map(tag => (
            <span key={tag.type + tag.value} className="chip">
              <span className="chip-type">@{tag.type}</span>{tag.label}
              <button aria-label={t('remove')} onClick={() => setTags(ts => ts.filter(x => x !== tag))}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="composer-row">
        <textarea ref={ta} rows={big ? 3 : 1} value={text} onChange={onChange} disabled={disabled}
          placeholder={t('placeholder')}
          onKeyDown={e => {
            if (nav(e)) return;
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
          }} />
        {!big && <button className="btn primary send" onClick={submit} disabled={disabled || !text.trim()} aria-label={t('send')}><Icon name="up" /></button>}
      </div>
      {big && (
        <div className="composer-foot">
          <button className="icon-btn" onClick={openPicker} disabled={disabled} aria-label={t('openPicker')} title={t('openPicker')}><Icon name="plus" /></button>
          <button className="btn primary send" onClick={submit} disabled={disabled || !text.trim()} aria-label={t('send')}><Icon name="up" /></button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- answer parts
function MentionText({ text }) {
  return String(text).split(/(@[a-z][a-z0-9_]*)/gi).map((p, i) => (p.startsWith('@') ? <b key={i} className="mention">{p}</b> : p));
}

function Queries({ queries }) {
  if (!queries?.length) return null;
  const rejected = queries.filter(q => q.status !== 'ok').length;
  return (
    <details className="queries">
      <summary>{t('ranQueries', { n: queries.length, q: t(queries.length === 1 ? 'query' : 'queries') })}{rejected ? ` · ${t('blocked', { n: rejected })}` : ''}</summary>
      {queries.map((q, i) => (
        <div key={i} className="query">
          <div className="query-head">
            <span className={`badge ${q.status}`}>{q.status}</span>
            <span className="mention">@{q.agent}</span>
            <span className="muted">{q.purpose}</span>
            {q.status === 'ok' && <span className="muted small">{t('rows', { n: q.rowCount })}{q.truncated ? ` ${t('truncated')}` : ''}</span>}
          </div>
          <pre className="sql">{q.sql}</pre>
          {q.error && <div className="query-error">{q.error}</div>}
          {q.sample?.length > 0 && (
            <div className="table-wrap">
              <table className="data">
                <thead><tr>{q.columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>{q.sample.slice(0, 10).map((r, j) => <tr key={j}>{r.map((v, k) => <td key={k}>{v == null ? '∅' : String(v)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </details>
  );
}

function Proposal({ p, status, onChange }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const act = async kind => {
    setBusy(true); setErr('');
    try { const r = await api(`/ai/changes/${p.id}/${kind}`, { method: 'POST' }); onChange(p.id, r); }
    catch (e) { setErr(e.message); if (e.status === 409) onChange(p.id, null); }
    finally { setBusy(false); }
  };
  const st = status?.status || p.status;
  return (
    <div className={`proposal ${st}`}>
      <div className="proposal-head">
        <span className="muted small">{t('proposal', { id: p.id })} · {p.tool}</span>
        <span className={`badge ${st}`}>{st}</span>
      </div>
      <div><b>{p.key}</b> · {p.field}: <s>{p.before}</s> → <b>{status?.after_value || p.after}</b></div>
      {p.reason && <div className="muted small">{p.reason}</div>}
      {status?.status_note && <div className="muted small">{status.status_note}</div>}
      {err && <div className="error small">{err}</div>}
      <div className="proposal-actions">
        {st === 'proposed' && <button className="btn primary sm" disabled={busy} onClick={() => act('apply')}>Apply</button>}
        {st === 'applied' && <button className="btn sm" disabled={busy} onClick={() => act('undo')}>Undo</button>}
      </div>
    </div>
  );
}

function Message({ m, changes, onChange }) {
  if (m.role === 'user') {
    return (
      <div className="msg user">
        <div className="bubble">
          {!!m.meta?.tags?.length && (
            <div className="chips">{m.meta.tags.map(t => <span key={t.type + t.value} className="chip"><span className="chip-type">@{t.type}</span>{t.label}</span>)}</div>
          )}
          <MentionText text={m.content} />
        </div>
      </div>
    );
  }
  const meta = m.meta || {};
  return (
    <div className="msg assistant">
      <div className="msg-head">
        <span className="mention">@{m.agent_handle}</span> · {modelLabel(m.model)}
        {meta.router && <span className="router" title={`router: ${meta.router.by}`}>{meta.router.reason}</span>}
      </div>
      {meta.delegations?.map((d, i) => (
        <details key={i} className="delegation">
          <summary>↪ <span className="mention">@{d.from}</span> {t('asked')} <span className="mention">@{d.to}</span> ({modelLabel(d.model)}): {d.question}</summary>
          <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{d.answer || ''}</ReactMarkdown></div>
        </details>
      ))}
      <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown></div>
      {meta.notes?.length > 0 && <div className="guard-notes">{meta.notes.map((n, i) => <div key={i}>🛡 {n}</div>)}</div>}
      {meta.proposals?.map(p => <Proposal key={p.id} p={p} status={changes[p.id]} onChange={onChange} />)}
      <Queries queries={meta.queries} />
    </div>
  );
}

function Pending({ p }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  return (
    <>
      <div className="msg user"><div className="bubble"><MentionText text={p.text} /></div></div>
      <div className="msg assistant pending">
        <span className="dots"><i /><i /><i /></span> {t('pending', { s: Math.round((now - p.started) / 1000) })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- home
function Home({ me, send, seed, error }) {
  const [group, setGroup] = useState('All');
  const all = me.starterCards.map(loc);
  const groups = ['All', ...new Set(all.map(c => c.group).filter(Boolean))];
  const cards = all.filter(c => group === 'All' || c.group === group);
  return (
    <div className="home">
      <h1>{t('homeTitle', { name: me.domain.name })}</h1>
      <p className="muted">{t('homeHintA')} <b className="mention">@</b> {t('homeHintB')}</p>
      <Composer onSend={send} seed={seed} big />
      {error && <div className="error">{error}</div>}
      {groups.length > 2 && (
        <div className="tabs" role="tablist">
          {groups.map(g => <button key={g} role="tab" aria-selected={g === group} className={g === group ? 'on' : ''} onClick={() => setGroup(g)}>{g === 'All' ? t('all') : g}</button>)}
        </div>
      )}
      <div className="cards">
        {cards.map(c => (
          <button key={c.title} className="card" onClick={() => send(c.text, c.tags || [])}>
            {c.group && <span className="card-kicker"><Icon name={c.icon} />{c.group}</span>}
            <span className="card-title">{c.title}</span>
            <span className="card-text"><MentionText text={c.text} /></span>
            <span className="card-run">{t('run')} <Icon name="chev" /></span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- page
export default function Chat({ me, convId, onCreated, onAnswered }) {
  const [messages, setMessages] = useState([]);
  const [changes, setChanges] = useState({});
  const [pending, setPending] = useState(null);
  const [error, setError] = useState('');
  const [seed, setSeed] = useState(null);
  const end = useRef(null);

  useEffect(() => {
    if (!convId) return;
    api(`/ai/conversations/${convId}`).then(r => {
      setMessages(r.messages);
      setChanges(Object.fromEntries(r.changes.map(c => [c.id, c])));
    }).catch(e => setError(e.message));
  }, [convId]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length, pending]);

  const send = async (text, tags) => {
    setPending({ text, started: Date.now() });
    setError('');
    try {
      const r = await api('/ai/chat', { method: 'POST', body: { conversationId: convId, text, tags } });
      if (!convId) onCreated(r.conversationId);
      else {
        setMessages(ms => [...ms, { id: `u${Date.now()}`, role: 'user', content: text, meta: { tags } }, r.message]);
        onAnswered();
      }
      return true;
    } catch (e) {
      setError(e.message);
      setSeed({ text, tags, n: Date.now() }); // composer may have remounted — restore the draft
      return false;
    } finally {
      setPending(null);
    }
  };
  const onChange = (id, row) => setChanges(c => ({ ...c, [id]: row || { ...c[id], status: 'rejected' } }));

  if (!convId && !pending && !messages.length) {
    return <Home me={me} send={send} seed={seed} error={error} />;
  }

  return (
    <div className="chat">
      <div className="messages">
        {messages.map(m => <Message key={m.id} m={m} changes={changes} onChange={onChange} />)}
        {pending && <Pending p={pending} />}
        {error && <div className="error">{error}</div>}
        <div ref={end} />
      </div>
      <div className="dock"><Composer onSend={send} disabled={!!pending} seed={seed} /></div>
    </div>
  );
}
