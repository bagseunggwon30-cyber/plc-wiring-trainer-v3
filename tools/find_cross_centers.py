"""Find dark cross centers inside bright metallic screw heads."""
from PIL import Image, ImageDraw
import numpy as np
from scipy.ndimage import gaussian_filter, maximum_filter, label
import os


def find_screws(path, y0, y1, min_bright=140, max_area=2500, min_area=80):
  im = Image.open(path).convert('RGB')
  arr = np.array(im).astype(float)
  h, w = arr.shape[:2]
  gray = 0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]
  roi = gray[y0:y1, :]
  # bright metal mask
  bright = roi > min_bright
  # also require some darkness nearby (cross)
  dark = roi < 110
  # dilate dark a bit conceptually: points that are bright with dark nearby
  from scipy.ndimage import binary_dilation, binary_opening, binary_closing
  metal = binary_closing(bright, iterations=2)
  metal = binary_opening(metal, iterations=1)
  labeled, n = label(metal)
  centers = []
  for i in range(1, n + 1):
    ys, xs = np.where(labeled == i)
    area = len(xs)
    if area < min_area or area > max_area:
      continue
    # centroid weighted toward darkest pixel inside (cross center)
    vals = roi[ys, xs]
    # invert brightness as weight for darker center
    weights = (255 - vals) ** 2
    if weights.sum() <= 0:
      continue
    cx = float(np.average(xs, weights=weights))
    cy = float(np.average(ys, weights=weights)) + y0
    # roundish
    if xs.std() < 1 or ys.std() < 1:
      continue
    aspect = max(xs.std(), ys.std()) / min(xs.std(), ys.std())
    if aspect > 2.5:
      continue
    centers.append((cx, cy, area, float(vals.mean())))
  centers.sort(key=lambda c: (c[1], c[0]))
  return centers, (w, h)


def mark(path, centers, out):
  im = Image.open(path).convert('RGBA')
  d = ImageDraw.Draw(im)
  for i, (cx, cy, a, m) in enumerate(centers):
    r = 7
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 0, 255, 255), width=2)
    d.text((cx + 9, cy - 7), f'{i}:{int(cx)},{int(cy)}', fill=(255, 0, 255, 255))
  im.save(out)


def main():
  root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
  os.chdir(root)
  os.makedirs('assets/devices/_calib_check', exist_ok=True)

  cases = [
    ('TB4', 'assets/devices/codex/tb4-codex.png', [(12, 55, 120), (60, 110, 120)]),
    ('TB10', 'assets/devices/codex/tb10-codex.png', [(12, 55, 120), (60, 110, 120)]),
    ('MC_top', 'assets/devices/trimmed/mc-22b-trim.png', [(80, 200, 150)]),
    ('MC_bot', 'assets/devices/trimmed/mc-22b-trim.png', [(840, 980, 150)]),
    ('MC_right', 'assets/devices/trimmed/mc-22b-trim.png', [(120, 1000, 140)]),
    ('XBF', 'assets/devices/codex/xbf-ah04a-codex.png', [(20, 290, 100)]),
    ('MDR_top', 'assets/devices/trimmed/mdr-100-trim.png', [(40, 130, 130)]),
    ('MDR_bot', 'assets/devices/trimmed/mdr-100-trim.png', [(1060, 1160, 130)]),
  ]
  for name, path, bands in cases:
    allc = []
    for y0, y1, mb in bands:
      c, sz = find_screws(path, y0, y1, min_bright=mb)
      allc.extend(c)
    # NMS
    allc.sort(key=lambda c: -c[2])
    kept = []
    for c in allc:
      if any((c[0] - k[0]) ** 2 + (c[1] - k[1]) ** 2 < 16 ** 2 for k in kept):
        continue
      kept.append(c)
    kept.sort(key=lambda c: (c[1], c[0]))
    print(f'\n{name} {sz if bands else ""} n={len(kept)}')
    for c in kept:
      print(f'  {c[0]:.1f}, {c[1]:.1f} area={c[2]} mean={c[3]:.0f}')
    mark(path, kept, f'assets/devices/_calib_check/{name}_crosscent.png')


if __name__ == '__main__':
  main()
