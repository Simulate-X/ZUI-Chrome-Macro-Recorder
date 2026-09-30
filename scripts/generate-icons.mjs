import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "extension", "icons");
await mkdir(out, { recursive: true });
function crc32(buffer) { let crc = 0xffffffff; for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const name = Buffer.from(type); const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data]))); return Buffer.concat([length, name, data, crc]); }
function icon(size) {
  const rows = []; const teal = [45, 212, 191, 255]; const navy = [7, 17, 31, 255]; const light = [231, 237, 245, 255];
  for (let y = 0; y < size; y += 1) { const row = Buffer.alloc(1 + size * 4); row[0] = 0; for (let x = 0; x < size; x += 1) { const i = 1 + x * 4; const pad = Math.max(1, Math.round(size * .1)); const inner = x >= pad && y >= pad && x < size - pad && y < size - pad; const slash = Math.abs((x + y) - (size - 1)) <= Math.max(1, size * .08); const top = y >= size * .27 && y <= size * .39 && x >= size * .25 && x <= size * .72; const bottom = y >= size * .61 && y <= size * .73 && x >= size * .28 && x <= size * .75; const color = !inner ? [0,0,0,0] : (slash || top || bottom ? light : (x > size * .5 ? teal : navy)); row.set(color, i); } rows.push(row); }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows), { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
for (const size of [16, 32, 48, 128]) await writeFile(path.join(out, `icon-${size}.png`), icon(size));
console.log(`Generated icons in ${out}`);
