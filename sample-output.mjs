#!/usr/bin/env node
/**
 * Generate the committed sample forecast output from the real model.
 *
 *   HUGGINGFACE_TOKEN=hf_... node benchmarks/sample-output.mjs
 *
 * Reads public/samples/timestral-sample.csv, asks the public Timestral Space
 * for a 12-step forecast, and saves the Space's full quantile CSV to
 * public/samples/timestral-sample-output.csv. The file is used by the API
 * reference page as a concrete output example.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from '@gradio/client';

const SPACE = 'mrfakename/timestral-209m';
const SPACE_URL = 'https://mrfakename-timestral-209m.hf.space';
const IN_SITE_REPO = existsSync(resolve('public/samples'));
const INPUT = IN_SITE_REPO
  ? resolve('public/samples/timestral-sample.csv')
  : resolve('samples/timestral-sample.csv');
const OUTPUT = IN_SITE_REPO
  ? resolve('public/samples/timestral-sample-output.csv')
  : resolve('samples/timestral-sample-output.csv');

const token = process.env.HUGGINGFACE_TOKEN;
if (!token) {
  console.error('HUGGINGFACE_TOKEN is required.');
  process.exit(1);
}

const csv = readFileSync(INPUT, 'utf8');
const client = await Client.connect(SPACE, { token });
const response = await client.predict('/forecast', [
  csv,
  12,
  '80% (0.1 to 0.9)',
  0,
  true,
  true,
]);

const data = response.data;
const table = data[1];
const file = data[2];
const took = data[3];

if (file?.url) {
  const url = new URL(file.url, SPACE_URL).toString();
  const result = await fetch(url);
  if (!result.ok) {
    throw new Error(`could not download the quantile CSV: ${result.status}`);
  }
  const text = await result.text();
  writeFileSync(OUTPUT, text);
  console.log(`wrote ${OUTPUT} from ${url}`);
  console.log(`bytes: ${text.length}; took: ${took || 'n/a'}`);
} else {
  // The Space returned only the preview table. Keep a real, useful fallback:
  // time,column,low,median,high from the same call.
  const headers = table?.headers || [];
  const timeIndex = headers.indexOf('time') >= 0 ? headers.indexOf('time') : headers.indexOf('step');
  const columnIndex = headers.indexOf('column');
  const rows = (table?.data || []).map((row) => [
    String(row[timeIndex >= 0 ? timeIndex : 0] ?? ''),
    String(row[columnIndex >= 0 ? columnIndex : 1] ?? 'series'),
    row[2],
    row[3],
    row[4],
  ]);
  const out = ['time,column,low,median,high', ...rows.map((row) => row.join(','))].join('\n');
  writeFileSync(OUTPUT, `${out}\n`);
  console.log(`wrote ${OUTPUT} from the preview table (no file URL); rows: ${rows.length}`);
}
