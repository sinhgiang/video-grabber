// Kiểm "build" cho pull request (T-0911), không cần Windows, không tải Electron, không cần bin/.
// `npm run dist` (electron-builder) chỉ chạy được trên máy Windows có yt-dlp và ffmpeg, nên CI không đóng
// gói thật; script này bắt những lỗi đóng gói hay gặp mà không cần đóng gói:
//   1. mọi tệp JS của app (server.js, electron/, lib/) và của scripts/ chạy lúc cài và đóng gói đều đúng
//      cú pháp (node --check);
//   2. mọi require("...") bằng chuỗi trỏ tới tệp có thật, hoặc tới module có sẵn của Node, hoặc tới gói nằm
//      trong "dependencies" (gói chỉ nằm ở devDependencies sẽ không được đóng vào app);
//   3. "main" và các mục trong build.files tồn tại (trừ bin/, thư mục sinh ra lúc cài);
//   4. trang public/index.html chỉ gọi tệp css/js nội bộ có thật.
// Require viết bằng biến (require(x)) không đọc được bằng cách này nên không được kiểm.
const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const errors = [];

// Thư mục sinh ra lúc cài hoặc lúc đóng gói, không nằm trong git.
const GENERATED = new Set(['bin', 'node_modules']);

function exists(p) {
  return fs.existsSync(path.join(root, p));
}

// 3. main và build.files
if (!exists(pkg.main)) errors.push(`package.json "main" trỏ tới tệp không có: ${pkg.main}`);
for (const pattern of pkg.build.files) {
  const top = pattern.split('/')[0];
  if (GENERATED.has(top)) continue;
  if (!exists(top)) errors.push(`build.files nêu "${pattern}" nhưng "${top}" không có`);
}

// Gom tệp JS được đóng gói (không gồm public/js: chạy trong trình duyệt, không có require).
function listJs(rel) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return rel.endsWith('.js') ? [rel] : [];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((e) => listJs(path.join(rel, e.name)));
}
const files = [
  'server.js',
  ...listJs('electron'),
  ...listJs('lib'),
  ...listJs('scripts'),
].map((f) => f.split(path.sep).join('/'));

const deps = new Set(Object.keys(pkg.dependencies || {}));
const builtins = new Set(builtinModules);

function packageName(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function resolveRelative(fromFile, spec) {
  const base = path.resolve(root, path.dirname(fromFile), spec);
  const candidates = [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')];
  return candidates.some((c) => fs.existsSync(c) && fs.statSync(c).isFile());
}

for (const file of files) {
  // 1. cú pháp
  const r = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  if (r.status !== 0) errors.push(`${file}: lỗi cú pháp\n${(r.stderr || '').trim()}`);

  // 2. require bằng chuỗi (bỏ qua chính script này: trong mã và thông báo của nó có chữ require("..."))
  if (file === 'scripts/check-build.js') continue;
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const re = /\brequire\(\s*(['"])([^'"]+)\1\s*\)/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const spec = m[2];
    if (spec.startsWith('.')) {
      if (!resolveRelative(file, spec)) errors.push(`${file}: require("${spec}") không trỏ tới tệp nào`);
    } else if (spec.startsWith('node:') || builtins.has(spec.split('/')[0]) || spec === 'electron') {
      // module có sẵn của Node hoặc của Electron
    } else if (!deps.has(packageName(spec))) {
      errors.push(`${file}: require("${spec}") nhưng "${packageName(spec)}" không nằm trong "dependencies" (app đóng gói sẽ thiếu nó)`);
    }
  }
}

// 4. trang chính chỉ gọi tệp nội bộ có thật
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const refRe = /<(?:script[^>]*\ssrc|link[^>]*\shref)=["']([^"'#?]+)["']/gi;
for (let m = refRe.exec(html); m; m = refRe.exec(html)) {
  const ref = m[1];
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(ref) || ref.startsWith('data:')) continue; // địa chỉ ngoài
  const local = path.join('public', ref.replace(/^\//, ''));
  if (!exists(local)) errors.push(`public/index.html gọi "${ref}" nhưng ${local.split(path.sep).join('/')} không có`);
}

if (errors.length) {
  console.error('Kiểm build thất bại:\n- ' + errors.join('\n- '));
  process.exit(1);
}
console.log(`Kiểm build đạt: ${files.length} tệp JS đúng cú pháp, require khớp "dependencies", build.files và trang chính đủ tệp.`);
