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

// pairing
const code = sync.info().code;
ok('code is 6 digits', /^\d{6}$/.test(code));
ok('bad device id refused', H.pair({ code, deviceId: 'x' }).status === 400);
const wrong = code === '000000' ? '111111' : '000000';
for (let i = 0; i < 4; i++) assert.strictEqual(H.pair({ code: wrong, deviceId: 'phone-aaaaaaaa' }).status, 403);
const p1 = H.pair({ code: code.slice(0, 3) + ' ' + code.slice(3), deviceId: 'phone-aaaaaaaa', deviceName: 'Pixel' });
ok('right code (with a space) pairs and returns a token', p1.status === 200 && /^[0-9a-f]{64}$/.test(p1.body.token));
const token = p1.body.token;
ok('token is stored only as a hash', !fs.readFileSync(path.join(dir, 'sync.json'), 'utf8').includes(token));
for (let i = 0; i < 5; i++) H.pair({ code: wrong, deviceId: 'phone-bbbbbbbb' });
ok('5 wrong codes lock pairing (429)', H.pair({ code, deviceId: 'phone-bbbbbbbb' }).status === 429);
clock += 11 * 60 * 1000;
ok('lock ends after 10 minutes', H.pair({ code, deviceId: 'phone-bbbbbbbb', deviceName: 'Tablet' }).status === 200);
ok('unknown token refused', H.sync('f'.repeat(64), {}).status === 401);

// cups add up and undo works
const t0 = today();
let r = H.sync(token, { now: clock, cups: { [t0]: 3 }, settings: {} });
ok('phone cups added to the desktop', r.status === 200 && desk.cups[t0] === 3 && r.body.totals[t0] === 3 && r.body.mine[t0] === 3);
desk.cups[t0] += 2; // 2 cups logged on the desktop
r = H.sync(token, { now: clock, cups: { [t0]: 4 } });
ok('only the difference is added (3 -> 4) and desktop cups count', desk.cups[t0] === 6 && r.body.totals[t0] === 6);
r = H.sync(token, { now: clock, cups: { [t0]: 4 } });
ok('repeating a sync adds nothing', desk.cups[t0] === 6);
r = H.sync(token, { now: clock, cups: { [t0]: 2 } });
ok('undo on the phone takes cups off', desk.cups[t0] === 4);
r = H.sync(token, { now: clock, cups: { '2099-01-01': 5, 'bad': 1, [t0]: -1 } });
ok('future / bad dates and values ignored', desk.cups[t0] === 4 && !desk.cups['2099-01-01']);

// settings: newest wins, desktop wins ties, invalid values are not stamped
r = H.sync(token, { now: clock, settings: { goalCups: { v: 10, t: 0 } } });
ok('an unstamped (never edited) phone value does not win', desk.settings.goalCups === 8 && r.body.settings.goalCups.v === 8);
clock += 1000;
r = H.sync(token, { now: clock, settings: { goalCups: { v: 10, t: clock - 500 }, quietStart: { v: '22:30', t: clock - 500 } } });
ok('a newer phone change wins', desk.settings.goalCups === 10 && desk.settings.quietStart === '22:30' && r.body.settings.goalCups.t === clock - 500);
clock += 1000;
hooks.applySettings({ goalCups: 12 }); // edited on the desktop afterwards
r = H.sync(token, { now: clock, settings: { goalCups: { v: 10, t: clock - 1500 } } });
ok('a newer desktop change wins', desk.settings.goalCups === 12 && r.body.settings.goalCups.v === 12);
clock += 1000;
r = H.sync(token, { now: clock, settings: { goalCups: { v: 500, t: clock } } });
ok('an invalid phone value is ignored and not stamped', desk.settings.goalCups === 12 && r.body.settings.goalCups.v === 12);
// phone clock 1 h behind: its stamps are corrected
clock += 1000;
const skew = 3600 * 1000;
r = H.sync(token, { now: clock - skew, settings: { repeatMinutes: { v: 7, t: clock - skew - 100 }, remindersPausedUntil: { v: clock - skew + 60000, t: clock - skew - 100 } } });
ok('a phone with a slow clock still wins with a newer change', desk.settings.repeatMinutes === 7);
ok('pause time converted to desktop clock and back', desk.settings.remindersPausedUntil === clock + 60000 && r.body.settings.remindersPausedUntil.v === clock - skew + 60000);
ok('stamps answered in the phone clock', r.body.settings.repeatMinutes.t === clock - skew - 100);
r = H.sync(token, { now: clock, settings: { alarms: { v: [{ id: 'a1', time: '07:00', text: 'Wake', enabled: true }], t: clock + 3600 * 1000 } } });
ok('a stamp far in the future is ignored', desk.settings.alarms[0].id === 'pill');

// persistence + forgetting
const s2 = mk();
ok('devices + stamps survive a restart', s2.info().devices.length === 2 && s2._state().stamps.goalCups > 0 && s2._state().devices['phone-aaaaaaaa'].cups[t0] === 2);
const p2 = s2._handle.pair({ code: s2.info().code, deviceId: 'phone-aaaaaaaa', deviceName: 'Pixel' });
ok('re-pairing keeps the phone\'s cups (no double count)', p2.status === 200 && s2._state().devices['phone-aaaaaaaa'].cups[t0] === 2);
s2.forget('phone-bbbbbbbb');
ok('forget one phone', s2.info().devices.length === 1);
ok('old token stops working after re-pairing', s2._handle.sync(token, {}).status === 401);
const t2 = p2.body.token;
ok('unpair from the phone', s2._handle.unpair(t2).status === 200 && s2.info().devices.length === 0);
const c1 = s2.info().code;
ok('new code', s2.newCode().code !== c1 || c1 === s2.info().code);

// real network: HTTP + UDP discovery
(async () => {
  const net = mk();
  net.start();
  await new Promise((res) => setTimeout(res, 300));
  const info = net.info();
  ok('server running', info.running && info.port > 0);
  const req = (method, url, body, tok) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const q = http.request({ host: '127.0.0.1', port: info.port, path: url, method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) } }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b) }));
    });
    q.on('error', reject);
    q.end(data);
  });
  const hi = await req('GET', '/watercat/hello');
  ok('GET hello', hi.status === 200 && hi.body.app === 'WaterCat');
  const pr = await req('POST', '/watercat/pair', { code: info.code, deviceId: 'phone-cccccccc', deviceName: 'Net' });
  ok('POST pair', pr.status === 200);
  const sy = await req('POST', '/watercat/sync', { now: clock, cups: { [t0]: 1 } }, pr.body.token);
  ok('POST sync', sy.status === 200 && sy.body.mine[t0] === 1);
  ok('POST sync without token -> 401', (await req('POST', '/watercat/sync', {})).status === 401);
  ok('unknown path -> 404', (await req('GET', '/nope')).status === 404);

  // discovery: find the UDP port through the module's socket is not exposed, so test with a fixed port
  net.stop();
  const port = 40000 + Math.floor(Math.random() * 20000);
  const d = Sync.create({ dataDir: dir, hooks, now: () => clock, httpPort: 0, discoveryPort: port });
  d.start();
  await new Promise((res) => setTimeout(res, 300));
  const reply = await new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    s.on('message', (m) => { s.close(); resolve(JSON.parse(m.toString())); });
    s.bind(0, () => s.send(Buffer.from(Sync.DISCOVER_MSG), port, '127.0.0.1'));
    setTimeout(() => { try { s.close(); } catch (_) { /* */ } resolve(null); }, 2000);
  });
  ok('UDP discovery answers with name + port', reply && reply.app === 'WaterCat' && reply.port === d.info().port);
  d.stop();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
