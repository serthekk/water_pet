// Builds the bundled meow sounds.
// Run: node make_meows.js   (needs ffmpeg on PATH, or set FFMPEG=C:\path\to\ffmpeg.exe)
//
// Inputs
//   source_audio/meow_original.mp3  the original recording -> built-in "Original meow"
//   sounds/*                        YOUR sounds: drop any .mp3 .wav .ogg .m4a .flac .opus .aac
//                                   file here. File name = style name ("happy-trill.mp3" -> "Happy trill").
// Output
//   assets/meows/<id>.wav    48 kHz mono 16-bit, equal loudness, peaks <= -3 dBFS
//   assets/meows/meows.json  manifest the app reads (no code changes needed to add a sound)
//
// Cleanup chain (why):
//   mono            - stereo adds nothing for a meow
//   highpass 250 Hz - rumble / handling noise
//   lowpass 9 kHz x2 (steep) - harsh crunch + MP3 hash above a cat's harmonics
//   afftdn          - light denoise
//   silence trim    - (your sounds) cut dead air at the start/end; max 4 s kept
//   fades           - every clip starts/ends at zero, so no clicks
//   gain + limiter  - equal loudness, hard ceiling at -3 dBFS (headroom for game audio)
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const ROOT = __dirname;
const SRC = path.join(ROOT, 'source_audio', 'meow_original.mp3');
const USER_DIR = path.join(ROOT, 'sounds');
const OUT = path.join(ROOT, 'assets', 'meows');
const TARGET_RMS_DB = -12; // loudness of the loudest 50 ms of each clip
const CEILING = 0.708; // -3 dBFS
const MAX_SECONDS = 4;
const AUDIO_EXT = ['.mp3', '.wav', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.flac', '.webm'];

// Built-in: the original recording, cleaned. Optional per entry: rate > 1 = higher + shorter.
const BUILTIN = [
  { id: 'original', label: 'Original meow', start: 0.0, end: 1.8 },
];

const CLEAN = [
  'aformat=channel_layouts=mono',
  'highpass=f=250:p=2',
  'lowpass=f=9000:p=2',
  'lowpass=f=9000:p=2',
  'afftdn=nr=10:nf=-50',
].join(',');

// Trim leading + trailing quiet (< -45 dB) parts.
const TRIM = [
  'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02',
  'areverse',
  'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05',
  'areverse',
].join(',');

function ff(args) {
  execFileSync(FFMPEG, ['-hide_banner', '-nostats', '-v', 'error', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
}

function measure(file) {
  const res = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', file, '-af', 'astats=metadata=0', '-f', 'null', '-'], { encoding: 'utf8' });
  const txt = res.stderr || '';
  const overall = txt.slice(txt.lastIndexOf('Overall'));
  const num = (label) => {
    const m = overall.match(new RegExp(label + ':\\s*(-?[\\d.]+|-inf)'));
    return m ? (m[1] === '-inf' ? -Infinity : parseFloat(m[1])) : NaN;
  };
  return { peakDb: num('Peak level dB'), rmsDb: num('RMS level dB'), rmsPeakDb: num('RMS peak dB'), samples: num('Number of samples') };
}

function slug(name) {
  return name.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40) || 'sound';
}

function labelFromFile(base) {
  const words = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Step A: decode + clean (+ slice/pitch or silence-trim) -> 48 kHz float temp file.
// Step B: fades, loudness, limiter, 50 ms tail -> final 16-bit wav.
function build(entry, inputArgs, extraFilters) {
  const tmp = path.join(OUT, `_${entry.id}.wav`);
  const dst = path.join(OUT, `${entry.id}.wav`);
  ff(['-y', ...inputArgs, '-af', `aresample=48000,${CLEAN}${extraFilters}`, '-ar', '48000', '-c:a', 'pcm_f32le', tmp]);
  const m = measure(tmp);
  const seconds = m.samples / 48000;
  if (!(seconds > 0.05)) {
    fs.rmSync(tmp, { force: true });
    throw new Error('no audible sound found (silent or too short)');
  }
  const fadeIn = 0.012;
  const fadeOut = Math.min(0.06, seconds / 4);
  const gainDb = TARGET_RMS_DB - (Number.isFinite(m.rmsPeakDb) ? m.rmsPeakDb : m.rmsDb);
  ff([
    '-y', '-i', tmp,
    '-af', [
      `afade=t=in:st=0:d=${fadeIn}`,
      `afade=t=out:st=${(seconds - fadeOut).toFixed(3)}:d=${fadeOut}`,
      `volume=${gainDb.toFixed(2)}dB`,
      `alimiter=limit=${CEILING}:attack=1:release=30:level=disabled`,
      'apad=pad_dur=0.05',
      'volume=0.98',
    ].join(','),
    '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', dst,
  ]);
  fs.rmSync(tmp, { force: true });
  const after = measure(dst);
  return { seconds: +(after.samples / 48000).toFixed(2), peakDb: +after.peakDb.toFixed(1), gainDb: +gainDb.toFixed(1) };
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(USER_DIR, { recursive: true });
  const manifest = [];
  const report = [];
  const used = new Set();

  // Built-ins
  if (!fs.existsSync(SRC)) throw new Error(`missing ${SRC}`);
  for (const b of BUILTIN) {
    const dur = b.end - b.start;
    const pitch = b.rate ? `,asetrate=48000*${b.rate},aresample=48000` : '';
    const r = build(b, ['-ss', String(b.start), '-t', String(dur), '-i', SRC], pitch);
    manifest.push({ id: b.id, label: b.label, file: `${b.id}.wav`, seconds: r.seconds, source: 'builtin' });
    used.add(b.id);
    report.push({ id: b.id, from: 'built-in', ...r });
  }

  // Your sounds (project sounds/ folder)
  const files = fs.readdirSync(USER_DIR).filter((f) => AUDIO_EXT.includes(path.extname(f).toLowerCase())).sort();
  for (const f of files) {
    const base = path.basename(f, path.extname(f));
    let id = slug(base);
    for (let n = 2; used.has(id); n++) id = `${slug(base)}-${n}`;
    try {
      const r = build({ id }, ['-i', path.join(USER_DIR, f)], `,${TRIM},atrim=duration=${MAX_SECONDS}`);
      manifest.push({ id, label: labelFromFile(base), file: `${id}.wav`, seconds: r.seconds, source: `sounds/${f}` });
      used.add(id);
      report.push({ id, from: f, ...r });
    } catch (err) {
      report.push({ id, from: f, error: String(err.message || err).split('\n')[0].slice(0, 80) });
    }
  }

  // Remove stale outputs (deleted sounds), then write the manifest.
  for (const f of fs.readdirSync(OUT)) {
    if (f.endsWith('.wav') && !used.has(path.basename(f, '.wav'))) fs.rmSync(path.join(OUT, f));
  }
  fs.writeFileSync(path.join(OUT, 'meows.json'), JSON.stringify(manifest, null, 2));

  console.table(report);
  const failed = report.filter((r) => r.error);
  const hot = report.filter((r) => !r.error && !(r.peakDb <= -2.9));
  if (failed.length) console.error(`skipped (could not process): ${failed.map((f) => f.from).join(', ')}`);
  if (hot.length) {
    console.error(`peak above -2.9 dBFS: ${hot.map((h) => h.id).join(', ')}`);
    process.exit(1);
  }
  console.log(`ok: ${manifest.length} sounds in ${path.relative(ROOT, OUT)} (${manifest.length - BUILTIN.length} from sounds/)`);
}

main();
