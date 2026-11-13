// サーバー側の保存場所（自律運営・2026-11-14）：Upstash Redis（Vercel Marketplace の無料枠）を REST で使う。SDKは使わない。
// 環境変数：KV_REST_API_URL / KV_REST_API_TOKEN（Vercel の連携で入る名前）か、UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN。
// 設定がなければ kvFrom は null を返す（自律運営は「未接続」として動かない。今までの機能には影響しない）。
// テストでは memoryKv() を使う（本番では使わない）。
export class KvError extends Error {}

export function kvConfig(env) {
  const url = String(env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/$/, '');
  const token = String(env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  return url && token && /^https:\/\//.test(url) ? { url, token } : null;
}

// Upstash の REST：POST / に ["SET","key","value",...] を送る（1回の通信で1つの命令）
export function restKv({ url, token }, fetchImpl = (...a) => fetch(...a)) {
  async function cmd(...args) {
    let res;
    try {
      res = await fetchImpl(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args.map((a) => (typeof a === 'string' ? a : String(a)))), signal: AbortSignal.timeout(8000) });
    } catch (e) {
      throw new KvError(`保存場所に接続できませんでした（${e.name}）`);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.error) throw new KvError(`保存場所のエラー（${res.status}${data && data.error ? `: ${String(data.error).slice(0, 120)}` : ''}）`);
    return data.result;
  }
  return wrap(cmd);
}

// テスト用（本番では使わない）：同じ命令をメモリで再現する
export function memoryKv() {
  const m = new Map();
  const exp = new Map();
  const alive = (k) => { const t = exp.get(k); if (t && t <= Date.now()) { m.delete(k); exp.delete(k); } return m.has(k); };
  async function cmd(op, ...a) {
    switch (op) {
      case 'GET': return alive(a[0]) ? m.get(a[0]) : null;
      case 'SET': {
        const [k, v, ...opt] = a;
        const nx = opt.includes('NX');
        const ex = opt.indexOf('EX');
        if (nx && alive(k)) return null;
        m.set(k, String(v));
        if (ex !== -1) exp.set(k, Date.now() + Number(opt[ex + 1]) * 1000); else exp.delete(k);
        return 'OK';
      }
      case 'DEL': { let n = 0; a.forEach((k) => { if (m.delete(k)) n++; exp.delete(k); }); return n; }
      case 'INCRBYFLOAT': { const v = (alive(a[0]) ? Number(m.get(a[0])) : 0) + Number(a[1]); m.set(a[0], String(v)); return String(v); }
      case 'INCR': { const v = (alive(a[0]) ? Number(m.get(a[0])) : 0) + 1; m.set(a[0], String(v)); return v; }
      case 'EXPIRE': if (alive(a[0])) exp.set(a[0], Date.now() + Number(a[1]) * 1000); return 1;
      case 'LPUSH': { const l = alive(a[0]) ? JSON.parse(m.get(a[0])) : []; a.slice(1).forEach((v) => l.unshift(String(v))); m.set(a[0], JSON.stringify(l)); return l.length; }
      case 'LTRIM': { const l = alive(a[0]) ? JSON.parse(m.get(a[0])) : []; m.set(a[0], JSON.stringify(l.slice(Number(a[1]), Number(a[2]) + 1))); return 'OK'; }
      case 'LRANGE': { const l = alive(a[0]) ? JSON.parse(m.get(a[0])) : []; const end = Number(a[2]) === -1 ? l.length : Number(a[2]) + 1; return l.slice(Number(a[1]), end); }
      default: throw new KvError(`未対応の命令 ${op}`);
    }
  }
  return wrap(cmd);
}

function wrap(cmd) {
  return {
    cmd,
    get: (k) => cmd('GET', k),
    getJson: async (k) => { const v = await cmd('GET', k); if (v == null) return null; try { return JSON.parse(v); } catch { return null; } },
    set: (k, v, { nx = false, ex = 0 } = {}) => cmd('SET', k, v, ...(nx ? ['NX'] : []), ...(ex ? ['EX', ex] : [])),
    setJson: (k, v, opt) => cmd('SET', k, JSON.stringify(v), ...((opt && opt.ex) ? ['EX', opt.ex] : [])),
    del: (...k) => cmd('DEL', ...k),
    incrFloat: async (k, n) => Number(await cmd('INCRBYFLOAT', k, n)),
    incr: async (k) => Number(await cmd('INCR', k)),
    expire: (k, s) => cmd('EXPIRE', k, s),
    pushJson: async (k, v, keep = 200) => { await cmd('LPUSH', k, JSON.stringify(v)); await cmd('LTRIM', k, 0, keep - 1); },
    listJson: async (k, n = 50) => ((await cmd('LRANGE', k, 0, n - 1)) || []).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean)
  };
}

export function kvFrom(env, fetchImpl) {
  if (env.__kv) return env.__kv; // テストで差し込む
  const c = kvConfig(env);
  return c ? restKv(c, fetchImpl) : null;
}
