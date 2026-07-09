"""Convert measured screw pixel centers to device-local terminal coordinates."""
from PIL import Image, ImageDraw
import os


def conv(px, py, iw, ih, box):
  bx, by, bw, bh = box
  return round(bx + px / iw * bw, 1), round(by + py / ih * bh, 1)


# Measured / detected screw centers in image pixel space
DATA = {
  'MC': {
    'img': 'assets/devices/trimmed/mc-22b-trim.png',
    'w': 260, 'h': 340,
    'box': (20, 10, 220, 320),
    'screws': [
      # main top (brightness + visual)
      ('1L1', 112, 140), ('3L2', 275, 140), ('5L3', 442, 140),
      # main bottom
      ('2T1', 112, 888), ('4T2', 275, 887), ('6T3', 442, 888),
      # coil
      ('A1', 580, 155), ('A2', 610, 955),
      # aux NO / NC on right block
      ('13', 600, 410), ('14', 600, 490),
      ('21', 600, 690), ('22', 600, 770),
    ],
    'meta': {
      '1L1': dict(side='T', label='R/L1', pol='AC-L'),
      '3L2': dict(side='T', label='S/L2', pol='AC-L'),
      '5L3': dict(side='T', label='T/L3', pol='AC-L'),
      '2T1': dict(side='B', label='U/T1', pol='AC-L'),
      '4T2': dict(side='B', label='V/T2', pol='AC-L'),
      '6T3': dict(side='B', label='W/T3', pol='AC-L'),
      'A1': dict(side='R', label='A1', pol='DC+', forceLabel=True),
      'A2': dict(side='R', label='A2', pol='DC-', forceLabel=True),
      '13': dict(side='R', label='13(NO)', pol='SW', forceLabel=True),
      '14': dict(side='R', label='14(NO)', pol='SW', forceLabel=True),
      '21': dict(side='R', label='21(NC)', pol='SW', forceLabel=True),
      '22': dict(side='R', label='22(NC)', pol='SW', forceLabel=True),
    },
  },
  'MDR': {
    'img': 'assets/devices/trimmed/mdr-100-trim.png',
    'w': 308, 'h': 385,
    'box': (80.5, 36.5, 146.9, 324.5),
    'screws': [
      ('V+1', 127, 82.5), ('V+2', 217.6, 82.6),
      ('V-1', 307.5, 82.5), ('V-2', 397.7, 82.4),
      ('PE', 162.2, 1100.6), ('N', 264.7, 1100.5), ('L', 364.6, 1100.6),
    ],
    'meta': {
      'V+1': dict(side='T', label='+V', pol='DC+'),
      'V+2': dict(side='T', label='+V', pol='DC+'),
      'V-1': dict(side='T', label='-V', pol='DC-'),
      'V-2': dict(side='T', label='-V', pol='DC-'),
      'PE': dict(side='B', label='FG', pol='PE'),
      'N': dict(side='B', label='N', pol='AC-N'),
      'L': dict(side='B', label='L', pol='AC-L'),
    },
  },
  'EOCR': {
    'img': 'assets/devices/trimmed/eocr-trim.png',
    'w': 280, 'h': 300,
    'box': (10, 5, 260, 290),
    'screws': [
      ('R-IN', 175, 100), ('S-IN', 505, 100), ('T-IN', 835, 100),
      ('R-OUT', 175, 230), ('S-OUT', 505, 230), ('T-OUT', 835, 230),
      ('A1', 113, 988), ('A2', 230, 988), ('95', 349, 987), ('96', 456, 991),
      ('97', 579, 988), ('98', 694, 988), ('07', 811, 987), ('08', 925, 988),
    ],
    'meta': {
      'R-IN': dict(side='T', label='L1 IN', pol='AC-L', forceLabel=True),
      'S-IN': dict(side='T', label='L2 IN', pol='AC-L', forceLabel=True),
      'T-IN': dict(side='T', label='L3 IN', pol='AC-L', forceLabel=True),
      'R-OUT': dict(side='T', label='L1 OUT', pol='AC-L', forceLabel=True),
      'S-OUT': dict(side='T', label='L2 OUT', pol='AC-L', forceLabel=True),
      'T-OUT': dict(side='T', label='L3 OUT', pol='AC-L', forceLabel=True),
      'A1': dict(side='B', label='A1(+)', pol='DC+'),
      'A2': dict(side='B', label='A2', pol='DC-'),
      '95': dict(side='B', label='95', pol='SW'),
      '96': dict(side='B', label='96', pol='SW'),
      '97': dict(side='B', label='97', pol='SW'),
      '98': dict(side='B', label='98', pol='SW'),
      '07': dict(side='B', label='07', pol='SW'),
      '08': dict(side='B', label='08', pol='SW'),
    },
  },
  'PB': {
    'img': 'assets/devices/codex/pushbutton-1c-codex.png',
    'w': 180, 'h': 240,
    'box': (10, 5, 160, 230),
    'screws': [
      ('11', 39, 30), ('12', 114, 29),
      ('21', 39, 242), ('22', 115, 241),
    ],
    'meta': {
      '11': dict(side='T', label='11(NO)', pol='SW', forceLabel=True),
      '12': dict(side='T', label='12(NO)', pol='SW', forceLabel=True),
      '21': dict(side='B', label='21(NC)', pol='SW', forceLabel=True),
      '22': dict(side='B', label='22(NC)', pol='SW', forceLabel=True),
    },
  },
  'SEL': {
    'img': 'assets/devices/codex/selector-2p-codex.png',
    'w': 180, 'h': 250,
    'box': (8, 5, 164, 240),
    'screws': [
      ('21', 39, 29), ('22', 116, 29),
      ('11', 40, 240), ('12', 115, 241),
    ],
    'meta': {
      '21': dict(side='T', label='21(NC COM)', pol='SW', forceLabel=True),
      '22': dict(side='T', label='22(NC)', pol='SW', forceLabel=True),
      '11': dict(side='B', label='11(NO COM)', pol='SW', forceLabel=True),
      '12': dict(side='B', label='12(NO)', pol='SW', forceLabel=True),
    },
  },
  'TB4': {
    'img': 'assets/devices/codex/tb4-codex.png',
    'w': 220, 'h': 100,
    'box': (0, 0, 220, 100),
    'screws': [
      ('1', 67, 35), ('2', 104, 35), ('3', 141, 35), ('4', 173, 35),
      ("1'", 67, 87), ("2'", 104, 87), ("3'", 141, 87), ("4'", 173, 87),
    ],
    'meta': {k: dict(side='T' if "'" not in k else 'B', label=k, pol='NEUTRAL')
             for k in ['1', '2', '3', '4', "1'", "2'", "3'", "4'"]},
  },
  'TB10': {
    'img': 'assets/devices/codex/tb10-codex.png',
    'w': 480, 'h': 100,
    'box': (0, 0, 480, 100),
    'screws': (
      [(str(i + 1), 67 + i * 36.5, 35) for i in range(10)]
      + [(f"{i + 1}'", 67 + i * 36.5, 87) for i in range(10)]
    ),
    'meta': None,
  },
  'TIMER': {
    'img': 'assets/devices/codex/timer-codex.png',
    'w': 160, 'h': 260,
    'box': (8, 5, 144, 250),
    'screws': [
      ('1', 25, 28), ('3', 53, 29), ('4', 82, 30), ('8', 111, 28),
      ('2', 26, 201), ('7', 54, 203), ('6', 82, 202), ('5', 112, 200),
    ],
    'meta': {
      '1': dict(side='T', label='1(C)', pol='SW'),
      '3': dict(side='T', label='3(NO)', pol='SW'),
      '4': dict(side='T', label='4(NC)', pol='SW'),
      '8': dict(side='T', label='8(C)', pol='SW'),
      '2': dict(side='B', label='2(+)', pol='DC+'),
      '7': dict(side='B', label='7(-)', pol='DC-'),
      '6': dict(side='B', label='6(NO)', pol='SW'),
      '5': dict(side='B', label='5(NC)', pol='SW'),
    },
  },
  'XBF': {
    'img': 'assets/devices/codex/xbf-ah04a-codex.png',
    'w': 140, 'h': 420,
    'box': (0, 0, 140, 420),
    'screws': [
      (id_, 66, 40 + i * 24.5)
      for i, id_ in enumerate(
        ['NC', '+24V', '0V', 'I0+', 'I0-', 'I1+', 'I1-', 'O0+', 'O0-', 'O1+', 'O1-']
      )
    ],
    'meta': {
      'NC': dict(side='L', label='NC', pol='NEUTRAL', labelDx=14),
      '+24V': dict(side='L', label='+24V', pol='DC+', labelDx=14),
      '0V': dict(side='L', label='0V', pol='DC-', labelDx=14),
      'I0+': dict(side='L', label='CH0+ IN', pol='AI', labelDx=14),
      'I0-': dict(side='L', label='CH0- IN', pol='COM', labelDx=14),
      'I1+': dict(side='L', label='CH1+ IN', pol='AI', labelDx=14),
      'I1-': dict(side='L', label='CH1- IN', pol='COM', labelDx=14),
      'O0+': dict(side='L', label='CH0+ OUT', pol='AO', labelDx=14),
      'O0-': dict(side='L', label='CH0- OUT', pol='COM', labelDx=14),
      'O1+': dict(side='L', label='CH1+ OUT', pol='AO', labelDx=14),
      'O1-': dict(side='L', label='CH1- OUT', pol='COM', labelDx=14),
    },
  },
  'LAMP': {
    'img': 'assets/devices/codex/lamp-green-codex-clean.png',
    'w': 170, 'h': 220,
    'box': (0, 0, 170, 220),
    'screws': [('+', 52, 190), ('-', 118, 194)],
    'meta': {
      '+': dict(side='B', label='+', pol='DC+'),
      '-': dict(side='B', label='-', pol='DC-'),
    },
  },
  'FUSE': {
    'img': 'assets/devices/codex/fuse-holder-2p-codex.png',
    'w': 170, 'h': 300,
    'box': (0, 0, 170, 300),
    'screws': [
      ('L-IN', 45, 48), ('N-IN', 115, 48),
      ('L-OUT', 53, 288), ('N-OUT', 119, 290),
    ],
    'meta': {
      'L-IN': dict(side='T', label='L IN', pol='AC-L'),
      'N-IN': dict(side='T', label='N IN', pol='AC-N'),
      'L-OUT': dict(side='B', label='L OUT', pol='AC-L'),
      'N-OUT': dict(side='B', label='N OUT', pol='AC-N'),
    },
  },
  'PSU': {
    'img': 'assets/devices/codex/psu24-clean.png',
    'w': 160, 'h': 420,
    'box': (10, 8, 140, 404),
    'screws': [
      ('V+', 20, 14), ('V-', 58, 14),
      ('L', 18, 215), ('N', 40, 215), ('PE', 62, 215),
    ],
    'meta': {
      'V+': dict(side='T', label='+24V', pol='DC+'),
      'V-': dict(side='T', label='0V', pol='DC-'),
      'L': dict(side='B', label='AC L', pol='AC-L'),
      'N': dict(side='B', label='AC N', pol='AC-N'),
      'PE': dict(side='B', label='PE', pol='PE'),
    },
  },
}


def main():
  root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
  os.chdir(root)
  out_dir = 'assets/devices/_calib_check'
  os.makedirs(out_dir, exist_ok=True)

  for name, d in DATA.items():
    im = Image.open(d['img'])
    iw, ih = im.size
    box = d['box']
    print(f'\n// === {name} ({iw}x{ih}) box={box} ===')
    terms = []
    for item in d['screws']:
      tid, px, py = item[0], item[1], item[2]
      x, y = conv(px, py, iw, ih, box)
      meta = (d.get('meta') or {}).get(tid, {})
      side = meta.get('side', 'R')
      label = meta.get('label', tid)
      pol = meta.get('pol', 'NEUTRAL')
      extra = ''
      if meta.get('forceLabel'):
        extra += ',forceLabel:true'
      if meta.get('labelDx') is not None:
        extra += f",labelDx:{meta['labelDx']}"
      line = f"{{id:'{tid}',x:{x},y:{y},side:'{side}',label:'{label}',pol:'{pol}'{extra}}}"
      print(f'  {line},')
      terms.append((tid, x, y, px, py))

    # green overlay verification
    im2 = im.convert('RGBA')
    draw = ImageDraw.Draw(im2)
    for tid, x, y, px, py in terms:
      r = max(5, min(iw, ih) * 0.012)
      draw.ellipse([px - r, py - r, px + r, py + r], outline=(0, 255, 0, 255), width=2)
      draw.line([px - r * 1.6, py, px + r * 1.6, py], fill=(0, 255, 0, 255), width=2)
      draw.line([px, py - r * 1.6, px, py + r * 1.6], fill=(0, 255, 0, 255), width=2)
      draw.text((px + r + 2, py - 8), tid, fill=(0, 200, 0, 255))
    im2.save(os.path.join(out_dir, f'{name}_fixed.png'))
    print(f'// saved {name}_fixed.png')


if __name__ == '__main__':
  main()
