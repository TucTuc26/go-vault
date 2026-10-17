/** Genera public/icon-192.png e icon-512.png (pokébola estilizada) sin dependencias. */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

function crc32(buf: Buffer): number {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size: number): Buffer {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const c = size / 2, R = size * 0.3;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      let col = [11, 16, 32];
      if (d <= R) {
        col = y < c - size * 0.027 ? [229, 72, 77] : y > c + size * 0.027 ? [244, 244, 245] : [11, 16, 32];
        if (d <= R * 0.31) col = [11, 16, 32];
        if (d <= R * 0.17) col = [244, 244, 245];
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = col[0]; raw[o + 1] = col[1]; raw[o + 2] = col[2]; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const s of [192, 512]) writeFileSync(`public/icon-${s}.png`, png(s));
console.log('iconos listos');
