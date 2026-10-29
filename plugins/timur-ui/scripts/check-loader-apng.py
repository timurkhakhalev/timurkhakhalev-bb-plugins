"""Check generated animation timing and the masks embedded in app.css (needs Pillow).

Also fails if app.css still declares a looping CSS animation: every infinite loop must
be an APNG mask so pending rows never restyle the page per frame.
"""
import base64
from pathlib import Path
import subprocess
import sys
import tempfile

from PIL import Image

plugin = Path(__file__).resolve().parent.parent
css = (plugin / "src/chat/app.css").read_text()
expected = {
    "drive": ((28, 28), 26, 650),
    "dots": ((28, 28), 26, 650),
    "orbit": ((28, 28), 38, 950),
    "sweep": ((128, 1), 56, 1400),
    "drive-static": ((28, 28), 1, 0),
    "dots-static": ((28, 28), 1, 0),
    "coins": ((28, 28), 105, 5236),
    "coins-static": ((28, 28), 1, 0),
}

import re
looping = re.findall(r"animation(?:-iteration-count)?:[^;{}]*infinite", css)
assert not looping, f"Looping CSS animation in app.css: {looping}"

with tempfile.TemporaryDirectory() as output:
    subprocess.run([sys.executable, str(plugin / "scripts/loader-apng.py"), output], check=True)
    for name, (size, frames, duration) in expected.items():
        path = Path(output) / f"{name}.png"
        assert base64.b64encode(path.read_bytes()).decode() in css, f"Stale embedded mask: {name}"
        with Image.open(path) as image:
            assert image.size == size, name
            assert image.n_frames == frames, name
            if frames > 1:
                assert image.info["loop"] == 0, name
            total = 0
            masks = set()
            for frame in range(image.n_frames):
                image.seek(frame)
                image.load()
                total += image.info.get("duration", 0)
                masks.add(image.convert("RGBA").getchannel("A").tobytes())
            assert total == duration, (name, total)
            assert len(masks) > 1 if frames > 1 else len(masks) == 1, name
print(f"All {len(expected)} masks decode, match app.css, and have the expected timing.")
