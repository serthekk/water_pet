'use strict';
// Plain-node test of sync.js (no Electron): node tools/sync-test.js
// Uses a fake main.js (in-memory settings + cups) and real HTTP + UDP on random ports.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const dgram = require('dgram');
const Sync = require('../sync.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watercat-sync-'));
let clock = Date.UTC(2026, 10, 20, 12, 0, 0);
const today = () => { const d = new Date(clock); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

// fake main.js
const desk = {
  settings: { goalCups: 8, reminderMinutes: 60, repeatMinutes: 5, quietStart: '23:00', quietEnd: '08:00', alarms: [{ id: 'pill', time: '22:00', text: 'Pill', enabled: true }], remindersPausedUntil: 0 },
  cups: {},
};
let sync = null;
const hooks = {
  name: () => 'Gargorl on TEST',
  snapshot: () => ({ settings: { ...desk.settings }, totals: { ...desk.cups }, goals: {}, streak: 0, best: 0, catName: 'Gargorl', drinkWord: 'cups' }),
  applySettings: (p) => {
    const changed = [];
    for (const [k, v] of Object.entries(p)) {
      if (k === 'goalCups' && !(Number.isInteger(v) && v > 0 && v <= 100)) continue; // main.js ignores invalid values
      if (JSON.stringify(desk.settings[k]) !== JSON.stringify(v)) changed.push(k);
      desk.settings[k] = v;
    }
    sync.noteLocalChange(changed); // like main.js applySettings
  },
  applyCups: (date, delta) => { desk.cups[date] = Math.max(0, (desk.cups[date] || 0) + delta); },
};
const mk = () => Sync.create({ dataDir: dir, hooks, now: () => clock, httpPort: 0, discoveryPort: 0, version: 'test' });
sync = mk();
const H = sync._handle;
let passed = 0;
const ok = (name, cond) => { assert.ok(cond, name); passed++; console.log(`ok - ${name}`); };

// The phone side of a signed call (like the Kotlin SyncClient): challenge, check the
// computer's proof, sign the body, check the answer's proof.
const crypto = require('crypto');
function S(handle, deviceId, token, body, url = '/watercat/sync') {
  const key = Sync.deriveKey(token);
  const c = crypto.randomBytes(16).toString('hex');
  const ch = handle.challenge({ deviceId, c });
  if (ch.status !== 200) return ch;
  assert.strictEqual(ch.body.proof, Sync.hmac(key, `srv:${c}:${ch.body.nonce}`), 'computer proof');
  const raw = Buffer.from(JSON.stringify(body));
  const headers = { 'x-watercat-device': deviceId, 'x-watercat-nonce': ch.body.nonce, 'x-watercat-sig': Sync.hmac(key, `cli:${ch.body.nonce}:${Sync.sha256(raw)}`) };
  const r = handle.signed(url, headers, raw);
  if (r.status === 200) assert.strictEqual(r.headers['X-WaterCat-Proof'], Sync.hmac(key, `resp:${ch.body.nonce}:${Sync.sha256(r.data)}`), 'answer proof');
  return { ...r, nonce: ch.body.nonce, headers, raw };
}
const A = 'phone-aaaaaaaa';

// pairing
const code = sync.info().code;
ok('code is 6 digits', /^\d{6}$/.test(code));
ok('bad device id refused', H.pair({ code, deviceId: 'x' }).status === 400);
const wrong = code === '000000' ? '111111' : '000000';
for (let i = 0; i < 4; i++) assert.strictEqual(H.pair({ code: wrong, deviceId: 'phone-aaaaaaaa' }).status, 403);
const p1 = H.pair({ code: code.slice(0, 3) + ' ' + code.slice(3), deviceId: 'phone-aaaaaaaa', deviceName: 'Pixel' });
ok('right code (with a space) pairs and returns a token', p1.status === 200 && /^[0-9a-f]{64}$/.test(p1.body.token));
const token = p1.body.token;
ok('the token itself is not stored', !fs.readFileSync(path.join(dir, 'sync.json'), 'utf8').includes(token));
ok('pair answers with the computer id', /^[0-9a-f]{16}$/.test(p1.body.id) && p1.body.id === sync.info().id);
for (let i = 0; i < 5; i++) H.pair({ code: wrong, deviceId: 'phone-bbbbbbbb' });
ok('5 wrong codes lock pairing (429)', H.pair({ code, deviceId: 'phone-bbbbbbbb' }).status === 429);
clock += 11 * 60 * 1000;
ok('lock ends after 10 minutes', H.pair({ code, deviceId: 'phone-bbbbbbbb', deviceName: 'Tablet' }).status === 200);
ok('a phone with the wrong key sees the computer\'s proof fail (sends nothing)', (() => { try { S(H, A, 'f'.repeat(64), {}); return false; } catch (e) { return /computer proof/.test(e.message); } })());
ok('an unknown phone gets no challenge (401, with the computer id)', H.challenge({ deviceId: 'phone-zzzzzzzz', c: 'ab'.repeat(16) }).status === 401 && H.challenge({ deviceId: 'phone-zzzzzzzz', c: 'ab'.repeat(16) }).body.id === sync.info().id);
{
  const first = S(H, A, token, { now: clock });
  ok('a signed sync works', first.status === 200);
  ok('a nonce works only once (replay refused)', H.signed('/watercat/sync', first.headers, first.raw).status === 401);
  const ch = H.challenge({ deviceId: A, c: 'cd'.repeat(16) });
  const raw = Buffer.from('{"cups":{}}');
  const sig = Sync.hmac(Sync.deriveKey(token), `cli:${ch.body.nonce}:${Sync.sha256(Buffer.from('{}'))}`);
  ok('a changed body breaks the signature', H.signed('/watercat/sync', { 'x-watercat-device': A, 'x-watercat-nonce': ch.body.nonce, 'x-watercat-sig': sig }, raw).status === 401);
  const ch2 = H.challenge({ deviceId: A, c: 'ef'.repeat(16) });
  clock += 61 * 1000;
  const raw2 = Buffer.from('{}');
  ok('a nonce expires after a minute', H.signed('/watercat/sync', { 'x-watercat-device': A, 'x-watercat-nonce': ch2.body.nonce, 'x-watercat-sig': Sync.hmac(Sync.deriveKey(token), `cli:${ch2.body.nonce}:${Sync.sha256(raw2)}`) }, raw2).status === 401);
}

// cups add up and undo works
const t0 = today();
let r = S(H, A, token, { now: clock, cups: { [t0]: 3 }, settings: {} });
ok('phone cups added to the desktop', r.status === 200 && desk.cups[t0] === 3 && r.body.totals[t0] === 3 && r.body.mine[t0] === 3);
desk.cups[t0] += 2; // 2 cups logged on the desktop
r = S(H, A, token, { now: clock, cups: { [t0]: 4 } });
ok('only the difference is added (3 -> 4) and desktop cups count', desk.cups[t0] === 6 && r.body.totals[t0] === 6);
r = S(H, A, token, { now: clock, cups: { [t0]: 4 } });
ok('repeating a sync adds nothing', desk.cups[t0] === 6);
r = S(H, A, token, { now: clock, cups: { [t0]: 2 } });
ok('undo on the phone takes cups off', desk.cups[t0] === 4);
r = S(H, A, token, { now: clock, cups: { '2099-01-01': 5, 'bad': 1, [t0]: -1 } });
ok('future / bad dates and values ignored', desk.cups[t0] === 4 && !desk.cups['2099-01-01']);

// settings: newest wins, desktop wins ties, invalid values are not stamped
r = S(H, A, token, { now: clock, settings: { goalCups: { v: 10, t: 0 } } });
ok('an unstamped (never edited) phone value does not win', desk.settings.goalCups === 8 && r.body.settings.goalCups.v === 8);
clock += 1000;
r = S(H, A, token, { now: clock, settings: { goalCups: { v: 10, t: clock - 500 }, quietStart: { v: '22:30', t: clock - 500 } } });
ok('a newer phone change wins', desk.settings.goalCups === 10 && desk.settings.quietStart === '22:30' && r.body.settings.goalCups.t === clock - 500);
clock += 1000;
hooks.applySettings({ goalCups: 12 }); // edited on the desktop afterwards
r = S(H, A, token, { now: clock, settings: { goalCups: { v: 10, t: clock - 1500 } } });
ok('a newer desktop change wins', desk.settings.goalCups === 12 && r.body.settings.goalCups.v === 12);
clock += 1000;
r = S(H, A, token, { now: clock, settings: { goalCups: { v: 500, t: clock } } });
ok('an invalid phone value is ignored and not stamped', desk.settings.goalCups === 12 && r.body.settings.goalCups.v === 12);
// phone clock 1 h behind: its stamps are corrected
clock += 1000;
const skew = 3600 * 1000;
r = S(H, A, token, { now: clock - skew, settings: { repeatMinutes: { v: 7, t: clock - skew - 100 }, remindersPausedUntil: { v: clock - skew + 60000, t: clock - skew - 100 } } });
ok('a phone with a slow clock still wins with a newer change', desk.settings.repeatMinutes === 7);
ok('pause time converted to desktop clock and back', desk.settings.remindersPausedUntil === clock + 60000 && r.body.settings.remindersPausedUntil.v === clock - skew + 60000);
ok('stamps answered in the phone clock', r.body.settings.repeatMinutes.t === clock - skew - 100);
r = S(H, A, token, { now: clock, settings: { alarms: { v: [{ id: 'a1', time: '07:00', text: 'Wake', enabled: true }], t: clock + 3600 * 1000 } } });
ok('a stamp far in the future is ignored', desk.settings.alarms[0].id === 'pill');

// persistence + forgetting
const s2 = mk();
ok('devices + stamps survive a restart', s2.info().devices.length === 2 && s2._state().stamps.goalCups > 0 && s2._state().devices['phone-aaaaaaaa'].cups[t0] === 2);
const p2 = s2._handle.pair({ code: s2.info().code, deviceId: 'phone-aaaaaaaa', deviceName: 'Pixel' });
ok('re-pairing keeps the phone\'s cups (no double count)', p2.status === 200 && s2._state().devices['phone-aaaaaaaa'].cups[t0] === 2);
s2.forget('phone-bbbbbbbb');
ok('forget one phone', s2.info().devices.length === 1);
ok('old token stops working after re-pairing', (() => { try { return S(s2._handle, A, token, {}).status === 401; } catch (_) { return true; } })());
const t2 = p2.body.token;
ok('unpair from the phone', S(s2._handle, A, t2, {}, '/watercat/unpair').status === 200 && s2.info().devices.length === 0);
const c1 = s2.info().code;
ok('new code', s2.newCode().code !== c1 || c1 === s2.info().code);

// real network: HTTP + UDP discovery
(async () => {
  const net = Sync.create({ dataDir: dir, hooks, now: () => clock, httpPort: 0, discoveryPort: 0, networks: async () => null });
  net.start();
  await new Promise((res) => setTimeout(res, 300));
  const info = net.info();
  ok('server running', info.running && info.port > 0);
  const req = (method, url, body, headers = {}) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const q = http.request({ host: '127.0.0.1', port: info.port, path: url, method, headers: { 'Content-Type': 'application/json', ...headers } }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b), raw: b, headers: res.headers }));
    });
    q.on('error', reject);
    q.end(data);
  });
  const hi = await req('GET', '/watercat/hello');
  ok('GET hello (with the computer id)', hi.status === 200 && hi.body.app === 'WaterCat' && hi.body.id === info.id && hi.body.protocol === 2);
  const pr = await req('POST', '/watercat/pair', { code: info.code, deviceId: 'phone-cccccccc', deviceName: 'Net' });
  ok('POST pair', pr.status === 200);
  const key = Sync.deriveKey(pr.body.token);
  const ch = await req('POST', '/watercat/challenge', { deviceId: 'phone-cccccccc', c: '12'.repeat(16) });
  ok('POST challenge proves the key', ch.status === 200 && ch.body.proof === Sync.hmac(key, `srv:${'12'.repeat(16)}:${ch.body.nonce}`));
  const body = { now: clock, cups: { [t0]: 1 } };
  const sig = Sync.hmac(key, `cli:${ch.body.nonce}:${Sync.sha256(Buffer.from(JSON.stringify(body)))}`);
  const sy = await req('POST', '/watercat/sync', body, { 'X-WaterCat-Device': 'phone-cccccccc', 'X-WaterCat-Nonce': ch.body.nonce, 'X-WaterCat-Sig': sig });
  ok('POST signed sync', sy.status === 200 && sy.body.mine[t0] === 1);
  ok('the answer is signed', sy.headers['x-watercat-proof'] === Sync.hmac(key, `resp:${ch.body.nonce}:${Sync.sha256(sy.raw)}`));
  ok('POST sync without a signature -> 401', (await req('POST', '/watercat/sync', {})).status === 401);
  ok('the old bearer token does not work', (await req('POST', '/watercat/sync', {}, { Authorization: `Bearer ${pr.body.token}` })).status === 401);
  ok('unknown path -> 404', (await req('GET', '/nope')).status === 404);

  // discovery: find the UDP port through the module's socket is not exposed, so test with a fixed port
  net.stop();
  const port = 40000 + Math.floor(Math.random() * 20000);
  const d = Sync.create({ dataDir: dir, hooks, now: () => clock, httpPort: 0, discoveryPort: port, networks: async () => null });
  d.start();
  await new Promise((res) => setTimeout(res, 300));
  const reply = await new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    s.on('message', (m) => { s.close(); resolve(JSON.parse(m.toString())); });
    s.bind(0, () => s.send(Buffer.from(Sync.DISCOVER_MSG), port, '127.0.0.1'));
    setTimeout(() => { try { s.close(); } catch (_) { /* */ } resolve(null); }, 2000);
  });
  ok('UDP discovery answers with id, name + port', reply && reply.app === 'WaterCat' && reply.port === d.info().port && reply.id === d.info().id);
  d.stop();

  // port fallback: another Windows account already has the first port
  const base = 41000 + Math.floor(Math.random() * 10000);
  const blocker = http.createServer(() => {});
  await new Promise((res) => blocker.listen(base, '0.0.0.0', res));
  const fb = Sync.create({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'watercat-sync-fb-')), hooks, now: () => clock, httpPort: base, discoveryPort: 0, networks: async () => null });
  fb.start();
  await new Promise((res) => setTimeout(res, 300));
  ok('port in use -> the next one', fb.info().running && fb.info().port === base + 1);
  fb.stop();
  blocker.close();

  // home network only
  let nets = ['HomeWifi'];
  const hd = fs.mkdtempSync(path.join(os.tmpdir(), 'watercat-sync-home-'));
  const hn = Sync.create({ dataDir: hd, hooks, now: () => clock, httpPort: 0, discoveryPort: 0, networks: async () => nets });
  hn.start();
  await new Promise((res) => setTimeout(res, 300));
  ok('turning sync on makes the current network home and listens', hn.info().homeNetwork === 'HomeWifi' && hn.info().running && hn.info().atHome);
  nets = ['Cafe Free WiFi'];
  await hn._checkNetwork();
  await new Promise((res) => setTimeout(res, 100));
  ok('another network: nothing listens', !hn.info().running && !hn.info().atHome && hn.info().homeNetwork === 'HomeWifi');
  nets = null;
  await hn._checkNetwork();
  ok('network unknown: stays closed', !hn.info().running);
  nets = ['Ethernet 2', 'HomeWifi'];
  await hn._checkNetwork();
  await new Promise((res) => setTimeout(res, 300));
  ok('back home (also with a second network): listens again', hn.info().running && hn.info().atHome);
  hn.stop();
  const hn2 = Sync.create({ dataDir: hd, hooks, now: () => clock, httpPort: 0, discoveryPort: 0, networks: async () => ['Office'] });
  hn2.start();
  await new Promise((res) => setTimeout(res, 300));
  ok('home is remembered after a restart', hn2.info().homeNetwork === 'HomeWifi' && !hn2.info().running);
  await hn2.useCurrentNetworkAsHome();
  await new Promise((res) => setTimeout(res, 300));
  ok('"use this network as home"', hn2.info().homeNetwork === 'Office' && hn2.info().running);
  hn2.stop();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
