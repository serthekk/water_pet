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
- **Wi-Fi sync** with the desktop app: cups, goal, reminder interval, repeat, quiet hours,
  alarms and the pause. Cups logged on both sides add up (even when they were offline);
  for settings the newest change wins. A cup on either side restarts the reminder on both.

## Install

Build it (below) or download the APK from the CI run (Actions → CI → artifact
`WaterCat-android`), copy it to the phone and open it. Android asks to allow installs from
that app the first time. Needs Android 8.0 or newer.

## Pair with the computer

1. Desktop: **Settings → 📱 Phone sync → Sync with my phone over Wi-Fi**. If Windows
   asks, allow WaterCat on **private** networks. Settings shows a 6-digit code and the
   computer's address.
2. Phone: **Sync tab → 🔍 Search Wi-Fi** (or type the address), enter the code, **Pair**.

After that it syncs whenever the app is open (every minute), a few seconds after every
change, and about every 15 minutes in the background while on Wi-Fi.

### How sync works

The desktop app (`sync.js`) listens on the local network only while Phone sync is on:
UDP 47824 for discovery, HTTP 47823 for pairing + sync. Pairing gives the phone a random
token (the computer keeps only its hash; 5 wrong codes lock pairing for 10 minutes).
Traffic is plain HTTP on your Wi-Fi, nothing goes to the internet, so use it on networks
you trust (home, not café Wi-Fi). Each phone reports *its own* cups per day; the computer
adds the difference since the last sync, so nothing is counted twice. Settings carry a
time stamp per field (corrected for clock differences); the newer one wins.

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
`sync.js` instance with a fake main (see `DesktopE2ETest.kt`), then run
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
