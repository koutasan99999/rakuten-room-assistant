// マスター画像の取り込み（開発用）：画像を assets/kuma-master/ に写し、lib/kuma-master-manifest.js に「確認待ち」で記録する。
// 社長の承認は、アプリの画面（広報のいちばん上）で行う。ここでは承認しない。
// 使い方：node scripts/kuma-master-add.mjs <元の画像> <ID> <front|full|side> --single --no-text --no-logo [--note "メモ"]
//   --single --no-text --no-logo は、画像を見て「くまが1体だけ」「文字が無い」「ロゴが無い」を確かめたときだけ付ける
//   デザインの参考資料（assets/kuma-reference/）は取り込めない
import fs from 'node:fs';
import path from 'node:path';
import { imageInfo, sha256, validateMaster } from '../lib/kuma-master.js';
import { MASTERS } from '../lib/kuma-master-manifest.js';

const [src, id, kind] = process.argv.slice(2);
const flag = (f) => process.argv.includes(f);
const noteAt = process.argv.indexOf('--note');
if (!src || !id || !kind) { console.error('使い方：node scripts/kuma-master-add.mjs <元の画像> <ID> <front|full|side> --single --no-text --no-logo'); process.exit(2); }
if (/kuma-reference/.test(path.resolve(src))) { console.error('デザインの参考資料（kuma-reference）はマスターにできません'); process.exit(2); }
const buf = fs.readFileSync(src);
const info = imageInfo(buf);
if (!info) { console.error('PNG か JPEG ではありません'); process.exit(2); }
const file = `${id}.${info.format === 'jpeg' ? 'jpg' : 'png'}`;
const entry = {
  id, kind, file, format: info.format, width: info.width, height: info.height, bytes: buf.length, sha256: sha256(buf),
  addedAt: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10),
  checked: { single: flag('--single'), noText: flag('--no-text'), noLogo: flag('--no-logo'), by: '開発（目視）' },
  note: noteAt > 0 ? String(process.argv[noteAt + 1] || '').slice(0, 120) : ''
};
const others = MASTERS.filter((m) => m.id !== id);
const problems = validateMaster(entry, others.concat([entry]));
if (problems.length) { console.error(`取り込めません：${problems.join('／')}`); process.exit(1); }
fs.mkdirSync('assets/kuma-master', { recursive: true });
fs.writeFileSync(path.join('assets/kuma-master', file), buf);
const list = others.concat([entry]);
fs.writeFileSync('lib/kuma-master-manifest.js', `// サングラスくまのマスター画像の一覧（scripts/kuma-master-add.mjs が書く。手で直さない）。\n// 社長の承認はここではなく、サーバーの保存場所に記録する（lib/kuma-master.js）。\nexport const MASTERS = ${JSON.stringify(list, null, 2)};\n`);
console.log(`取り込みました（確認待ち）：${file} ${info.width}×${info.height} ${entry.sha256.slice(0, 12)}…`);
