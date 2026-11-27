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

## Pixel art (drawn by the app, not images)

The desktop draws its cat, items and drinks from letter grids in code. The grids are exported
as data (`scripts/export_sprites.js` → `assets/catsprite.json`, 28 KB) and drawn by
`CatSprite.kt`, a line-by-line port of the desktop renderer, so every coat, colour, item and
animation works on the phone without thousands of image files. `SpriteGoldenTest` checks
288 scenes against the desktop's own output, cell for cell.

| Desktop | Android | Used in |
|---|---|---|
| `catsprite.js` poses (sit, blink, wag, squint, yawn, groom ×2, belly, sleep ×2, walk ×4, crouch ×2, pounce, stretch ×2, scratch ×2, knead ×2) | `assets/catsprite.json` `frames` → `SpriteData.render()` | `PixelCat` (Today screen, alarm screen), `CatThumb` (coat picker) |
| `catsprite.js` 15 coats (`PRESETS`), 6 patterns, ear styles, fluffy / tufts, whiskers | `presets`, `SpriteData.render()` / `whiskerLines()` | Settings → Look → Coat |
| `renderer.js` animations (`ANIMS`: happy, boop, belly, stretch, scratch, yawn, groom, look, knead, chomp, tailcurl) + idle blinks / wags | `PixelCat.kt` `ANIMS` (same timings) | Drink → happy, hold → boop, stroke → belly; idle life |
| `main.js` `catMood()` (ears + eyelids when well behind) | `catMood()` in `PixelCat.kt` | Today screen |
| Accessories (bow, glasses, sunglasses, crown, scarf, bandana, bell, name tag, heart glasses, flower crown, gold crown) | `accessories`, `itemGrids`, `anchors` → `SpriteData.accessoryCells()` | Ready for the Bag / Clothes step |
| Seasonal outfits (Santa hat, bunny ears, witch hat, heart pin) | `seasonal` → `seasonalFor()` | Worn automatically on the dates |
| Party hat, hearts, disco ball | `partyHat`, `heart`, `discoBall` | Hat on goal days; hearts on every reward |
| Sleeping spots (bed, cat tree, box) | `spots` → `SpriteData.spotCells()` | She sleeps in her bed during quiet hours |
| Knead props (blanket, dough) | `kneadProps` | Ready for treats |
| `drinks.js` icons (water, kombucha, tea, coffee, boba) | `drinks` | Ready for the drink picker |

## Colours, font, shapes

| Desktop | Android | Used in |
|---|---|---|
| `themes.js` (Cream & Peach, Lavender Dream, Cherry Blossom, Sunflower Field, Matcha & Rose, Autumn Harvest, Cozy Maple, Plum & Olive, Autumn Twilight) | `assets/themes.json` → `DesktopTheme.scheme()` (Material 3 `ColorScheme`) | Settings → Look → Colours (saved in DataStore) |
| — (desktop uses the system font) | `res/font/nunito.ttf` (variable, SIL OFL: `assets/licenses/OFL-Nunito.txt`) → `Nunito` `FontFamily`, `AppTypography` | Every text |
| Desktop cards (rounded) | `AppShapes` (24 dp cards) | Every card |

## Images

All lossless WebP (`scripts/convert_assets.py`, ffmpeg).

| Desktop | Android | Used in |
|---|---|---|
| `assets/bowl_10x.png` | `drawable-nodpi/bowl.webp` | Today screen, under the cat |
| `build/icon.png` | `mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.webp` | Launcher icon |
| `assets/cat_pixel*.png` | — (the cat is drawn by the sprite renderer now) | — |
| `assets/tray.png` | — (Android uses `drawable/ic_stat_cat.xml`, a vector status-bar icon) | Notifications |
