#!/usr/bin/env node
/**
 * Reproducible Timestral benchmark.
 *
 *   HUGGINGFACE_TOKEN=hf_... node benchmarks/run.mjs
 *
 * For each series in benchmarks/data/m4-monthly-subset.csv:
 *   - hold out the last 12 monthly points
 *   - send the first 108 points to the public Timestral Space
 *   - score the 12-step median forecast with MASE (seasonal 12), RMSE and
 *     80% interval coverage
 *
 * The script writes raw results to benchmarks/results/latest.json and a
 * markdown table to benchmarks/results/latest.md. It never prints the token.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from '@gradio/client';

const SPACE = 'mrfakename/timestral-209m';
const HORIZON = 12;
const SEASON = 12;

// The same file runs in the site repo (benchmarks/...) and in the public
// benchmark repo (data/, results/). Detect the layout instead of hard-coding.
const IN_SITE_REPO = existsSync(resolve('benchmarks'));
const DATA = IN_SITE_REPO
  ? resolve('benchmarks/data/m4-monthly-subset.csv')
  : resolve('data/m4-monthly-subset.csv');
const RESULTS_DIR = IN_SITE_REPO ? resolve('benchmarks/results') : resolve('results');

/** List price per 1,000 successful calls, in USD. One credit = one call. */
const COST_PER_1K = [
  { label: 'Studio annual (6,000 credits)', usd: (63900 / 6000) * 1000 / 100 },
  { label: 'Pro annual (2,400 credits)', usd: (31900 / 2400) * 1000 / 100 },
  { label: 'Studio monthly (500 credits)', usd: (7990 / 500) * 1000 / 100 },
  { label: 'Starter monthly (20 credits)', usd: (990 / 20) * 1000 / 100 },
  { label: 'Entry one-time pack (10 credits)', usd: (990 / 10) * 1000 / 100 },
];

function parseCsv(text) {
  const bySeries = new Map();
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (const line of lines.slice(1)) {
    const [seriesId, date, rawValue] = line.split(',');
    const value = Number(rawValue);
    if (!seriesId || !date || !Number.isFinite(value)) continue;
    if (!bySeries.has(seriesId)) bySeries.set(seriesId, []);
    bySeries.get(seriesId).push({ date, value });
  }
  return bySeries;
}

function parseTable(table) {
  const headers = table?.headers || [];
  const timeIndex = headers.indexOf('time') >= 0 ? headers.indexOf('time') : headers.indexOf('step');
  const columnIndex = headers.indexOf('column');
  return (table?.data || []).map((row) => ({
    time: String(row[timeIndex >= 0 ? timeIndex : 0] ?? ''),
    column: String(row[columnIndex >= 0 ? columnIndex : 1] ?? 'series'),
    low: Number(row[2] ?? NaN),
    median: Number(row[3] ?? NaN),
    high: Number(row[4] ?? NaN),
  }));
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
}

function median(values) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function quantile(values, q) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
}

function score(train, actual, forecast) {
  let scaleSum = 0;
  let scaleN = 0;
  for (let i = SEASON; i < train.length; i += 1) {
    scaleSum += Math.abs(train[i] - train[i - SEASON]);
    scaleN += 1;
  }
  const scale = scaleN ? scaleSum / scaleN : 0;
  let absSum = 0;
  let sqSum = 0;
  let covered = 0;
  for (let i = 0; i < actual.length; i += 1) {
    const error = forecast[i].median - actual[i];
    absSum += Math.abs(error);
    sqSum += error * error;
    if (actual[i] >= forecast[i].low && actual[i] <= forecast[i].high) covered += 1;
  }
  return {
    mase: scale > 0 ? absSum / actual.length / scale : null,
    rmse: Math.sqrt(sqSum / actual.length),
    coverage: covered / actual.length,
  };
}

function toCsv(rows) {
  return ['date,value', ...rows.map((row) => `${row.date},${row.value}`)].join('\n');
}

async function forecast(client, rows) {
  const response = await client.predict('/forecast', [
    toCsv(rows),
    HORIZON,
    '80% (0.1 to 0.9)',
    0,
    true,
    true,
  ]);
  const data = response.data;
  const table = data[1];
  const rowsOut = parseTable(table);
  const columns = [...new Set(rowsOut.map((row) => row.column))];
  const first = columns[0];
  const selected = rowsOut.filter((row) => row.column === first).slice(0, HORIZON);
  const fileUrl = data[2]?.url ?? null;
  const took = typeof data[3] === 'string' ? data[3] : '';
  return { selected, fileUrl, took, columns };
}

async function main() {
  const token = process.env.HUGGINGFACE_TOKEN;
  if (!token) {
    console.error('HUGGINGFACE_TOKEN is required; do not run the benchmark without it.');
    process.exit(1);
  }

  const text = readFileSync(DATA, 'utf8');
  const bySeries = parseCsv(text);
  const series = [...bySeries.entries()].filter(([, rows]) => rows.length > HORIZON + SEASON);
  if (series.length === 0) {
    console.error(`no usable series in ${DATA}`);
    process.exit(1);
  }

  const client = await Client.connect(SPACE, { token });
  const perSeries = [];
  const latencies = [];

  for (const [seriesId, rows] of series) {
    const train = rows.slice(0, -HORIZON);
    const actual = rows.slice(-HORIZON).map((row) => row.value);
    const started = performance.now();
    let result;
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        result = await forecast(client, train);
        break;
      } catch (error) {
        lastError = error;
        console.error(`${seriesId}: attempt ${attempt} failed: ${error?.message || error}`);
        await new Promise((resolve) => setTimeout(resolve, 15_000 * attempt));
      }
    }
    const latencyMs = performance.now() - started;
    if (!result) {
      perSeries.push({
        seriesId,
        error: lastError instanceof Error ? lastError.message : String(lastError),
      });
      continue;
    }
    if (result.selected.length < HORIZON) {
      perSeries.push({
        seriesId,
        error: `expected ${HORIZON} rows, got ${result.selected.length}`,
      });
      continue;
    }
    latencies.push(latencyMs);
    const metrics = score(
      train.map((row) => row.value),
      actual,
      result.selected
    );
    perSeries.push({
      seriesId,
      ...metrics,
      latencyMs,
      took: result.took,
      firstRows: result.selected.slice(0, 3),
    });
    console.log(
      `${seriesId}: MASE=${metrics.mase?.toFixed(3) ?? 'n/a'} RMSE=${metrics.rmse.toFixed(2)} coverage=${(metrics.coverage * 100).toFixed(0)}% ${Math.round(latencyMs)}ms`
    );
  }

  const successful = perSeries.filter((row) => !row.error && row.mase != null);
  const summary = {
    generatedAt: new Date().toISOString(),
    model: 'mistralai/Timestral-209M',
    space: SPACE,
    dataset: 'M4 monthly, last 120 points of 8 series (public)',
    horizon: HORIZON,
    season: SEASON,
    seriesRequested: series.length,
    seriesScored: successful.length,
    meanMase: mean(successful.map((row) => row.mase)),
    medianMase: median(successful.map((row) => row.mase)),
    meanRmse: mean(successful.map((row) => row.rmse)),
    meanCoverage: mean(successful.map((row) => row.coverage)),
    beatsSeasonalNaive: successful.filter((row) => row.mase < 1).length,
    latencyMs: {
      mean: mean(latencies),
      median: median(latencies),
      p95: quantile(latencies, 0.95),
    },
    costPer1kCalls: COST_PER_1K,
    perSeries,
    notes: [
      'Small sample: 8 series, 12-step horizon. This is an illustrative benchmark, not a leaderboard.',
      'MASE uses a seasonal naive scale with period 12 on the 108-point training window.',
      'Coverage is the share of held-out actuals inside the 80% (0.1–0.9) interval.',
      'Latency includes the public Hugging Face Space round trip; a dedicated endpoint may differ.',
      'Cost is the list price per successful call at each tier, not GPU cost.',
    ],
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(
    resolve(RESULTS_DIR, 'latest.json'),
    `${JSON.stringify(summary, null, 2)}\n`
  );

  const lines = [
    '# Timestral benchmark',
    '',
    `Generated: ${summary.generatedAt}`,
    '',
    `- Model: ${summary.model}`,
    `- Dataset: ${summary.dataset}`,
    `- Horizon: ${summary.horizon} monthly steps`,
    `- Scored: ${summary.seriesScored}/${summary.seriesRequested} series`,
    '',
    '| Metric | Value |',
    '| --- | ---: |',
    `| Mean MASE | ${summary.meanMase.toFixed(3)} |`,
    `| Median MASE | ${summary.medianMase.toFixed(3)} |`,
    `| Mean RMSE | ${summary.meanRmse.toFixed(2)} |`,
    `| Mean 80% coverage | ${(summary.meanCoverage * 100).toFixed(1)}% |`,
    `| Beats seasonal naive | ${summary.beatsSeasonalNaive}/${summary.seriesScored} |`,
    `| Median latency | ${Math.round(summary.latencyMs.median)} ms |`,
    '',
    '| Series | MASE | RMSE | Coverage | Latency |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...successful.map(
      (row) =>
        `| ${row.seriesId} | ${row.mase.toFixed(3)} | ${row.rmse.toFixed(2)} | ${(row.coverage * 100).toFixed(0)}% | ${Math.round(row.latencyMs)} ms |`
    ),
    '',
    '## Cost per 1,000 calls',
    '',
    '| Tier | USD / 1,000 calls |',
    '| --- | ---: |',
    ...COST_PER_1K.map((row) => `| ${row.label} | $${row.usd.toFixed(2)} |`),
    '',
    '## Method',
    '',
    'Each series is cut to its last 120 monthly points. The first 108 points are sent to the public Timestral Space; the last 12 are held out. The returned median and 80% band are scored against the held-out values. See `benchmarks/run.mjs` for the exact code and `benchmarks/data/` for the input.',
    '',
    '> This is a small, reproducible check, not a claim of state-of-the-art accuracy. Use the harness on your own series before making a planning decision.',
  ];
  writeFileSync(resolve(RESULTS_DIR, 'latest.md'), `${lines.join('\n')}\n`);
  console.log(`\nwrote ${RESULTS_DIR}/latest.json and latest.md`);
  console.log(
    `mean MASE ${summary.meanMase.toFixed(3)} · coverage ${(summary.meanCoverage * 100).toFixed(1)}% · ${summary.seriesScored}/${summary.seriesRequested} scored`
  );
}

await main();
