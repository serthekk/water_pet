# WaterCat for Android 🐾💧

The phone companion for the WaterCat desktop cat. Instead of sitting on a screen, it is a
reminder + alarm app:

- **Water reminders** as notifications (with her meow), every *N* minutes, repeating until
  you drink. **💧 I drank!** right in the notification logs a cup without opening the app.
  "Not now" stops the repeats until the next reminder. No reminders in quiet hours or while
  paused (1 h / until tomorrow).
- **Daily alarms** (medicine time etc.) that ring like a real alarm clock: through Doze,
  full-screen over the lock screen, the sound loops until **Done** or **Snooze 10 min**
  (and stops by itself after 10 minutes). They come back after a reboot.
- **Today screen**: tap the cat (or the big button) to log a cup, progress to your goal,
  streak, the last 7 days, the next reminder and alarm.
- **Wi-Fi sync** with the desktop app, **on your home Wi-Fi only**: cups, goal, reminder
  interval, repeat, quiet hours, alarms and the pause. Cups logged on both sides add up (even
  when they were apart); for settings the newest change wins. A cup on either side restarts
  the reminder on both. Away from home everything is saved on the phone and syncs once you're
  back.

## Install

Build it (below) or download the APK from the CI run (Actions → CI → artifact
`WaterCat-android`), copy it to the phone and open it. Android asks to allow installs from
that app the first time. Needs Android 8.0 or newer.

## Pair with the computer

Do this at home: the network you pair on becomes the home network on both sides.

1. Desktop: **Settings → 📱 Phone sync → Sync with my phone over Wi-Fi**. If Windows
   asks, allow WaterCat on **private** networks. Settings shows a 6-digit code, the home
   network and the computer's address.
2. Phone: **Sync tab**. Allow location when asked ("Precise"): Android only tells apps the
   Wi-Fi's name with that permission. WaterCat uses it for nothing else.
3. **🔍 Search Wi-Fi** (or type the address), enter the code, **Pair**.

After that it syncs whenever the app is open (every minute), a few seconds after every
change, and about every 15 minutes in the background, as long as the phone is on the home
Wi-Fi. (Some phones don't tell apps the Wi-Fi name in the background; then it simply syncs
the next time you open the app at home.)

To use another home network: on the phone, Unpair and pair again there; on the computer,
Settings → Phone sync shows **Use this network** while it's on a different one.

### How sync works

- **Home network only.** The phone sends nothing unless it is on the home Wi-Fi (by name).
  The computer listens only while Phone sync is on *and* it is on its home network
  (Windows network profile); on any other network nothing listens at all.
- **The computer proves who it is first.** Pairing (with the 6-digit code; 5 wrong codes
  lock pairing for 10 minutes) gives the phone a random token once; both sides derive a key
  from it. Before every sync the computer must answer a random challenge with that key, so
  even a look-alike network with the same name gets nothing. Requests and answers are
  signed (HMAC-SHA256) with one-time nonces; the token itself never travels again.
  Contents are not encrypted, but they only ever go over your own home Wi-Fi.
- **Several Windows accounts on one PC** each get their own port (47823, else the next free
  one up to 47832) and their own data. Each computer has a random id, so the phone finds
  its own one again if the address or port changes.
- **Cups add up.** Each phone reports *its own* cups per day; the computer adds the
  difference since the last sync, so nothing is counted twice. Settings carry a time stamp
  per field (corrected for clock differences); the newer one wins.
- UDP 47824 is used to find the computer on the Wi-Fi.

## Build

Needs JDK 17+ and the Android SDK (platform 35). Android Studio: open the `android/`
folder. Command line:

```sh
cd android
echo "sdk.dir=/path/to/Android/sdk" > local.properties   # or set ANDROID_HOME
./gradlew assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease      # minified, signed with the debug key (use your own key to publish)
./gradlew testDebugUnitTest    # sync protocol, quiet hours, streak, ... tests
```

End-to-end test against the real desktop `sync.js` (no Electron needed): start a
`sync.js` instance with a fake main (`require('../sync.js').create({ dataDir, hooks, httpPort,
networks: async () => null })`, hooks as in `tools/sync-test.js`), then run
`WATERCAT_E2E_PORT=<port> WATERCAT_E2E_CODE=<code> ./gradlew testDebugUnitTest`.

## Code

| File | What |
|---|---|
| `State.kt` | All data (one JSON blob in SharedPreferences) + the sync protocol (pure Kotlin, unit tested) |
| `Store.kt` | The state holder + shared actions (log cup, undo, pause) |
| `Scheduler.kt` | AlarmManager: reminders (quiet hours / pause aware) and alarms (`setAlarmClock`) |
| `Notifications.kt` | Channels, the reminder notification, the ringing alarm notification |
| `AlarmActivity.kt` | Full-screen alarm over the lock screen |
| `Receivers.kt` | Notification buttons, alarm firing, reboot / time change rescheduling |
| `Sync.kt` | Wi-Fi discovery, pairing, sync client, WorkManager background sync |
| `MainActivity.kt` | The UI (Today, Alarms, Settings, Sync) in Jetpack Compose |
| `CatSprite.kt` | The desktop's pixel-cat renderer, ported (data in `assets/catsprite.json`) |
| `PixelCat.kt` | The animated cat on screen: idle life, reactions, hops, hearts, sleeping |
| `SoundManager.kt` | All in-app sound (SoundPool + MediaPlayer), sound settings |
| `Theme.kt` | The desktop's colour themes as Material 3, Nunito, rounded shapes |

Assets come from the desktop files: run `python3 scripts/convert_assets.py` after they change
(needs ffmpeg and node with playwright). See `docs/asset_mapping.md`.
