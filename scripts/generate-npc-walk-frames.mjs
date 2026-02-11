import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const OUT_DIR = path.resolve('public/static/assets/npc');
const W = 24;
const H = 24;

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = makeCrcTable();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type 0
    rgba.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function fillRect(buf, x, y, w, h, color) {
  const [r, g, b, a] = color;
  for (let yy = y; yy < y + h; yy += 1) {
    if (yy < 0 || yy >= H) continue;
    for (let xx = x; xx < x + w; xx += 1) {
      if (xx < 0 || xx >= W) continue;
      const i = (yy * W + xx) * 4;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = a;
    }
  }
}

function drawNpcFrame(theme, frame) {
  const buf = Buffer.alloc(W * H * 4, 0);

  const skin = theme.skin;
  const hair = theme.hair;
  const shirt = theme.shirt;
  const shirtLight = theme.shirtLight;
  const pants = theme.pants;
  const boots = theme.boots;

  // shadow
  fillRect(buf, 8, 21, 8, 2, [28, 36, 28, 120]);

  // head + hair
  fillRect(buf, 8, 4, 8, 6, skin);
  fillRect(buf, 8, 3, 8, 2, hair);
  fillRect(buf, 7, 4, 1, 4, hair);
  fillRect(buf, 16, 4, 1, 4, hair);

  // eyes
  fillRect(buf, 10, 6, 1, 1, [34, 34, 34, 255]);
  fillRect(buf, 13, 6, 1, 1, [34, 34, 34, 255]);

  // neck
  fillRect(buf, 10, 10, 4, 1, skin);

  // torso
  fillRect(buf, 8, 11, 8, 7, shirt);
  fillRect(buf, 9, 12, 2, 4, shirtLight);
  fillRect(buf, 13, 12, 2, 4, shirtLight);

  // arm swing
  const armOffset = frame === 0 ? -1 : frame === 2 ? 1 : 0;
  fillRect(buf, 6 + armOffset, 12, 2, 5, shirt);
  fillRect(buf, 16 + armOffset, 12, 2, 5, shirt);
  fillRect(buf, 6 + armOffset, 16, 2, 1, skin);
  fillRect(buf, 16 + armOffset, 16, 2, 1, skin);

  // legs swing
  const leftLegDx = frame === 0 ? -1 : frame === 2 ? 1 : 0;
  const rightLegDx = frame === 0 ? 1 : frame === 2 ? -1 : 0;
  const legY = frame === 1 || frame === 3 ? 18 : 17;

  fillRect(buf, 9 + leftLegDx, legY, 3, 4, pants);
  fillRect(buf, 12 + rightLegDx, legY, 3, 4, pants);
  fillRect(buf, 9 + leftLegDx, legY + 3, 3, 1, boots);
  fillRect(buf, 12 + rightLegDx, legY + 3, 3, 1, boots);

  // outline accents
  fillRect(buf, 8, 11, 8, 1, [52, 72, 52, 170]);
  fillRect(buf, 8, 17, 8, 1, [52, 72, 52, 170]);

  return buf;
}

const THEMES = {
  cz: {
    skin: [244, 211, 176, 255],
    hair: [89, 64, 44, 255],
    shirt: [79, 155, 85, 255],
    shirtLight: [111, 196, 118, 255],
    pants: [53, 95, 157, 255],
    boots: [45, 49, 56, 255],
  },
  heyi: {
    skin: [246, 206, 172, 255],
    hair: [58, 54, 70, 255],
    shirt: [95, 124, 193, 255],
    shirtLight: [135, 164, 229, 255],
    pants: [117, 75, 47, 255],
    boots: [45, 49, 56, 255],
  },
};

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const [name, theme] of Object.entries(THEMES)) {
  for (let frame = 0; frame < 4; frame += 1) {
    const rgba = drawNpcFrame(theme, frame);
    const png = encodePng(W, H, rgba);
    const outPath = path.join(OUT_DIR, `${name}_walk_${frame}.png`);
    fs.writeFileSync(outPath, png);
    console.log('wrote', outPath);
  }
}
