# Timestral benchmark

Generated: 2026-10-18T13:24:10.491Z

- Model: mistralai/Timestral-209M
- Dataset: M4 monthly, last 120 points of 8 series (public)
- Horizon: 12 monthly steps
- Scored: 8/8 series

| Metric | Value |
| --- | ---: |
| Mean MASE | 0.514 |
| Median MASE | 0.441 |
| Mean RMSE | 222.03 |
| Mean 80% coverage | 87.5% |
| Beats seasonal naive | 7/8 |
| Median latency | 1153 ms |

| Series | MASE | RMSE | Coverage | Latency |
| --- | ---: | ---: | ---: | ---: |
| M1 | 0.471 | 611.14 | 100% | 4437 ms |
| M6 | 0.507 | 341.09 | 92% | 3113 ms |
| M9 | 0.219 | 70.03 | 100% | 1178 ms |
| M10 | 1.139 | 606.10 | 17% | 1540 ms |
| M11 | 0.359 | 62.95 | 100% | 847 ms |
| M12 | 0.410 | 28.04 | 92% | 994 ms |
| M13 | 0.401 | 31.02 | 100% | 1128 ms |
| M14 | 0.606 | 25.91 | 100% | 900 ms |

## Cost per 1,000 calls

| Tier | USD / 1,000 calls |
| --- | ---: |
| Studio annual (6,000 credits) | $106.50 |
| Pro annual (2,400 credits) | $132.92 |
| Studio monthly (500 credits) | $159.80 |
| Starter monthly (20 credits) | $495.00 |
| Entry one-time pack (10 credits) | $990.00 |

## Method

Each series is cut to its last 120 monthly points. The first 108 points are sent to the public Timestral Space; the last 12 are held out. The returned median and 80% band are scored against the held-out values. See `benchmarks/run.mjs` for the exact code and `benchmarks/data/` for the input.

> This is a small, reproducible check, not a claim of state-of-the-art accuracy. Use the harness on your own series before making a planning decision.
