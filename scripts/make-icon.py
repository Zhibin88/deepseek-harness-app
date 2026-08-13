#!/usr/bin/env python3
"""Generate a 1024x1024 app icon for DeepSeek Harness (whale mark on blue gradient)."""
from PIL import Image, ImageDraw

W = H = 1024
RADIUS = 216
WHITE = (255, 255, 255, 245)
INK = (15, 23, 42, 255)

img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
mask = Image.new("L", (W, H), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, H - 1], radius=RADIUS, fill=255)

# vertical gradient background
top = (10, 25, 47)       # deep blue-black
mid = (23, 84, 172)
bottom = (64, 145, 255)  # bright DeepSeek blue
d = ImageDraw.Draw(img)
for y in range(H):
    t = y / H
    if t < 0.55:
        u = t / 0.55
        c = tuple(int(top[i] + (mid[i] - top[i]) * u) for i in range(3))
    else:
        u = (t - 0.55) / 0.45
        c = tuple(int(mid[i] + (bottom[i] - mid[i]) * u) for i in range(3))
    d.line([(0, y), (W, y)], fill=c + (255,))
img.putalpha(mask)

d = ImageDraw.Draw(img)

# ---- whale body (swimming left, tail on the right) ----
# back body / barrel
d.ellipse([250, 360, 720, 700], fill=WHITE)
# taper toward tail
d.ellipse([610, 400, 860, 660], fill=WHITE)
# tail flukes (two symmetric fans pointing right)
d.polygon([(780, 430), (990, 330), (930, 480), (990, 600), (900, 560), (830, 600)],
          fill=WHITE)
# smooth the joint between body and flukes
d.ellipse([740, 430, 860, 610], fill=WHITE)
# front snout rounding
d.ellipse([190, 400, 330, 680], fill=WHITE)
# belly (slightly dimmer for depth)
d.ellipse([280, 560, 780, 720], fill=(222, 234, 247, 245))

# eye
d.ellipse([330, 500, 372, 542], fill=INK)
# eye highlight
d.ellipse([344, 510, 358, 524], fill=(255, 255, 255, 230))

# water spout (from the top of the head)
spout = [(300, 360), (282, 300), (318, 268), (326, 250),
         (352, 268), (362, 300), (404, 330), (340, 352)]
d.polygon(spout, fill=WHITE)
d.ellipse([270, 300, 420, 370], fill=WHITE)

# soft "harness" ring around the whale: a light-blue arc
d.arc([150, 150, 900, 900], start=200, end=340, fill=(150, 200, 255, 160),
      width=18)

img.save("assets/icon.png")
print("saved assets/icon.png")