import { mkdirSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = crc32(Buffer.concat([typeBuffer, data])) >>> 0;
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  typeBuffer.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc, 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6; // RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function insideCircle(x, y, cx, cy, radius) {
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function draw(size) {
  const scale = 4;
  const big = size * scale;
  const buffer = Buffer.alloc(big * big * 4);

  const radius = big * 0.22;
  const set = (x, y, r, g, b, a) => {
    const offset = (y * big + x) * 4;
    buffer[offset] = r;
    buffer[offset + 1] = g;
    buffer[offset + 2] = b;
    buffer[offset + 3] = a;
  };

  for (let y = 0; y < big; y += 1) {
    for (let x = 0; x < big; x += 1) {
      const dx = Math.min(x, big - 1 - x);
      const dy = Math.min(y, big - 1 - y);
      const inRound =
        dx >= radius || dy >= radius || (dx - radius) ** 2 + (dy - radius) ** 2 <= radius ** 2;

      if (inRound) {
        set(x, y, 79, 70, 229, 255);
      }

      const cloud =
        insideCircle(x, y, big * 0.37, big * 0.61, big * 0.18) ||
        insideCircle(x, y, big * 0.56, big * 0.49, big * 0.22) ||
        insideCircle(x, y, big * 0.74, big * 0.59, big * 0.16) ||
        (x >= big * 0.37 && x <= big * 0.74 && y >= big * 0.58 && y <= big * 0.71);

      if (cloud) {
        set(x, y, 255, 255, 255, 255);
      }
    }
  }

  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const offset = ((y * scale + sy) * big + (x * scale + sx)) * 4;
          r += buffer[offset];
          g += buffer[offset + 1];
          b += buffer[offset + 2];
          a += buffer[offset + 3];
        }
      }
      const count = scale * scale;
      const offset = (y * size + x) * 4;
      rgba[offset] = Math.round(r / count);
      rgba[offset + 1] = Math.round(g / count);
      rgba[offset + 2] = Math.round(b / count);
      rgba[offset + 3] = Math.round(a / count);
    }
  }

  return encodePng(size, size, rgba);
}

mkdirSync('resources', { recursive: true });
writeFileSync('resources/icon.png', draw(256));
writeFileSync('resources/tray.png', draw(32));
console.log('Generated resources/icon.png and resources/tray.png');
