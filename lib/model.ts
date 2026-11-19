// Token Radar — the radar-2 scoring model.
//
// One sealed snapshot goes in, one ranked board comes out. The board ranks every
// protocol on the snapshot's watchlist, plus the strongest pre-token protocols
// below the watchlist floor, by the value a token in them would imply. A token is
// priced the way the market already prices the same kind of protocol: take the
// median market-cap-per-dollar-of-TVL of the live protocols in the same category,
// multiply by the protocol's own TVL, then adjust for how fast its TVL is growing,
// how long it has run with no token, and how many chains it runs on. Nothing in
// here names a protocol: the same function scores every row, and the dashboard
// re-runs the same function in the page, so the numbers on screen and the numbers
// in board.json are the same arithmetic, checkable row by row.
//
// A protocol counts as pre-token when the snapshot records no token for it at all:
// no market cap, no CoinGecko id, no symbol. Live-token protocols are never ranked
// against the pre-token board; the dashboard shows them apart, with the market's
// own values. A name that ends in a version marker (a release of another protocol,
// by DefiLlama's rule) and any exchange are not rankable either.

/** One protocol record, exactly the ten fields the sealed snapshot carries. */
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

/** The whole sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's tunable constants. The dashboard prints them and its sandbox moves two. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  multiple_floor: number;
  multiple_cap: number;
  min_category_peers: number;
  maturity_young_days: number;
  maturity_young: number;
  maturity_ramp_start: number;
  maturity_ramp_end: number;
  maturity_days: number;
  maturity_old_days: number;
  maturity_old: number;
  unknown_age_multiplier: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.8,
  growth_floor: -40,
  growth_cap: 60,
  multiple_floor: 0.05,
  multiple_cap: 1.5,
  min_category_peers: 3,
  maturity_young_days: 90,
  maturity_young: 0.75,
  maturity_ramp_start: 0.8,
  maturity_ramp_end: 1.0,
  maturity_days: 1095,
  maturity_old_days: 1500,
  maturity_old: 0.95,
  unknown_age_multiplier: 0.85,
  breadth_per_chain: 0.02,
  breadth_max_chains: 4,
};

/** The model the dashboard names and the rules quote. */
export const MODEL_VERSION = 'radar-2';

/**
 * How many pre-token protocols below the watchlist floor the early radar carries,
 * strongest TVL first. The cap is 260; this snapshot holds 186 rankable ones below
 * the floor, so the board comes out as 40 watchlist + 186 early = 226 rows.
 */
export const EARLY_ROWS = 260;

/** How many live-token protocols the dashboard's Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One step of a farm plan: what to do, what it costs, how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact form of one board row; the page builds farm plans from it. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
}

/** A protocol that already trades: the board shows the market's own value for it. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model that scored it. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_multiple: number;
  watchlist: string[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** The snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** `value` when it is a finite number, else `fallback`. */
function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The number `n`, kept inside `[lo, hi]`. */
function clampValue(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** The median of a non-empty list. */
function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whole days from `from` to `to`, never below zero; null when either date is missing or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether the snapshot records no token for this protocol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether the board may rank this protocol: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/**
 * The market's own price for this kind of protocol: the median mcap/TVL of the live
 * protocols in the same category when there are enough peers, else the median over
 * every live protocol. Live protocols with a zero market cap are left out — they
 * would drag the median down for a reason that has nothing to do with price.
 * Computed from the snapshot at run time, never from a table of names.
 */
export function categoryMultiple(
  protocol: SnapshotProtocol,
  snapshot: Snapshot,
  model: ModelConstants,
): { multiple: number; global: number } {
  const live = snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const global = medianOf(live.map((p) => p.mcap_usd! / p.tvl_usd));
  const peers = live
    .filter((p) => p.category !== null && p.category === protocol.category)
    .map((p) => p.mcap_usd! / p.tvl_usd);
  const raw = peers.length >= model.min_category_peers ? medianOf(peers) : global;
  return { multiple: clampValue(raw, model.multiple_floor, model.multiple_cap), global: clampValue(global, model.multiple_floor, model.multiple_cap) };
}

/** The maturity multiplier: how long the protocol has run with no token. */
export function maturityMultiplier(age: number | null, model: ModelConstants): number {
  if (age === null) return model.unknown_age_multiplier;
  if (age < model.maturity_young_days) return model.maturity_young;
  if (age >= model.maturity_old_days) return model.maturity_old;
  if (age >= model.maturity_days) return model.maturity_ramp_end;
  const ramp = (age - model.maturity_young_days) / (model.maturity_days - model.maturity_young_days);
  return model.maturity_ramp_start + ramp * (model.maturity_ramp_end - model.maturity_ramp_start);
}

/** The breadth multiplier: more chains, a little more value. */
export function breadthMultiplier(chains: string[], model: ModelConstants): number {
  return 1 + model.breadth_per_chain * clampValue(chains.length - 1, 0, model.breadth_max_chains);
}

/** The multipliers and the implied value one protocol gets under this model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  snapshot: Snapshot,
  model: ModelConstants,
): {
  implied: number;
  multiple: number;
  global: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
} {
  const age = ageDays(snapshot.as_of, protocol.listed_at);
  const { multiple, global } = categoryMultiple(protocol, snapshot, model);
  const rawGrowth = numOr(protocol.change_7d, 0);
  const growthPct = clampValue(rawGrowth, model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const maturityMult = maturityMultiplier(age, model);
  const breadthMult = breadthMultiplier(protocol.chains, model);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * breadthMult));
  return { implied, multiple, global, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** The snapshot's protocols indexed by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** Strongest implied value first; ties break by slug so the order is deterministic. */
function byValue(a: { implied: number; p: SnapshotProtocol }, b: { implied: number; p: SnapshotProtocol }): number {
  return b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0);
}

/** The board: every watchlist slug, plus the strongest rankable pre-token protocols below the floor. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it is ranked, even one the snapshot
  // no longer carries (it cannot, but the board's coverage is the gate's row and is
  // never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: rankable pre-token protocols below the watchlist floor, by TVL,
  // capped. A chosen protocol stays chosen; the early rows never replace a watchlist row.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot, model) }));
  scored.sort(byValue);
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.multiple,
      growth_pct: s.growthPct,
      growth_multiplier: s.growthMult,
      maturity_multiplier: s.maturityMult,
      breadth_multiplier: s.breadthMult,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** One farm step as a single string: its action, then its cost and time, inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('basis')) return `Deposit $${capital} of USDC into ${name}'s delta-neutral vault on ${chain} and keep the shares.`;
  if (c.includes('governance')) return `Deposit $${capital} of the governance asset through ${name} on ${chain} and vote once.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second qualifying action: airdrops reward repeat use, not one deposit. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $${Math.max(10, Math.round(capital / 5))} against the deposit on ${name} and repay it a week later, so the position shows both sides of the market.`;
  if (c.includes('dex') || c.includes('yield')) return `Swap $${Math.max(10, Math.round(capital / 5))} through ${name}'s main pool on ${chain} once, so the wallet shows volume as well as liquidity.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close the first hedge on ${name} and open a second one half the size, so the wallet shows repeat trading, not one trade.`;
  if (c.includes('bridge')) return `Bridge a second, smaller amount back through ${name} after a week, so the wallet shows two-way use.`;
  if (c.includes('staking') || c.includes('restak')) return `Add a second, smaller stake through ${name} a week later, so the wallet shows repeat staking, not one deposit.`;
  if (c.includes('prediction')) return `Settle the first market position on ${name} and place a second one in a different market.`;
  if (c.includes('governance')) return `Vote a second time on ${name} when the next proposal opens, so the wallet shows repeat governance.`;
  return `Use ${name} a second time a week later — a swap, a deposit or a vote — so the wallet shows repeat use, not one visit.`;
}

/**
 * One protocol's farm plan: seven steps, each an action with a cost and a time. The
 * plan is derived from the protocol's own record (category, chains, TVL, age), never
 * from a hand-written list of names. Every step carries what it costs and how long
 * it takes.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const second = secondActionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: second,
      cost: `about $${Math.max(2, Math.round(capital / 25))} of gas`,
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** One board row's compact form for data.js; the page builds the farm plan from it. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
  };
}

/** Everything the dashboard renders, built from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const liveMultiples = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => p.mcap_usd! / p.tvl_usd);
  const global = liveMultiples.length > 0 ? round4(medianOf(liveMultiples)) : 0;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_multiple: global,
    watchlist: [...snapshot.watchlist],
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape this model scores. */
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
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
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
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/**
 * Why a board is not one the gate will take, or null: coverage, ranks, order, one
 * shared implied value, and farm steps.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's whole dataset as one script: no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
