# Timestral-209M benchmark

A small, reproducible check of the public **Timestral-209M** time-series model
on eight monthly series from the public M4 competition dataset.

This is **not** a leaderboard. It is a harness you can run on your own series
before trusting a forecast in a plan.

- Product: <https://timestral.org>
- Write-up: <https://timestral.org/blog/timestral-benchmark-2026>
- Detailed results: [`results/latest.md`](results/latest.md)
- Raw JSON: [`results/latest.json`](results/latest.json)

## Result (2026-10-18)

| Metric | Value |
| --- | ---: |
| Mean MASE | 0.514 |
| Median MASE | 0.441 |
| Mean RMSE | 222.03 |
| Mean 80% coverage | 87.5% |
| Series beating seasonal naive | 7 / 8 |
| Median latency | 1,153 ms |
| Cost / 1,000 calls (Studio annual) | $106.50 |

| Series | MASE | RMSE | 80% coverage | Latency |
| --- | ---: | ---: | ---: | ---: |
| M1 | 0.471 | 611.14 | 100% | 4,437 ms |
| M6 | 0.507 | 341.09 | 92% | 3,113 ms |
| M9 | 0.219 | 70.03 | 100% | 1,178 ms |
| M10 | 1.139 | 606.10 | 17% | 1,540 ms |
| M11 | 0.359 | 62.95 | 100% | 847 ms |
| M12 | 0.410 | 28.04 | 92% | 994 ms |
| M13 | 0.401 | 31.02 | 100% | 1,128 ms |
| M14 | 0.606 | 25.91 | 100% | 900 ms |

**M10 is the important row.** It has a MASE above 1 and 17% coverage: the
median lost to seasonal naive and the 80% band missed most held-out months.
A benchmark that only reported the average would have hidden that.

## Method

- **Model:** `mistralai/Timestral-209M`, served by the public Hugging Face
  Space `mrfakename/timestral-209m`.
- **Data:** the last 120 monthly points of eight series from the public M4
  monthly dataset. The first 108 points are the context; the last 12 are held
  out.
- **Forecast:** 12 steps, median and the 80% interval (quantiles 0.1 and 0.9).
- **MASE:** mean absolute error divided by the in-sample seasonal naive MAE
  (period 12). Below 1 means the model beats seasonal naive.
- **RMSE:** root mean squared error in the series' own unit.
- **80% coverage:** share of held-out actuals inside the low/high band.
- **Latency:** wall time around one `predict` call, including the public
  Space round trip.
- **Cost:** published list price per successful call at each self-serve tier,
  not the underlying GPU cost.

## Data source

`data/m4-monthly-subset.csv` is derived from:

- <https://github.com/Mcompetitions/M4-methods/blob/master/Dataset/Train/Monthly-train.csv>
- File blob: `d956904cd5991422f70598453571572f5e6ba7f3`

M4 does not ship calendar dates, so the subset uses relative monthly indices
(`2000-01-01` + i months). Check the source repository for the dataset terms
before redistributing it.

## Run

```bash
npm install
HUGGINGFACE_TOKEN=hf_... node run.mjs
```

The token is only used to call the public Space. Never commit it.

To regenerate the sample output from the real model:

```bash
HUGGINGFACE_TOKEN=hf_... node sample-output.mjs
```

To rebuild the M4 subset (requires the 87 MB `Monthly-train.csv`):

```bash
node prepare-data.mjs /path/to/Monthly-train.csv
```

## Limitations

- Eight series and one horizon are a smoke test, not a statistical claim.
- The public Space runs on a shared ZeroGPU quota; latency and availability
  are not a service-level guarantee.
- The run does not test long horizons (the API supports up to 1,024 steps) or
  multivariate series (up to eight related columns).
- A low MASE means the pattern matched the holdout; it does not establish
  causality.

## License

The benchmark code is MIT. The M4 dataset is public competition data; see the
source repository for its terms.
