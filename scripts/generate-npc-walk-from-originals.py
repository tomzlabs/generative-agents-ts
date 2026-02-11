from PIL import Image, ImageDraw
from pathlib import Path
from collections import deque

ROOT = Path('/Users/tommy/clawd/generative-agents-ts')
ASSET_DIR = ROOT / 'public' / 'static' / 'assets' / 'npc'

SOURCES = {
    'cz': ASSET_DIR / 'cz_sprite.png',
    'heyi': ASSET_DIR / 'heyi_sprite11.png',
}

CANVAS = (32, 32)
TARGET_H = 30

# subtle walk bob only, preserve full body silhouette
OFFSETS = [
    (0, 0),
    (1, -1),
    (0, 0),
    (-1, -1),
]


def is_bg_pixel(r: int, g: int, b: int) -> bool:
    # near-white background only
    if r < 220 or g < 220 or b < 220:
        return False
    return (max(r, g, b) - min(r, g, b)) <= 24


def remove_border_background(img: Image.Image) -> Image.Image:
    rgb = img.convert('RGB')
    w, h = rgb.size
    px = rgb.load()

    bg = [[False for _ in range(w)] for _ in range(h)]
    q = deque()

    def push_if_bg(x: int, y: int):
        if x < 0 or y < 0 or x >= w or y >= h:
            return
        if bg[y][x]:
            return
        r, g, b = px[x, y]
        if not is_bg_pixel(r, g, b):
            return
        bg[y][x] = True
        q.append((x, y))

    # seed from borders only, so inner whites on character are preserved
    for x in range(w):
        push_if_bg(x, 0)
        push_if_bg(x, h - 1)
    for y in range(h):
        push_if_bg(0, y)
        push_if_bg(w - 1, y)

    while q:
        x, y = q.popleft()
        push_if_bg(x + 1, y)
        push_if_bg(x - 1, y)
        push_if_bg(x, y + 1)
        push_if_bg(x, y - 1)

    rgba = rgb.convert('RGBA')
    out = rgba.load()
    for y in range(h):
        for x in range(w):
            r, g, b, _ = out[x, y]
            if bg[y][x]:
                out[x, y] = (r, g, b, 0)
            else:
                out[x, y] = (r, g, b, 255)

    return rgba


def crop_alpha(img: Image.Image, pad: int = 2) -> Image.Image:
    alpha = img.getchannel('A')
    bbox = alpha.getbbox()
    if not bbox:
        return img
    l, t, r, b = bbox
    l = max(0, l - pad)
    t = max(0, t - pad)
    r = min(img.width, r + pad)
    b = min(img.height, b + pad)
    return img.crop((l, t, r, b))


def prep_sprite(src_path: Path) -> Image.Image:
    src = Image.open(src_path)
    no_bg = remove_border_background(src)
    cropped = crop_alpha(no_bg, 2)
    tw = max(1, int(cropped.width * (TARGET_H / cropped.height)))
    resized = cropped.resize((tw, TARGET_H), Image.Resampling.LANCZOS)
    return resized


def compose_walk_frames(name: str, sprite: Image.Image):
    sw, sh = sprite.size
    base_x = (CANVAS[0] - sw) // 2
    base_y = CANVAS[1] - sh

    for i, (dx, dy) in enumerate(OFFSETS):
        frame = Image.new('RGBA', CANVAS, (0, 0, 0, 0))

        # soft shadow
        shadow = Image.new('RGBA', CANVAS, (0, 0, 0, 0))
        d = ImageDraw.Draw(shadow)
        d.ellipse((10 + dx, 27, 22 + dx, 31), fill=(30, 42, 30, 105))
        frame.alpha_composite(shadow)

        frame.alpha_composite(sprite, (base_x + dx, base_y + dy))

        out = ASSET_DIR / f'{name}_walk_{i}.png'
        frame.save(out, format='PNG')
        print('wrote', out)


def main():
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    for name, path in SOURCES.items():
        if not path.exists():
            print('missing source', path)
            continue
        sprite = prep_sprite(path)
        compose_walk_frames(name, sprite)


if __name__ == '__main__':
    main()
