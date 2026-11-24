'use strict';
// Is a fullscreen app / game / presentation running? (main process, Windows only)
// Asks Windows' SHQueryUserNotificationState through a hidden PowerShell (no window, no
// focus change). Takes ~1 s, so call it rarely (e.g. once before a non-urgent bubble).
// Resolves to { busy, state, name }; any failure counts as busy (better quiet than rude).
const { execFile } = require('child_process');

const STATES = {
  1: 'not present', // screensaver / locked / fast user switching
  2: 'busy', // a fullscreen app
  3: 'd3d fullscreen', // a fullscreen Direct3D game
  4: 'presentation mode',
  5: 'accepts notifications',
  6: 'quiet time',
  7: 'windows store app',
};
const BUSY = [1, 2, 3, 4, 7];

const SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "Add-Type -Namespace WC -Name N -MemberDefinition '[DllImport(\"shell32.dll\")] public static extern int SHQueryUserNotificationState(out int s);'",
  '$s = 0',
  '[void][WC.N]::SHQueryUserNotificationState([ref]$s)',
  '$s',
].join('; ');

function query(timeoutMs = 6000) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve({ busy: false, state: 0, name: 'not windows' });
    try {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT],
        { windowsHide: true, timeout: timeoutMs }, (err, stdout) => {
          const n = parseInt(String(stdout || '').trim(), 10);
          if (err || !STATES[n]) return resolve({ busy: true, state: 0, name: `unknown (${err ? err.message.split('\n')[0] : String(stdout).trim()})` });
          return resolve({ busy: BUSY.includes(n), state: n, name: STATES[n] });
        });
    } catch (err) {
      resolve({ busy: true, state: 0, name: `unknown (${err.message})` });
    }
  });
}

module.exports = { query, STATES, BUSY };
