"""Post-process the Blender floor bake for the web app: lift the fully occluded floor under the racks
to a soft shade, then save a compact JPEG (web/public/tex/floor.jpg)."""
from pathlib import Path
import numpy as np
from PIL import Image

HERE = Path(__file__).parent
OUT = HERE.parent.parent / "web" / "public" / "tex" / "floor.jpg"
a = np.asarray(Image.open(HERE / "floor_raw.png").convert("RGB"), dtype=np.float32) / 255
lum = a @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
f = np.clip((0.42 - lum) / 0.42, 0, 1)[..., None]
a = a * (1 - f) + np.array([184, 178, 166], dtype=np.float32) / 255 * f
OUT.parent.mkdir(parents=True, exist_ok=True)
Image.fromarray((a * 255 + 0.5).astype(np.uint8)).save(OUT, quality=86, optimize=True, progressive=True)
edge = (a[4, 4] * 255).round().astype(int)
print("saved", OUT, OUT.stat().st_size // 1024, "KB; corner colour #%02x%02x%02x" % tuple(edge))
