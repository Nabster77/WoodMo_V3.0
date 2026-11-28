/**
 * Kleiner QR-Code-Erzeuger (Byte-Modus, Fehlerkorrektur M, Version 1–10), ohne Fremdpaket und ohne Internet.
 * Nach dem Verfahren der QR-Norm (ISO/IEC 18004), angelehnt an Project Nayuki „QR Code generator“ (MIT).
 * Liefert eine quadratische Matrix (true = dunkles Modul).
 */

// Fehlerkorrektur M: Codewörter je Block und Blockanzahl je Version (Index = Version).
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const NUM_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const ECL_FORMAT_BITS = 0; // M

function numRawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}
const numDataCodewords = (ver: number) => Math.floor(numRawDataModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];

function reedSolomonDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = multiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = multiply(root, 0x02);
  }
  return result;
}
function reedSolomonRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= multiply(coef, factor); });
  }
  return result;
}
function multiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11D);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const step = (ver === 32) ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = ver * 4 + 10; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

export function makeQr(text: string): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text));
  let ver = 1;
  for (; ver <= 10; ver++) {
    const capacityBits = numDataCodewords(ver) * 8;
    const used = 4 + (ver <= 9 ? 8 : 16) + bytes.length * 8;
    if (used <= capacityBits) break;
  }
  if (ver > 10) throw new Error('Text zu lang für QR-Code.');

  // Bitstrom: Modus Byte (0100), Länge, Daten, Abschluss, Füllbytes.
  const bits: number[] = [];
  const append = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  append(4, 4);
  append(bytes.length, ver <= 9 ? 8 : 16);
  bytes.forEach((b) => append(b, 8));
  const capacity = numDataCodewords(ver) * 8;
  append(0, Math.min(4, capacity - bits.length));
  append(0, (8 - bits.length % 8) % 8);
  for (let pad = 0xEC; bits.length < capacity; pad ^= 0xEC ^ 0x11) append(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // Fehlerkorrektur je Block, dann verschränken.
  const numBlocks = NUM_BLOCKS[ver];
  const blockEccLen = ECC_PER_BLOCK[ver];
  const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - rawCodewords % numBlocks;
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const divisor = reedSolomonDivisor(blockEccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = reedSolomonRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const codewords: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) codewords.push(block[i]);
    });
  }

  const size = ver * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const isFunction = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const setFn = (x: number, y: number, dark: boolean) => { modules[y][x] = dark; isFunction[y][x] = true; };

  // Funktionsmuster
  for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
  const finder = (x: number, y: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFn(xx, yy, dist !== 2 && dist !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const align = alignmentPositions(ver);
  align.forEach((ax, i) => align.forEach((ay, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const drawFormat = (mask: number) => {
    const fdata = (ECL_FORMAT_BITS << 3) | mask;
    let rem = fdata;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const fbits = ((fdata << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((fbits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(i));
    setFn(8, 7, bit(6)); setFn(8, 8, bit(7)); setFn(7, 8, bit(8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(i));
    setFn(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    const vbits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((vbits >>> i) & 1) !== 0;
      const a = size - 11 + i % 3, b = Math.floor(i / 3);
      setFn(a, b, dark); setFn(b, a, dark);
    }
  }

  // Daten im Zickzack einsetzen
  let idx = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && idx < codewords.length * 8) {
          modules[y][x] = ((codewords[idx >>> 3] >>> (7 - (idx & 7))) & 1) !== 0;
          idx++;
        }
      }
    }
  }

  // Maske 0 ((x + y) % 2) – fest; für kurze Links zuverlässig lesbar.
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (!isFunction[y][x] && (x + y) % 2 === 0) modules[y][x] = !modules[y][x];
  }
  drawFormat(0);
  return modules;
}

/** QR-Code als SVG-Pfad (inkl. 4 Module Ruhezone). */
export function qrSvgPath(text: string): { size: number; path: string } {
  const m = makeQr(text);
  const quiet = 4;
  let path = '';
  m.forEach((row, y) => row.forEach((dark, x) => { if (dark) path += `M${x + quiet},${y + quiet}h1v1h-1z`; }));
  return { size: m.length + quiet * 2, path };
}
