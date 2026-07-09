"""Detect circular screw/terminal centers in device images for calibration."""
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance
import os
import math

# Manual pixel picks for known screw positions (image pixel coords)
# Measured carefully from original images after visual inspection of overlays.
# Format: list of (id, px, py) in image pixel space of the source PNG.

manual = {
  'MC': {
    'img': 'assets/devices/trimmed/mc-22b-trim.png',
    'dev_w': 260, 'dev_h': 340,
    'box': (20, 10, 220, 320),
    # pixel positions of screw centers on 709x1100 image
    'screws': [
      # top main R S T — three large screws
      ('1L1', 148, 118),
      ('3L2', 310, 118),
      ('5L3', 472, 118),
      # bottom main U V W
      ('2T1', 148, 900),
      ('4T2', 310, 900),
      ('6T3', 472, 900),
      # A1 coil top-right small
      ('A1', 615, 145),
      # A2 coil bottom-right
      ('A2', 615, 930),
      # aux NO 13 (upper of pair on right block)
      ('13', 615, 380),
      ('14', 615, 455),
      # aux NC 21
      ('21', 615, 620),
      ('22', 615, 700),
    ],
  },
  'MDR': {
    'img': 'assets/devices/trimmed/mdr-100-trim.png',
    'dev_w': 308, 'dev_h': 385,
    'box': (80.5, 36.5, 146.9, 324.5),
    'screws': [
      # top 4 screws on 535x1182 — left to right
      ('V+1', 145, 72),
      ('V+2', 215, 72),
      ('V-1', 310, 72),
      ('V-2', 390, 72),
      # bottom 3
      ('PE', 155, 1110),
      ('N', 268, 1110),
      ('L', 370, 1110),
    ],
  },
  'PB': {
    'img': 'assets/devices/codex/pushbutton-1c-codex.png',
    'dev_w': 180, 'dev_h': 240,
    'box': (10, 5, 160, 230),
    'screws': [
      ('11', 40, 28),
      ('12', 136, 28),
      ('21', 40, 240),
      ('22', 136, 240),
    ],
  },
  'SEL': {
    'img': 'assets/devices/codex/selector-2p-codex.png',
    'dev_w': 180, 'dev_h': 250,
    'box': (8, 5, 164, 240),
    # image 177x267 — top pair + bottom pair of screws
    'screws': [
      ('21', 42, 28),   # top-left screw (NC COM) — use top for 21/22? SEL has 4 bottom screws in data but image has top+bottom
      ('22', 135, 28),  # top-right
      ('11', 42, 238),  # bottom-left
      ('12', 135, 238), # bottom-right
    ],
  },
  'TB4': {
    'img': 'assets/devices/codex/tb4-codex.png',
    'dev_w': 220, 'dev_h': 100,
    'box': (0, 0, 220, 100),
    # 191x127 image — 4 top + 4 bottom screws
    'screws': [
      ('1', 38, 32),
      ('2', 80, 32),
      ('3', 122, 32),
      ('4', 164, 32),
      ("1'", 38, 88),
      ("2'", 80, 88),
      ("3'", 122, 88),
      ("4'", 164, 88),
    ],
  },
  'TB10': {
    'img': 'assets/devices/codex/tb10-codex.png',
    'dev_w': 480, 'dev_h': 100,
    'box': (0, 0, 480, 100),
    # 456x127 — 10 columns, pitch ~42px starting ~35
    'screws': (
      [(str(i + 1), 35 + i * 42.2, 32) for i in range(10)]
      + [(f"{i + 1}'", 35 + i * 42.2, 88) for i in range(10)]
    ),
  },
  'TIMER': {
    'img': 'assets/devices/codex/timer-codex.png',
    'dev_w': 160, 'dev_h': 260,
    'box': (8, 5, 144, 250),
    # 145x235
    'screws': [
      ('1', 22, 22),
      ('3', 52, 22),
      ('4', 92, 22),
      ('8', 122, 22),
      ('2', 22, 212),
      ('7', 52, 212),
      ('6', 92, 212),
      ('5', 122, 212),
    ],
  },
  'XBF': {
    'img': 'assets/devices/codex/xbf-ah04a-codex.png',
    'dev_w': 140, 'dev_h': 420,
    'box': (0, 0, 140, 420),
    # 107x309 — screws are on RIGHT side of the grey strip (~x=72)
    'screws': [
      (id_, 72, 28 + i * 25.5)
      for i, id_ in enumerate(
        ['NC', '+24V', '0V', 'I0+', 'I0-', 'I1+', 'I1-', 'O0+', 'O0-', 'O1+', 'O1-']
      )
    ],
  },
  'PSU': {
    'img': 'assets/devices/codex/psu24-clean.png',
    'dev_w': 160, 'dev_h': 420,
    'box': (10, 8, 140, 404),
    # 79x232 — top 2 screws, bottom 3 terminal holes
    'screws': [
      ('V+', 22, 14),
      ('V-', 58, 14),
      ('L', 18, 218),
      ('N', 40, 218),
      ('PE', 62, 218),
    ],
  },
  'LAMP': {
    'img': 'assets/devices/codex/lamp-green-codex-clean.png',
    'dev_w': 170, 'dev_h': 220,
    'box': (0, 0, 170, 220),
    # use bottom 2 screws as +/-; also top 2 exist but lamp only needs 2
    'screws': [
      ('+', 48, 195),
      ('-', 122, 195),
    ],
  },
  'EOCR': {
    'img': 'assets/devices/trimmed/eocr-trim.png',
    'dev_w': 280, 'dev_h': 300,
    'box': (10, 5, 260, 290),
    # 1009x1065 — bottom 8 screws look good already; refine CT positions
    'screws': [
      ('R-IN', 175, 95),
      ('S-IN', 505, 95),
      ('T-IN', 835, 95),
      ('R-OUT', 175, 230),
      ('S-OUT', 505, 230),
      ('T-OUT', 835, 230),
      ('A1', 95, 980),
      ('A2', 210, 980),
      ('95', 325, 980),
      ('96', 440, 980),
      ('97', 555, 980),
      ('98', 670, 980),
      ('07', 785, 980),
      ('08', 900, 980),
    ],
  },
}


def px_to_dev(px, py, iw, ih, box):
  bx, by, bw, bh = box
  x = bx + (px / iw) * bw
  y = by + (py / ih) * bh
  return round(x, 1), round(y, 1)


def main():
  root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
  os.chdir(root)
  out_dir = 'assets/devices/_calib_check'
  os.makedirs(out_dir, exist_ok=True)

  print('// Auto-generated terminal coords from screw pixel picks')
  print('const SCREW_CALIBRATION = {')
  for name, d in manual.items():
    im = Image.open(d['img'])
    iw, ih = im.size
    terms = []
    for item in d['screws']:
      tid, px, py = item[0], item[1], item[2]
      x, y = px_to_dev(px, py, iw, ih, d['box'])
      terms.append((tid, x, y, px, py))
    print(f"  '{name}': {{")
    print(f"    w: {d['dev_w']}, h: {d['dev_h']},")
    print(f"    box: {d['box']},")
    print('    terminals: [')
    for tid, x, y, px, py in terms:
      print(f"      {{id:'{tid}',x:{x},y:{y}}}, // px={px},{py}")
    print('    ],')
    print('  },')

    # redraw overlay with new coords
    im2 = im.convert('RGBA')
    draw = ImageDraw.Draw(im2)
    for tid, x, y, px, py in terms:
      r = max(4, min(iw, ih) * 0.012)
      draw.ellipse([px - r, py - r, px + r, py + r], outline=(0, 255, 0, 255), width=2)
      draw.line([px - r * 1.5, py, px + r * 1.5, py], fill=(0, 255, 0, 255), width=2)
      draw.line([px, py - r * 1.5, px, py + r * 1.5], fill=(0, 255, 0, 255), width=2)
      draw.text((px + r + 2, py - 8), tid, fill=(0, 200, 0, 255))
    im2.save(os.path.join(out_dir, f'{name}_v2.png'))
    print(f'  // saved {name}_v2.png')
  print('};')


if __name__ == '__main__':
  main()
