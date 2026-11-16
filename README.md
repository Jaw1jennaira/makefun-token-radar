# Token Launch Radar — make.fun token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Jaw1jennaira/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Jaw1jennaira/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A program plus the dashboard it writes: it reads a sealed DefiLlama snapshot of the
protocol universe, ranks the protocols that record no token by what their launch would
be worth, and hands in a web dashboard with the board, a detail view for every protocol,
and the steps to farm each one.

## The model (radar-3)

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

Radar-3 also tightens what counts as a launch. The watchlist's own rule leaves out
wrapped, staked and bridged products of a token that already trades, and radar-2 only
applied half of that rule — its board ranked 48 bridges, liquid-staking and staking
products (Ink Bridge, Polygon zkEVM Bridge, Definity Staked SOL) that are not protocols
waiting on a launch of their own. Radar-3 applies the whole rule to the early rows too:
no Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX
category, no versioned name, no whole word wrapped, staked or staking, and no name
beginning with an exchange's name.

Every row also carries a confidence score (how complete its record is, and how many
live comparables back its multiple), a value thesis and a profile written from its own
figures, its rank inside its category, and the signals the thesis rests on. The farm
plan is derived the same way — the action, the weekly rhythm, the check and the hold
all change with the category, the chain and the seven-day trend — never from a
hand-written list of names.

The board covers all 40 watchlist protocols (TVL ≥ $50M, no token on record) and adds
138 pre-token protocols below the floor — 178 rows, $4.97B of total implied value.
Live-token protocols are set aside with their market caps shown, never mixed into the
ranking. "No token" means the snapshot records none, not that the protocol has none.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`main.ts` (Node 22, standard library only) writes `board.json`, `data.js`, and copies
`dashboard/` and `screenshots/` into the output directory, then writes `dossier.json`
with the vendored `vendor/makefun-board.ts`.

## Dashboard

`dashboard/` is a static page with no network: `index.html`, `app.css`, `app.js`, fed
by `data.js`. It has a sortable board (rank, TVL, 7d, age, implied value, implied per
$TVL, confidence), search, category and chain filters, a pre-token / live-token switch,
a "Watchlist only" scope toggle and a "Farm plan complete only" toggle (every row is
labelled watchlist or early so the floor is visible), a top-5 strip that follows the
current filter with a Farm-first / Best-per-$TVL switch, a category chart of total
implied value, a fastest-growers list, a methodology panel with the calibrated
multiples and its warnings, and a detail dialog per protocol with its profile, value
thesis, signals, confidence, the model's own inputs and a seven-step farm plan
(action, cost, time).

## License

MIT — see `LICENSE`.
