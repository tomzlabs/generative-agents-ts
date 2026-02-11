from PIL import Image, ImageDraw
from pathlib import Path

ROOT = Path('/Users/tommy/clawd/generative-agents-ts')
ASSET_DIR = ROOT / 'public' / 'static' / 'assets' / 'npc'

SOURCES = {
    'cz': ASSET_DIR / 'cz_sprite.png',
    'heyi': ASSET_DIR / 'heyi_sprite11.png',
}

CANVAS = (32, 32)
TARGET_H = 30
PADDING = 2

# 4-frame walk cycle params
BOB = [0, -1, 0, -1]
LEFT_DX = [-1, 0, 1, 0]
RIGHT_DX = [1, 0, -1, 0]


def white_to_alpha(img: Image.Image) -> Image.Image:
    rgba = img.convert('RGBA')
    px = rgba.load()
    w, h = rgba.size
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            # preserve character highlights while removing white backdrop
            if r > 250 and g > 250 and b > 250:
                a = 0
            elif r > 238 and g > 238 and b > 238:
                # soft edge for anti-aliased borders
                a = max(0, min(255, int((250 - ((r + g + b) / 3)) * 28)))
            else:
                a = 255
            px[x, y] = (r, g, b, a)
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
    rgba = white_to_alpha(src)
    cropped = crop_alpha(rgba, PADDING)
    # keep proportions, scale by target height
    tw = max(1, int(cropped.width * (TARGET_H / cropped.height)))
    resized = cropped.resize((tw, TARGET_H), Image.Resampling.LANCZOS)
    return resized


def compose_walk_frames(name: str, sprite: Image.Image):
    sw, sh = sprite.size
    split_y = int(sh * 0.62)

    upper = sprite.crop((0, 0, sw, split_y))
    lower = sprite.crop((0, split_y, sw, sh))
    half = sw // 2
    lower_l = lower.crop((0, 0, half, lower.height))
    lower_r = lower.crop((half, 0, sw, lower.height))

    base_x = (CANVAS[0] - sw) // 2
    base_y = CANVAS[1] - sh

    for i in range(4):
        frame = Image.new('RGBA', CANVAS, (0, 0, 0, 0))

        # subtle ground shadow
        shadow = Image.new('RGBA', CANVAS, (0, 0, 0, 0))
        d = ImageDraw.Draw(shadow)
        d.ellipse((10, 27, 22, 31), fill=(32, 44, 32, 110))
        frame.alpha_composite(shadow)

        bob = BOB[i]
        frame.alpha_composite(upper, (base_x, base_y + bob))

        # leg swing from split lower half
        lx = base_x + LEFT_DX[i]
        rx = base_x + half + RIGHT_DX[i]
        ly = base_y + split_y + bob
        frame.alpha_composite(lower_l, (lx, ly))
        frame.alpha_composite(lower_r, (rx, ly))

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
