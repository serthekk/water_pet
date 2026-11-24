Drop your own cat sounds in this folder, then run:   node make_meows.js

- Any of: .mp3 .wav .ogg .m4a .flac .opus .aac .webm
- The file name becomes the style name:  happy-trill.mp3  ->  "Happy trill"
- Each sound is cleaned (rumble/hiss/harsh highs removed), silence at the start/end
  is trimmed, it is cut to 4 seconds max, and its loudness is matched to the built-in meows.
- The results go to assets/meows/ and are bundled into the .exe on the next build.

After installing, sounds can also be added WITHOUT rebuilding: Settings -> "Open sounds folder"
(%APPDATA%\water-cat-tracker\sounds). Those show up in the app within a second.
