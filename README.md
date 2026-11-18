# Token Radar

[![Token Radar bounty](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/adra2n/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/adra2n/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

A radar of the protocols that record no token yet, ranked by what a token would be worth if the
protocol's record stayed as it is. Built for [make.fun](https://make.fun)'s `token-radar-01`.

## Run it

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Node 22.18 or later, standard library only, no network, no clock. In the grader's container the
snapshot is at `/input/snapshot.json` and the output goes to `/output`; the snapshot itself is
sealed input and is not in this repository.

The run writes `board.json` (the ranked board), `data.js` (the page's dataset), `dashboard/` and
`screenshots/` (copied from this repository) and, last, `dossier.json`.

## What it does

1. **Which protocols are still to come.** A protocol is a subject when its record carries no token
   (no market cap, no CoinGecko id, no symbol) and it is not the wrapped, staked, bridged or
   exchange-run form of one that already trades. The snapshot's 198 subjects are ranked; the 144
   protocols it sets aside are listed with the reason, never hidden.

2. **What the token would be worth.**

   ```
   implied = tvl_usd × multiple(category) × growth(change_7d) × seasoning(listed_at)
   ```

   `multiple(category)` is the median market-cap-to-TVL ratio of the protocols in the same category
   whose token already trades, winsorised at 0.01..5, shrunk toward the all-market median by six
   pseudo-peers and clamped to 0.05..1.5. A category with fifteen live comparables keeps its own
   ratio; a category with one is pulled almost all the way back to the market's. No protocol name is
   ever special-cased.

   Growth moves the estimate by a third of the seven-day TVL change, clamped to −50..+100 per cent.
   Seasoning runs from 0.65 at day zero to 1.0 at four years with no token, at 365 days when the
   record has no start date.

3. **What to do about it.** Every row carries a six-step farm plan derived from its own category,
   chains, TVL and age, each step with its cost and its time.

## The dashboard

`dashboard/index.html` is one page, no framework and no network. It reads `data.js` and renders the
ranked board, per-protocol filters, a detail view whose arithmetic is recomputed in the browser from
each row's own figures, the category multiples, and the set-aside list. Views are addressable
(`#p/<slug>`, `#cat=…&sort=…&wl=1`) so every screenshot is reproducible from a URL:

- `screenshots/1-board.png` — the ranked board
- `screenshots/2-detail.png` — one protocol's arithmetic and farm plan (`#p/steakhouse-financial`)
- `screenshots/3-filtered.png` — the same board filtered to one category (`#cat=Risk+Curators`)

## Layout

```
main.ts                  the entrypoint: read the snapshot, score it, write the outputs
lib/model.ts             the model: subject rule, category multiples, implied value, farm plans
dashboard/               the page (index.html, app.css, app.js)
screenshots/             the three views above, 1440×1200
vendor/makefun-board.ts  make.fun's dossier library, vendored unchanged
```

## Model

`comps-1`. Deterministic: the same snapshot always produces the same board, byte for byte. The
constants live in `lib/model.ts` and are stated on the page. An implied value is this radar's own
estimate of what a token could be worth — not a forecast that one will be issued, and not advice to
buy anything. Farming a protocol risks the capital you put in it.
