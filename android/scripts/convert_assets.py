#!/usr/bin/env python3
"""Converts the desktop app's assets (the repo root, read-only) into Android resources.

Run it again whenever the desktop assets change:

    cd android && python3 scripts/convert_assets.py

Needs: ffmpeg (with libvorbis), node + the playwright package with Chromium (for the
synthesized sounds). See docs/asset_mapping.md for what goes where.

Audio
  assets/meows/<id>.wav         -> res/raw/meow_<id>.ogg   (Ogg Vorbis, mono, same level)
  renderer.js synth sounds      -> res/raw/sfx_*.ogg, music_party.ogg
                                   (rendered by scripts/render_synth_sounds.js)
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ANDROID = os.path.dirname(HERE)
DESKTOP = os.path.dirname(ANDROID)
RES = os.path.join(ANDROID, "app", "src", "main", "res")
RAW = os.path.join(RES, "raw")


def res_name(s: str) -> str:
    """Android resource names: lowercase letters, digits and underscores only."""
    out = "".join(c if c.isalnum() else "_" for c in s.lower())
    return out.strip("_")


def ogg(src: str, dst: str) -> None:
    # Vorbis quality 5 (~160 kbit/s stereo equivalent): transparent for these short clips.
    # No loudness change: the levels stay exactly the desktop's.
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-ac", "1", "-c:a", "libvorbis", "-q:a", "5", dst], check=True)


def convert_audio() -> list:
    os.makedirs(RAW, exist_ok=True)
    done = []
    with open(os.path.join(DESKTOP, "assets", "meows", "meows.json"), encoding="utf-8") as f:
        meows = json.load(f)
    for m in meows:
        src = os.path.join(DESKTOP, "assets", "meows", m["file"])
        name = "meow_" + res_name(m["id"])
        ogg(src, os.path.join(RAW, name + ".ogg"))
        done.append((f"assets/meows/{m['file']}", f"raw/{name}.ogg", m["label"]))
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["node", os.path.join(HERE, "render_synth_sounds.js"), tmp], check=True)
        for f in sorted(os.listdir(tmp)):
            name = res_name(os.path.splitext(f)[0])
            ogg(os.path.join(tmp, f), os.path.join(RAW, name + ".ogg"))
            done.append(("renderer.js (synthesized)", f"raw/{name}.ogg", name))
    return done


def main() -> int:
    for tool in ("ffmpeg", "node"):
        if not shutil.which(tool):
            print(f"missing: {tool}", file=sys.stderr)
            return 1
    for src, dst, what in convert_audio():
        print(f"{src:40} -> {dst:32} {what}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
