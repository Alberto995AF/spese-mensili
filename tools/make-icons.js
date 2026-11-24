// Disegna le icone dell'app (PNG) senza dipendenze esterne.
// Uso:  node tools/make-icons.js
const fs = require('fs'), path = require('path'), zlib = require('zlib');

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const hex = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// in coordinate 0..1: sfondo blu, tre barre che crescono e una moneta
function sample(x, y, rounded) {
  if (rounded) { const r = 0.22, cx = Math.min(Math.max(x, r), 1 - r), cy = Math.min(Math.max(y, r), 1 - r); if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return null }
  let c = mix(hex('#3b6fe0'), hex('#1c3f99'), (x + y) / 2);
  const bars = [[0.22, 0.58], [0.42, 0.46], [0.62, 0.32]];
  for (const [bx, top] of bars) if (x >= bx && x <= bx + 0.15 && y >= top && y <= 0.8) c = hex('#ffffff');
  const d = Math.hypot(x - 0.3, y - 0.3);
  if (d <= 0.11) c = d >= 0.085 ? hex('#d99a00') : hex('#f6b90f');
  return c;
}
function draw(size, rounded) {
  const SS = 4, buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const c = sample((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, rounded);
      if (c) { r += c[0]; g += c[1]; b += c[2]; a++ }
    }
    const o = (py * size + px) * 4;
    if (a) { buf[o] = r / a; buf[o + 1] = g / a; buf[o + 2] = b / a; buf[o + 3] = 255 * a / (SS * SS) }
  }
  return png(size, size, buf);
}
const out = path.join(__dirname, '..', 'icons');
fs.mkdirSync(out, { recursive: true });
// iPhone arrotonda da solo gli angoli: per lui e per "maskable" serve il quadrato pieno
for (const [name, size, rounded] of [['icon-180.png', 180, false], ['icon-192.png', 192, true], ['icon-512.png', 512, true], ['icon-maskable-512.png', 512, false], ['favicon-32.png', 32, true]])
  fs.writeFileSync(path.join(out, name), draw(size, rounded));
console.log('icone create in', out);
