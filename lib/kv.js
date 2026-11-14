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

// 原子的な操作（2026-11-14・段階1の修正）：Redis の Lua（EVAL）で「確かめる→書く」を1つの命令にする。Upstash の REST でもそのまま使える。
// テスト用の memoryKv は、同じ意味の処理を JavaScript で（途中で待たずに）行う。
export const SCRIPTS = {
  // まだ無ければ作る：KEYS=[中身, 更新番号, 一覧(hash), 状態の集合]・ARGV=[中身, ID, 一覧の値]。戻り値 1＝作った／0＝既にある
  createIfAbsent: `if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
redis.call('SET', KEYS[1], ARGV[1])
redis.call('SET', KEYS[2], '1')
redis.call('HSET', KEYS[3], ARGV[2], ARGV[3])
redis.call('SADD', KEYS[4], ARGV[2])
return 1`,
  // 更新番号が一致し、移り先の状態の件数に空きがあるときだけ書く（状態の集合の移動も同じ命令で）
  //   KEYS=[中身, 更新番号, 一覧(hash), 移る前の状態の集合, 移った後の状態の集合]・ARGV=[読んだ番号, 新しい中身, 新しい番号, ID, 一覧の値, 移り先の上限（0＝上限なし）]
  //   戻り値 {1}＝書いた／{0, 今の番号}＝競合／{-1}＝無い／{2, 今の件数}＝移り先が満杯
  casMove: `local cur = redis.call('GET', KEYS[2])
if not cur then return {-1} end
if cur ~= ARGV[1] then return {0, cur} end
local limit = tonumber(ARGV[6])
if limit > 0 and KEYS[4] ~= KEYS[5] and redis.call('SISMEMBER', KEYS[5], ARGV[4]) == 0 then
  local n = redis.call('SCARD', KEYS[5])
  if n >= limit then return {2, n} end
end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], ARGV[3])
redis.call('HSET', KEYS[3], ARGV[4], ARGV[5])
if KEYS[4] ~= KEYS[5] then
  redis.call('SREM', KEYS[4], ARGV[4])
  redis.call('SADD', KEYS[5], ARGV[4])
end
return {1}`,
  // 自分が取った鍵だけを外す：KEYS=[鍵]・ARGV=[自分の印]。戻り値 1＝外した／0＝ほかの処理の鍵なので外さない
  delIfEqual: `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`
};

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
      case 'HSET': { const h = alive(a[0]) ? JSON.parse(m.get(a[0])) : {}; for (let i = 1; i < a.length; i += 2) h[a[i]] = String(a[i + 1]); m.set(a[0], JSON.stringify(h)); return 1; }
      case 'HGETALL': { const h = alive(a[0]) ? JSON.parse(m.get(a[0])) : {}; return Object.entries(h).flat(); }
      case 'EXISTS': return alive(a[0]) ? 1 : 0;
      case 'SADD': { const st = new Set(alive(a[0]) ? JSON.parse(m.get(a[0])) : []); a.slice(1).forEach((v) => st.add(String(v))); m.set(a[0], JSON.stringify([...st])); return 1; }
      case 'SREM': { const st = new Set(alive(a[0]) ? JSON.parse(m.get(a[0])) : []); a.slice(1).forEach((v) => st.delete(String(v))); m.set(a[0], JSON.stringify([...st])); return 1; }
      case 'SCARD': return alive(a[0]) ? JSON.parse(m.get(a[0])).length : 0;
      case 'SMEMBERS': return alive(a[0]) ? JSON.parse(m.get(a[0])) : [];
      case 'EVAL': {
        // 本番の Lua と同じ意味の処理（途中で待たないので、ほかの命令が割り込まない）
        const [script, n, ...rest] = a; const keys = rest.slice(0, Number(n)); const argv = rest.slice(Number(n)).map(String);
        const get = (k) => (alive(k) ? m.get(k) : null);
        const hset = (k, f, v) => { const h = alive(k) ? JSON.parse(m.get(k)) : {}; h[f] = v; m.set(k, JSON.stringify(h)); };
        const members = (k) => (alive(k) ? JSON.parse(m.get(k)) : []);
        const sset = (k, arr) => m.set(k, JSON.stringify(arr));
        if (script === SCRIPTS.createIfAbsent) { if (get(keys[1]) != null) return 0; m.set(keys[0], argv[0]); m.set(keys[1], '1'); hset(keys[2], argv[1], argv[2]); sset(keys[3], [...new Set([...members(keys[3]), argv[1]])]); return 1; }
        if (script === SCRIPTS.casMove) {
          const cur = get(keys[1]); if (cur == null) return [-1]; if (cur !== argv[0]) return [0, cur];
          const limit = Number(argv[5]);
          if (limit > 0 && keys[3] !== keys[4] && !members(keys[4]).includes(argv[3]) && members(keys[4]).length >= limit) return [2, members(keys[4]).length];
          m.set(keys[0], argv[1]); m.set(keys[1], argv[2]); hset(keys[2], argv[3], argv[4]);
          if (keys[3] !== keys[4]) { sset(keys[3], members(keys[3]).filter((x) => x !== argv[3])); sset(keys[4], [...new Set([...members(keys[4]), argv[3]])]); }
          return [1];
        }
        if (script === SCRIPTS.delIfEqual) { if (get(keys[0]) === argv[0]) { m.delete(keys[0]); exp.delete(keys[0]); return 1; } return 0; }
        throw new KvError('未対応の命令（EVAL）');
      }
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
    eval: (name, keys, args) => cmd('EVAL', SCRIPTS[name], keys.length, ...keys, ...args),
    delIf: (k, token) => cmd('EVAL', SCRIPTS.delIfEqual, 1, k, token),
    hgetallJson: async (k) => { const flat = (await cmd('HGETALL', k)) || []; const out = {}; for (let i = 0; i < flat.length; i += 2) { try { out[flat[i]] = JSON.parse(flat[i + 1]); } catch { /* 読めない値は飛ばす */ } } return out; },
    listJson: async (k, n = 50) => ((await cmd('LRANGE', k, 0, n - 1)) || []).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean)
  };
}

// 検証用：すべての鍵の前に prefix を付ける（Upstash の実機での検証で、ほかのデータに触れないため）。使った鍵を記録し、あとで片付けられるようにする
const KEY_AT = { GET: 1, SET: 1, EXISTS: 1, INCR: 1, INCRBYFLOAT: 1, EXPIRE: 1, LPUSH: 1, LTRIM: 1, LRANGE: 1, HSET: 1, HGETALL: 1, SADD: 1, SREM: 1, SCARD: 1, SMEMBERS: 1 };
export function prefixKv(kv, prefix) {
  const used = new Set();
  const p = (k) => { const x = `${prefix}${k}`; used.add(x); return x; };
  async function cmd(op, ...a) {
    if (op === 'DEL') return kv.cmd('DEL', ...a.map(p));
    if (op === 'EVAL') { const [script, n, ...rest] = a; const keys = rest.slice(0, Number(n)).map(p); return kv.cmd('EVAL', script, n, ...keys, ...rest.slice(Number(n))); }
    if (KEY_AT[op]) return kv.cmd(op, p(a[0]), ...a.slice(1));
    throw new KvError(`prefixKv：未対応の命令 ${op}`);
  }
  const w = wrap(cmd);
  w.usedKeys = () => [...used];
  w.cleanup = async () => { const keys = [...used]; for (let i = 0; i < keys.length; i += 50) await kv.cmd('DEL', ...keys.slice(i, i + 50)); return keys.length; };
  return w;
}

export function kvFrom(env, fetchImpl) {
  if (env.__kv) return env.__kv; // テストで差し込む
  const c = kvConfig(env);
  return c ? restKv(c, fetchImpl) : null;
}
