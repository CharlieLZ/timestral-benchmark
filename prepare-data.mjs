#!/usr/bin/env node
/**
 * Build the committed benchmark subset from the public M4 monthly dataset.
 *
 *   node benchmarks/prepare-data.mjs /path/to/Monthly-train.csv
 *
 * The M4 monthly file has one row per series: `M1,v1,v2,...`. We keep eight
 * series that have at least 120 consecutive non-missing monthly values and
 * write the last 120 of each as a long CSV. Dates are relative month indices
 * (2000-01-01 + i months) because M4 does not ship calendar dates; the model
 * only needs a regular monthly index.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const input = process.argv[2];
if (!input) {
  console.error('usage: node benchmarks/prepare-data.mjs <Monthly-train.csv>');
  process.exit(1);
}

const WINDOW = 120;
const WANTED = 8;

function monthLabel(index) {
  const year = 2000 + Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

const lines = readFileSync(input, 'utf8').split(/\r?\n/).filter(Boolean);
const rows = [];
const clean = (cell) => cell.replace(/^"|"$/g, '').trim();
for (const line of lines.slice(1)) {
  const cells = line.split(',');
  const id = clean(cells[0] ?? '');
  const values = cells.slice(1).map(clean);
  const numeric = values.map((cell) => (cell === '' ? NaN : Number(cell)));
  if (!id || numeric.some((value) => !Number.isFinite(value))) continue;
  if (numeric.length < WINDOW) continue;
  rows.push({ id, values: numeric.slice(-WINDOW) });
  if (rows.length >= WANTED) break;
}

if (rows.length < WANTED) {
  console.error(`only ${rows.length} eligible series found; need ${WANTED}`);
  process.exit(1);
}

const out = existsSync(resolve('benchmarks'))
  ? resolve('benchmarks/data/m4-monthly-subset.csv')
  : resolve('data/m4-monthly-subset.csv');
mkdirSync(dirname(out), { recursive: true });
const linesOut = ['series_id,date,value'];
for (const row of rows) {
  row.values.forEach((value, index) => {
    linesOut.push(`${row.id},${monthLabel(index)},${value}`);
  });
}
writeFileSync(out, `${linesOut.join('\n')}\n`);
console.log(`wrote ${out}`);
console.log(`series: ${rows.map((row) => row.id).join(', ')}`);
