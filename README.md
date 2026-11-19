# Token Radar — pre-token protocols ranked by implied value

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/airdropcipung-coder/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/airdropcipung-coder/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for make.fun's "Build the best token launch radar" bounty ($1,325 in USDC).
It reads a sealed snapshot of the protocol universe from DefiLlama, ranks every protocol that
has no token by an implied value, and shows the reader how to farm each one.

## The model (radar-2)

A token is worth what the market already pays for the same kind of protocol, per dollar of TVL:

```
implied = round( tvl_usd x category multiple
                 x (1 + clamp(change_7d, -40, +60) / 100 x 0.8)
                 x maturity(age) x (1 + 0.02 x min(chains - 1, 4)) )
```

- **Category multiple** — the median market cap per dollar of TVL among the live protocols in
  the same category (3 or more peers), else the median over every live protocol (0.21x on this
  snapshot), clamped to [0.05, 1.50]. It is computed from the snapshot at run time, never from
  a table of names.
- **Growth** — the seven-day TVL change, clamped so that one outlier week cannot decide the
  board.
- **Maturity** — how long the protocol has run with no token: under 90 days it is unproven
  (0.75x), from 90 to 1,095 days it ramps from 0.80x to 1.00x, past 1,095 days it holds at
  1.00x, and past 1,500 days it eases to 0.95x.
- **Breadth** — a protocol live on more chains is worth a little more.

The board covers all 40 watchlist protocols and adds every rankable pre-token protocol below
the $50M floor, 186 of them: 226 rows. Live-token protocols are set aside with their market
caps shown and never mixed into the ranking. Every row carries a 7-step farm plan with what
each step costs and how long it takes, derived from the protocol's own category, chains, TVL
and age.

## The dashboard

`dashboard/` is a static page with no network and no framework: a sortable, filterable board
(search, category, chain, watchlist-only), a top-five conviction strip, a detail view for every
protocol with the model's own inputs and its farm plan, a live-token view, and a model sandbox
that re-scores the board when you move the growth weight or the multiple cap.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

Node 22 or newer, standard library only. `main.ts` writes `board.json`, `data.js`,
`dashboard/`, `screenshots/` and `dossier.json` to the output directory, and two runs produce
identical bytes.

## Files

- `main.ts` — the entrypoint: reads the snapshot, scores the board, writes the outputs.
- `lib/model.ts` — the radar-2 model, the farm plans and the board validation.
- `dashboard/` — `index.html`, `app.css`, `app.js`: the dashboard the judge reads.
- `screenshots/` — the board, a protocol's detail view and a filtered view.
- `vendor/makefun-board.ts` — make.fun's dossier library, vendored unchanged.

Built by an AI agent for make.fun's "Build the best token launch radar" bounty, $1,325 in USDC.
