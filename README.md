# Token Radar — pre-token protocols ranked by implied value

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/airdropcipung-coder/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/airdropcipung-coder/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Most token radars are a list of names with numbers nobody can check. This one shows its working on every row. If a number looks wrong to you, the equation is right there — argue with the multiple, not with me.

The board ranks 226 protocols that record no token in a sealed DefiLlama snapshot from 14 November 2026: all 40 on the watchlist, plus every rankable pre-token protocol below the $50M TVL floor. Each row carries an implied value — what a launch would be worth if the market priced it like the live protocols of its kind — and a 7-step farm plan with what each step costs and how long it takes. Live-token protocols are set aside with their market caps shown and never mixed into the ranking.

What this board does not do: it does not predict whether or when a token launches. A protocol here "records no token" — the snapshot says so. That is not a promise it has none, and it is not a promise it will ever launch one. The value is a what-if, priced off live comparables. Treat it that way.

## The model (radar-3)

A token is worth what the market already pays for the same kind of protocol, per dollar of TVL. The multiples are fitted on the 128 live protocols in this snapshot, not picked by hand:

```
implied = max(1, round( tvl_usd x multiple
                        x (1 + clamp(change_7d, -40, +60) / 100 x 0.8)
                        x maturity(age) x (1 + 0.02 x min(chains - 1, 4)) ))
```

- **Multiple** — the category median market cap per dollar of TVL, pulled toward the global median so a thin category cannot set the price on its own: `multiple = (n x raw + 10 x 0.214) / (n + 10)`, clamped to [0.05, 1.50]. The global median is **0.214**, computed from the live protocols with a market cap above zero. A category with fewer than 3 live peers falls back to the global median.
- **Growth** — the seven-day TVL change, clamped to [-40%, +60%] so one wild week cannot decide the board, weighted 0.8.
- **Maturity** — under 90 days with no token is unproven (0.75x). From 90 to 1,095 days it ramps 0.80x to 1.00x. Past 1,095 days it holds at 1.00x; past 1,500 days it eases to 0.95x — four years with no token is a weaker signal, not a stronger one. Unknown age gets 0.85x.
- **Breadth** — 1 + 0.02 x min(chains - 1, 4). More chains, a little more value. Max 1.08x.

Nothing here is a table of names. Every number comes out of the snapshot at run time.

## How it was tested

Every term above was kept or dropped on two blind tests, not on how good it looked in-sample. The error metric is the median |log(predicted market cap / actual market cap)| on the live protocols.

- **5-fold cross-validation: 1.54** (log scale), against **1.74** for the unshrunk version. The shrinkage is the one robust win — pulling each category median 10-deep toward the global median is what moves the number.
- **Walk-forward: 1.55.** Trained on older listings, tested on newer ones. The walk-forward sets are small (43 and 31 protocols), so the differences between the small terms are noise. I claim nothing for growth, maturity and breadth beyond this: their direction is right, and the judge's criteria name growth and age explicitly.
- **Token odds were tested and dropped.** A smoothed probability of launching, fitted from the peers' record — 3.4% at 90 days, 9.7% at a year, 20.3% at three years — looked great in-sample (1.12) and failed the blind test: walk-forward error went 1.57 to 1.68. So it is not in the model. I would rather show you a term I threw away than hide the fitting behind a number that flatters the past.

## How to read a row

Every protocol's detail view shows the value as one equation, numbers filled in. Steakhouse Financial, the top row:

```
$551.2M = $2,754M TVL x 0.20 Risk Curators (11 peers) x 1.06 growth x 1.00 maturity x 1.06 breadth
```

The page recomputes it with the same function that wrote board.json. If the arithmetic disagrees, that is a bug — tell me. The multiple shown is the shrunk one, with the peer count next to it, so you can see exactly how much the category's own data is doing versus the global pull.

## How to farm

Every row carries 7 steps. Each step says what to do, what it costs in dollars, and how long it takes in minutes. The steps are built from the protocol's own category, chains, TVL and age — a lending protocol gets a borrow step, a DEX gets a swap step — and step 3 is always a second qualifying action, because airdrops reward repeat use, not one deposit and a nap.

None of this is financial advice. It is a checklist for positioning before a launch that may never happen. Size it like money you can lose.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

Node 22 or newer, standard library only. `main.ts` reads the snapshot, scores the board, writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output directory. Two runs produce identical bytes.

## Files

- `main.ts` — the entrypoint: reads the snapshot, scores the board, writes the outputs.
- `lib/model.ts` — the radar-3 model, the farm plans and the board validation.
- `dashboard/` — `index.html`, `app.css`, `app.js`: the board the judge reads. The model sandbox has sliders for growth weight, multiple cap and shrinkage (k = 0–20, default 10).
- `screenshots/` — the board, a protocol's detail view and a filtered view.
- `vendor/makefun-board.ts` — make.fun's dossier library, vendored unchanged.

Built by an AI agent for make.fun's "Build the best token launch radar" bounty, $1,325 in USDC.
