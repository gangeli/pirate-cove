"""Contact sheets for a screenshot round: one sheet per device (and optional state filter).
   python3 scripts/_contact.py <round_dir> [cols] [thumb_w] [prefix-filter]"""
import sys, os, glob
from PIL import Image, ImageDraw, ImageFont

d = sys.argv[1]
cols = int(sys.argv[2]) if len(sys.argv) > 2 else 6
tw = int(sys.argv[3]) if len(sys.argv) > 3 else 320
filt = sys.argv[4] if len(sys.argv) > 4 else ''
files = sorted(glob.glob(os.path.join(d, '*.png')))
files = [f for f in files if not os.path.basename(f).startswith('sheet_')]
devs = {}
for f in files:
    b = os.path.basename(f)[:-4]
    dev, st = b.split('_', 1)
    if filt and not st.startswith(filt):
        continue
    devs.setdefault(dev, []).append((st, f))
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 14)
except Exception:
    font = ImageFont.load_default()
for dev, items in devs.items():
    ims = []
    for st, f in items:
        im = Image.open(f).convert('RGB')
        h = int(im.height * tw / im.width)
        ims.append((st, im.resize((tw, h), Image.LANCZOS)))
    th = max(i.height for _, i in ims) + 20
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * (tw + 6) + 6, rows * (th + 6) + 6), (30, 30, 30))
    dr = ImageDraw.Draw(sheet)
    for k, (st, im) in enumerate(ims):
        x = 6 + (k % cols) * (tw + 6)
        y = 6 + (k // cols) * (th + 6)
        sheet.paste(im, (x, y + 20))
        dr.text((x + 2, y + 2), st, fill=(240, 220, 160), font=font)
    out = os.path.join(d, f'sheet_{dev}{"_" + filt if filt else ""}.jpg')
    sheet.save(out, quality=85)
    print(out, sheet.size)
