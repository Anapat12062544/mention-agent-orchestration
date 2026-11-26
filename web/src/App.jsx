import React, { useEffect, useState, useCallback } from 'react';
import { api } from './api.js';
import Chat from './Chat.jsx';
import { Agents, Routines, Usage } from './Admin.jsx';
import { t, useLang, setLang, LANGS } from './i18n.js';

function LangSwitch() {
  const lang = useLang();
  return (
    <div className="lang" role="group" aria-label="Language">
      {LANGS.map(l => (
        <button key={l} type="button" aria-pressed={l === lang} className={l === lang ? 'on' : ''} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
      ))}
    </div>
  );
}

function Login({ onDone }) {
  const [form, setForm] = useState({ username: 'admin', password: '' });
  const [err, setErr] = useState('');
  const submit = async e => {
    e.preventDefault();
    setErr('');
    try { await api('/login', { method: 'POST', body: form }); onDone(); } catch (e2) { setErr(e2.message); }
  };
  return (
    <div className="login">
      <form onSubmit={submit} className="login-card">
        <div className="login-top"><div className="brand-mark">@</div><LangSwitch /></div>
        <h1>AI Console</h1>
        <p className="muted">{t('tagline')}</p>
        <label>{t('username')}<input value={form.username} autoComplete="username" onChange={e => setForm({ ...form, username: e.target.value })} autoFocus /></label>
        <label>{t('password')}<input type="password" autoComplete="current-password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></label>
        {err && <div className="error">{err}</div>}
        <button className="btn primary" type="submit">{t('signIn')}</button>
        <p className="muted small">Demo: admin / admin1234 · manager / manager1234 · staff / staff1234</p>
      </form>
    </div>
  );
}

export default function App() {
  useLang(); // re-render everything on language switch
  const [me, setMe] = useState(undefined);
  const [view, setView] = useState('chat');
  const [convs, setConvs] = useState([]);
  const [convId, setConvId] = useState(null);
  const [drawer, setDrawer] = useState(false); // sidebar on phone/tablet

  const loadMe = useCallback(() => api('/me').then(setMe).catch(() => setMe(null)), []);
  const loadConvs = useCallback(() => api('/ai/conversations').then(setConvs).catch(() => {}), []);
  useEffect(() => { loadMe(); }, [loadMe]);
  useEffect(() => { if (me?.can.use) loadConvs(); }, [me, loadConvs]);
  useEffect(() => { if (me) document.title = `${me.domain.name} · AI Console`; }, [me]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = e => e.key === 'Escape' && setDrawer(false);
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [drawer]);

  if (me === undefined) return <div className="center muted">{t('loading')}</div>;
  if (me === null) return <Login onDone={loadMe} />;

  const go = (v, id = convId) => { setView(v); setConvId(id); setDrawer(false); };
  const logout = async () => { await api('/logout', { method: 'POST' }); setMe(null); };
  const remove = async id => {
    await api(`/ai/conversations/${id}`, { method: 'DELETE' });
    if (id === convId) setConvId(null);
    loadConvs();
  };
  const nav = [
    ['chat', t('navChat')],
    ['agents', t('navAgents')],
    ['routines', t('navRoutines')],
    ...(me.can.seeUsage ? [['usage', t('navUsage')]] : []),
  ];
  const title = view === 'chat' ? (convs.find(c => c.id === convId)?.title || t('newChatTitle')) : nav.find(([k]) => k === view)?.[1];

  return (
    <div className={`shell ${drawer ? 'drawer-open' : ''}`}>
      <div className="backdrop" onClick={() => setDrawer(false)} aria-hidden="true" />
      <aside className="sidebar" aria-label={t('menu')}>
        <div className="side-head">
          <div className="brand-mark sm">@</div>
          <div className="side-name">
            <div className="side-title">{me.domain.name}</div>
            <div className="muted small">Agent Orchestration</div>
          </div>
          <button className="icon-btn side-close" onClick={() => setDrawer(false)} aria-label={t('closeMenu')}>×</button>
        </div>
        {me.can.use && <button className="btn new-chat" onClick={() => go('chat', null)}>{t('newChat')}</button>}
        <nav className="nav">
          {nav.map(([k, l]) => (
            <button key={k} className={view === k ? 'active' : ''} onClick={() => go(k)}>{l}</button>
          ))}
        </nav>
        <div className="side-label">{t('history')}</div>
        <div className="conv-list">
          {convs.map(c => (
            <div key={c.id} className={`conv ${c.id === convId && view === 'chat' ? 'active' : ''}`}>
              <button className="conv-title" title={c.title} onClick={() => go('chat', c.id)}>
                {c.source === 'routine' ? '⏰ ' : ''}{c.title.replace(/^⏰ /, '')}
              </button>
              <button className="conv-del" title={t('del')} aria-label={t('delChat')} onClick={() => remove(c.id)}>×</button>
            </div>
          ))}
          {!convs.length && <div className="muted small pad">{t('noChats')}</div>}
        </div>
        <div className="side-foot">
          <div className="side-user">
            <div>{me.user.display_name}</div>
            <div className="muted small">{me.user.role}</div>
          </div>
          <LangSwitch />
          <button className="btn ghost sm" onClick={logout}>{t('signOut')}</button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setDrawer(true)} aria-label={t('menu')} aria-expanded={drawer}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <span className="topbar-title">{title}</span>
          {me.can.use && view === 'chat' && convId && (
            <button className="icon-btn menu-btn" onClick={() => go('chat', null)} aria-label={t('newChatTitle')}>+</button>
          )}
        </header>
        {!me.can.use && view === 'chat' && <div className="center muted">{t('noAccess', { role: me.user.role })}</div>}
        {me.can.use && view === 'chat' && (
          <Chat key={convId || 'new'} me={me} convId={convId}
            onCreated={id => { setConvId(id); loadConvs(); }} onAnswered={loadConvs} />
        )}
        {view === 'agents' && <Agents me={me} />}
        {view === 'routines' && <Routines me={me} onOpen={id => { go('chat', id); loadConvs(); }} />}
        {view === 'usage' && <Usage />}
      </main>
    </div>
  );
}
