# Token Launch Radar — make.fun token-radar-01

A program plus the dashboard it writes: it reads a sealed DefiLlama snapshot of the
protocol universe, ranks the protocols that record no token by what their launch would
be worth, and hands in a web dashboard with the board, a detail view for every protocol,
and the steps to farm each one.

## The model (radar-2)

Implied value follows only from the snapshot's own figures:

```
implied = round( tvl_usd x category_multiple
  x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
  x (0.6 + min(age_days, 1095) / 1095 x 0.4)
  x (1 + 0.03 x min(chains - 1, 4)) )
```

The one idea a flat TVL multiple misses is that the market does not price every kind
of protocol alike. Each category gets its own multiple, calibrated from the snapshot
itself: the median market-cap-to-TVL of that category's live-token protocols, shrunk
toward the overall median (prior weight 6) and clamped to 0.05x–0.60x, so one wild
outlier cannot decide a whole board. No protocol name is special-cased; the multiples
the run used are shown in the dashboard's methodology panel.

The board covers all 40 watchlist protocols (TVL ≥ $50M, no token on record) and adds
260 pre-token protocols below the floor, by TVL — 300 rows. Live-token protocols are
set aside with their market caps shown, never mixed into the ranking. "No token" means
the snapshot records none, not that the protocol has none.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`main.ts` (Node 22, standard library only) writes `board.json`, `data.js`, and copies
`dashboard/` and `screenshots/` into the output directory, then writes `dossier.json`
with the vendored `vendor/makefun-board.ts`.

## Dashboard

`dashboard/` is a static page with no network: `index.html`, `app.css`, `app.js`, fed
by `data.js`. It has a sortable board, search, category and chain filters, a pre-token /
live-token switch, a "Watchlist only" scope toggle (every row is labelled watchlist or
early so the floor is visible), a "Farm first" top-5 strip, a category chart of total implied value,
a methodology panel with the calibrated multiples, and a detail dialog per protocol
with the model's own inputs and a seven-step farm plan (action, cost, time).

## License

MIT — see `LICENSE`.
