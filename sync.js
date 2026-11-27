'use strict';
// Phone sync over Wi-Fi (the WaterCat Android companion app).
//
// Off by default (settings.phoneSync). When on, the desktop app listens on the local
// network:
//   - UDP 47824: answers "WATERCAT_DISCOVER 1" broadcasts so the phone can find it;
//   - HTTP 47823: POST /watercat/pair   { code, deviceId, deviceName }      -> { token, name }
//                 POST /watercat/sync   (Authorization: Bearer <token>)    -> merged state
//                 POST /watercat/unpair (Authorization: Bearer <token>)
//                 GET  /watercat/hello                                     -> { app, name, version }
//
// Pairing needs the 6-digit code shown in Settings; a paired phone gets a random token
// (only its SHA-256 hash is stored). Failed codes are rate limited.
//
// What syncs:
//   - cups: every phone reports ITS OWN cups per day (it is the only one who changes
//     them), the desktop adds the difference since the last sync to its count and
//     answers with the totals per day. So cups logged on both sides offline add up.
//   - settings in SYNC_FIELDS (goal, reminder interval, quiet hours, alarms, pause):
//     the newest change wins, per field. Phone times are corrected for clock skew.
//
// Everything is kept in <userData>/sync.json. This module has no Electron dependency so
// it can be tested with plain node (tools/sync-test.js).
const http = require('http');
const dgram = require('dgram');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');

const PROTOCOL = 1;
const HTTP_PORT = 47823;
const DISCOVERY_PORT = 47824;
const DISCOVER_MSG = 'WATERCAT_DISCOVER 1';
const SYNC_FIELDS = ['goalCups', 'reminderMinutes', 'repeatMinutes', 'quietStart', 'quietEnd', 'alarms', 'remindersPausedUntil'];
const MAX_BODY = 64 * 1024;
const MAX_DEVICES = 10;
const CUP_DAYS = 120; // how far back a phone's per-day cups are kept / accepted
const PAIR_FAILS_MAX = 5; // wrong codes per PAIR_FAIL_WINDOW_MS, then pairing is refused for a while
const PAIR_FAIL_WINDOW_MS = 10 * 60 * 1000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[\w-]{8,64}$/;

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const cleanName = (s, fallback) => {
  const t = typeof s === 'string' ? s.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) : '';
  return t || fallback;
};
const nonNegInt = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);

function dayKey(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Local IPv4 addresses (shown in Settings so the phone can be pointed at one by hand).
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a && a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

// deps: { dataDir, log, version, hooks: { snapshot(), applySettings(partial), applyCups(date, delta), name() },
//         now?, httpPort?, discoveryPort? }
//   snapshot() -> { settings: { <SYNC_FIELDS> }, totals: { date: cups }, goals: { date: goal }, streak, best, catName, drinkWord }
function create(deps) {
  const log = deps.log || (() => {});
  const now = deps.now || (() => Date.now());
  const file = path.join(deps.dataDir, 'sync.json');
  const hooks = deps.hooks;
  const httpPort = deps.httpPort === undefined ? HTTP_PORT : deps.httpPort;
  const discoveryPort = deps.discoveryPort === undefined ? DISCOVERY_PORT : deps.discoveryPort;

  let state = load();
  let server = null;
  let udp = null;
  let applyingRemote = false;
  let pairFails = []; // timestamps of wrong codes
  let listeners = [];

  function load() {
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (_) { raw = {}; }
    const s = { code: /^\d{6}$/.test(raw.code) ? raw.code : newCode(), devices: {}, stamps: {} };
    if (raw.devices && typeof raw.devices === 'object') {
      for (const [id, d] of Object.entries(raw.devices)) {
        if (!ID_RE.test(id) || !d || typeof d.tokenHash !== 'string') continue;
        const cups = {};
        if (d.cups && typeof d.cups === 'object') for (const [k, v] of Object.entries(d.cups)) if (DAY_RE.test(k)) cups[k] = nonNegInt(v);
        s.devices[id] = { name: cleanName(d.name, 'Phone'), tokenHash: d.tokenHash, pairedAt: nonNegInt(d.pairedAt), lastSync: nonNegInt(d.lastSync), cups };
      }
    }
    if (raw.stamps && typeof raw.stamps === 'object') for (const k of SYNC_FIELDS) if (Number.isFinite(raw.stamps[k])) s.stamps[k] = raw.stamps[k];
    return s;
  }
  function save() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify(state, null, 2));
      fs.renameSync(file + '.tmp', file);
    } catch (err) {
      log('sync: could not save sync.json', err);
    }
  }
  const changed = () => { for (const cb of listeners) { try { cb(info()); } catch (_) { /* ignore */ } } };

  // main.js calls this after every settings change; a change that came from a phone keeps
  // the phone's time stamp instead.
  function noteLocalChange(keys) {
    if (applyingRemote) return;
    const ks = (keys || []).filter((k) => SYNC_FIELDS.includes(k));
    if (!ks.length) return;
    const t = now();
    for (const k of ks) state.stamps[k] = t;
    save();
  }

  function deviceForToken(token) {
    if (typeof token !== 'string' || token.length < 32) return null;
    const h = sha256(token);
    for (const [id, d] of Object.entries(state.devices)) {
      if (d.tokenHash.length === h.length && crypto.timingSafeEqual(Buffer.from(d.tokenHash), Buffer.from(h))) return id;
    }
    return null;
  }

  // --- request handlers (plain objects in / out, so they can be tested) ---------
  function hello() {
    return { status: 200, body: { app: 'WaterCat', protocol: PROTOCOL, name: hooks.name(), version: deps.version || '' } };
  }

  function pair(body) {
    const t = now();
    pairFails = pairFails.filter((x) => t - x < PAIR_FAIL_WINDOW_MS);
    if (pairFails.length >= PAIR_FAILS_MAX) return { status: 429, body: { error: 'Too many wrong codes. Wait a few minutes and try again.' } };
    const code = body && typeof body.code === 'string' ? body.code.replace(/\s+/g, '') : '';
    const id = body && typeof body.deviceId === 'string' && ID_RE.test(body.deviceId) ? body.deviceId : null;
    if (!id) return { status: 400, body: { error: 'Bad device id' } };
    const a = Buffer.from(sha256(code));
    const b = Buffer.from(sha256(state.code));
    if (!crypto.timingSafeEqual(a, b)) {
      pairFails.push(t);
      log(`sync: wrong pairing code from "${cleanName(body.deviceName, 'Phone')}" (${pairFails.length}/${PAIR_FAILS_MAX})`);
      return { status: 403, body: { error: 'Wrong code. Check the code in WaterCat Settings → Phone sync.' } };
    }
    if (!state.devices[id] && Object.keys(state.devices).length >= MAX_DEVICES) return { status: 409, body: { error: 'Too many phones paired. Forget one in WaterCat Settings.' } };
    const token = crypto.randomBytes(32).toString('hex');
    const prev = state.devices[id];
    // re-pairing the same phone keeps its cups (so they are not counted twice)
    state.devices[id] = { name: cleanName(body.deviceName, 'Phone'), tokenHash: sha256(token), pairedAt: t, lastSync: 0, cups: prev ? prev.cups : {} };
    pairFails = [];
    save();
    log(`sync: paired "${state.devices[id].name}"`);
    changed();
    return { status: 200, body: { token, name: hooks.name(), protocol: PROTOCOL } };
  }

  function unpair(token) {
    const id = deviceForToken(token);
    if (!id) return { status: 401, body: { error: 'Not paired' } };
    log(`sync: "${state.devices[id].name}" unpaired itself`);
    delete state.devices[id];
    save();
    changed();
    return { status: 200, body: { ok: true } };
  }

  function sync(token, body) {
    const id = deviceForToken(token);
    if (!id) return { status: 401, body: { error: 'Not paired (or forgotten in WaterCat Settings). Pair again.' } };
    if (!body || typeof body !== 'object') return { status: 400, body: { error: 'Bad request' } };
    const dev = state.devices[id];
    const t = now();
    // phone clock -> desktop clock (a few seconds is just network delay: ignored)
    const rawSkew = Number.isFinite(body.now) && body.now > 0 ? t - body.now : 0;
    const skew = Math.abs(rawSkew) < 5000 ? 0 : rawSkew;
    const today = dayKey(new Date(t));
    const oldest = dayKey(new Date(t - CUP_DAYS * 86400000));

    // 1. cups: the phone's own count per day; apply the difference
    let cupChanges = 0;
    if (body.cups && typeof body.cups === 'object') {
      for (const [date, v] of Object.entries(body.cups)) {
        if (!DAY_RE.test(date) || date > today || date < oldest || !Number.isInteger(v) || v < 0 || v > 1000) continue;
        const delta = v - (dev.cups[date] || 0);
        if (!delta) continue;
        dev.cups[date] = v;
        hooks.applyCups(date, delta);
        cupChanges += Math.abs(delta);
      }
    }
    for (const k of Object.keys(dev.cups)) if (k < oldest) delete dev.cups[k];

    // 2. settings: newest change wins, per field (desktop wins a tie)
    const remote = {};
    const remoteStamps = {};
    if (body.settings && typeof body.settings === 'object') {
      const cur = hooks.snapshot().settings;
      for (const k of SYNC_FIELDS) {
        const e = body.settings[k];
        if (!e || typeof e !== 'object' || !('v' in e) || !Number.isFinite(e.t) || e.t <= 0) continue;
        const tt = e.t + skew;
        const v = k === 'remindersPausedUntil' && e.v > 0 ? Math.round(e.v + skew) : e.v;
        // newer by more than a second (an echo of our own stamp is not a change), and not from the future
        if (tt > (state.stamps[k] || 0) + 1000 && tt <= t + 60000 && JSON.stringify(v) !== JSON.stringify(cur[k])) {
          remote[k] = v;
          remoteStamps[k] = tt;
        }
      }
    }
    let applied = [];
    if (Object.keys(remote).length) {
      const before = hooks.snapshot().settings;
      applyingRemote = true;
      try { hooks.applySettings(remote); } finally { applyingRemote = false; }
      const after = hooks.snapshot().settings;
      for (const k of Object.keys(remote)) {
        // invalid values are ignored by main.js; only a value that stuck gets the phone's stamp
        if (JSON.stringify(after[k]) === JSON.stringify(remote[k]) || JSON.stringify(after[k]) !== JSON.stringify(before[k])) {
          state.stamps[k] = remoteStamps[k];
          applied.push(k);
        }
      }
    }

    dev.lastSync = t;
    if (typeof body.deviceName === 'string') dev.name = cleanName(body.deviceName, dev.name);
    save();
    if (cupChanges || applied.length) log(`sync: "${dev.name}" - ${cupChanges} cup change(s), settings from phone: ${applied.join(', ') || 'none'}`);
    changed();

    // 3. the answer: merged settings (stamps in the phone's clock) + totals per day
    const snap = hooks.snapshot();
    const settings = {};
    for (const k of SYNC_FIELDS) {
      let v = snap.settings[k];
      if (k === 'remindersPausedUntil' && v > 0) v = Math.round(v - skew);
      settings[k] = { v, t: state.stamps[k] ? state.stamps[k] - skew : 0 };
    }
    return {
      status: 200,
      body: {
        protocol: PROTOCOL, now: t, today, name: hooks.name(),
        settings, totals: snap.totals, goals: snap.goals, mine: { ...dev.cups },
        streak: snap.streak, best: snap.best, catName: snap.catName, drinkWord: snap.drinkWord,
      },
    };
  }

  // --- network --------------------------------------------------------------
  function route(req, res) {
    const send = (r) => {
      const data = JSON.stringify(r.body);
      res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(data);
    };
    const url = (req.url || '').split('?')[0];
    if (req.method === 'GET' && url === '/watercat/hello') return send(hello());
    if (req.method !== 'POST' || !['/watercat/pair', '/watercat/sync', '/watercat/unpair'].includes(url)) return send({ status: 404, body: { error: 'Not found' } });
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { send({ status: 413, body: { error: 'Too large' } }); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (size > MAX_BODY) return;
      let body = null;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (_) { return send({ status: 400, body: { error: 'Bad JSON' } }); }
      const auth = String(req.headers.authorization || '');
      const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      try {
        if (url === '/watercat/pair') return send(pair(body));
        if (url === '/watercat/unpair') return send(unpair(token));
        return send(sync(token, body));
      } catch (err) {
        log('sync: request failed', err);
        return send({ status: 500, body: { error: 'Something went wrong on the computer' } });
      }
    });
  }

  function start() {
    if (server) return;
    server = http.createServer(route);
    server.requestTimeout = 15000;
    server.on('error', (err) => {
      log(`sync: HTTP server error (${err.code || err.message})`);
      lastError = err.code === 'EADDRINUSE' ? `Port ${httpPort} is in use by another program` : `Could not start (${err.code || err.message})`;
      stop();
      changed();
    });
    lastError = '';
    server.listen(httpPort, '0.0.0.0', () => {
      log(`sync: listening on port ${server.address().port} (${lanAddresses().join(', ') || 'no network'})`);
      changed();
    });
    udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    udp.on('error', (err) => {
      log(`sync: discovery socket error (${err.code || err.message}) - the phone can still connect by IP address`);
      try { udp.close(); } catch (_) { /* ignore */ }
      udp = null;
    });
    udp.on('message', (msg, rinfo) => {
      if (msg.length > 64 || msg.toString('utf8').trim() !== DISCOVER_MSG || !server) return;
      const port = server.address() ? server.address().port : httpPort;
      const reply = Buffer.from(JSON.stringify({ app: 'WaterCat', protocol: PROTOCOL, name: hooks.name(), port }));
      udp.send(reply, rinfo.port, rinfo.address);
    });
    udp.bind(discoveryPort);
  }
  let lastError = '';

  function stop() {
    if (server) { try { server.close(); } catch (_) { /* ignore */ } server = null; log('sync: stopped'); }
    if (udp) { try { udp.close(); } catch (_) { /* ignore */ } udp = null; }
  }

  function info() {
    const addr = server && server.address();
    return {
      running: !!addr,
      error: lastError,
      port: addr ? addr.port : httpPort,
      addresses: lanAddresses(),
      code: state.code,
      devices: Object.entries(state.devices).map(([id, d]) => ({ id, name: d.name, lastSync: d.lastSync, pairedAt: d.pairedAt })),
    };
  }

  return {
    start, stop, info, noteLocalChange,
    newCode() { state.code = newCode(); save(); changed(); return info(); },
    forget(id) {
      if (id === 'all') state.devices = {};
      else delete state.devices[id];
      save();
      changed();
      return info();
    },
    onChange(cb) { listeners.push(cb); },
    // for tests
    _handle: { hello, pair, sync, unpair },
    _state: () => state,
  };
}

module.exports = { create, SYNC_FIELDS, HTTP_PORT, DISCOVERY_PORT, DISCOVER_MSG, PROTOCOL };
