// The radar's model: a sealed snapshot of every protocol DefiLlama tracks in, one ranked board out.
//
// Two jobs, in this order.
//
// 1. Decide which protocols are still to come. A protocol is a subject when its record carries no
//    token (no market cap, no CoinGecko id, no symbol) and it is not the wrapped, staked, bridged or
//    exchange-run shell of a token that already trades. DefiLlama's record is not proof, so the board
//    says "records no token"; the ones it sets aside are listed with the reason, never hidden.
//
// 2. Price the token it may issue, from the snapshot's own figures and nothing else:
//
//      implied = tvl_usd x multiple(category) x growth(change_7d) x seasoning(listed_at)
//
//    multiple(category) is the one number no other entry gets from the data: the median
//    market-cap-to-TVL ratio of the protocols in the same category whose token already trades,
//    winsorised, then shrunk toward the all-market median by how few peers the category has. A
//    category with fifteen live comparables keeps its own ratio; a category with one is pulled most
//    of the way back to the market's. No protocol name is ever special-cased.
//
//    growth rewards a protocol whose TVL grew in the last seven days and trims one that shrank, at a
//    third of the raw move, clamped to -50..+100 per cent.
//    seasoning rewards a protocol that has run a long time without a token: its record has been read
//    by the market for longer, so a launch has more behind it. 0.65 at day zero rising to 1.0 at four
//    years; a protocol with no start date is scored at one year.
//
// The model is deterministic, uses no clock and no network, and the page recomputes every row from
// the same three inputs, so the number board.json carries and the number the page shows agree.

/** One protocol, exactly the ten fields the sealed snapshot carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants: stated on the page, and the only tunables the model has. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  season_floor: number;
  season_range: number;
  season_days: number;
  unknown_age_days: number;
  shrink_peers: number;
  ratio_floor: number;
  ratio_cap: number;
  multiple_floor: number;
  multiple_cap: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.35,
  growth_floor: -50,
  growth_cap: 100,
  season_floor: 0.65,
  season_range: 0.35,
  season_days: 1460,
  unknown_age_days: 365,
  shrink_peers: 6,
  ratio_floor: 0.01,
  ratio_cap: 5,
  multiple_floor: 0.05,
  multiple_cap: 1.5,
};

export const MODEL_VERSION = 'comps-1';

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of the ranked board. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  token_status: 'records-no-token';
  implied_value_usd: number;
  model: {
    category_multiple: number;
    peers: number;
    peer_median_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    season_multiplier: number;
    season_days: number;
  };
  farm_steps: string[];
}

/** A category's comparable set: the live tokens that price a pre-token protocol in it. */
export interface CategoryStat {
  name: string;
  peers: number;
  median_multiple: number;
  multiple: number;
  rows: number;
}

/** A protocol the board set aside, and why. */
export interface SetAside {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: string;
}

/** A protocol whose token already trades: the board's comparables, never its subjects. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

/** Everything the page renders, from one snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  protocol_count: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  set_aside_size: number;
  total_implied_usd: number;
  median_multiple: number;
  rows: RadarRow[];
  categories: CategoryStat[];
  live: LiveRow[];
  set_aside: SetAside[];
}

/** A board row as the page reads it: the same figures, the plan split into action, cost and time. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  multiple: number;
  peers: number;
  growth_multiplier: number;
  season_multiplier: number;
  farm: FarmStep[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else the fallback. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Whole days from the snapshot's date back to the day the record starts; null when it has no date. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const now = Date.parse(`${asOf}T00:00:00Z`);
  const then = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(now) || !Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((now - then) / DAY_MS));
}

/** Whether the record carries no token at all. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Categories whose every member is the on-chain form of a token that already trades. */
const TOKEN_SHELL = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A name ending in a release number is a pool or a version of another protocol. */
const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A name carrying these as a whole word is a staked or wrapped derivative. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name beginning with an exchange's is the exchange's own product. */
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Why a protocol that records no token is still not a subject, or null when it is one. */
export function setAsideReason(p: SnapshotProtocol): string | null {
  if (!recordsNoToken(p)) return null;
  if (p.category !== null && TOKEN_SHELL.has(p.category)) {
    if (p.category === 'CEX') return 'a centralised exchange: its equity is not a token launch';
    if (p.category === 'Bridge' || p.category === 'Canonical Bridge') return 'a bridge: the wrapped asset is a claim on a token that already trades';
    if (p.category === 'Liquid Staking' || p.category === 'Liquid Restaking' || p.category === 'Restaked BTC') return 'a liquid staking receipt: it tracks a token that already trades';
  }
  if (VERSION_MARKER.test(p.name)) return 'a versioned pool of another protocol';
  if (WRAPPED_WORD.test(p.name)) return 'a wrapped or staked derivative named in its own record';
  const lead = p.name.split(/\s+/)[0]!.toLowerCase();
  if (EXCHANGES.some((e) => lead === e.toLowerCase())) return 'an exchange-run product, named after its exchange';
  if (p.tvl_usd <= 0) return 'no TVL on record to value';
  return null;
}

/** Whether the board may rank this protocol. */
export function isSubject(p: SnapshotProtocol): boolean {
  return recordsNoToken(p) && setAsideReason(p) === null;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** The multiple one live protocol trades at: its market cap over its TVL, winsorised. */
function liveMultiple(p: SnapshotProtocol, model: ModelConstants): number {
  return clamp(p.mcap_usd! / p.tvl_usd, model.ratio_floor, model.ratio_cap);
}

/**
 * Every category's comparable set, from the protocols whose token already trades. A category's
 * multiple is its median ratio shrunk toward the all-market median by `shrink_peers` pseudo-peers,
 * then clamped: a handful of comparables never prices a launch above 1.5x or below 0.05x its TVL.
 */
export function categoryStats(snapshot: Snapshot, model: ModelConstants = MODEL): Map<string, CategoryStat> {
  const live = snapshot.protocols.filter((p) => !recordsNoToken(p) && p.mcap_usd !== null && p.tvl_usd > 0);
  const market = median(live.map((p) => liveMultiple(p, model)));
  const ratios = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'none';
    const list = ratios.get(key) ?? [];
    list.push(liveMultiple(p, model));
    ratios.set(key, list);
  }
  const stats = new Map<string, CategoryStat>();
  for (const [name, list] of ratios) {
    const med = median(list);
    const shrunk = (list.length * med + model.shrink_peers * market) / (list.length + model.shrink_peers);
    stats.set(name, {
      name,
      peers: list.length,
      median_multiple: round4(med),
      multiple: round4(clamp(shrunk, model.multiple_floor, model.multiple_cap)),
      rows: 0,
    });
  }
  stats.set('__market__', {
    name: 'all live protocols',
    peers: live.length,
    median_multiple: round4(market),
    multiple: round4(clamp(market, model.multiple_floor, model.multiple_cap)),
    rows: 0,
  });
  return stats;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The three multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(p: SnapshotProtocol, asOf: string, model: ModelConstants, stats: Map<string, CategoryStat>): {
  implied: number;
  categoryMultiple: number;
  peers: number;
  peerMedian: number;
  growthPct: number;
  growthMult: number;
  seasonMult: number;
  age: number | null;
} {
  const stat = stats.get(p.category ?? '__market__') ?? stats.get('__market__')!;
  const age = ageDays(asOf, p.listed_at);
  const growthPct = clamp(finite(p.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const seasonMult = model.season_floor + (clamp(ageForModel, 0, model.season_days) / model.season_days) * model.season_range;
  const implied = Math.max(1, Math.round(p.tvl_usd * stat.multiple * growthMult * seasonMult));
  return {
    implied,
    categoryMultiple: stat.multiple,
    peers: stat.peers,
    peerMedian: stat.median_multiple,
    growthPct,
    growthMult,
    seasonMult,
    age,
  };
}

/** A step as the string board.json carries: the action, then its cost and its time. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep a written record of it.`;
  return s;
}

/** The chain a plan acts on: the first the protocol names, or the one its name implies. */
function chainOf(p: SnapshotProtocol): string {
  if (p.chains.length > 0) return p.chains[0]!;
  return 'its main chain';
}

/** How much capital one position needs, from the protocol's own TVL: deep pools take more to count. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 2_000_000_000) return 250;
  if (p.tvl_usd >= 500_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** What gas costs on the chain the plan acts on, as one short phrase. */
function gasFor(chain: string): string {
  return /ethereum|arbitrum|optimism|base|polygon|bsc|avalanche/i.test(chain)
    ? 'about $4 of gas for the first two transactions'
    : 'under $1 of gas for the first two transactions';
}

/** How long the position has to stay open, from how young the protocol is. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** What a qualifying action is for this category, and what the protocol's own programme counts. */
function qualifyingAction(p: SnapshotProtocol, capital: number, chain: string): { action: string; metric: string } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('risk curator') || c.includes('capital allocator')) {
    return {
      action: `Deposit $${capital} of USDC into a ${name} vault on ${chain} and leave it there; curators count deposits into their own vaults, not deposits into the protocols they allocate to.`,
      metric: 'deposited days and the vault shares you hold',
    };
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return {
      action: `Supply $${capital} of USDC to ${name} on ${chain}, then borrow $${Math.round(capital * 0.4)} of a stable against it, so both the supply and the borrow side of the market count.`,
      metric: 'supplied and borrowed days, both sides',
    };
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged')) {
    return {
      action: `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} and leave it through the week; fees are the yield, and impermanent loss is the risk you carry.`,
      metric: 'liquidity days and the fees the position earns',
    };
  }
  if (c.includes('basis trading')) {
    return {
      action: `Deposit $${capital} of USDC into ${name}'s delta-neutral vault on ${chain} and hold the receipt; the vault's funding rate, not your own trades, is what accrues.`,
      metric: "deposited days and the vault's reported yield",
    };
  }
  if (c.includes('rwa') || c.includes('stable')) {
    return {
      action: `Mint or deposit $${capital} of the protocol's yield asset through ${name} on ${chain} and hold it in the wallet, not in a pool.`,
      metric: "the asset's balance and the days it is held",
    };
  }
  if (c.includes('restak') || c.includes('staking pool')) {
    return {
      action: `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the same wallet.`,
      metric: 'staked balance and receipt-token days',
    };
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('option')) {
    return {
      action: `Deposit $${capital} of USDC as margin on ${name} on ${chain} and trade a small round trip each week; volume, not the size of the deposit, is what these programmes count.`,
      metric: 'traded volume, not open interest',
    };
  }
  if (c.includes('prediction')) {
    return {
      action: `Fund $${capital} on ${name} on ${chain} and take a position in three markets, holding each to resolution rather than selling out early.`,
      metric: 'settled positions and the volume they carried',
    };
  }
  if (c.includes('insurance')) {
    return {
      action: `Buy $${capital} of cover from ${name} on ${chain} for a pool you actually use, and keep the policy open past its first renewal.`,
      metric: 'premium paid and days covered',
    };
  }
  if (c === 'chain') {
    return {
      action: `Bridge $${capital} of USDC onto ${name} and use two of its applications with it, keeping the balance on the chain between uses.`,
      metric: 'bridged balance and the transactions made with it',
    };
  }
  if (c.includes('payment')) {
    return {
      action: `Move $${capital} through ${name} on ${chain} as a real payment or a balance you hold, and repeat it in a later week.`,
      metric: 'volume routed and the balance kept',
    };
  }
  if (c.includes('index')) {
    return {
      action: `Mint $${capital} of ${name}'s index token on ${chain} and hold it rather than redeeming it in the same week.`,
      metric: 'minted balance and holding days',
    };
  }
  if (c.includes('launchpad')) {
    return {
      action: `Fund $${capital} on ${name} on ${chain} and take part in one launch with a small ticket; keep the rest in the account so the wallet stays active.`,
      metric: 'participations and the balance kept on the platform',
    };
  }
  return {
    action: `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open; if the app offers more than one product, use two of them.`,
    metric: 'deposited balance and the days it stays',
  };
}

/**
 * A protocol's farm plan: six steps, each an action with its cost and its time. Everything in it is
 * derived from the protocol's own record (category, chains, TVL, age), never from a name list.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const { action, metric } = qualifyingAction(p, capital, chain);
  const gas = gasFor(chain);
  return [
    {
      text: `Open a fresh wallet on ${chain} that holds only the money you plan to farm, write its seed phrase on paper, and keep it off any device that signs other transactions.`,
      cost: `nothing but the wallet, and ${gas}`,
      time: '10 minutes',
    },
    {
      text: action,
      cost: `$${capital} of your own capital, plus ${gas}`,
      time: '15 to 20 minutes to set up',
    },
    {
      text: `Repeat one qualifying action every week that moves ${metric}, and never leave the wallet empty between weeks: an idle balance often drops off a programme's snapshot.`,
      cost: 'about $2 of gas a week, and no new capital',
      time: '10 minutes a week',
    },
    {
      text: `Keep the position open for at least ${hold} days so it is counted in several weekly snapshots, and do not unwind it to chase a second protocol's programme.`,
      cost: `the $${capital} stays locked in the position`,
      time: `${hold} days`,
    },
    {
      text: `Read ${p.name}'s own docs and app for a points or launch page before you claim anything, and never sign a transfer of your whole balance or pay a fee to claim.`,
      cost: 'free to check, and no legitimate claim charges a fee',
      time: '15 minutes once',
    },
    {
      text: `Log the entry date, the transaction hashes and the exit plan in one file, so the position can be repeated next month or unwound in the same order it was opened.`,
      cost: 'nothing but the note',
      time: '5 minutes',
    },
  ];
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const stats = categoryStats(snapshot, model);
  const subjects = snapshot.protocols.filter(isSubject);
  const scored = subjects.map((p) => ({ p, ...impliedValue(p, snapshot.as_of, model, stats) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    age_days: s.age,
    token_status: 'records-no-token',
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.categoryMultiple,
      peers: s.peers,
      peer_median_multiple: s.peerMedian,
      growth_pct: round4(s.growthPct),
      growth_multiplier: round4(s.growthMult),
      season_multiplier: round4(s.seasonMult),
      season_days: s.age ?? model.unknown_age_days,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** The live-token protocols, biggest market cap first: the comparables the model learns from. */
export function liveRows(snapshot: Snapshot, model: ModelConstants): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.mcap_usd !== null && p.tvl_usd > 0)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || (a.slug < b.slug ? -1 : 1))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      multiple: round4(liveMultiple(p, model)),
    }));
}

/** The protocols that record no token and are still not subjects, with the reason, biggest first. */
export function setAsideRows(snapshot: Snapshot): SetAside[] {
  return snapshot.protocols
    .filter((p) => recordsNoToken(p) && !isSubject(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      reason: setAsideReason(p)!,
    }));
}

/** Everything the page renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const stats = categoryStats(snapshot, model);
  const watchlist = new Set(snapshot.watchlist);
  const perCategory = new Map<string, number>();
  for (const row of board) perCategory.set(row.category ?? 'none', (perCategory.get(row.category ?? 'none') ?? 0) + 1);
  const categories = [...stats.values()]
    .filter((s) => s.name !== 'all live protocols')
    .map((s) => ({ ...s, rows: perCategory.get(s.name) ?? 0 }))
    .sort((a, b) => b.rows - a.rows || b.peers - a.peers || (a.name < b.name ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    protocol_count: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watchlist.has(r.slug)).length,
    live_size: snapshot.protocols.filter((p) => !recordsNoToken(p)).length,
    set_aside_size: snapshot.protocols.filter((p) => recordsNoToken(p) && !isSubject(p)).length,
    total_implied_usd: board.reduce((sum, r) => sum + r.implied_value_usd, 0),
    median_multiple: stats.get('__market__')!.median_multiple,
    rows: board.map((row) => ({
      rank: row.rank,
      slug: row.slug,
      name: row.name,
      category: row.category,
      chains: row.chains,
      tvl_usd: row.tvl_usd,
      change_7d: row.change_7d,
      age_days: row.age_days,
      watchlist: watchlist.has(row.slug),
      implied_value_usd: row.implied_value_usd,
      multiple: row.model.category_multiple,
      peers: row.model.peers,
      growth_multiplier: row.model.growth_multiplier,
      season_multiplier: row.model.season_multiplier,
      farm: farmSteps(snapshot.protocols.find((p) => p.slug === row.slug)!, row.age_days),
    })),
    categories,
    live: liveRows(snapshot, model),
    set_aside: setAsideRows(snapshot),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((value, i) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = value as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `only ${board.length} rows: the gate takes 100 or more`;
  if (board.length > 4000) return `${board.length} rows: the gate takes 4,000 or fewer`;
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) {
    if (board[i]!.rank !== i + 1) return `rank ${i + 1} is ${board[i]!.rank}`;
    if (i > 0 && board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share one implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const row of board) {
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 100_000_000_000_000) {
      return `${row.slug} has implied value ${row.implied_value_usd}`;
    }
    const steps = row.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${row.slug} has ${steps.length} farm steps`;
    for (const step of steps) if (step.length < 20 || step.length > 600) return `${row.slug} has a farm step of ${step.length} characters`;
  }
  return null;
}

/** data.js: the page's whole dataset as one script, so the page fetches nothing. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
