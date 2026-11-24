// 本番の版（2026-11-24・KOT-14）：/api/version
//   自動開発の「本番反映の確認」が、マージしたコミットが本番で動いているかを確かめるために使う（秘密は返さない）
//   VERCEL_GIT_COMMIT_SHA などは Vercel が自動で入れるシステムの環境変数（値は公開して問題ないコミットの番号・ブランチ名）
import { send } from '../lib/http.js';

export default async function handler(req, res, env = process.env) {
  return send(res, 200, {
    commit: String(env.VERCEL_GIT_COMMIT_SHA || ''),
    branch: String(env.VERCEL_GIT_COMMIT_REF || ''),
    env: String(env.VERCEL_ENV || ''),
    at: new Date().toISOString()
  });
}
