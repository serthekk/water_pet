'use strict';
// Local fake update feed: test every updater state without a real GitHub release.
//
//   node tools/update-test-server.js [mode] [version]
//     mode:    ok (default) | slow | current | fail | badsha
//     version: the "new" version to offer (default 0.1.1)
//
// Then start the app from source against it (a second terminal, PowerShell):
//   $env:FORCE_UPDATER = '1'; npm start
// and right-click the cat -> "Check for updates" (or wait 30 s).
//   ok      -> "Downloading v0.1.1..." -> "Update ready (v0.1.1)" + the bubble
//   slow    -> the same, but the download takes ~40 s so you can watch the progress
//   current -> "You're up to date"
//   fail    -> HTTP 500 -> "Couldn't check right now" (and the log says why)
//   badsha  -> the download doesn't match its checksum -> rejected, nothing installs
//   (offline: just don't run this server -> "Couldn't check right now")
// The "installer" served here is dummy bytes: in this test mode "Restart to update" only
// logs what it would do. dev-app-update.yml (project root) points the app here.
const http = require('http');
const crypto = require('crypto');

const PORT = 47613;

function dummyInstaller(size) {
  // deterministic bytes, so the checksum is stable between runs
  const buf = Buffer.alloc(size);
  let x = 2463534242;
  for (let i = 0; i < size; i++) {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    buf[i] = x & 255;
  }
  return buf;
}

// opts: { port, mode, version, current, size, bytesPerSec, quiet }
function startServer(opts = {}) {
  const mode = opts.mode || 'ok';
  const version = opts.version || '0.1.1';
  const current = opts.current || '0.1.0';
  const size = opts.size || 6 * 1024 * 1024;
  const bytesPerSec = opts.bytesPerSec || (mode === 'slow' ? 150 * 1024 : 3 * 1024 * 1024);
  const offered = mode === 'current' ? current : version;
  const file = `WaterCat-Setup-${offered}.exe`;
  const exe = dummyInstaller(size);
  let sha512 = crypto.createHash('sha512').update(exe).digest('base64');
  if (mode === 'badsha') sha512 = crypto.createHash('sha512').update('not the same file').digest('base64');
  const yml = [
    `version: ${offered}`,
    'files:',
    `  - url: ${file}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${file}`,
    `sha512: ${sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    '',
  ].join('\n');
  const requests = [];
  const say = (m) => { if (!opts.quiet) process.stdout.write(`${m}\n`); };

  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    requests.push(url);
    say(`${req.method} ${url}`);
    if (mode === 'fail') {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end('test feed: simulated server error');
    }
    if (url === '/latest.yml') {
      res.writeHead(200, { 'Content-Type': 'text/yaml', 'Content-Length': Buffer.byteLength(yml) });
      return res.end(yml);
    }
    if (url === `/${file}`) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': size });
      // trickle it out so the "Downloading... N%" state is visible
      const chunk = Math.max(16 * 1024, Math.round(bytesPerSec / 10));
      let off = 0;
      const pump = () => {
        if (off >= size || res.destroyed) return res.end();
        res.write(exe.subarray(off, off + chunk));
        off += chunk;
        return setTimeout(pump, 100);
      };
      return pump();
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('not found');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port === undefined ? PORT : opts.port, '127.0.0.1', () => {
      const { port } = server.address();
      say(`Test update feed (${mode}) offering v${offered} at http://127.0.0.1:${port}/  - Ctrl+C to stop`);
      resolve({ url: `http://127.0.0.1:${port}/`, port, offered, requests, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

module.exports = { startServer, PORT };

if (require.main === module) {
  const [mode = 'ok', version = '0.1.1'] = process.argv.slice(2);
  if (!['ok', 'slow', 'current', 'fail', 'badsha'].includes(mode)) {
    process.stderr.write('mode must be one of: ok, slow, current, fail, badsha\n');
    process.exit(2);
  }
  // eslint-disable-next-line global-require
  const current = require('../package.json').version;
  startServer({ mode, version, current }).catch((err) => {
    process.stderr.write(`could not start: ${err.message}\n`);
    process.exit(1);
  });
}
