'use strict';
// Renders the desktop app's synthesized Web Audio sounds (renderer.js: chirp, squeak,
// purr; party loop) to WAV files, by running the SAME node graphs in headless Chromium's
// OfflineAudioContext. Levels are the desktop's at volume 1.0 (the phone scales them by
// its own volume, like the desktop does).
//   node scripts/render_synth_sounds.js <outDir>      (needs: npm playwright + Chromium)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RATE = 44100;

// Each entry: seconds + a function body that builds the graph on `ctx` (OfflineAudioContext).
// Copied from renderer.js (keep in step when the desktop sounds change).
const SOUNDS = {
  // renderer.js chirp(): two quick rising triangle notes, level 0.32
  sfx_chirp: [0.32, `
    const lvl = 0.32;
    const note = (t0, f0, f1) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f1, t0 + 0.07);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(lvl, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
      o.connect(g).connect(ctx.destination); o.start(t0); o.stop(t0 + 0.15);
    };
    note(0, 880, 1100); note(0.12, 1175, 1560);`],
  // renderer.js squeak(): the nose boop, level 0.25
  sfx_squeak: [0.16, `
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(1700, 0); o.frequency.exponentialRampToValueAtTime(2700, 0.08);
    g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.25, 0.01); g.gain.exponentialRampToValueAtTime(0.0001, 0.12);
    o.connect(g).connect(ctx.destination); o.start(0); o.stop(0.14);`],
  // renderer.js purrFor(): brown noise -> lowpass 320 Hz -> 25 Hz tremolo, level 0.9.
  // Rendered WITHOUT fades as a seamless 2 s loop: 4 s are rendered with the noise looping
  // and the second half kept (filter already settled; 50 tremolo cycles per 2 s, so the end
  // joins the start). The phone fades it in / out.
  sfx_purr_loop: [4.0, `
    const len = ctx.sampleRate * 2;
    const brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    // bend the random walk so its end meets its start (no step where the buffer loops)
    const shift = d[len - 1] - d[0];
    for (let i = 0; i < len; i++) d[i] -= shift * (i / (len - 1));
    const src = ctx.createBufferSource(); src.buffer = brown; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
    const am = ctx.createGain(); am.gain.value = 0.55;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 25;
    const depth = ctx.createGain(); depth.gain.value = 0.45;
    lfo.connect(depth).connect(am.gain);
    const out = ctx.createGain(); out.gain.value = 0.9;
    src.connect(lp).connect(am).connect(out).connect(ctx.destination);
    src.start(0); lfo.start(0);`],
  // renderer.js partyMusic(20, 1): kick + hat + square arpeggio, C-Am-F-G at 124 BPM, level 0.35
  music_party: [20.2, `
    const seconds = 20; const BEAT = 60 / 124; const t0 = 0.05;
    const master = ctx.createGain(); const level = 0.35;
    master.gain.setValueAtTime(0, t0); master.gain.linearRampToValueAtTime(level, t0 + 0.6);
    master.gain.setValueAtTime(level, t0 + seconds - 2); master.gain.linearRampToValueAtTime(0, t0 + seconds);
    const mix = ctx.createGain(); mix.connect(master); master.connect(ctx.destination);
    const noise = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate);
    const nd = noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const kick = (t) => { const o = ctx.createOscillator(); const g2 = ctx.createGain();
      o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      g2.gain.setValueAtTime(0.9, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      o.connect(g2).connect(mix); o.start(t); o.stop(t + 0.2); };
    const hat = (t) => { const s = ctx.createBufferSource(); s.buffer = noise;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
      const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.25, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      s.connect(hp).connect(g2).connect(mix); s.start(t); s.stop(t + 0.06); };
    const note = (t, f) => { const o = ctx.createOscillator(); const g2 = ctx.createGain();
      o.type = 'square'; o.frequency.value = f;
      g2.gain.setValueAtTime(0.06, t); g2.gain.exponentialRampToValueAtTime(0.001, t + BEAT / 4 - 0.01);
      o.connect(g2).connect(mix); o.start(t); o.stop(t + BEAT / 4); };
    const CHORDS = [[523.25, 659.25, 783.99, 1046.5], [440, 523.25, 659.25, 880], [349.23, 440, 523.25, 698.46], [392, 493.88, 587.33, 783.99]];
    for (let beat = 0; beat * BEAT < seconds - 1; beat++) {
      const t = t0 + beat * BEAT; kick(t); hat(t + BEAT / 2);
      const chord = CHORDS[Math.floor(beat / 4) % CHORDS.length];
      for (let s = 0; s < 4; s++) note(t + (s * BEAT) / 4, chord[(beat * 4 + s) % chord.length]);
    }`],
};

function wav(samples, rate) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
  return b;
}

(async () => {
  const out = process.argv[2];
  if (!out) throw new Error('usage: node render_synth_sounds.js <outDir>');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [name, [seconds, body]] of Object.entries(SOUNDS)) {
    const data = await page.evaluate(async ({ seconds, body, rate }) => {
      const ctx = new OfflineAudioContext(1, Math.ceil(seconds * rate), rate);
      new Function('ctx', body)(ctx);
      const buf = await ctx.startRendering();
      return Array.from(buf.getChannelData(0));
    }, { seconds, body, rate: RATE }).then((d) => (name.endsWith('_loop') ? d.slice(d.length / 2) : d));
    fs.writeFileSync(path.join(out, `${name}.wav`), wav(data, RATE));
    const peak = data.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    console.log(`${name}: ${seconds} s, peak ${peak.toFixed(3)}`);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
