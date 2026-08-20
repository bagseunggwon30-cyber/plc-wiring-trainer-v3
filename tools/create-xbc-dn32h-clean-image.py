"""Create the DN32H front drawing without runtime SVG correction boxes.

The source is the user's PPT raster.  Only model-dependent printed legends are
changed; the enclosure, open covers, screws and terminal geometry stay byte-for-
byte derived from that source image.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "devices" / "manual" / "xbc-dn32h-ppt-open-front.png"
OUTPUT = ROOT / "assets" / "devices" / "manual" / "xbc-dn32h-ppt-open-front-clean.png"


def font(size: int, *, bold: bool = False) -> ImageFont.FreeTypeFont:
    windows_font = Path("C:/Windows/Fonts") / ("arialbd.ttf" if bold else "arial.ttf")
    if windows_font.exists():
        return ImageFont.truetype(str(windows_font), size=size)
    return ImageFont.truetype("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf", size=size)


def patch(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], fill: str = "#ffffff") -> None:
    draw.rectangle(box, fill=fill)


def centered(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, *, size: int = 18) -> None:
    draw.text(xy, text, font=font(size), fill="#161616", anchor="mm")


def main() -> None:
    image = Image.open(SOURCE).convert("RGB")
    draw = ImageDraw.Draw(image)

    # Change only the model legend.  The surrounding panel is flat white in the
    # source, so this small patch does not cover any enclosure line work.
    patch(draw, (340, 334, 492, 365), "#ffffff")
    draw.text((344, 337), "XBC-DN32H", font=font(24, bold=True), fill="#747474")

    # Input row corrections: TB6=P00, TB22=COM and TB24=24V.
    patch(draw, (357, 210, 403, 236))
    centered(draw, (380, 224), "P00", size=17)
    patch(draw, (826, 210, 1070, 236))
    draw.line((826, 210, 1070, 210), fill="#222222", width=2)
    draw.line((826, 236, 1070, 236), fill="#222222", width=2)
    draw.line((920, 210, 920, 236), fill="#222222", width=2)
    centered(draw, (860, 224), "COM", size=16)
    centered(draw, (930, 224), "24V", size=16)

    # DN32H has an external transistor-output supply at TB4.  The remaining
    # P20..P2F/COM legends already match the PPT drawing and are left untouched.
    patch(draw, (313, 584, 367, 611))
    centered(draw, (341, 598), "P", size=18)

    # Replace the relay rating with the DN32H NPN sinking-output rating while
    # keeping the original bordered rating strip.
    patch(draw, (763, 529, 1090, 558))
    draw.text(
        (770, 536),
        "NPN SINK OUT : 24 V d.c. 0.5 A/P, 2 A/C",
        font=font(15, bold=True),
        fill="#202020",
    )

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    image.save(OUTPUT, format="PNG", optimize=False)


if __name__ == "__main__":
    main()
