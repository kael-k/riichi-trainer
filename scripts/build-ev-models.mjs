// Builds src/core/hououPrior.ts — the empirical wait-shape prior the deal-in model reads —
// from chienshyong/houou-statistics at a pinned commit.
//
//   node scripts/build-ev-models.mjs          (npm run build-ev-models)
//   node scripts/build-ev-models.mjs --dir D  read the CSVs from D instead of fetching
//
// The generated file is committed, so this only needs to run when the pin moves.
//
// WHY THE CSVs AND NOT THE LOG DATABASE. Upstream's pipeline is `data/es4p.db` (the merged
// 2016-2020 Tenhou houou logs — five per-year files on Google Drive, ~8 GB, 1.6 GB for 2016
// alone) -> `app.py` runs one analyzer from `/analyzers/` -> aggregates printed into
// `/results/*.csv`. The CSVs are therefore the finished measurement, and re-running the Python
// over the database would reproduce numbers already committed upstream. The database is only
// worth fetching for work that needs the raw logs — backtesting our own model against real
// decision points (plans/EV-5 §2.13) — which is a session of its own, not a build step.
//
// LICENCE. The CSVs are measured facts, not copyrightable expression; upstream states it is
// forked from Euophrys/houou-analysis, which carries an MIT LICENSE; no code is copied here, only
// aggregate numbers. The generated file carries both repositories, the pinned commit and the
// retrieval date.
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = 'chienshyong/houou-statistics'
const COMMIT = '80dc535dc7eab1a0faf18a2fbcfe72db2067976a'
const COMMIT_DATE = '2023-11-25'
const UPSTREAM = 'Euophrys/houou-analysis'
const CSV = 'results/WaitDistribution.csv'
const CALIBRATION_CSV = 'results/DorasobaDanger.csv'
const FOLD_CSV = 'results/BetaoirCost.csv'
const SCORE_CSV = 'results/HandScore.csv'
const VARIANCE_CSV = 'results/Variance.csv'

/** Turn axis of `BetaoirCost.csv`, which samples every second turn. */
const FOLD_TURNS = [4, 6, 8, 10, 12, 14, 16, 18]
/** The matchups the fold table carries, `me vs each threat`, D = dealer. Every one of them is a
 *  column of the riichi frame; the calls frame (nobody in riichi) is not extracted, since a
 *  `ThreatView` is only ever built for a declared seat. */
const FOLD_MATCHUPS = [
  'D vs ND',
  'ND vs ND',
  'ND vs D',
  'D vs ND ND',
  'ND vs ND ND',
  'ND vs D ND',
  'D vs ND ND ND',
  'ND vs D ND ND',
]

/** Rounds of a four-player hanchan, in the order `Variance.csv` indexes them: East 1-4, South 1-4. */
const VARIANCE_ROUNDS = 8

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'core', 'hououPrior.ts')

const SIMPLE_SHAPES = ['sanmenchan', 'ryanmen', 'penchan', 'kanchan', 'tanki']
/** Bucket keys in the shanpon frame, in the order the emitted matrix indexes them: 0 = honours. */
const KEYS = ['honor', '1', '2', '3', '4', '5', '6', '7', '8', '9']

const dirArg = process.argv.indexOf('--dir')
const localDir = dirArg > -1 ? process.argv[dirArg + 1] : null

async function read(path) {
  if (localDir) return readFileSync(join(localDir, path.split('/').pop()), 'utf8')
  const url = `https://raw.githubusercontent.com/${REPO}/${COMMIT}/${path}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`)
  return res.text()
}

/**
 * `WaitDistribution.csv` is four pandas frames appended to one file, then five scalar lines.
 * A frame starts with a header row whose first cell is empty; every row after it until the next
 * such header (or the first scalar line) is data. Trailing empty columns are pandas padding.
 */
function parseFrames(text) {
  const frames = []
  const scalars = {}
  let current = null
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const cells = line.split(',')
    while (cells.length && cells[cells.length - 1] === '') cells.pop()
    if (cells.length === 0) continue
    if (cells[0] === '') {
      current = { columns: cells.slice(1), rows: new Map() }
      frames.push(current)
      continue
    }
    // a scalar line is `label,value` where the label is neither a rank nor an honour bucket
    if (cells.length === 2 && Number.isNaN(Number(cells[0])) && !cells[0].startsWith('honor')) {
      scalars[cells[0]] = Number(cells[1])
      current = null
      continue
    }
    if (!current) throw new Error(`data row outside any frame: ${line}`)
    current.rows.set(cells[0], cells.slice(1).map(Number))
  }
  return { frames, scalars }
}

/** `frame[row][column]`, with both names checked rather than trusting a position. */
function cell(frame, row, column) {
  const values = frame.rows.get(row)
  if (!values) throw new Error(`no row ${row}`)
  const index = frame.columns.indexOf(column)
  if (index < 0) throw new Error(`no column ${column}`)
  return values[index]
}

/**
 * `BetaoirCost.csv` and `HandScore.csv` are pandas frames appended to one file with a real index
 * label (`callturn`, `turndealer`) rather than the empty first cell `WaitDistribution.csv` uses, so
 * they need their own split: a line whose first cell is not a number starts a frame.
 *
 * Values may be blank where upstream divided by a zero count; they come back as `null` rather than
 * `NaN` so the emitted table can say "not measured here" and the model can fall back.
 */
function parseIndexedFrames(text) {
  const frames = []
  let current = null
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const cells = line.split(',')
    while (cells.length && cells[cells.length - 1] === '') cells.pop()
    if (cells.length === 0) continue
    if (Number.isNaN(Number(cells[0]))) {
      current = { label: cells[0], columns: cells.slice(1), rows: new Map() }
      frames.push(current)
      continue
    }
    if (!current) throw new Error(`data row outside any frame: ${line}`)
    current.rows.set(
      cells[0],
      cells.slice(1).map((cell) => (cell === '' ? null : Number(cell))),
    )
  }
  return frames
}

/** One column of an indexed frame, down a stated row axis. `null` stays `null`. */
function column(frame, rows, name) {
  const index = frame.columns.indexOf(name)
  if (index < 0) throw new Error(`no column ${name} in frame ${frame.label}`)
  return rows.map((row) => {
    const values = frame.rows.get(String(row))
    if (!values) throw new Error(`no row ${row} in frame ${frame.label}`)
    return values[index] ?? null
  })
}

/**
 * What giving up on a hand costs, per turn, per matchup — `analyzers/betaori_cost.py` over the
 * same database.
 *
 * **Units are pinned here** (plans/EV-3 §5 asks for exactly that): the analyzer sums Tenhou's `sc`
 * score deltas, which are in HUNDREDS of points, so a raw -19.5 is -1950 points.
 *
 * **What it measures, and what it does not.** The sample is every seat that neither won nor dealt
 * in, and on an exhaustive draw only the noten ones — so this is the cost of *not winning and
 * being noten*: opponents' tsumo payments plus the noten penalty. **Deal-ins are excluded by
 * construction**, which makes it exactly the complement of the deal-in term rather than a whole
 * fold price: `EV(fold)` is this plus `P(deal in while folding) × value_j`, never this alone.
 */
function foldCost(values, counts) {
  const cost = {}
  const samples = {}
  for (const matchup of FOLD_MATCHUPS) {
    cost[matchup] = column(values, FOLD_TURNS, matchup).map((v) =>
      v === null ? null : Math.round(v * 100),
    )
    samples[matchup] = column(counts, FOLD_TURNS, matchup).map((v) => v ?? 0)
  }
  return { cost, samples }
}

/**
 * What a riichi hand pays, per turn of declaration, from `analyzers/hand_score.py`. Points as
 * scored — riichi and honba sticks excluded upstream, yakuman excluded upstream, ura and dora
 * included because these are real wins off real logs.
 *
 * `ron` is the deal-in cost `plans/EV-3` §4 calls `value_j`, conditioned the way §4's option 2 asks
 * for: by the threat's dealership and by the turn they declared. `tsumo` is the winner's whole
 * take, before the three-way split — what the payer owes is the model's arithmetic, not the table's.
 */
function handScore(values, counts) {
  const turns = Array.from({ length: 19 }, (_, i) => i)
  const round = (v) => (v === null ? null : Math.round(v))
  return {
    ron: column(values, turns, 'riichi ron').map(round),
    tsumo: column(values, turns, 'riichi tsumo').map(round),
    ronSamples: column(counts, turns, 'riichi ron').map((v) => v ?? 0),
    tsumoSamples: column(counts, turns, 'riichi tsumo').map((v) => v ?? 0),
    damaRon: column(values, turns, 'dama ron').map(round),
    damaRonSamples: column(counts, turns, 'dama ron').map((v) => v ?? 0),
  }
}

/**
 * One prior, from a simple-wait frame and its shanpon companion. Counts stay as measured —
 * aggregated over the three numbered suits (or the seven honour kinds) — and `dealIn.ts` divides
 * a bucket by the number of hypotheses sharing it. Confirmed against
 * `analyzers/wait_distribution.py`, 2026-08-27:
 *
 *  - every shape is indexed by the LOWEST tile it waits on, so ryanmen is nonzero only at ranks
 *    1-6, sanmenchan only at 1-3, penchan only at 3 and 7, kanchan at 2-8;
 *  - the ryanmen/shanpon split is an ukeire threshold (`uke >= 5` counts as ryanmen), not a shape
 *    test, so a true ryanmen with four or more copies already visible lands in the shanpon frame;
 *  - honour tanki is bucketed `honor` / `honor 1` / `honor 2` by copies visible across ALL FOUR
 *    rivers, so that row already integrates a visibility signal the model then applies again;
 *  - shanpon is a wait-PAIR matrix and is kept as one. Marginalising it to a per-rank column
 *    cannot be right: a shanpon waits on two kinds, and one-wait hypotheses summing to the same
 *    mass reproduce the file's wait width as 1.61 kinds instead of 1.78. The matrix is upper
 *    triangular, and its diagonal is not a self-pair — (5, 5) means both waits fell in rank
 *    bucket 5, e.g. 5m and 5p.
 */
function buildPrior(simple, shanpon) {
  const weights = {}
  for (const shape of SIMPLE_SHAPES) {
    // index 0 is honours, and no simple shape but tanki can wait on one
    weights[shape] = [0, ...KEYS.slice(1).map((rank) => cell(simple, rank, shape))]
  }
  // honour tanki is split across three visibility buckets upstream; the model has no such split
  weights.tanki[0] =
    cell(simple, 'honor', 'tanki') +
    cell(simple, 'honor 1', 'tanki') +
    cell(simple, 'honor 2', 'tanki')

  // fold the frame onto the upper triangle of our own key order, reading both halves so that a
  // symmetric dump would not be counted twice and the diagonal is read exactly once
  const pairs = KEYS.map(() => KEYS.map(() => 0))
  for (let i = 0; i < KEYS.length; i++) {
    for (let j = i; j < KEYS.length; j++) {
      pairs[i][j] = cell(shanpon, KEYS[i], KEYS[j])
      if (j !== i) pairs[i][j] += cell(shanpon, KEYS[j], KEYS[i])
    }
  }
  return { weights, shanpon: pairs }
}

/**
 * How often a riichi waits on SOME tile of each rank, 1-9, from a different analyzer over the same
 * database — `dora_danger.py` classifies every rank against every riichi wait, and its `none` row
 * is the complement. Denominator is one riichi hand, and the three numbered suits are collapsed by
 * "any", so a specific tile of that rank is very nearly a third of it (two suits waited at one rank
 * is rare).
 *
 * This is the calibration target `dealIn.test.ts` checks the model against, and it is worth having
 * because it is INDEPENDENT: the model's prior comes from wait *shape* counts, and this is a direct
 * per-tile measurement. The two agreeing is evidence the enumeration and the per-bucket division
 * are right, in a way that no self-consistency check could be.
 *
 * The honour columns (`honor fresh` / `honor 1 out` / `honor 2 out` / `z`) overlap in a way the
 * analyzer does not document, so only the numbered ranks are extracted.
 */
function waitByRank(text) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => line.startsWith('Riichi wait,'))
  if (start < 0) throw new Error('no "Riichi wait" block')
  const columns = lines[start].split(',').slice(1)
  const rows = []
  for (let i = start + 1; i < lines.length; i++) {
    if (!lines[i].trim() || lines[i].startsWith('Open wait,')) break
    rows.push(lines[i].split(','))
  }
  return Array.from({ length: 10 }, (_, rank) => {
    if (rank === 0) return 0
    const column = columns.indexOf(String(rank)) + 1
    if (column === 0) throw new Error(`no column ${rank}`)
    let waits = 0
    let none = 0
    for (const row of rows) {
      if (row[0] === 'none') none += Number(row[column])
      else waits += Number(row[column])
    }
    return waits / (waits + none)
  })
}

/** Hands counted and wait kinds counted; their ratio is the expected wait width in kinds, which
 *  `dealIn.test.ts` reproduces from the model side. That check is what catches the plans/EV-2 §8
 *  double-counting error. */
function totals({ weights, shanpon }) {
  const kinds = { sanmenchan: 3, ryanmen: 2, penchan: 1, kanchan: 1, tanki: 1 }
  let hands = 0
  let waitKinds = 0
  for (const [shape, counts] of Object.entries(weights)) {
    const sum = counts.reduce((a, b) => a + b, 0)
    hands += sum
    waitKinds += sum * kinds[shape]
  }
  const shanponHands = shanpon.flat().reduce((a, b) => a + b, 0)
  return {
    hands: hands + shanponHands,
    waitKinds: waitKinds + shanponHands * 2,
    get width() {
      return this.waitKinds / this.hands
    },
  }
}

const indent = (depth) => ' '.repeat(depth)

function literal({ weights, shanpon }, depth) {
  const rows = SIMPLE_SHAPES.map(
    (shape) => `${indent(depth + 2)}${shape}: [${weights[shape].join(', ')}],`,
  ).join('\n')
  const matrix = shanpon.map((row) => `${indent(depth + 2)}[${row.join(', ')}],`).join('\n')
  return `${indent(depth)}weights: {
${rows}
${indent(depth)}},
${indent(depth)}shanpon: [
${matrix}
${indent(depth)}],`
}

/**
 * `Variance.csv` is a plain header-and-rows frame: `Round,Position,Mean,Stddev`, where the moments
 * are of the *remaining* swing — final score minus the score right now — measured in Tenhou score
 * deltas (hundreds of points), the same unit `BetaoirCost.csv` uses. `Position` carries the four
 * current ranks alongside several Ahead/Behind buckets and an `All` row; only the ranks are taken,
 * since that is the axis a placement-odds function indexes by.
 */
function variance(text) {
  const mean = [[], [], [], []]
  const stddev = [[], [], [], []]
  for (const line of text.trim().split(/\r?\n/).slice(1)) {
    const [round, position, m, sd] = line.split(',')
    const rank = Number(position)
    if (!Number.isInteger(rank) || rank < 1 || rank > 4) continue
    mean[rank - 1][Number(round)] = Math.round(Number(m) * 100)
    stddev[rank - 1][Number(round)] = Math.round(Number(sd) * 100)
  }
  for (const rank of mean.concat(stddev)) {
    if (rank.length !== VARIANCE_ROUNDS || rank.some((v) => !Number.isFinite(v))) {
      throw new Error(
        `${VARIANCE_CSV}: expected ${VARIANCE_ROUNDS} rounds per rank, got ${rank.length}`,
      )
    }
  }
  return { mean, stddev }
}

const swing = variance(await read(VARIANCE_CSV))

const text = await read(CSV)
const byRank = waitByRank(await read(CALIBRATION_CSV))

const foldFrames = parseIndexedFrames(await read(FOLD_CSV))
// four frames: the calls case and its counts, then the riichi case and its counts
if (foldFrames.length !== 4)
  throw new Error(`${FOLD_CSV}: expected 4 frames, got ${foldFrames.length}`)
const [, , foldValues, foldCounts] = foldFrames
if (foldValues.label !== 'riichiturn')
  throw new Error(`${FOLD_CSV}: frame 3 is ${foldValues.label}`)
const fold = foldCost(foldValues, foldCounts)

const scoreFrames = parseIndexedFrames(await read(SCORE_CSV))
const [dealerScores, dealerCounts, nonDealerScores, nonDealerCounts] = scoreFrames
if (dealerScores.label !== 'turndealer' || nonDealerScores.label !== 'turnnondealer') {
  throw new Error(
    `${SCORE_CSV}: frames are ${scoreFrames
      .slice(0, 4)
      .map((f) => f.label)
      .join(', ')}`,
  )
}
const dealerScore = handScore(dealerScores, dealerCounts)
const nonDealerScore = handScore(nonDealerScores, nonDealerCounts)
const { frames, scalars } = parseFrames(text)
if (frames.length !== 4) throw new Error(`expected 4 frames, got ${frames.length}`)
const [riichiSimple, riichiShanpon, openSimple, openShanpon] = frames

const riichi = buildPrior(riichiSimple, riichiShanpon)
const open = buildPrior(openSimple, openShanpon)
const riichiTotals = totals(riichi)

// the file's own arithmetic, as a guard that the four frames were read in the right order
if (riichiTotals.hands + scalars['Complex waits'] !== scalars['Total riichi']) {
  throw new Error(
    `riichi frames tally ${riichiTotals.hands} + ${scalars['Complex waits']} complex, ` +
      `but the file reports ${scalars['Total riichi']}`,
  )
}

const n = (value) => value.toLocaleString('en-US')
/** A TS array literal, `null` where upstream divided by a zero count. */
const arr = (values) => `[${values.map((v) => (v === null ? 'null' : v)).join(', ')}]`
const matchups = (table, depth) =>
  FOLD_MATCHUPS.map((m) => `${indent(depth)}'${m}': ${arr(table[m])},`).join('\n')

writeFileSync(
  OUT,
  `// GENERATED by scripts/build-ev-models.mjs — do not edit by hand.
//
// The measured half of the houou EV model: wait-shape counts for a seat that has declared riichi,
// what giving up on a hand costs, and what a riichi hand pays — all over Tenhou houou four-player
// hanchan logs.
//
//   source   https://github.com/${REPO}/blob/${COMMIT}/${CSV}
//            https://github.com/${REPO}/blob/${COMMIT}/${FOLD_CSV}
//            https://github.com/${REPO}/blob/${COMMIT}/${SCORE_CSV}
//            https://github.com/${REPO}/blob/${COMMIT}/${VARIANCE_CSV}
//   commit   ${COMMIT} (${COMMIT_DATE})
//   upstream forked from https://github.com/${UPSTREAM} (MIT). No code is copied here, only
//            aggregate counts, which are measured facts rather than expression.
//   fetched  ${new Date().toISOString().slice(0, 10)}
//
// The sample is ${n(scalars['Total riichi'])} riichi tenpai hands (${n(scalars['Total open'])} open), NOT the full
// 893,440-game database: upstream's \`rowcount\` caps how many logs an analyzer reads.
// ${n(scalars['Complex waits'])} riichi hands held a wait too complex for the analyzer to enumerate and are
// absent from these tables — kokushi is one of them, which is why its prior is a stated constant
// in \`dealIn.ts\` rather than a figure here.
//
// Index 0 is honours and 1-9 are ranks within a numbered suit. Counts are aggregated across the
// three numbered suits (or the seven honour kinds), so \`dealIn.ts\` divides a bucket by the number
// of hypotheses sharing it. Every shape is indexed by the lowest tile it waits on; the extraction
// script records the three caveats that convention carries.
import type { ShapePrior } from './dealIn'

/** The block \`dealInRisk\` reads: the model only ever speaks about a seat that has declared. */
export const HOUOU_PRIOR: ShapePrior = {
  name: 'houou',
  kind: 'measured',
${literal(riichi, 2)}
}

/** Open tenpai, whose shape mix is materially different — far more kanchan and shanpon, far fewer
 *  ryanmen. Nothing reads it yet: \`ThreatView\` does not say whether a seat has melded, and the
 *  model refuses to speak about undeclared seats at all (plans/EV-2 §2). Extracted because the
 *  same parse produces it, and because using the riichi block against a melded threat is one of
 *  the known wrongnesses (plans/EV-5 §1.10). */
export const HOUOU_OPEN_PRIOR: ShapePrior = {
  name: 'houou-open',
  kind: 'measured',
${literal(open, 2)}
}

/**
 * What it costs to give up on a hand while somebody is in riichi: points, by the turn you are
 * deciding on and by who is threatening whom.
 *
 * Keys are \`me vs each threat\`, D for dealer and ND for not, threats in the order upstream writes
 * them (the dealer first when one of them is the dealer). Values are per entry of \`turns\`, and
 * negative — they are losses.
 *
 * **This is not the whole fold price.** The measurement excludes every seat that dealt in, so what
 * is here is opponents' tsumo payments plus the noten penalty, and nothing else. Add the deal-in
 * term to it: \`EV(fold) = HOUOU_FOLD_COST + P(deal in while folding) × HOUOU_HAND_SCORE.ron\`.
 *
 * \`samples\` is the hand count behind each cell. Some are tiny — two hands in one turn-4 cell — so
 * a reader of this table must check them before believing a number.
 *
 * source \`analyzers/betaori_cost.py\`, units converted from Tenhou score deltas (hundreds) to
 * points at extraction.
 */
export const HOUOU_FOLD_COST = {
  turns: [${FOLD_TURNS.join(', ')}],
  cost: {
${matchups(fold.cost, 4)}
  },
  samples: {
${matchups(fold.samples, 4)}
  },
} as const

/**
 * What a riichi hand pays when it wins, by the turn it declared — the deal-in cost \`plans/EV-3\` §4
 * calls \`value_j\`, conditioned by the threat's dealership as that section's option 2 asks for.
 *
 * Points as scored: riichi and honba sticks are excluded upstream, yakuman are excluded upstream,
 * and ura and dora are included because these are real wins off real logs rather than a shape
 * priced by a scorer. \`ron\` is what the discarder pays. \`tsumo\` is the winner's whole take before
 * the three-way split, so a payer's share is arithmetic on top of it, not a figure in this table.
 *
 * Indexed by turn 0-18 directly. The early turns are thin — check \`ronSamples\`.
 *
 * source \`analyzers/hand_score.py\`.
 */
export const HOUOU_HAND_SCORE = {
  dealer: {
    ron: ${arr(dealerScore.ron)},
    tsumo: ${arr(dealerScore.tsumo)},
    ronSamples: ${arr(dealerScore.ronSamples)},
    tsumoSamples: ${arr(dealerScore.tsumoSamples)},
    damaRon: ${arr(dealerScore.damaRon)},
    damaRonSamples: ${arr(dealerScore.damaRonSamples)},
  },
  nonDealer: {
    ron: ${arr(nonDealerScore.ron)},
    tsumo: ${arr(nonDealerScore.tsumo)},
    ronSamples: ${arr(nonDealerScore.ronSamples)},
    tsumoSamples: ${arr(nonDealerScore.tsumoSamples)},
    damaRon: ${arr(nonDealerScore.damaRon)},
    damaRonSamples: ${arr(nonDealerScore.damaRonSamples)},
  },
} as const

/**
 * How much a seat's score still has left to move, measured: the mean and standard deviation of
 * (final score − score right now), by which round it is and where the seat currently stands.
 *
 * This is the houou model's placement-odds input. Read it as "a 2nd-place seat in East 2 finishes
 * within about this much of where it stands", and integrate the four seats against each other for
 * rank probabilities (\`core/placement.ts\`).
 *
 * Indexed \`[rank - 1][round]\`, round 0-7 being East 1 through South 4 of a four-player hanchan.
 * Units converted from Tenhou score deltas (hundreds) to points at extraction, and rounded — the
 * source's own precision is far beyond what a rank integral can use.
 *
 * source \`analyzers/variance.py\`.
 */
export const HOUOU_SWING = {
  mean: [
${swing.mean.map((row) => `    [${row.join(', ')}],`).join('\n')}
  ],
  stddev: [
${swing.stddev.map((row) => `    [${row.join(', ')}],`).join('\n')}
  ],
} as const

/** What the source file says about itself, and what the riichi tables above imply. \`width\` is the
 *  expected number of distinct tile kinds a riichi waits on. */
export const HOUOU_PRIOR_META = {
  riichiHands: ${scalars['Total riichi']},
  complexWaits: ${scalars['Complex waits']},
  enumeratedHands: ${riichiTotals.hands},
  /** Mean ukeire in TILES, straight from the file — the same fact as \`width\`, at ~3.6 unseen
   *  copies per kind. */
  reportedWidthInTiles: ${scalars['Riichi width avg']},
  width: ${riichiTotals.width},
  /** P(a riichi waits on SOME tile of this rank), index 1-9, measured by a different analyzer over
   *  the same database (\`${CALIBRATION_CSV}\`). Index 0 is unused: the honour buckets there overlap
   *  in a way the analyzer does not document. Divide by three for one specific tile. */
  waitByRank: [${byRank.map((v) => v.toFixed(6)).join(', ')}],
} as const
`,
)

console.log(OUT)
console.log(`  riichi: ${riichiTotals.hands} hands, ${riichiTotals.waitKinds} wait kinds`)
console.log(`  implied width: ${riichiTotals.width.toFixed(4)} kinds`)
console.log(`  fold cost: ${FOLD_MATCHUPS.length} matchups over turns ${FOLD_TURNS.join('/')}`)
console.log(
  `  hand score: riichi ron ${nonDealerScore.ron[9]} non-dealer / ${dealerScore.ron[9]} dealer at turn 9`,
)
console.log(
  `  swing: 1st in East 1 sd ${swing.stddev[0][0]}, 1st in South 4 sd ${swing.stddev[0][7]}`,
)
console.log(
  `  riichi uplift at turn 9: ${nonDealerScore.ron[9] - nonDealerScore.damaRon[9]} non-dealer`,
)
