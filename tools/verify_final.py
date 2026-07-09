"""Verify final terminal coords from index.html against images."""
from PIL import Image, ImageDraw
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

# Final known coordinates after QA (mirror of calibrateTerminalScrews)
devices = {
  'MC': {
    'img': 'assets/devices/trimmed/mc-22b-trim.png',
    'box': (20, 10, 220, 320),
    'terms': [
      ('1L1', 54.9, 47.2), ('3L2', 105.6, 47.2), ('5L3', 159.6, 47.2),
      ('2T1', 55.0, 267.2), ('4T2', 105.8, 269.3), ('6T3', 159.5, 269.5),
      ('A1', 206.5, 52.2), ('A2', 206.0, 282.0),
      ('13', 205.5, 91.7), ('14', 205.5, 120.5),
      ('21', 205.2, 216.3), ('22', 204.3, 264.8),
    ],
  },
  'TB4': {
    'img': 'assets/devices/codex/tb4-codex.png',
    'box': (0, 0, 220, 100),
    'terms': [
      ('1', 78.7, 28.3), ('2', 119.2, 27.3), ('3', 165.1, 28.6), ('4', 207.1, 28.5),
      ("1'", 78.1, 69.5), ("2'", 121.7, 69.1), ("3'", 165.2, 69.3), ("4'", 206.3, 68.6),
    ],
  },
  'TB10': {
    'img': 'assets/devices/codex/tb10-codex.png',
    'box': (0, 0, 480, 100),
    'terms': [
      (str(i + 1), round(px / 456 * 480, 1), 28.3)
      for i, px in enumerate([68.3, 103.5, 143.3, 179.8, 216.0, 253.2, 288.5, 324.7, 361.4, 398.4])
    ] + [
      (f"{i + 1}'", round(px / 456 * 480, 1), 69.3)
      for i, px in enumerate([68.3, 103.5, 143.3, 179.8, 216.0, 253.2, 288.5, 324.7, 361.4, 398.4])
    ],
  },
  'XBF': {
    'img': 'assets/devices/codex/xbf-ah04a-codex.png',
    'box': (0, 0, 140, 420),
    'terms': [
      (id_, 51.0, round(49.6 + (327.7 - 49.6) * i / 10, 1))
      for i, id_ in enumerate(
        ['NC', '+24V', '0V', 'I0+', 'I0-', 'I1+', 'I1-', 'O0+', 'O0-', 'O1+', 'O1-']
      )
    ],
  },
  'MDR': {
    'img': 'assets/devices/trimmed/mdr-100-trim.png',
    'box': (80.5, 36.5, 146.9, 324.5),
    'terms': [
      ('V+1', 115.4, 59.1), ('V+2', 140.2, 59.2), ('V-1', 164.9, 59.1), ('V-2', 189.7, 59.1),
      ('PE', 125.0, 338.7), ('N', 153.2, 338.6), ('L', 180.6, 338.7),
    ],
  },
  'PB': {
    'img': 'assets/devices/codex/pushbutton-1c-codex.png',
    'box': (10, 5, 160, 230),
    'terms': [
      ('11', 45.5, 30.7), ('12', 113.6, 29.8),
      ('21', 45.5, 211.9), ('22', 114.5, 211.1),
    ],
  },
  'SEL': {
    'img': 'assets/devices/codex/selector-2p-codex.png',
    'box': (8, 5, 164, 240),
    'terms': [
      ('21', 44.1, 31.1), ('22', 115.5, 31.1),
      ('11', 45.1, 220.7), ('12', 114.6, 221.6),
    ],
  },
  'TIMER': {
    'img': 'assets/devices/codex/timer-codex.png',
    'box': (8, 5, 144, 250),
    'terms': [
      ('1', 32.8, 34.8), ('3', 60.6, 35.9), ('4', 89.4, 36.9), ('8', 118.2, 34.8),
      ('2', 33.8, 218.8), ('7', 61.6, 221.0), ('6', 89.4, 219.9), ('5', 119.2, 217.8),
    ],
  },
  'EOCR': {
    'img': 'assets/devices/trimmed/eocr-trim.png',
    'box': (10, 5, 260, 290),
    'terms': [
      ('R-IN', 55.1, 32.2), ('S-IN', 140.1, 32.2), ('T-IN', 225.2, 32.2),
      ('R-OUT', 55.1, 67.6), ('S-OUT', 140.1, 67.6), ('T-OUT', 225.2, 67.6),
      ('A1', 42.0, 270.5), ('A2', 72.5, 270.5), ('95', 103.0, 270.5), ('96', 131.0, 270.5),
      ('97', 162.5, 270.5), ('98', 192.0, 270.5), ('07', 222.5, 270.5), ('08', 251.5, 270.5),
    ],
  },
  'LAMP': {
    'img': 'assets/devices/codex/lamp-green-codex-clean.png',
    'box': (0, 0, 170, 220),
    'terms': [('+', 52, 190), ('-', 118, 194)],
  },
  'FUSE': {
    'img': 'assets/devices/codex/fuse-holder-2p-codex.png',
    'box': (0, 0, 170, 300),
    'terms': [
      ('L-IN', 53.5, 52.1), ('N-IN', 123.0, 52.1),
      ('L-OUT', 62.0, 269.7), ('N-OUT', 130.4, 269.7),
    ],
  },
  'MCCB': {
    'img': 'assets/devices/trimmed/mccb-trim.png',
    'box': (32.7, 47.3, 173.7, 205.4),
    'terms': [
      ('L1', 56, 70), ('L2', 120, 70), ('L3', 180, 70),
      ('T1', 56, 232), ('T2', 120, 232), ('T3', 180, 232),
    ],
  },
}


def main():
  out_dir = 'assets/devices/_calib_check'
  os.makedirs(out_dir, exist_ok=True)
  for name, d in devices.items():
    im = Image.open(d['img']).convert('RGBA')
    iw, ih = im.size
    bx, by, bw, bh = d['box']
    draw = ImageDraw.Draw(im)
    for tid, x, y in d['terms']:
      px = (x - bx) / bw * iw
      py = (y - by) / bh * ih
      r = max(5, min(iw, ih) * 0.012)
      draw.ellipse([px - r, py - r, px + r, py + r], outline=(0, 255, 0, 255), width=2)
      draw.line([px - r * 1.6, py, px + r * 1.6, py], fill=(0, 255, 0, 255), width=2)
      draw.line([px, py - r * 1.6, px, py + r * 1.6], fill=(0, 255, 0, 255), width=2)
      draw.text((px + r + 2, py - 8), tid, fill=(0, 220, 0, 255))
    path = os.path.join(out_dir, f'{name}_QA.png')
    im.save(path)
    print(f'saved {path}')


if __name__ == '__main__':
  main()
