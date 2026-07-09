from PIL import Image, ImageDraw
import os


def conv(px, py, iw, ih, box):
  bx, by, bw, bh = box
  return round(bx + px / iw * bw, 1), round(by + py / ih * bh, 1)


fixes = {
  'MC': {
    'img': 'assets/devices/trimmed/mc-22b-trim.png',
    'box': (20, 10, 220, 320),
    'screws': [
      ('1L1', 112, 140), ('3L2', 275, 140), ('5L3', 442, 140),
      ('2T1', 112, 888), ('4T2', 275, 887), ('6T3', 442, 888),
      ('A1', 605, 145),
      ('13', 605, 395), ('14', 605, 470),
      ('21', 605, 720), ('22', 595, 890),
      ('A2', 620, 945),
    ],
  },
  'TB4': {
    'img': 'assets/devices/codex/tb4-codex.png',
    'box': (0, 0, 220, 100),
    'screws': [
      ('1', 78, 36), ('2', 112, 36), ('3', 146, 36), ('4', 180, 36),
      ("1'", 78, 88), ("2'", 112, 88), ("3'", 146, 88), ("4'", 180, 88),
    ],
  },
  'TB10': {
    'img': 'assets/devices/codex/tb10-codex.png',
    'box': (0, 0, 480, 100),
    'screws': (
      [(str(i + 1), 78 + i * 36.0, 36) for i in range(10)]
      + [(f"{i + 1}'", 78 + i * 36.0, 88) for i in range(10)]
    ),
  },
  'XBF': {
    'img': 'assets/devices/codex/xbf-ah04a-codex.png',
    'box': (0, 0, 140, 420),
    'screws': [
      (id_, 82, 42 + i * 24.0)
      for i, id_ in enumerate(
        ['NC', '+24V', '0V', 'I0+', 'I0-', 'I1+', 'I1-', 'O0+', 'O0-', 'O1+', 'O1-']
      )
    ],
  },
}


def main():
  root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
  os.chdir(root)
  os.makedirs('assets/devices/_calib_check', exist_ok=True)
  for name, d in fixes.items():
    im = Image.open(d['img'])
    iw, ih = im.size
    box = d['box']
    print(name, iw, ih)
    im2 = im.convert('RGBA')
    draw = ImageDraw.Draw(im2)
    for item in d['screws']:
      tid, px, py = item[0], item[1], item[2]
      x, y = conv(px, py, iw, ih, box)
      print(f"  {{id:'{tid}',x:{x},y:{y}}},")
      r = max(5, min(iw, ih) * 0.012)
      draw.ellipse([px - r, py - r, px + r, py + r], outline=(0, 255, 255, 255), width=2)
      draw.line([px - r * 1.5, py, px + r * 1.5, py], fill=(0, 255, 255, 255), width=2)
      draw.line([px, py - r * 1.5, px, py + r * 1.5], fill=(0, 255, 255, 255), width=2)
      draw.text((px + r + 2, py - 8), tid, fill=(0, 220, 220, 255))
    im2.save(f'assets/devices/_calib_check/{name}_v3.png')


if __name__ == '__main__':
  main()
