# Renders the pixel loaders (drive, dots, orbit), the coins loader, their reduced-motion
# stills, and the label shimmer sweep to looping APNG masks; app.css embeds them as
# base64 data URLs.
# Usage: python3 scripts/loader-apng.py <out-dir>   (needs Pillow)
import sys, base64, io, math

# 40 fps. ~30 fps (BB's shine-sweep.png rate) costs less compositor work in Chromium 152,
# but the smoother rate is kept by choice; see docs/performance-2026-10-29.md, round 3.
FRAME_MS = 25

def frame_plan(period):
    """Frame count and integer per-frame durations (ms) that sum exactly to period."""
    n = round(period / FRAME_MS)
    return n, [round((k + 1) * period / n) - round(k * period / n) for k in range(n)]
OUT = sys.argv[1] if len(sys.argv) > 1 else "."
from PIL import Image, ImageDraw

def bez(t, p1=0.42, p2=0.58):
    # cubic-bezier(0.42,0,0.58,1): solve x(u)=t, return y(u)
    lo, hi = 0.0, 1.0
    for _ in range(40):
        u = (lo + hi) / 2
        x = 3*(1-u)**2*u*p1 + 3*(1-u)*u**2*p2 + u**3
        lo, hi = (u, hi) if x < t else (lo, u)
    u = (lo + hi) / 2
    return 3*(1-u)*u**2 + u**3  # y control points 0,1

def level(phase):  # keyframes: 0,62,100%: .15 ; 18,42%: 1 ; ease-in-out per segment
    p = phase % 1.0
    if p < .18: return .15 + .85 * bez(p / .18)
    if p < .42: return 1.0
    if p < .62: return 1.0 - .85 * bez((p - .42) / .2)
    return .15

def render(kind, scale=2):
    if kind in ("drive", "dots"):
        period, delays = 650, {"a": 0, "b": 90, "c": 180, "d": 270}
        grid = {(0,0):"b",(5,0):"c",(10,0):"d",(0,5):"a",(5,5):"b",(10,5):"c",(0,10):"b",(5,10):"c",(10,10):"d"}
    else:
        period, delays = 950, {str(i): 110 * i for i in range(8)}
        grid = {(0,0):"0",(5,0):"1",(10,0):"2",(0,5):"7",(5,5):None,(10,5):"3",(0,10):"6",(5,10):"5",(10,10):"4"}
    frames = []
    n, durations = frame_plan(period)
    for f in range(n):
        t = f * period / n
        im = Image.new("RGBA", (14 * scale, 14 * scale), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        for (x, y), k in grid.items():
            v = .07 if k is None else level((t - delays[k]) / period)
            box = [x * scale, y * scale, (x + 4) * scale - 1, (y + 4) * scale - 1]
            a = round(v * 255); fill = (a, a, a, a)
            (d.ellipse if kind == "dots" else d.rectangle)(box, fill=fill)
        frames.append(im)
    buf = io.BytesIO()
    frames[0].save(buf, format="PNG", save_all=True, append_images=frames[1:], duration=durations, loop=0, disposal=1, blend=0, optimize=True)
    return buf.getvalue()

for kind in ("drive", "dots", "orbit"):
    data = render(kind)
    open(f"{OUT}/{kind}.png", "wb").write(data)
    print(kind, len(data), "bytes", len(base64.b64encode(data)), "b64")

def sweep(period=1400, w=128, base=0.42):
    frames = []
    n, durations = frame_plan(period)
    for f in range(n):
        p = 1.5 - 2.0 * f / n
        im = Image.new("RGBA", (w, 1))
        for x in range(w):
            u = (x / (w - 1) + p) / 2
            k = 0.0
            if .35 <= u <= .5: k = (u - .35) / .15
            elif .5 < u <= .65: k = (.65 - u) / .15
            a = round((base + (1 - base) * k) * 255)
            im.putpixel((x, 0), (a, a, a, a))
        frames.append(im)
    buf = io.BytesIO()
    frames[0].save(buf, format="PNG", save_all=True, append_images=frames[1:], duration=durations, loop=0, disposal=1, blend=0, optimize=True)
    return buf.getvalue()

data = sweep()
open(f"{OUT}/sweep.png", "wb").write(data)
print("sweep", len(data), "bytes", len(base64.b64encode(data)), "b64")

def static_grid(kind, v=.15, scale=2):
    im = Image.new("RGBA", (14 * scale, 14 * scale), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for x in (0, 5, 10):
        for y in (0, 5, 10):
            a = round(v * 255)
            box = [x * scale, y * scale, (x + 4) * scale - 1, (y + 4) * scale - 1]
            (d.ellipse if kind == "dots" else d.rectangle)(box, fill=(a, a, a, a))
    buf = io.BytesIO(); im.save(buf, format="PNG", optimize=True); return buf.getvalue()

for kind in ("drive", "dots"):
    data = static_grid(kind)
    open(f"{OUT}/{kind}-static.png", "wb").write(data)
    print(kind + "-static", len(data))


# Coins: Originkit's ring of tumbling coins (formerly a CSS Paint Worklet driven by an
# @property animation). Same geometry: 8 coins on a ring of 0.33s, radius 0.12s; each
# squashes as it turns edge-on and brightens as it faces the viewer. The original loop
# (2π/0.6 s) is symmetric after half a turn, so one APNG loop covers t = 0..0.5. Kept at ~20 fps since the ring moves slowly.
COINS_LOOP_MS = 5236
COINS_FRAMES = 105  # ~20 fps; alpha quantized to 16 levels keeps the file ~46 KB

def coins_alpha(t, px=28, ss=8):
    S = px * ss
    tau = math.tau
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ring, coin, c = S * .33, S * .12, S / 2
    ring_phase, tumble = t * tau, t * tau * 2
    for i in range(8):
        a = i / 8 * tau
        pa = a + tau / 8 - ring_phase
        face = abs(math.cos(tumble + a))
        rx, ry, rot = coin, coin * max(.12, face), pa + tumble / 2
        ox, oy = c + math.cos(pa) * ring, c + math.sin(pa) * ring
        pts = []
        for k in range(64):
            th = k / 64 * tau
            x, y = rx * math.cos(th), ry * math.sin(th)
            pts.append((ox + x * math.cos(rot) - y * math.sin(rot), oy + x * math.sin(rot) + y * math.cos(rot)))
        layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(layer).polygon(pts, fill=(255, 255, 255, round((.25 + .75 * face * face) * 255)))
        im = Image.alpha_composite(im, layer)
    alpha = im.resize((px, px), Image.BOX).getchannel("A").point(lambda v: (v * 15 + 127) // 255 * 17)
    return Image.merge("LA", (alpha, alpha))

def coins():
    frames = [coins_alpha(k / COINS_FRAMES * .5) for k in range(COINS_FRAMES)]
    durations = [round((k + 1) * COINS_LOOP_MS / COINS_FRAMES) - round(k * COINS_LOOP_MS / COINS_FRAMES) for k in range(COINS_FRAMES)]
    buf = io.BytesIO()
    frames[0].save(buf, format="PNG", save_all=True, append_images=frames[1:], duration=durations, loop=0, disposal=1, blend=0, optimize=True)
    return buf.getvalue()

data = coins()
open(f"{OUT}/coins.png", "wb").write(data)
print("coins", len(data), "bytes", len(base64.b64encode(data)), "b64")
buf = io.BytesIO(); coins_alpha(0).save(buf, format="PNG", optimize=True)
open(f"{OUT}/coins-static.png", "wb").write(buf.getvalue())
print("coins-static", len(buf.getvalue()))
