# WaterCat 🐾💧

A tiny pixel-art cat that lives on your Windows desktop and reminds you to drink water,
made for people who game. She never steals focus, never pops up windows on her own and
never interrupts a fullscreen game.

![WaterCat on the desktop](docs/screenshot.png)
<!-- screenshot placeholder: put a PNG at docs/screenshot.png -->

## Install

1. Open the [latest release](https://github.com/serthekk/water_pet/releases/latest).
2. Download **`WaterCat-Setup-<version>.exe`** (the installer, *not* the Portable one:
   only the installed app updates itself).
3. Run it. It installs for your user only, without an admin prompt, and starts the cat.

**Windows SmartScreen:** the app isn't code-signed, so Windows may say
"Windows protected your PC". Click **More info**, then **Run anyway**.

Your cats, settings and cup history live in `%APPDATA%\water-cat-tracker` and are kept
across updates and even when you uninstall.

## Features

- A pixel cat with a cup counter (`🥣 3 / 8 cups`); click her to log a cup.
- Hourly water reminder in a speech bubble, repeating every few minutes until you drink.
- Daily alarms with your own text (e.g. medicine time).
- Quiet hours (default 23:00 to 08:00): no sounds, no reminders.
- Petting (stroke her), nose boops, purring, hearts.
- Several cats with their own names, looks, genders and descriptions; a Customize
  window with presets, a colour editor and an eyedropper.
- She naps when nobody plays with her: in a cat bed, on a cat tree or in a cardboard box.
- Idle animations, optional mouse chasing, adjustable size, your own meow sounds.
- Starts with Windows; one instance only; everything can be turned off in Settings.

## Phone app (Android)

WaterCat has an Android companion: water reminders as notifications ("💧 I drank!" logs a
cup from the notification), real alarm-clock alarms (full screen, ring until stopped) and
**Wi-Fi sync** of cups, goal, reminders, quiet hours, alarms and your cat with this app, on
your home network only. Turn it on at home in **Settings → 📱 Phone sync** and pair the phone with the
code shown there. See
[android/README.md](android/README.md).

## Controls

| Action | What it does |
|---|---|
| Click the cat | Log a cup (or wake her up) |
| Drag the cat | Move her |
| Stroke the cat | Pet her |
| Right-click the cat | Menu: settings, customize, switch cat, sleep, quit... |
| Tray icon | Same menu |
| **Ctrl+Alt+W** | Show / hide the cat |
| Mouse wheel / corner grip | Resize (if enabled in Settings) |

## Updates

The installed app checks this repository's releases quietly in the background (30 s
after start, then every 6 hours), downloads a new version in the background and installs
it the next time you quit the app. It **never** restarts by itself: when an update is ready
the cat says so once, and the right-click menu offers **Restart to update**. You can turn
automatic updates off, or opt in to beta releases, in Customize.

The Portable exe can't update itself; it only tells you when a new version is out and
opens the download page.

## Development

Requires Node.js (LTS) on Windows.

```sh
npm install          # dependencies (Electron, electron-builder)
npm start            # run the app from source
npm run build        # build the installer + portable exe into release/ (no upload)
npx electron . --selftest   # automated self-test -> logs/debug.log, logs/selftest-result.json
```

- Sprites are drawn in code (`catsprite.js`); `node preview_catsprite.js` writes preview
  sheets to `build/`.
- Sounds: put files in `sounds/` and run `node make_meows.js` (needs ffmpeg) to rebuild
  `assets/meows/`.
- Releasing a new version: see [RELEASING.md](RELEASING.md).

## License

Copyright © 2026 serthekk. All rights reserved, including the code, art and sounds.
No license is granted to copy, modify or redistribute this software.
