'use strict';
// Phone sync over Wi-Fi (the WaterCat Android companion app).
//
// Off by default (settings.phoneSync). When on, and only while this computer is on its
// HOME network (the network it was on when sync was turned on; Settings can change it),
// the desktop app listens on the local network:
//   - UDP 47824: answers "WATERCAT_DISCOVER 1" broadcasts so the phone can find it;
//   - HTTP 47823 (or the next free port up to 47832: another Windows account on this PC
//     may already use it; the last port that worked is tried first):
//       GET  /watercat/hello                                 -> { app, id, name, protocol }
//       POST /watercat/pair      { code, deviceId, deviceName } -> { token, id, name }
//       POST /watercat/challenge { deviceId, c }              -> { nonce, proof, id }
//       POST /watercat/sync      (signed, see below)          -> merged state
//       POST /watercat/unpair    (signed)
//   On any other network nothing listens at all.
//
// Pairing needs the 6-digit code shown in Settings and gives the phone a random token,
// once. Both sides derive a key from it; the token itself never travels again:
//   1. the phone sends a random challenge c; the computer answers with a nonce and
//      proof = HMAC(key, "srv:" + c + ":" + nonce), so the phone knows it is talking to ITS
//      computer before it sends anything;
//   2. the phone signs the request: X-WaterCat-Device, X-WaterCat-Nonce and
//      X-WaterCat-Sig = HMAC(key, "cli:" + nonce + ":" + sha256(body)); the nonce works once;
//   3. the answer carries X-WaterCat-Proof = HMAC(key, "resp:" + nonce + ":" + sha256(answer)).
// Wrong codes are rate limited. Each computer has a random id, so the phone finds it again
// after its address or port changed.
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
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROTOCOL = 2;
const HTTP_PORT = 47823;
const PORT_TRIES = 10; // 47823..47832
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
const HEX_RE = /^[0-9a-f]{16,128}$/;
const NONCE_MS = 60 * 1000;
const NETWORK_CHECK_MS = 60 * 1000;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (key, msg) => crypto.createHmac('sha256', key).update(msg).digest('hex');
// the shared key both sides derive from the pairing token (Kotlin: SyncProtocol.deriveKey)
const deriveKey = (token) => sha256(`watercat-key:${token}`);
const sameHex = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
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

// The networks this computer is connected to right now, by their Windows network profile
// name (the Wi-Fi name, or "Network 2" etc. for a cable). Resolves to null if unknown.
function windowsNetworks(timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    const script = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ErrorActionPreference='Stop'; Get-NetConnectionProfile | ForEach-Object { $_.Name }";
    try {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { windowsHide: true, timeout: timeoutMs }, (err, stdout) => {
          if (err) return resolve(null);
          resolve(String(stdout || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean));
        });
    } catch (_) {
      resolve(null);
    }
  });
}

// deps: { dataDir, log, version, hooks: { snapshot(), applySettings(partial), applyCups(date, delta), name() },
//         now?, httpPort?, discoveryPort? }
//         networks?: async () => [names] | null (default: Windows network profiles)
//   snapshot() -> { settings: { <SYNC_FIELDS> }, totals: { date: cups }, goals: { date: goal }, streak, best, catName, drinkWord }
function create(deps) {
  const log = deps.log || (() => {});
  const now = deps.now || (() => Date.now());
  const file = path.join(deps.dataDir, 'sync.json');
  const hooks = deps.hooks;
  const httpPort = deps.httpPort === undefined ? HTTP_PORT : deps.httpPort;
  const discoveryPort = deps.discoveryPort === undefined ? DISCOVERY_PORT : deps.discoveryPort;
  const networks = deps.networks || windowsNetworks;

  let state = load();
  let server = null;
  let udp = null;
  let applyingRemote = false;
  let pairFails = []; // timestamps of wrong codes
  let listeners = [];
  let nonces = new Map(); // nonce -> { deviceId, at }
  let enabled = false; // Phone sync is on (listens only while also at home)
  let netTimer = null;
  let net = { checked: false, current: null, atHome: false };

  function load() {
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (_) { raw = {}; }
    const s = {
      id: /^[0-9a-f]{16}$/.test(raw.id) ? raw.id : crypto.randomBytes(8).toString('hex'),
      code: /^\d{6}$/.test(raw.code) ? raw.code : newCode(),
      lastPort: Number.isInteger(raw.lastPort) && raw.lastPort >= HTTP_PORT && raw.lastPort < HTTP_PORT + PORT_TRIES ? raw.lastPort : 0,
      homeNetwork: typeof raw.homeNetwork === 'string' ? raw.homeNetwork.slice(0, 200) : '',
      devices: {}, stamps: {},
    };
    if (raw.devices && typeof raw.devices === 'object') {
      for (const [id, d] of Object.entries(raw.devices)) {
        // (a phone paired with the first version, before signed requests, pairs again)
        if (!ID_RE.test(id) || !d || typeof d.key !== 'string' || !/^[0-9a-f]{64}$/.test(d.key)) continue;
        const cups = {};
        if (d.cups && typeof d.cups === 'object') for (const [k, v] of Object.entries(d.cups)) if (DAY_RE.test(k)) cups[k] = nonNegInt(v);
        s.devices[id] = { name: cleanName(d.name, 'Phone'), key: d.key, pairedAt: nonNegInt(d.pairedAt), lastSync: nonNegInt(d.lastSync), cups };
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

  // --- request handlers (plain objects in / out, so they can be tested) ---------
  function hello() {
    return { status: 200, body: { app: 'WaterCat', protocol: PROTOCOL, id: state.id, name: hooks.name(), version: deps.version || '' } };
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
    state.devices[id] = { name: cleanName(body.deviceName, 'Phone'), key: deriveKey(token), pairedAt: t, lastSync: 0, cups: prev ? prev.cups : {} };
    pairFails = [];
    save();
    log(`sync: paired "${state.devices[id].name}"`);
    changed();
    return { status: 200, body: { token, id: state.id, name: hooks.name(), protocol: PROTOCOL } };
  }

  // Step 1: the computer proves it knows the phone's key, and hands out a one-time nonce.
  function challenge(body) {
    const id = body && typeof body.deviceId === 'string' && ID_RE.test(body.deviceId) ? body.deviceId : null;
    const c = body && typeof body.c === 'string' && HEX_RE.test(body.c) ? body.c : null;
    if (!id || !c) return { status: 400, body: { error: 'Bad request', id: state.id } };
    const dev = state.devices[id];
    if (!dev) return { status: 401, body: { error: 'Not paired (or forgotten in WaterCat Settings). Pair again.', id: state.id } };
    const t = now();
    for (const [n, v] of nonces) if (t - v.at > NONCE_MS) nonces.delete(n);
    if (nonces.size > 100) nonces = new Map([...nonces].slice(-50));
    const nonce = crypto.randomBytes(16).toString('hex');
    nonces.set(nonce, { deviceId: id, at: t });
    return { status: 200, body: { nonce, proof: hmac(dev.key, `srv:${c}:${nonce}`), id: state.id } };
  }

  // Step 2: a signed request. Returns { status, body, headers } (the answer is signed too).
  function signed(url, headers, raw) {
    const h = (k) => String(headers[k] || '');
    const id = h('x-watercat-device');
    const nonce = h('x-watercat-nonce');
    const n = nonces.get(nonce);
    const dev = state.devices[id];
    const fail = { status: 401, body: { error: 'Not paired (or forgotten in WaterCat Settings). Pair again.', id: state.id } };
    if (!dev || !n || n.deviceId !== id || now() - n.at > NONCE_MS) return fail;
    nonces.delete(nonce); // works once
    if (!sameHex(h('x-watercat-sig'), hmac(dev.key, `cli:${nonce}:${sha256(raw)}`))) return fail;
    let body = null;
    try { body = JSON.parse(raw.toString('utf8') || '{}'); } catch (_) { return { status: 400, body: { error: 'Bad JSON' } }; }
    const r = url === '/watercat/unpair' ? unpair(id) : sync(id, body);
    const data = JSON.stringify(r.body);
    return { status: r.status, body: r.body, data, headers: { 'X-WaterCat-Proof': hmac(dev.key, `resp:${nonce}:${sha256(data)}`) } };
  }

  function unpair(id) {
    log(`sync: "${state.devices[id].name}" unpaired itself`);
    delete state.devices[id];
    save();
    changed();
    return { status: 200, body: { ok: true } };
  }

  function sync(id, body) {
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
      const data = r.data || JSON.stringify(r.body);
      res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(r.headers || {}) });
      res.end(data);
    };
    const url = (req.url || '').split('?')[0];
    if (req.method === 'GET' && url === '/watercat/hello') return send(hello());
    if (req.method !== 'POST' || !['/watercat/pair', '/watercat/challenge', '/watercat/sync', '/watercat/unpair'].includes(url)) return send({ status: 404, body: { error: 'Not found' } });
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { send({ status: 413, body: { error: 'Too large' } }); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (size > MAX_BODY) return;
      const raw = Buffer.concat(chunks);
      try {
        if (url === '/watercat/sync' || url === '/watercat/unpair') return send(signed(url, req.headers, raw));
        let body = null;
        try { body = JSON.parse(raw.toString('utf8') || '{}'); } catch (_) { return send({ status: 400, body: { error: 'Bad JSON' } }); }
        return send(url === '/watercat/pair' ? pair(body) : challenge(body));
      } catch (err) {
        log('sync: request failed', err);
        return send({ status: 500, body: { error: 'Something went wrong on the computer' } });
      }
    });
  }

  // Ports to try: the last one that worked, then 47823, 47824... (another Windows account
  // on this PC may have one). httpPort 0 (tests) = any free port.
  function portList() {
    if (httpPort === 0) return [0];
    const list = [];
    if (httpPort === HTTP_PORT && state.lastPort) list.push(state.lastPort);
    for (let i = 0; i < PORT_TRIES; i++) if (!list.includes(httpPort + i)) list.push(httpPort + i);
    return list;
  }

  function listen() {
    if (server) return;
    const ports = portList();
    const srv = http.createServer(route);
    srv.requestTimeout = 15000;
    server = srv;
    lastError = '';
    let onError = null;
    const tryPort = (i) => {
      onError = (err) => {
        if (server !== srv) return;
        if (err.code === 'EADDRINUSE' && i + 1 < ports.length) {
          log(`sync: port ${ports[i]} is in use, trying ${ports[i + 1]}`);
          return tryPort(i + 1);
        }
        log(`sync: HTTP server error (${err.code || err.message})`);
        lastError = err.code === 'EADDRINUSE' ? `Ports ${ports[0]}-${ports[ports.length - 1]} are all in use by other programs` : `Could not start (${err.code || err.message})`;
        closeServer();
        changed();
      };
      srv.once('error', onError);
      srv.listen(ports[i], '0.0.0.0');
    };
    srv.on('listening', () => {
      srv.removeListener('error', onError);
      srv.on('error', (err) => log(`sync: HTTP server error (${err.code || err.message})`));
      const port = srv.address().port;
      if (httpPort !== 0 && state.lastPort !== port) { state.lastPort = port; save(); }
      log(`sync: listening on port ${port} (${lanAddresses().join(', ') || 'no network'})`);
      startDiscovery();
      changed();
    });
    tryPort(0);
  }

  function startDiscovery() {
    if (udp) return;
    udp = dgram.createSocket({ type: 'udp4', reuseAddr: true }); // reuseAddr: other Windows accounts answer too
    udp.on('error', (err) => {
      log(`sync: discovery socket error (${err.code || err.message}) - the phone can still connect by IP address`);
      try { udp.close(); } catch (_) { /* ignore */ }
      udp = null;
    });
    udp.on('message', (msg, rinfo) => {
      if (msg.length > 64 || msg.toString('utf8').trim() !== DISCOVER_MSG || !server || !server.address()) return;
      const reply = Buffer.from(JSON.stringify({ app: 'WaterCat', protocol: PROTOCOL, id: state.id, name: hooks.name(), port: server.address().port }));
      udp.send(reply, rinfo.port, rinfo.address);
    });
    udp.bind(discoveryPort);
  }
  let lastError = '';

  function closeServer() {
    if (server) { try { server.close(); } catch (_) { /* ignore */ } server = null; log('sync: not listening'); }
    if (udp) { try { udp.close(); } catch (_) { /* ignore */ } udp = null; }
    nonces.clear();
  }

  // Home network only: listen while connected to it, close everything on any other.
  // The first check after turning sync on makes the current network home.
  async function checkNetwork() {
    if (!enabled) return;
    const current = await networks();
    if (!enabled) return;
    if (!state.homeNetwork && current && current.length) {
      state.homeNetwork = current[0];
      save();
      log('sync: home network set');
    }
    // unknown network list (not Windows / PowerShell failed): only allowed while no home is set
    const atHome = current ? current.includes(state.homeNetwork) : !state.homeNetwork;
    const was = net.atHome;
    net = { checked: true, current, atHome };
    if (atHome) listen();
    else if (server) closeServer();
    if (was !== atHome) log(`sync: ${atHome ? 'on the home network' : 'not on the home network - paused'}`);
    changed();
  }

  function start() {
    if (enabled) return;
    enabled = true;
    net = { checked: false, current: null, atHome: false };
    checkNetwork();
    netTimer = setInterval(checkNetwork, NETWORK_CHECK_MS);
  }

  function stop() {
    enabled = false;
    if (netTimer) { clearInterval(netTimer); netTimer = null; }
    closeServer();
  }

  function info() {
    const addr = server && server.address();
    return {
      running: !!addr,
      error: lastError,
      id: state.id,
      homeNetwork: state.homeNetwork,
      networks: net.current,
      networkChecked: net.checked,
      atHome: net.atHome,
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
    // make the network this computer is on now the home network
    async useCurrentNetworkAsHome() {
      const current = await networks();
      if (current && current.length) {
        state.homeNetwork = current[0];
        save();
        log('sync: home network changed');
      }
      await checkNetwork();
      return info();
    },
    // for tests
    _handle: { hello, pair, challenge, signed },
    _checkNetwork: checkNetwork,
    _state: () => state,
  };
}

module.exports = { create, deriveKey, hmac, sha256, SYNC_FIELDS, HTTP_PORT, DISCOVERY_PORT, DISCOVER_MSG, PROTOCOL, PORT_TRIES };
