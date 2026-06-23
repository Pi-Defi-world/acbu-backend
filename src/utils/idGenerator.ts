import { randomBytes } from 'crypto';

/**
 * Generates a UUIDv7 (timestamp-ordered) string.
 * Timestamp-ordered UUIDs avoid B-tree index fragmentation in PostgreSQL
 * compared to random UUIDv4, improving insert performance and index locality.
 * A monotonic counter ensures strict ordering within the same millisecond.
 */

let lastMs = -1n;
let seq = 0;

export function generateId(): string {
  let ms = BigInt(Date.now());
  if (ms === lastMs) {
    seq = (seq + 1) & 0xfff;
    if (seq === 0) ms = ++lastMs; // counter overflow: advance clock
  } else {
    seq = 0;
    lastMs = ms;
  }

  const rand = randomBytes(8);
  const timeLow = Number(ms & BigInt(0xffffffff));
  const timeMid = Number((ms >> BigInt(32)) & BigInt(0xffff));
  const ver = 0x7000 | seq;                          // version 7 | 12-bit seq
  const varRand = 0x80 | (rand[0] & 0x3f);           // variant 10xx | random

  const hex = (n: number, pad: number) => n.toString(16).padStart(pad, '0');

  return [
    hex(timeLow, 8),
    hex(timeMid, 4),
    hex(ver, 4),
    hex(varRand, 2) + hex(rand[1], 2),
    rand.slice(2).reduce((s, b) => s + hex(b, 2), ''),
  ].join('-');
}
