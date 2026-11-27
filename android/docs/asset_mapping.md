# Desktop asset → Android resource mapping

Desktop files live in the repository root (read-only for the Android app). Regenerate the
Android side with `python3 scripts/convert_assets.py` (from `android/`).

## Audio

All clips are converted at the desktop's own level for volume 1.0 (peak levels match to
±0.1 dB) and play at the phone's volume setting, so the mix is the desktop's. Format: Ogg
Vorbis, mono (stored uncompressed in the APK, as SoundPool / MediaPlayer need).

| Desktop | Android | Played by | When |
|---|---|---|---|
| `assets/meows/original.wav` | `raw/meow_original.ogg` | `SoundManager.meow()` (style "original"); reminder notification channel `reminders_meow` | Meow style, volume test; every water reminder notification |
| `assets/meows/deep-purr.wav` | `raw/meow_deep_purr.ogg` | `SoundManager.meow()` | Meow style "Deep Purr" / random |
| `assets/meows/mew.wav` | `raw/meow_mew.ogg` | `SoundManager.meow()` | Meow style "Mew" / random |
| `assets/meows/nyah-nyah.wav` | `raw/meow_nyah_nyah.ogg` | `SoundManager.meow()` | Meow style "Nyah Nyah" / random |
| `assets/meows/purrina.wav` | `raw/meow_purrina.ogg` | `SoundManager.meow()` | Meow style "Purrina" / random |
| `assets/meows/rrreow.wav` | `raw/meow_rrreow.ogg` | `SoundManager.meow()` | Meow style "Rrreow" / random |
| `assets/meows/singing-cat.wav` | `raw/meow_singing_cat.ogg` | `SoundManager.meow()` | Meow style "Singing cat" / random |
| `renderer.js` `chirp()` (Web Audio synth) | `raw/sfx_chirp.ogg` | `SoundManager.cupLogged()` / `chirp()` | A drink is logged (tap the cat / "I drank"); softer in quiet hours |
| `renderer.js` `squeak()` | `raw/sfx_squeak.ogg` | `SoundManager.squeak()` | Nose boop (hold the cat) |
| `renderer.js` `purrFor()` | `raw/sfx_purr_loop.ogg` (seamless 2 s loop; fades done in code) | `SoundManager.purr()` | Petting (stroke the cat) |
| `renderer.js` `partyMusic()` | `raw/music_party.ogg` (20 s) | `SoundManager.startParty()` (MediaPlayer + audio focus) | The goal is reached the first time in a day (not in quiet hours) |
| `sounds/*.mp3`, `source_audio/*.mp3` | — | — | Sources of the WAVs above (`make_meows.js`); not needed on the phone |

The synthesized sounds are rendered by `scripts/render_synth_sounds.js`, which runs the
desktop's own Web Audio graphs in headless Chromium's `OfflineAudioContext`.

## Images

| Desktop | Android | Used in |
|---|---|---|
| `assets/cat_pixel_10x.png` | `drawable-nodpi/cat.png` | Today screen, alarm screen (to be replaced by the sprite renderer, step 3) |
| `assets/bowl_10x.png` | `drawable-nodpi/bowl.png` | Today screen |
| `build/icon.png` | `mipmap-xxxhdpi/ic_launcher.png` | Launcher icon |

(Sprites, drink icons, toys, themes and fonts: step 3.)
