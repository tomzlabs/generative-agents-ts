from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw


TILE = 16
COLS = 8
ROWS = 8
WIDTH = TILE * COLS
HEIGHT = TILE * ROWS

OUT_DIR = Path("public/static/assets/farm")
PNG_PATH = OUT_DIR / "farm-spritesheet.png"
META_PATH = OUT_DIR / "farm-spritesheet.json"


def p(img: Image.Image, x: int, y: int, color: tuple[int, int, int, int]) -> None:
    if 0 <= x < img.width and 0 <= y < img.height:
        img.putpixel((x, y), color)


def r(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int, color: tuple[int, int, int, int]) -> None:
    draw.rectangle((x, y, x + w - 1, y + h - 1), fill=color)


def tile_xy(index: int) -> tuple[int, int]:
    return (index % COLS) * TILE, (index // COLS) * TILE


def draw_grass_tile(img: Image.Image, draw: ImageDraw.ImageDraw, tx: int, ty: int, variant: int) -> None:
    c1 = (164, 238, 125, 255)
    c2 = (142, 225, 104, 255)
    c3 = (118, 204, 82, 255)
    for y in range(TILE):
        for x in range(TILE):
            p(img, tx + x, ty + y, c1 if (x + y + variant) % 3 else c2)
    for y in range(0, TILE, 4):
        for x in range((y + variant) % 3, TILE, 3):
            p(img, tx + x, ty + y, c3)
    r(draw, tx, ty, TILE, 1, (178, 246, 147, 255))
    r(draw, tx, ty + TILE - 1, TILE, 1, (108, 187, 77, 255))


def draw_path_tile(img: Image.Image, draw: ImageDraw.ImageDraw, tx: int, ty: int) -> None:
    c1 = (236, 218, 141, 255)
    c2 = (227, 204, 121, 255)
    c3 = (216, 188, 100, 255)
    r(draw, tx, ty, TILE, TILE, c1)
    for y in range(0, TILE, 3):
        for x in range((y // 3) % 2, TILE, 4):
            p(img, tx + x, ty + y, c2)
    for x, y in [(3, 4), (11, 5), (8, 10), (4, 13), (13, 12)]:
        p(img, tx + x, ty + y, c3)
    r(draw, tx, ty, TILE, 1, (243, 230, 168, 255))
    r(draw, tx, ty + TILE - 1, TILE, 1, (202, 171, 92, 255))


def draw_soil_tile(img: Image.Image, draw: ImageDraw.ImageDraw, tx: int, ty: int) -> None:
    base = (145, 95, 57, 255)
    line = (118, 73, 42, 255)
    high = (182, 129, 80, 255)
    r(draw, tx, ty, TILE, TILE, base)
    for y in (3, 7, 11):
        r(draw, tx, ty + y, TILE, 1, line)
    for x, y in [(2, 2), (6, 5), (10, 9), (13, 13), (4, 12)]:
        p(img, tx + x, ty + y, high)
    r(draw, tx, ty, TILE, 1, (201, 149, 99, 255))
    r(draw, tx, ty + TILE - 1, TILE, 1, (97, 59, 33, 255))


def draw_fence_h(draw: ImageDraw.ImageDraw, tx: int, ty: int) -> None:
    dark = (131, 95, 58, 255)
    light = (174, 133, 86, 255)
    r(draw, tx + 1, ty + 4, 14, 3, dark)
    r(draw, tx + 1, ty + 9, 14, 3, dark)
    r(draw, tx + 1, ty + 3, 14, 1, light)
    r(draw, tx + 1, ty + 8, 14, 1, light)
    r(draw, tx + 2, ty + 2, 2, 12, dark)
    r(draw, tx + 12, ty + 2, 2, 12, dark)
    r(draw, tx + 2, ty + 2, 1, 12, light)
    r(draw, tx + 12, ty + 2, 1, 12, light)


def draw_fence_v(draw: ImageDraw.ImageDraw, tx: int, ty: int) -> None:
    dark = (131, 95, 58, 255)
    light = (174, 133, 86, 255)
    r(draw, tx + 4, ty + 1, 3, 14, dark)
    r(draw, tx + 9, ty + 1, 3, 14, dark)
    r(draw, tx + 3, ty + 1, 1, 14, light)
    r(draw, tx + 8, ty + 1, 1, 14, light)
    r(draw, tx + 2, ty + 2, 12, 2, dark)
    r(draw, tx + 2, ty + 12, 12, 2, dark)
    r(draw, tx + 2, ty + 2, 12, 1, light)
    r(draw, tx + 2, ty + 12, 12, 1, light)


def draw_rock_small(draw: ImageDraw.ImageDraw, tx: int, ty: int) -> None:
    dark = (117, 133, 151, 255)
    mid = (161, 177, 196, 255)
    hi = (221, 231, 240, 255)
    r(draw, tx + 4, ty + 9, 8, 4, dark)
    r(draw, tx + 3, ty + 10, 10, 3, mid)
    r(draw, tx + 5, ty + 8, 6, 2, mid)
    r(draw, tx + 6, ty + 8, 3, 1, hi)


def draw_rock_big(draw: ImageDraw.ImageDraw, tx: int, ty: int) -> None:
    dark = (110, 125, 143, 255)
    mid = (153, 170, 190, 255)
    hi = (224, 233, 243, 255)
    r(draw, tx + 2, ty + 8, 12, 6, dark)
    r(draw, tx + 1, ty + 9, 14, 5, mid)
    r(draw, tx + 4, ty + 6, 8, 3, mid)
    r(draw, tx + 6, ty + 7, 4, 1, hi)
    r(draw, tx + 4, ty + 12, 8, 1, dark)


def draw_bush(draw: ImageDraw.ImageDraw, tx: int, ty: int) -> None:
    dark = (82, 145, 74, 255)
    mid = (107, 179, 93, 255)
    hi = (149, 219, 128, 255)
    r(draw, tx + 4, ty + 5, 8, 8, dark)
    r(draw, tx + 3, ty + 6, 10, 7, mid)
    r(draw, tx + 5, ty + 4, 6, 3, mid)
    r(draw, tx + 6, ty + 5, 3, 2, hi)
    r(draw, tx + 8, ty + 8, 2, 1, hi)


def draw_flower(draw: ImageDraw.ImageDraw, tx: int, ty: int, color: tuple[int, int, int, int]) -> None:
    stem = (89, 144, 72, 255)
    center = (255, 228, 127, 255)
    hi = (255, 196, 216, 255) if color[0] > 200 else (255, 247, 214, 255)
    r(draw, tx + 7, ty + 8, 2, 6, stem)
    r(draw, tx + 6, ty + 9, 1, 2, (110, 171, 89, 255))
    r(draw, tx + 9, ty + 9, 1, 2, (110, 171, 89, 255))
    r(draw, tx + 6, ty + 5, 2, 2, color)
    r(draw, tx + 8, ty + 5, 2, 2, color)
    r(draw, tx + 7, ty + 4, 2, 2, color)
    r(draw, tx + 7, ty + 6, 2, 2, color)
    r(draw, tx + 7, ty + 5, 2, 2, center)
    r(draw, tx + 7, ty + 4, 1, 1, hi)


def draw_tuft(draw: ImageDraw.ImageDraw, tx: int, ty: int) -> None:
    d = (86, 145, 71, 255)
    m = (110, 184, 91, 255)
    h = (147, 220, 124, 255)
    r(draw, tx + 7, ty + 7, 2, 8, d)
    r(draw, tx + 5, ty + 9, 2, 6, m)
    r(draw, tx + 9, ty + 9, 2, 6, m)
    r(draw, tx + 4, ty + 12, 2, 3, h)
    r(draw, tx + 10, ty + 12, 2, 3, h)
    r(draw, tx + 7, ty + 6, 2, 1, h)


def draw_seed(draw: ImageDraw.ImageDraw, tx: int, ty: int, kind: str) -> None:
    stem = (84, 140, 68, 255)
    if kind == "wheat":
        crop = (246, 213, 99, 255)
        hi = (255, 236, 161, 255)
    elif kind == "corn":
        crop = (247, 198, 72, 255)
        hi = (255, 231, 138, 255)
    else:
        crop = (243, 142, 70, 255)
        hi = (255, 185, 127, 255)

    r(draw, tx + 7, ty + 3, 2, 10, stem)
    if kind == "carrot":
        r(draw, tx + 6, ty + 2, 1, 2, (126, 193, 100, 255))
        r(draw, tx + 9, ty + 2, 1, 2, (126, 193, 100, 255))
        r(draw, tx + 6, ty + 8, 4, 5, crop)
        r(draw, tx + 7, ty + 13, 2, 1, (209, 102, 41, 255))
        r(draw, tx + 6, ty + 8, 1, 5, hi)
    elif kind == "corn":
        r(draw, tx + 6, ty + 4, 4, 7, crop)
        r(draw, tx + 5, ty + 5, 1, 5, (108, 171, 81, 255))
        r(draw, tx + 10, ty + 5, 1, 5, (108, 171, 81, 255))
        r(draw, tx + 6, ty + 4, 1, 7, hi)
    else:
        r(draw, tx + 5, ty + 4, 2, 2, crop)
        r(draw, tx + 9, ty + 5, 2, 2, crop)
        r(draw, tx + 5, ty + 8, 2, 2, crop)
        r(draw, tx + 9, ty + 9, 2, 2, crop)
        r(draw, tx + 5, ty + 12, 2, 2, crop)
        r(draw, tx + 9, ty + 13, 2, 2, crop)
        r(draw, tx + 5, ty + 4, 1, 2, hi)
        r(draw, tx + 9, ty + 5, 1, 2, hi)


def draw() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw_ctx = ImageDraw.Draw(img)
    meta: dict[str, dict[str, int]] = {}

    def put(name: str, idx: int, painter) -> None:
        tx, ty = tile_xy(idx)
        painter(tx, ty)
        meta[name] = {"x": tx, "y": ty, "w": TILE, "h": TILE}

    put("grass_a", 0, lambda x, y: draw_grass_tile(img, draw_ctx, x, y, 0))
    put("grass_b", 1, lambda x, y: draw_grass_tile(img, draw_ctx, x, y, 1))
    put("grass_c", 2, lambda x, y: draw_grass_tile(img, draw_ctx, x, y, 2))
    put("path", 3, lambda x, y: draw_path_tile(img, draw_ctx, x, y))
    put("soil", 4, lambda x, y: draw_soil_tile(img, draw_ctx, x, y))
    put("fence_h", 5, lambda x, y: draw_fence_h(draw_ctx, x, y))
    put("fence_v", 6, lambda x, y: draw_fence_v(draw_ctx, x, y))
    put("rock_small", 7, lambda x, y: draw_rock_small(draw_ctx, x, y))
    put("rock_big", 8, lambda x, y: draw_rock_big(draw_ctx, x, y))
    put("bush", 9, lambda x, y: draw_bush(draw_ctx, x, y))
    put("flower_red", 10, lambda x, y: draw_flower(draw_ctx, x, y, (216, 95, 134, 255)))
    put("flower_white", 11, lambda x, y: draw_flower(draw_ctx, x, y, (242, 244, 248, 255)))
    put("tuft", 12, lambda x, y: draw_tuft(draw_ctx, x, y))
    put("seed_wheat", 13, lambda x, y: draw_seed(draw_ctx, x, y, "wheat"))
    put("seed_corn", 14, lambda x, y: draw_seed(draw_ctx, x, y, "corn"))
    put("seed_carrot", 15, lambda x, y: draw_seed(draw_ctx, x, y, "carrot"))

    img.save(PNG_PATH)
    META_PATH.write_text(json.dumps({"tile": TILE, "sprites": meta}, indent=2), encoding="utf-8")


if __name__ == "__main__":
    draw()
