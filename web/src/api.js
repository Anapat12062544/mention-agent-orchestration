export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined || method !== 'GET' ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : method !== 'GET' ? '{}' : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const fmtUsd = n => `$${Number(n || 0).toFixed(Number(n) < 1 ? 4 : 2)}`;
export const fmtInt = n => Number(n || 0).toLocaleString('en-US');
export const modelLabel = id => {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(id || '');
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? '.' + m[3] : ''}` : id || '';
};
