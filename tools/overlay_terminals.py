"""Overlay terminal coordinates on device images for calibration QA."""
from PIL import Image, ImageDraw
import os

devices = {
  'MC': {
    'img': 'assets/devices/trimmed/mc-22b-trim.png',
    'box': (20, 10, 220, 320),
    'terms': [
      ('1L1', 70, 48), ('3L2', 130, 48), ('5L3', 190, 48),
      ('2T1', 70, 265), ('4T2', 130, 265), ('6T3', 190, 265),
      ('A1', 228, 55), ('A2', 228, 280),
      ('13', 228, 125), ('14', 228, 148), ('21', 228, 195), ('22', 228, 218),
    ],
  },
  'EOCR': {
    'img': 'assets/devices/trimmed/eocr-trim.png',
    'box': (10, 5, 260, 290),
    'terms': [
      ('R-IN', 55, 42), ('S-IN', 140, 42), ('T-IN', 225, 42),
      ('R-OUT', 55, 78), ('S-OUT', 140, 78), ('T-OUT', 225, 78),
      ('A1', 28, 272), ('A2', 60, 272), ('95', 92, 272), ('96', 124, 272),
      ('97', 156, 272), ('98', 188, 272), ('07', 220, 272), ('08', 252, 272),
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
  'MDR': {
    'img': 'assets/devices/trimmed/mdr-100-trim.png',
    'box': (80.5, 36.5, 146.9, 324.5),
    'terms': [
      ('V+1', 116, 57), ('V+2', 140, 57), ('V-1', 167, 57), ('V-2', 192, 57),
      ('PE', 125, 339), ('N', 154, 339), ('L', 179, 339),
    ],
  },
  'PB': {
    'img': 'assets/devices/codex/pushbutton-1c-codex.png',
    'box': (10, 5, 160, 230),
    'terms': [('11', 48, 38), ('12', 132, 38), ('21', 48, 205), ('22', 132, 205)],
  },
  'SEL': {
    'img': 'assets/devices/codex/selector-2p-codex.png',
    'box': (8, 5, 164, 240),
    'terms': [('21', 48, 175), ('22', 132, 175), ('11', 48, 220), ('12', 132, 220)],
  },
  'TB4': {
    'img': 'assets/devices/codex/tb4-codex.png',
    'box': (0, 0, 220, 100),
    'terms': [
      ('1', 36, 28), ('2', 85.3, 28), ('3', 134.7, 28), ('4', 184, 28),
      ("1'", 36, 72), ("2'", 85.3, 72), ("3'", 134.7, 72), ("4'", 184, 72),
    ],
  },
  'TB10': {
    'img': 'assets/devices/codex/tb10-codex.png',
    'box': (0, 0, 480, 100),
    'terms': (
      [(str(i + 1), 34 + i * 45.5, 28) for i in range(10)]
      + [(f"{i + 1}'", 34 + i * 45.5, 74) for i in range(10)]
    ),
  },
  'TIMER': {
    'img': 'assets/devices/codex/timer-codex.png',
    'box': (8, 5, 144, 250),
    'terms': [
      ('1', 32, 28), ('3', 64, 28), ('4', 96, 28), ('8', 128, 28),
      ('2', 32, 232), ('7', 64, 232), ('6', 96, 232), ('5', 128, 232),
    ],
  },
  'XBF': {
    'img': 'assets/devices/codex/xbf-ah04a-codex.png',
    'box': (0, 0, 140, 420),
    'terms': [
      (id_, 32, 48 + (372 - 48) * i / 10)
      for i, id_ in enumerate(
        ['NC', '+24V', '0V', 'I0+', 'I0-', 'I1+', 'I1-', 'O0+', 'O0-', 'O1+', 'O1-']
      )
    ],
  },
  'PSU': {
    'img': 'assets/devices/codex/psu24-clean.png',
    'box': (10, 8, 140, 404),
    'terms': [
      ('V+', 48, 22), ('V-', 112, 22),
      ('L', 40, 398), ('N', 80, 398), ('PE', 120, 398),
    ],
  },
  'LAMP': {
    'img': 'assets/devices/codex/lamp-green-codex-clean.png',
    'box': (0, 0, 170, 220),
    'terms': [('+', 58, 188), ('-', 112, 188)],
  },
  'FUSE': {
    'img': 'assets/devices/codex/fuse-holder-2p-codex.png',
    'box': (0, 0, 170, 300),
    'terms': [
      ('L-IN', 48, 36), ('N-IN', 122, 36),
      ('L-OUT', 48, 264), ('N-OUT', 122, 264),
    ],
  },
  'XBC': {
    'img': 'assets/devices/trimmed/xbc-dr32h-24g-v2.png',
    'box': (41.4, 52.4, 635.1, 492.6),
    'terms': [
      ('RX', 121, 86), ('TX', 157, 86), ('SG', 193, 86), ('P01', 228, 86),
      ('P03', 264, 86), ('P05', 299, 86), ('P07', 334, 86), ('P09', 370, 86),
      ('P0B', 405, 86), ('P0D', 434.6, 86), ('P0F', 468.9, 86),
      ('24G-TOP', 506.4, 86), ('24V', 545.9, 86),
      ('485+', 121, 141), ('485-', 157, 141), ('P00', 193, 141), ('P02', 228, 141),
      ('P04', 264, 141), ('P06', 299, 141), ('P08', 334, 141), ('P0A', 370, 141),
      ('P0C', 405, 140), ('P0E', 468.7, 140), ('COMI', 505.6, 140), ('24G', 545.1, 140),
      ('L', 103.2, 466), ('N', 143.1, 466), ('PE', 182.5, 466), ('P20', 224.2, 466),
      ('P22', 264.1, 466), ('COM0', 303.3, 466), ('P25', 344.5, 466), ('P27', 384.1, 466),
      ('P28', 424.4, 466), ('P2A', 466, 466), ('COM2', 507.4, 466), ('P2D', 548, 466),
      ('P2F', 588.8, 466),
      ('NC', 155.8, 518), ('PE2', 191.6, 518), ('P21', 226.1, 518), ('P23', 261.8, 518),
      ('P24', 298.2, 518), ('P26', 333.5, 518), ('COM1', 367.3, 518), ('P29', 400.1, 518),
      ('P2B', 434.6, 518), ('P2C', 469.1, 518), ('P2E', 505.2, 518), ('COM3', 541.2, 518),
    ],
  },
  'IG5A': {
    'img': 'assets/devices/trimmed/ig5a-trim.png',
    'box': (42.3, 25.9, 215.1, 337.9),
    'terms': [
      ('R', 11.5, 241.5), ('S', 11.5, 264.5), ('T', 11.5, 287.5), ('GMAIN', 11.5, 310.5),
      ('U', 287.5, 241.5), ('V', 287.5, 264.5), ('W', 287.5, 287.5), ('GMOT', 287.5, 310.5),
      ('MO', 62.4, 317.4), ('MG', 83.0, 317.4), ('24', 103.6, 317.4), ('P1', 124.1, 317.4),
      ('P2', 143.6, 317.4), ('CM', 163.3, 317.4), ('P3', 182.5, 317.4), ('P4', 201.7, 317.4),
      ('S-', 220.6, 317.4), ('S+', 239.1, 317.4),
      ('3A', 58.3, 345.0), ('3B', 75.1, 345.0), ('3C', 92.0, 345.0), ('P5', 108.8, 345.0),
      ('CM2', 125.5, 345.0), ('P6', 142.1, 345.0), ('P7', 158.4, 345.0), ('P8', 174.5, 345.0),
      ('VR', 190.6, 345.0), ('V1', 206.7, 345.0), ('I', 222.8, 345.0), ('AM', 239.1, 345.0),
    ],
  },
  'SERVO': {
    'img': 'assets/devices/user/servo-drive-clean.png',
    'box': (10, 8, 260, 544),
    'terms': [
      ('L1', 28, 90), ('L2', 28, 120), ('L3', 28, 150), ('PE', 28, 185),
      ('P24', 28, 230), ('0V', 28, 260), ('STO1', 28, 295), ('STO0', 28, 325),
      ('U', 28, 390), ('V', 28, 420), ('W', 28, 450), ('MPE', 28, 500),
      ('PULS+', 260, 160), ('PULS-', 260, 182.9), ('SIGN+', 260, 205.7), ('SIGN-', 260, 228.6),
      ('SON', 260, 251.4), ('ALMRST', 260, 274.3), ('READY', 260, 297.1), ('ALM', 260, 320),
      ('E5V', 260, 360), ('EGND', 260, 377.8), ('EA+', 260, 395.6), ('EA-', 260, 413.3),
      ('EB+', 260, 431.1), ('EB-', 260, 448.9), ('EZ+', 260, 466.7), ('EZ-', 260, 484.4),
      ('BRK+', 260, 502.2), ('BRK-', 260, 520),
    ],
  },
  'MOTOR': {
    'img': 'assets/devices/user/servo-motor-clean.png',
    'box': (0, 0, 280, 420),
    'terms': [
      ('U', 108, 94), ('V', 120, 94), ('W', 132, 94), ('PE', 144, 94),
      ('BRK+', 156, 94), ('BRK-', 168, 94),
      ('E5V', 108, 112), ('EGND', 120, 112), ('EA+', 132, 112), ('EA-', 144, 112),
      ('EB+', 156, 112), ('EB-', 168, 112), ('EZ+', 180, 112), ('EZ-', 192, 112),
    ],
  },
  'POS': {
    'img': 'assets/devices/user/pos-mod-clean.png',
    'box': (20, 10, 140, 500),
    'terms': [
      ('V+', 28, 470), ('V-', 28, 495), ('FG', 28, 445),
    ] + [
      (id_, 168, 80 + (430 - 80) * i / 10)
      for i, id_ in enumerate(
        ['PULS+', 'PULS-', 'SIGN+', 'SIGN-', 'SVON', 'ALMRST', 'RDY', 'ALM', 'ORG', 'LSP', 'LSN']
      )
    ],
  },
  'RAIL': {
    'img': 'assets/devices/user/linear-rail-clean.png',
    'box': (10, 10, 620, 160),
    'terms': [
      ('V+', 70, 155), ('V-', 110, 155), ('HOME', 250, 155),
      ('LIM-', 420, 155), ('LIM+', 520, 155), ('PE', 600, 155),
    ],
  },
  'SOL': {
    'img': 'assets/devices/codex/sol-y-codex.png',
    'box': (0, 0, 280, 160),
    'terms': [('A1', 48, 36), ('A2', 48, 70)],
  },
  'MD02': {
    'img': 'assets/devices/codex/md02-codex.png',
    'box': (0, 0, 190, 130),
    'terms': [
      ('V+', 34, 108), ('V-', 74.7, 108), ('A+', 115.3, 108), ('B-', 156, 108),
    ],
  },
  'PROX': {
    'img': 'assets/devices/codex/prox-sensor-codex.png',
    'box': (0, 0, 260, 120),
    'terms': [('BN', 250, 36), ('BK', 250, 60), ('BU', 250, 84)],
  },
  'ENCODER': {
    'img': 'assets/devices/codex/encoder-codex.png',
    'box': (0, 0, 220, 220),
    'terms': [
      ('V+', 200, 70), ('V-', 200, 95), ('A', 200, 120), ('B', 200, 145), ('Z', 200, 170),
    ],
  },
  'MOTOR3P': {
    'img': 'assets/devices/codex/motor-3p-codex.png',
    'box': (0, 0, 260, 180),
    'terms': [('U', 96, 48), ('V', 130, 48), ('W', 164, 48), ('PE', 130, 88)],
  },
  'EXP2': {
    'img': 'assets/devices/codex/exp2-700-rear-codex.png',
    'box': (0, 0, 420, 300),
    'terms': [
      ('V+', 70, 228), ('V-', 100, 228), ('FG', 130, 228),
      ('T+', 220, 218), ('T-', 252.5, 218), ('RXD', 285, 218), ('TXD', 317.5, 218), ('SG', 350, 218),
      ('COM3-RDB', 90, 258), ('COM3-RDA', 137.5, 258), ('COM3-SDB', 185, 258),
      ('COM3-SDA', 232.5, 258), ('COM3-SG', 280, 258),
    ],
  },
}


def overlay(name, d, out_dir):
  path = d['img']
  if not os.path.exists(path):
    print(f'MISSING {name}: {path}')
    return
  im = Image.open(path).convert('RGBA')
  bx, by, bw, bh = d['box']
  iw, ih = im.size
  draw = ImageDraw.Draw(im)
  out_of = []
  for tid, x, y in d['terms']:
    fx = (x - bx) / bw
    fy = (y - by) / bh
    px = fx * iw
    py = fy * ih
    outside = px < -5 or py < -5 or px > iw + 5 or py > ih + 5
    if outside:
      out_of.append((tid, round(px, 1), round(py, 1)))
    color = (255, 0, 0, 255) if outside else (255, 40, 40, 255)
    r = max(5, min(iw, ih) * 0.012)
    draw.ellipse([px - r, py - r, px + r, py + r], outline=color, width=max(2, int(r / 3)))
    draw.line([px - r * 1.8, py, px + r * 1.8, py], fill=color, width=2)
    draw.line([px, py - r * 1.8, px, py + r * 1.8], fill=color, width=2)
    draw.text((px + r + 2, py - 8), tid, fill=color)
  draw.rectangle([0, 0, iw - 1, ih - 1], outline=(0, 200, 0, 180), width=2)
  out = os.path.join(out_dir, f'{name}_overlay.png')
  im.save(out)
  status = f'OUT={out_of}' if out_of else 'ok'
  print(f'{name}: {iw}x{ih} terms={len(d["terms"])} {status} -> {out}')


def main():
  root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
  os.chdir(root)
  out_dir = os.path.join('assets', 'devices', '_calib_check')
  os.makedirs(out_dir, exist_ok=True)
  for name, d in devices.items():
    overlay(name, d, out_dir)
  print('done ->', out_dir)


if __name__ == '__main__':
  main()
