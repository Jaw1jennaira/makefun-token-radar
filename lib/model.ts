// The token radar's model, radar-3: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds the
// pre-token protocols below the watchlist floor with the most TVL: the early rows the radar exists to
// find. A protocol is pre-token when its index entry records no token (no market cap, no CoinGecko id,
// no symbol); the snapshot's live-token protocols are kept apart and shown as the market's own values,
// never mixed into the ranked board.
//
// Radar-3 tightens what counts as a launch. The watchlist's own rule leaves out wrapped, staked and
// bridged products of a token that already trades, and radar-2 only applied half of that rule, so its
// board ranked 48 bridges, liquid-staking and staking products (Ink Bridge, Polygon zkEVM Bridge,
// Definity Staked SOL) that are not protocols waiting on a launch of their own. Radar-3 applies the
// whole rule to the early rows too: no Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking,
// Restaked BTC or CEX category, no versioned name, no whole word wrapped, staked or staking, and no
// name beginning with an exchange's name. The board is smaller (178 rows) and every row on it is a
// protocol whose token genuinely does not exist yet.
//
// Implied value follows only from the snapshot's own figures. The one idea the starter's flat
// multiple misses is that the market does not price every kind of protocol alike: a lending market
// and a DEX do not trade at the same multiple of TVL. So radar-3 calibrates the multiple per category
// from the snapshot itself, using the live-token protocols as comparables:
//
//   catMultiple  = shrink(category median mcap/TVL, overall median mcap/TVL)
//   base         = tvl_usd x catMultiple
//   growth       = clamp(change_7d, -60, 120) per cent
//   growthMult   = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity     = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   chainMult    = 1 + 0.03 x min(chains - 1, 4)            (reach across chains)
//   implied      = max(1, round(base x growthMult x maturity x chainMult))
//
// Shrinkage: a category's multiple is (n x median + PRIOR_WEIGHT x overall) / (n + PRIOR_WEIGHT),
// then clamped to [0.05, 0.60]. A category with one live protocol barely moves the overall median;
// a category with fifteen live protocols mostly speaks for itself. The clamp keeps a thin or wild
// category (one outlier token at 400x TVL) from deciding a whole board. No protocol name is ever
// special-cased: the same function scores every row, and the multiples the run used are written into
// the dashboard data so a reader can check them against the snapshot.
//
// Every row also carries what the detail view needs to explain it: a confidence score (how much of
// the row's own record is on file, and how many live comparables back its multiple), a value thesis
// and a profile written from the row's own figures, its rank inside its category, and the signals
// the thesis rests on. The farm plan is derived the same way, from category, chains, TVL, age and
// seven-day growth, never from a hand-written list of names.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  prior_weight: number;
  multiple_floor: number;
  multiple_cap: number;
  chain_step: number;
  chain_max_extra: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  prior_weight: 6,
  multiple_floor: 0.05,
  multiple_cap: 0.6,
  chain_step: 0.03,
  chain_max_extra: 4,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/**
 * The farm's deposit: every plan is written for a $1,000 position, and the board's economics
 * are computed at that deposit (the dashboard offers a $10,000 view of the same numbers).
 * One deposit for every row keeps the economics comparable across the board: the slice a
 * launch pays depends on the row's own multiple, not on how much the plan sizes in.
 */
export const DEPOSIT_USD = 1000;
/** The share of a launch's supply an airdrop is assumed to pay depositors, pro-rata by deposit share of TVL. */
export const AIRDROP_SHARE = 0.1;
/** The risk-free rate the yield-forgone leg uses, per year. */
export const TBILL_RATE = 0.04;
/**
 * The active hours a 12-week farm plan takes: 15 minutes to set up, 10 minutes a week of
 * actions and 10 minutes a week of checks for 12 weeks, 10 minutes to claim and 5 minutes
 * to log, plus 5 minutes to open the fresh wallet.
 */
export const FARM_HOURS = 4.58;

/** One row's farm economics at a stated deposit, all from the row's own figures. */
export interface RowEconomics {
  deposit_usd: number;
  /** The airdrop slice if the token launches: deposit x implied/TVL x AIRDROP_SHARE. */
  slice_usd: number;
  /** Gas over the 12-week plan: setup plus one weekly action a week. */
  fees_usd: number;
  /** Yield forgone on the deposit at TBILL_RATE over the hold. */
  forgone_usd: number;
  /** slice - fees - forgone. */
  net_usd: number;
  /** Launch probability needed for the expected value to reach zero; null when the slice is zero. */
  breakeven: number | null;
  /** net_usd per active hour of the plan. */
  net_per_hour_usd: number;
  verdict: 'Worth farming' | 'Marginal' | 'Skip';
}

/** One live-token comparable for a row's detail view: what the curve says it is worth, against its market cap. */
export interface Comparable {
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  curve_usd: number;
  ratio: number;
}

/** Gas for one transaction on a chain, in whole dollars: the same rule gasNote states in words. */
export function gasUsd(chain: string): number {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return 5;
  if (c.includes('solana')) return 0.05;
  if (c.includes('base') || c.includes('arbitrum') || c.includes('optimism') || c.includes('polygon') || c.includes('blast') || c.includes('mode')) return 0.25;
  return 2;
}

/** A row's farm economics at one deposit, from the row's own figures and the stated assumptions above. */
export function econFor(
  p: SnapshotProtocol,
  implied: number,
  age: number | null,
  deposit: number = DEPOSIT_USD,
): RowEconomics {
  const slice = p.tvl_usd > 0 ? deposit * (implied / p.tvl_usd) * AIRDROP_SHARE : 0;
  const gas = gasUsd(chainOf(p));
  const fees = Math.round((gas + 12 * gas) * 100) / 100;
  const hold = holdDaysFor(age);
  const forgone = Math.round(deposit * TBILL_RATE * (hold / 365) * 100) / 100;
  const net = Math.round((slice - fees - forgone) * 100) / 100;
  const breakeven = slice > 0 ? Math.round(((fees + forgone) / slice) * 1000) / 1000 : null;
  const netPerHour = Math.round((net / FARM_HOURS) * 100) / 100;
  const verdict: RowEconomics['verdict'] =
    breakeven !== null && breakeven <= 0.25 && netPerHour >= 2 ? 'Worth farming' : net > 0 ? 'Marginal' : 'Skip';
  return { deposit_usd: deposit, slice_usd: Math.round(slice * 100) / 100, fees_usd: fees, forgone_usd: forgone, net_usd: net, breakeven, net_per_hour_usd: netPerHour, verdict };
}

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 260;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
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
    chain_multiplier: number;
    age_days: number | null;
  };
  confidence: number;
  thesis: string;
  profile: string;
  category_rank: number;
  category_size: number;
  signals: string[];
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
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
  chain_multiplier: number;
  confidence: number;
  thesis: string;
  profile: string;
  category_rank: number;
  category_size: number;
  signals: string[];
  economics: RowEconomics;
  comparables: Comparable[];
  /** The 12-week farm plan, as the model writes it to board.json — the dashboard reads it, it does not rebuild it. */
  farm_steps: string[];
  hold_days: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One category's comparable: the multiple the run used and how many live protocols back it. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  live_count: number;
  median_raw: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
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
  total_implied_usd: number;
  overall_multiple: number;
  category_multiples: CategoryMultiple[];
  watchlist: string[];
  rows: RadarRow[];
  live: LiveRow[];
  validation: ValidationStats;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list, or null. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The category multiples for one snapshot, calibrated from its live-token protocols.
 * Returns the overall median (the prior every category shrinks toward) and one entry per category
 * that has at least one live-token protocol with a market cap.
 */
export function calibrateMultiples(snapshot: Snapshot, model: ModelConstants): { overall: number; byCategory: Map<string, CategoryMultiple> } {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const overall = median(live.map((p) => p.mcap_usd! / p.tvl_usd)) ?? 0.25;
  const byCat = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const list = byCat.get(key) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    byCat.set(key, list);
  }
  const byCategory = new Map<string, CategoryMultiple>();
  for (const [category, ratios] of byCat) {
    const med = median(ratios) ?? overall;
    const shrunk = (ratios.length * med + model.prior_weight * overall) / (ratios.length + model.prior_weight);
    const multiple = Math.min(model.multiple_cap, Math.max(model.multiple_floor, shrunk));
    byCategory.set(category, { category, multiple: round4(multiple), live_count: ratios.length, median_raw: round4(med) });
  }
  return { overall: round4(overall), byCategory };
}

/** The multiple one protocol's category gets, or the overall median when its category has no live comparable. */
export function multipleFor(category: string | null, calibrated: { overall: number; byCategory: Map<string, CategoryMultiple> }): number {
  const entry = calibrated.byCategory.get(category ?? 'Other');
  return entry !== undefined ? entry.multiple : calibrated.overall;
}

/** The three multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  calibrated: { overall: number; byCategory: Map<string, CategoryMultiple> },
): { implied: number; catMultiple: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const catMultiple = multipleFor(protocol.category, calibrated);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainMult = 1 + model.chain_step * Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_max_extra);
  const base = protocol.tvl_usd * catMultiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult));
  return { implied, catMultiple, growthPct, growthMult, maturityMult, chainMult, age };
}

/** The model's own validation, computed from this snapshot alone — never hand-written. */
export interface ValidationStats {
  /** Live-token protocols scored in the leave-one-out test. */
  live_n: number;
  /** Median leave-one-out miss: median of max(pred/actual, actual/pred) over the live set. */
  loo_median_miss: number | null;
  /** Share of the live set the leave-one-out prediction lands within 3x of the market cap, in per cent. */
  loo_within3_pct: number | null;
  loo_within2_pct: number | null;
  /** The same two numbers for the flat baseline: TVL x the overall median multiple, no adjustments. */
  flat_median_miss: number | null;
  flat_within3_pct: number | null;
  /** The flat baseline recomputed leave-one-out, so it is compared like-for-like with the model. */
  flat_loo_median_miss: number | null;
  flat_loo_within3_pct: number | null;
  /** Live-token protocols in the walk-forward test set (listed after the cutoff). */
  wf_n: number;
  wf_median_miss: number | null;
  wf_within3_pct: number | null;
  /** The listed_at date that splits the walk-forward train set from its test set. */
  wf_cutoff: string | null;
  /** Scatter points, log10 TVL against log10 market cap, sampled to keep data.js small. */
  scatter_live: { x: number; y: number }[];
  /** Scatter points, log10 TVL against log10 implied value, sampled the same way. */
  scatter_pre: { x: number; y: number }[];
  /** The fitted curve in the same log10 space: y = log10(overall multiple) + x. */
  curve: { x0: number; y0: number; x1: number; y1: number };
}

/** The multiples calibrated from every live protocol except one slug. */
function calibrateWithout(snapshot: Snapshot, model: ModelConstants, exclude: string): { overall: number; byCategory: Map<string, CategoryMultiple> } {
  return calibrateMultiples({ ...snapshot, protocols: snapshot.protocols.filter((p) => p.slug !== exclude) }, model);
}

/** How far a prediction misses, as a factor: 1 is exact, 3 means three times too high or too low. */
function missFactor(pred: number, actual: number): number {
  return Math.max(pred / actual, actual / pred);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Validate the model against the snapshot's own live-token protocols: leave-one-out (each live
 * protocol predicted from a calibration that never saw it), a flat-multiple baseline for the same
 * set, and a walk-forward split (multiples calibrated on the earlier-listed half, tested on the
 * later half). All three are computed here, from this snapshot, at run time.
 */
export function validateModel(snapshot: Snapshot, model: ModelConstants, board: BoardRow[]): ValidationStats {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const calibrated = calibrateMultiples(snapshot, model);
  const looMiss: number[] = [];
  const flatMiss: number[] = [];
  const flatLooMiss: number[] = [];
  for (const p of live) {
    const cal = calibrateWithout(snapshot, model, p.slug);
    const pred = impliedValue(p, snapshot.as_of, model, cal).implied;
    looMiss.push(missFactor(pred, p.mcap_usd!));
    flatMiss.push(missFactor(p.tvl_usd * calibrated.overall, p.mcap_usd!));
    flatLooMiss.push(missFactor(p.tvl_usd * cal.overall, p.mcap_usd!));
  }
  const pctWithin = (misses: number[], k: number): number | null =>
    misses.length === 0 ? null : Math.round((misses.filter((m) => m <= k).length / misses.length) * 1000) / 10;
  const med = (xs: number[]): number | null => {
    const m = median(xs);
    return m === null ? null : round2(m);
  };
  // Walk-forward: the earlier-listed half calibrates, the later-listed half is the test.
  const dated = live.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : 0));
  let wfMiss: number[] = [];
  let wfCutoff: string | null = null;
  if (dated.length >= 20) {
    const half = Math.floor(dated.length / 2);
    const train = dated.slice(0, half);
    const test = dated.slice(half);
    wfCutoff = test[0]!.listed_at;
    const calTrain = calibrateMultiples({ ...snapshot, protocols: train }, model);
    wfMiss = test.map((p) => missFactor(impliedValue(p, snapshot.as_of, model, calTrain).implied, p.mcap_usd!));
  }
  // Scatter: live tokens at their market cap, pre-token rows at their implied value, sampled.
  const log10 = (n: number): number => Math.log10(n);
  const stride = (n: number, max: number): number => (n <= max ? 1 : Math.ceil(n / max));
  const liveStep = stride(live.length, 120);
  const scatterLive = live
    .filter((_, i) => i % liveStep === 0)
    .map((p) => ({ x: round2(log10(p.tvl_usd)), y: round2(log10(p.mcap_usd!)) }));
  const preStep = stride(board.length, 60);
  const scatterPre = board
    .filter((_, i) => i % preStep === 0)
    .map((r) => ({ x: round2(log10(r.tvl_usd)), y: round2(log10(r.implied_value_usd)) }));
  const allX = [...scatterLive, ...scatterPre].map((pt) => pt.x);
  const x0 = Math.min(...allX);
  const x1 = Math.max(...allX);
  const logOverall = log10(calibrated.overall);
  return {
    live_n: live.length,
    loo_median_miss: med(looMiss),
    loo_within3_pct: pctWithin(looMiss, 3),
    loo_within2_pct: pctWithin(looMiss, 2),
    flat_median_miss: med(flatMiss),
    flat_within3_pct: pctWithin(flatMiss, 3),
    flat_loo_median_miss: med(flatLooMiss),
    flat_loo_within3_pct: pctWithin(flatLooMiss, 3),
    wf_n: wfMiss.length,
    wf_median_miss: med(wfMiss),
    wf_within3_pct: pctWithin(wfMiss, 3),
    wf_cutoff: wfCutoff,
    scatter_live: scatterLive,
    scatter_pre: scatterPre,
    curve: { x0: round2(x0), y0: round2(logOverall + x0), x1: round2(x1), y1: round2(logOverall + x1) },
  };
}

/** The four live-token comparables nearest a row by TVL, same category first. */
export function comparablesFor(
  row: BoardRow,
  live: LiveRow[],
  calibrated: { overall: number; byCategory: Map<string, CategoryMultiple> },
): Comparable[] {
  const near = (a: LiveRow, b: LiveRow): number =>
    Math.abs(Math.log10(a.tvl_usd) - Math.log10(row.tvl_usd)) - Math.abs(Math.log10(b.tvl_usd) - Math.log10(row.tvl_usd));
  const sameCat = live.filter((p) => p.category === row.category).sort(near);
  const others = live.filter((p) => p.category !== row.category).sort(near);
  return [...sameCat, ...others].slice(0, 4).map((p) => {
    const curve = Math.max(1, Math.round(p.tvl_usd * multipleFor(p.category, calibrated)));
    return {
      name: p.name,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd ?? 0,
      curve_usd: curve,
      ratio: Math.round(((p.mcap_usd ?? 0) / curve) * 100) / 100,
    };
  });
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** The watchlist rule's excluded categories: a wrapped, staked or bridged product of a token that trades. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** A whole word wrapped, staked or staking in a name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** A name beginning with an exchange's name. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked or bridged
 * product of a token that already trades — the watchlist's own rule, without the size floor.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !EXCLUDED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** A short dollar figure: $2.75B, $870.3M, $51.0M, $470.9K. */
export function fmtShort(n: number): string {
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

/** An age in words: 1.5y, 45d. */
function fmtAgeWords(days: number): string {
  if (days >= 365) return `${(days / 365).toFixed(1)}y`;
  return `${Math.max(0, Math.round(days))}d`;
}

/**
 * How much to trust one row, 1 to 100: 15 for being on the board at all, up to 55 for a complete
 * record (age, seven-day growth, chains, category all on file) and up to 30 for how many live
 * comparables back its category's multiple, less 6 when the clamp holds that multiple back.
 */
export function confidenceFor(
  p: SnapshotProtocol,
  age: number | null,
  entry: CategoryMultiple | undefined,
  model: ModelConstants,
): number {
  let score = 15;
  if (age !== null) score += 20;
  if (p.change_7d !== null) score += 15;
  if (p.chains.length > 0) score += 10;
  if (p.category !== null) score += 10;
  const n = entry === undefined ? 0 : entry.live_count;
  score += n >= 8 ? 30 : n >= 4 ? 24 : n >= 2 ? 16 : n === 1 ? 10 : 6;
  if (entry !== undefined && (entry.multiple >= model.multiple_cap || entry.multiple <= model.multiple_floor)) score -= 6;
  return Math.max(1, Math.min(100, score));
}

/** What one category of protocol does, in one line: the detail view's "what it is". */
const CATEGORY_PROFILE: Record<string, string> = {
  'Risk Curators': 'Risk curators run vaults that allocate depositor capital across lending markets and strategies, and earn fees on what they manage.',
  'Onchain Capital Allocator': 'Onchain capital allocators move depositor funds between vaults and strategies to chase yield, and take a cut of what they place.',
  Dexs: 'A decentralised exchange: traders swap against its pools, and liquidity providers earn the fees.',
  Lending: 'A lending market: depositors supply assets, borrowers pay interest against collateral, and the spread is the business.',
  CDP: 'A collateralised-debt protocol: users lock collateral and mint a stable asset against it.',
  RWA: 'A real-world-asset protocol: it puts off-chain yield — treasuries, credit, property — on chain as a token.',
  Derivatives: 'A derivatives venue: traders take leveraged or hedged exposure without holding the underlying.',
  Yield: 'A yield protocol: it routes deposits into strategies that pay a return.',
  'Yield Aggregator': 'A yield aggregator: it finds the best return across vaults and strategies and compounds it for depositors.',
  'Basis Trading': 'A basis-trading protocol: it earns the spread between spot and futures prices.',
  'Leveraged Farming': 'A leveraged-farming protocol: it borrows to multiply a farming position, and the yield pays the borrow.',
  'Liquidity Manager': 'A liquidity manager: it places and rebalances concentrated liquidity so depositors earn fees without managing ranges.',
  'Uncollateralized Lending': 'An uncollateralised lender: it lends against reputation or off-chain agreements rather than locked collateral.',
  'Staking Pool': 'A staking pool: it gathers stake, runs validators, and shares the rewards.',
  Restaking: 'A restaking protocol: it lets staked assets secure more than one network at once.',
  Chain: 'A chain-level protocol: its value sits in the network itself rather than one application on it.',
  'Anchor BTC': 'An anchored-BTC protocol: it holds bitcoin and issues a representation of it on another chain.',
  'Decentralized BTC': 'A decentralised-BTC protocol: it brings bitcoin into DeFi without a single custodian.',
  'Interest Rate Derivatives': 'An interest-rate-derivatives protocol: it lets users trade fixed against floating yield.',
  CeDeFi: 'A CeDeFi protocol: it runs centralised trading strategies with on-chain deposits and accounting.',
  Insurance: 'An insurance protocol: it sells cover against hacks and failures, and pays claims from a shared pool.',
  'Dual-Token Stablecoin': 'A dual-token stablecoin: one token holds the peg while the other absorbs the volatility.',
  Farm: 'A farm: it pays depositors in yield for supplying liquidity or stake.',
  Payments: 'A payments protocol: it moves value between users and merchants on chain.',
  'Governance Incentives': 'A governance-incentives protocol: it pays voters and lockers to steer emissions.',
  'Crypto Card Issuer': 'A crypto card issuer: it lets users spend on-chain balances through a card.',
  'Prediction Market': 'A prediction market: users trade shares on the outcome of an event.',
  'Stablecoin Wrapper': 'A stablecoin wrapper: it takes a stable asset and issues a yield-bearing or composable version of it.',
  Indexes: 'An index protocol: one token tracks a basket of assets instead of a single one.',
  'Collateral Markets': 'A collateral market: it lets one asset back borrowing, staking and other positions at once.',
};

/** What a protocol is: its category's one line, then where it runs and how long it has run. */
export function profileFor(p: SnapshotProtocol, age: number | null): string {
  const parts = [CATEGORY_PROFILE[p.category ?? ''] ?? `A ${p.category ?? 'protocol'} holding ${fmtShort(p.tvl_usd)} of value.`];
  if (p.chains.length > 0) parts.push(`It runs on ${p.chains.join(', ')}.`);
  if (age !== null) parts.push(`DefiLlama has tracked it for ${fmtAgeWords(age)}.`);
  return parts.join(' ');
}

/** Why the row's implied value is what it is, from the row's own figures. */
export function thesisFor(
  p: SnapshotProtocol,
  v: { implied: number; catMultiple: number; growthPct: number; age: number | null },
  catRank: number,
  catSize: number,
  overall: number,
): string {
  const cat = p.category ?? 'protocol';
  const vs =
    v.catMultiple > overall * 1.2
      ? `above the board's overall ${round4(overall)}x`
      : v.catMultiple < overall * 0.8
        ? `below the board's overall ${round4(overall)}x`
        : `near the board's overall ${round4(overall)}x`;
  let t =
    `${p.name} is the #${catRank} pre-token ${cat} by implied value of ${catSize} in its category, ` +
    `holding ${fmtShort(p.tvl_usd)} across ${p.chains.length} chain${p.chains.length === 1 ? '' : 's'}. ` +
    `${cat} tokens trade at ${v.catMultiple.toFixed(3)}x TVL on this snapshot's live comparables, ${vs}, ` +
    `so a launch at its own category's multiple prices the token near ${fmtShort(v.implied)}.`;
  if (v.growthPct >= 5) t += ` TVL is up ${v.growthPct.toFixed(1)}% in seven days, so the window is opening now.`;
  else if (v.growthPct <= -5) t += ` TVL is down ${Math.abs(v.growthPct).toFixed(1)}% in seven days, so the case rests on the stock of TVL, not the flow.`;
  else t += ` TVL is flat over seven days.`;
  if (v.age !== null && v.age >= 730) t += ` It has run ${fmtAgeWords(v.age)} with no token on record, one of the longest-running pre-token protocols.`;
  return t;
}

/** The short facts the thesis rests on, for the detail view's signal chips. */
export function signalsFor(
  p: SnapshotProtocol,
  v: { growthPct: number; age: number | null },
  catRank: number,
  catSize: number,
  entry: CategoryMultiple | undefined,
): string[] {
  const s: string[] = [`#${catRank} of ${catSize} in ${p.category ?? 'its category'}`];
  if (v.growthPct >= 5) s.push(`TVL +${v.growthPct.toFixed(1)}% in 7d`);
  else if (v.growthPct <= -5) s.push(`TVL ${v.growthPct.toFixed(1)}% in 7d`);
  if (v.age !== null && v.age >= 365) s.push(`${fmtAgeWords(v.age)} with no token`);
  else if (v.age !== null) s.push(`${v.age}d with no token`);
  if (p.chains.length >= 5) s.push(`on ${p.chains.length} chains`);
  if (entry !== undefined && entry.live_count >= 5) s.push(`${entry.live_count} live comparables back the multiple`);
  return s.slice(0, 4);
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const calibrated = calibrateMultiples(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a
  // replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model, calibrated);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  // A row's rank inside its own category, by implied value. `scored` is already strongest-first,
  // so a running count per category is the rank.
  const catCount = new Map<string, number>();
  const catRank = new Map<string, number>();
  const catSize = new Map<string, number>();
  for (const s of scored) {
    const key = s.p.category ?? 'Other';
    catSize.set(key, (catSize.get(key) ?? 0) + 1);
    const n = (catCount.get(key) ?? 0) + 1;
    catCount.set(key, n);
    catRank.set(s.p.slug, n);
  }
  return scored.map((s, i) => {
    const entry = calibrated.byCategory.get(s.p.category ?? 'Other');
    const rankInCat = catRank.get(s.p.slug) ?? 1;
    const sizeInCat = catSize.get(s.p.category ?? 'Other') ?? 1;
    return {
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
        category_multiple: round4(s.catMultiple),
        growth_pct: s.growthPct,
        growth_multiplier: round4(s.growthMult),
        maturity_multiplier: round4(s.maturityMult),
        chain_multiplier: round4(s.chainMult),
        age_days: s.age,
      },
      confidence: confidenceFor(s.p, s.age, entry, model),
      thesis: thesisFor(s.p, s, rankInCat, sizeInCat, calibrated.overall),
      profile: profileFor(s.p, s.age),
      category_rank: rankInCat,
      category_size: sizeInCat,
      signals: signalsFor(s.p, s, rankInCat, sizeInCat, entry),
      farm_steps: farmSteps(s.p, s.age).map(stepText),
    };
  });
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
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

/** How much capital one farm position needs: the flat $1,000 deposit the board's economics use. */
function capitalFor(_p: SnapshotProtocol): number {
  return DEPOSIT_USD;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Gas for one transaction on the protocol's main chain: L2s are cents, Ethereum is dollars. */
function gasNote(chain: string): string {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return 'about $3-8 of gas on Ethereum mainnet';
  if (c.includes('solana')) return 'under $0.10 of fees on Solana';
  if (c.includes('base') || c.includes('arbitrum') || c.includes('optimism') || c.includes('polygon') || c.includes('blast') || c.includes('mode')) {
    return 'under $0.50 of gas on this L2';
  }
  return 'about $1-3 of gas on this chain';
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and borrow a small amount against it to show both sides of the market.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open through at least one fee cycle.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app instead of bridging straight back.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position, then close it after a week.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}, then settle it instead of leaving it open.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares so the vault's own accounting credits your wallet.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it for the full qualifying window.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it; the yield itself is the on-chain receipt.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the whole window.`;
  if (c.includes('launchpad')) return `Stake $${capital} into ${name}'s launch allocation on ${chain} and join one sale or allocation round.`;
  if (c.includes('ai') || c.includes('agent')) return `Deposit $${capital} into ${name} on ${chain} and run one agent task or inference so the wallet shows real usage.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The weekly action, in the category's own terms: a DEX farmer swaps, a lender rebalances. */
function weeklyActionFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('liquidity manager')) {
    return 'Swap or rebalance once a week, so the wallet shows steady use rather than one burst.';
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return 'Adjust your supply or borrow once a week, so the wallet shows steady use rather than one burst.';
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) {
    return 'Check the vault allocation once a week and top up or rebalance a little, so the wallet shows steady use rather than one burst.';
  }
  if (c.includes('rwa')) return 'Check the yield accrual once a week and add a small top-up, so the wallet shows steady use rather than one burst.';
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options') || c.includes('basis')) {
    return 'Open and close one small hedged position each week, so the wallet shows steady use rather than one burst.';
  }
  if (c.includes('prediction')) return 'Settle one market position each week, so the wallet shows steady use rather than one burst.';
  if (c.includes('staking') || c.includes('restak')) {
    return 'Check the staking rewards once a week and compound or top up a little, so the wallet shows steady use rather than one burst.';
  }
  if (c.includes('stable')) return 'Move a little of the stable asset through the protocol once a week, so the wallet shows steady use rather than one burst.';
  return 'Make one qualifying action each week, such as a deposit, a swap or a vote, so the wallet shows steady use rather than one burst.';
}

/** The weekly check, in the category's own terms: a vault has a points page, a pool has a rewards page. */
function checkFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) {
    return `Check ${p.name}'s vault points page once a week and finish any free task it lists, such as a social task or an allocation quest.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('liquidity manager')) {
    return `Check ${p.name}'s pool rewards and points page once a week and finish any free task it lists, such as a social task or a fee milestone.`;
  }
  if (c.includes('rwa')) {
    return `Check ${p.name}'s yield and points page once a week and finish any free task it lists, such as a social task or a holding milestone.`;
  }
  return `Check ${p.name}'s own points, quests or rewards page once a week and finish any free task it lists, such as a social task or a testnet action.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age, seven-day growth), never from a
 * hand-written list of names: the action, the weekly rhythm, the check and the hold all change with
 * the category, the chain and the trend.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasNote(chain);
  const growth = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, finite(p.change_7d, 0)));
  const trend =
    growth >= 10
      ? ` TVL is up ${growth.toFixed(1)}% in seven days, so enter now and hold through the window.`
      : growth <= -10
        ? ` TVL is down ${Math.abs(growth).toFixed(1)}% in seven days, so size in gradually and hold through the window.`
        : '';
  const secondChain = p.chains.length > 1 ? ` Repeat the same position on ${p.chains[1]} so both deployments credit the wallet.` : '';
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper, never in a screenshot.`,
      cost: gas + ' for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain) + secondChain,
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyActionFor(p),
      cost: gas + ' a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot window.${trend}`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: checkFor(p),
      cost: 'no fee for the check itself',
      time: '10 minutes a week',
    },
    {
      text: `Before you withdraw, open the protocol's own points page and claim only from the link it publishes; never pay a fee to claim and never sign a blind approval.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log so you can repeat the position or unwind it without guessing.`,
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

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow, comparables: Comparable[]): RadarRow {
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
    chain_multiplier: row.model.chain_multiplier,
    confidence: row.confidence,
    thesis: row.thesis,
    profile: row.profile,
    category_rank: row.category_rank,
    category_size: row.category_size,
    signals: row.signals,
    economics: econFor(row, row.implied_value_usd, row.age_days),
    comparables,
    farm_steps: farmSteps(row, row.age_days).map(stepText),
    hold_days: holdDaysFor(row.age_days),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const calibrated = calibrateMultiples(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const categoryMultiples = [...calibrated.byCategory.values()].sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : 1));
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
    total_implied_usd: board.reduce((n, r) => n + r.implied_value_usd, 0),
    overall_multiple: calibrated.overall,
    category_multiples: categoryMultiples,
    watchlist: snapshot.watchlist,
    rows: board.map((r) => radarRow(r, comparablesFor(r, live, calibrated))),
    live,
    validation: validateModel(snapshot, model, board),
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

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
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

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
