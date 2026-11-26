import React, { useEffect, useState } from 'react';
import { api, fmtUsd, fmtInt, modelLabel } from './api.js';
import { t, locale } from './i18n.js';

const modelOpts = () => [['auto', t('modelAuto')], ['haiku', 'Haiku'], ['sonnet', 'Sonnet'], ['opus', 'Opus']];

// ---------------------------------------------------------------- Agents
export function Agents({ me }) {
  const [list, setList] = useState([]);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState('');
  const load = () => api('/ai/agents').then(setList).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);
  const blank = { handle: '', name: '', description: '', instructions: '', model: 'auto', tools: ['table_list', 'describe_table', 'run_sql'] };

  const save = async e => {
    e.preventDefault(); setErr('');
    try {
      await api(edit.id ? `/ai/agents/${edit.id}` : '/ai/agents', { method: edit.id ? 'PUT' : 'POST', body: edit });
      setEdit(null); load();
    } catch (e2) { setErr(e2.message); }
  };
  const del = async a => { if (!confirm(t('confirmDelAgent', { h: a.handle }))) return; try { await api(`/ai/agents/${a.id}`, { method: 'DELETE' }); load(); } catch (e) { setErr(e.message); } };

  return (
    <div className="page">
      <div className="page-head">
        <div><h2>Agents</h2><p className="muted">{t('agentsSub')}</p></div>
        {me.can.manageAgents && <button className="btn primary" onClick={() => setEdit(blank)}>{t('newAgent')}</button>}
      </div>
      {err && <div className="error">{err}</div>}
      {edit && (
        <form className="panel form" onSubmit={save}>
          <div className="grid2">
            <label>Handle<input value={edit.handle} onChange={e => setEdit({ ...edit, handle: e.target.value })} placeholder="ads" /></label>
            <label>{t('name')}<input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></label>
          </div>
          <label>{t('descPicker')}<input value={edit.description} onChange={e => setEdit({ ...edit, description: e.target.value })} /></label>
          <label>Instructions<textarea rows={6} value={edit.instructions} onChange={e => setEdit({ ...edit, instructions: e.target.value })} /></label>
          <div className="grid2">
            <label>{t('model')}
              <select value={edit.model} onChange={e => setEdit({ ...edit, model: e.target.value })}>
                {modelOpts().map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <fieldset><legend>Tools</legend>
              {me.tools.map(t => (
                <label key={t.name} className="check" title={t.description}>
                  <input type="checkbox" checked={edit.tools.includes(t.name)}
                    onChange={e => setEdit({ ...edit, tools: e.target.checked ? [...edit.tools, t.name] : edit.tools.filter(x => x !== t.name) })} />
                  {t.name} <span className={`badge ${t.type}`}>{t.type}</span>
                </label>
              ))}
            </fieldset>
          </div>
          <div className="row-end"><button type="button" className="btn ghost" onClick={() => setEdit(null)}>{t('cancel')}</button><button className="btn primary">{t('save')}</button></div>
        </form>
      )}
      <div className="agent-grid">
        {list.map(a => (
          <div key={a.id} className="panel agent">
            <div className="agent-head">
              <span className="mention big">@{a.handle}</span>
              {a.is_default && <span className="badge">default</span>}
              <span className="badge model">{a.model === 'auto' ? 'Auto' : a.model}</span>
            </div>
            <div className="agent-name">{a.name}</div>
            <div className="muted small">{a.description}</div>
            <div className="tool-tags">{a.tools.map(t => <code key={t}>{t}</code>)}</div>
            {me.can.manageAgents && (
              <div className="row-end">
                <button className="btn ghost sm" onClick={() => setEdit({ ...a })}>{t('edit')}</button>
                {!a.is_default && <button className="btn ghost sm" onClick={() => del(a)}>{t('del')}</button>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Routines
const days = () => t('dayNames').split(',');

export function Routines({ onOpen }) {
  const [list, setList] = useState([]);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState('');
  const [running, setRunning] = useState(null);
  const load = () => api('/ai/routines').then(setList).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);
  const blank = { name: '', text: t('routineDefault'), time_of_day: '08:00', days: [1, 2, 3, 4, 5], webhook_url: '', enabled: true, tags: [] };

  const save = async e => {
    e.preventDefault(); setErr('');
    try {
      await api(edit.id ? `/ai/routines/${edit.id}` : '/ai/routines', { method: edit.id ? 'PUT' : 'POST', body: edit });
      setEdit(null); load();
    } catch (e2) { setErr(e2.message); }
  };
  const run = async r => {
    setRunning(r.id); setErr('');
    try { const out = await api(`/ai/routines/${r.id}/run`, { method: 'POST' }); onOpen(out.conversationId); }
    catch (e) { setErr(e.message); load(); }
    finally { setRunning(null); }
  };
  const del = async r => { if (confirm(t('confirmDelRoutine', { n: r.name }))) { await api(`/ai/routines/${r.id}`, { method: 'DELETE' }); load(); } };

  return (
    <div className="page">
      <div className="page-head">
        <div><h2>Routines</h2><p className="muted">{t('routinesSub')}</p></div>
        <button className="btn primary" onClick={() => setEdit(blank)}>{t('newRoutine')}</button>
      </div>
      {err && <div className="error">{err}</div>}
      {edit && (
        <form className="panel form" onSubmit={save}>
          <label>{t('name')}<input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder={t('routineName')} /></label>
          <label>{t('routineQ')}<textarea rows={3} value={edit.text} onChange={e => setEdit({ ...edit, text: e.target.value })} /></label>
          <div className="grid2">
            <label>{t('time')}<input type="time" value={edit.time_of_day} onChange={e => setEdit({ ...edit, time_of_day: e.target.value })} /></label>
            <fieldset><legend>{t('days')}</legend>
              <div className="days">
                {days().map((d, i) => (
                  <label key={d} className={`day ${edit.days.includes(i + 1) ? 'on' : ''}`}>
                    <input type="checkbox" checked={edit.days.includes(i + 1)}
                      onChange={e => setEdit({ ...edit, days: e.target.checked ? [...edit.days, i + 1] : edit.days.filter(x => x !== i + 1) })} />{d}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <label>{t('webhook')}<input value={edit.webhook_url || ''} onChange={e => setEdit({ ...edit, webhook_url: e.target.value })} placeholder="https://…" /></label>
          <label className="check"><input type="checkbox" checked={edit.enabled} onChange={e => setEdit({ ...edit, enabled: e.target.checked })} /> {t('enabled')}</label>
          <div className="row-end"><button type="button" className="btn ghost" onClick={() => setEdit(null)}>{t('cancel')}</button><button className="btn primary">{t('save')}</button></div>
        </form>
      )}
      <div className="panel">
        <table className="data wide">
          <thead><tr><th>{t('name')}</th><th>{t('question')}</th><th>{t('schedule')}</th><th>{t('nextRun')}</th><th>{t('lastRun')}</th><th /></tr></thead>
          <tbody>
            {list.map(r => (
              <tr key={r.id} className={r.enabled ? '' : 'muted'}>
                <td>{r.name}</td>
                <td className="clip">{r.text}</td>
                <td>{r.time_of_day} · {r.days.map(d => days()[d - 1]).join(' ')}</td>
                <td>{r.enabled && r.next_run_at ? new Date(r.next_run_at).toLocaleString(locale(), { timeZone: 'Asia/Bangkok' }) : '—'}</td>
                <td>{r.last_run ? <span className={`badge ${r.last_run.status}`} title={r.last_run.error || ''}>{r.last_run.status}{r.last_run.delivered ? ' · sent' : ''}</span> : '—'}</td>
                <td className="nowrap">
                  <button className="btn sm" disabled={running === r.id} onClick={() => run(r)}>{running === r.id ? t('running') : t('runNow')}</button>
                  {r.last_run?.conversation_id && <button className="btn ghost sm" onClick={() => onOpen(r.last_run.conversation_id)}>{t('viewResult')}</button>}
                  <button className="btn ghost sm" onClick={() => setEdit({ ...r })}>{t('edit')}</button>
                  <button className="btn ghost sm" onClick={() => del(r)}>{t('del')}</button>
                </td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={6} className="muted">{t('noRoutines')}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Usage
function Bars({ data }) {
  if (!data.length) return <div className="muted pad">{t('noData')}</div>;
  const max = Math.max(...data.map(d => d.cost), 1e-9);
  const w = 720, h = 180, pad = 24, bw = (w - pad) / data.length;
  return (
    <svg viewBox={`0 0 ${w} ${h + 22}`} className="bars" role="img" aria-label="Daily cost">
      <line x1={pad} y1={h} x2={w} y2={h} className="axis" />
      <text x={0} y={12} className="tick">{fmtUsd(max)}</text>
      {data.map((d, i) => {
        const bh = Math.max(2, (d.cost / max) * (h - 20));
        return (
          <g key={d.day}>
            <rect x={pad + i * bw + bw * 0.15} y={h - bh} width={bw * 0.7} height={bh} rx={3} className="bar">
              <title>{`${d.day}: ${fmtUsd(d.cost)} · ${d.calls} calls`}</title>
            </rect>
            {(data.length <= 14 || i % Math.ceil(data.length / 10) === 0) && (
              <text x={pad + i * bw + bw / 2} y={h + 16} className="tick" textAnchor="middle">{d.day.slice(5)}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function Usage() {
  const [days, setDays] = useState(30);
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api(`/ai/usage?days=${days}`).then(setD).catch(e => setErr(e.message)); }, [days]);
  if (err) return <div className="page"><div className="error">{err}</div></div>;
  if (!d) return <div className="page muted">{t('loading')}</div>;
  const routerTotal = d.router.reduce((s, r) => s + r.n, 0) || 1;
  const byRouterModel = Object.entries(d.router.reduce((acc, r) => ({ ...acc, [r.model]: (acc[r.model] || 0) + r.n }), {}));
  return (
    <div className="page">
      <div className="page-head">
        <div><h2>AI usage</h2><p className="muted">{t('usageSub')}</p></div>
        <select value={days} onChange={e => setDays(Number(e.target.value))}>
          {[7, 30, 90].map(n => <option key={n} value={n}>{t('lastDays', { n })}</option>)}
        </select>
      </div>
      <div className="stats">
        <div className="stat"><div className="stat-label">{t('cost')}</div><div className="stat-value">{fmtUsd(d.totals.cost)}</div></div>
        <div className="stat"><div className="stat-label">Model calls</div><div className="stat-value">{fmtInt(d.totals.calls)}</div></div>
        <div className="stat"><div className="stat-label">Input tokens</div><div className="stat-value">{fmtInt(d.totals.input_tokens)}</div>
          <div className="muted small">cache read {fmtInt(d.totals.cache_read_tokens)}</div></div>
        <div className="stat"><div className="stat-label">Output tokens</div><div className="stat-value">{fmtInt(d.totals.output_tokens)}</div></div>
      </div>
      <div className="panel"><h3>{t('dailyCost')}</h3><Bars data={d.daily} /></div>
      <div className="grid2">
        <div className="panel">
          <h3>{t('byModel')}</h3>
          <table className="data wide">
            <thead><tr><th>{t('model')}</th><th>{t('purpose')}</th><th className="num">calls</th><th className="num">in / out</th><th className="num">USD</th></tr></thead>
            <tbody>{d.byModel.map(r => (
              <tr key={r.model + r.purpose}><td>{r.provider === 'anthropic' ? modelLabel(r.model) : r.model}</td><td>{r.purpose}</td>
                <td className="num">{fmtInt(r.calls)}</td><td className="num">{fmtInt(r.input_tokens)} / {fmtInt(r.output_tokens)}</td><td className="num">{fmtUsd(r.cost)}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <div className="panel">
          <h3>{t('byUser')}</h3>
          <table className="data wide">
            <thead><tr><th>{t('person')}</th><th className="num">{t('chats')}</th><th className="num">calls</th><th className="num">USD</th></tr></thead>
            <tbody>{d.byUser.map(r => (
              <tr key={r.name}><td>{r.name} <span className="muted small">{r.role}</span></td><td className="num">{r.conversations}</td><td className="num">{fmtInt(r.calls)}</td><td className="num">{fmtUsd(r.cost)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>
      <div className="panel">
        <h3>{t('routerTitle')}</h3>
        {byRouterModel.map(([m, n]) => (
          <div key={m} className="share-row">
            <span className="share-label">{m}</span>
            <div className="share-track"><div className={`share-fill ${m}`} style={{ width: `${(n / routerTotal) * 100}%` }} /></div>
            <span className="num">{Math.round((n / routerTotal) * 100)}% · {n}</span>
          </div>
        ))}
        {!d.router.length && <div className="muted">{t('noData')}</div>}
        <p className="muted small">{t('routerNote')}</p>
      </div>
    </div>
  );
}
