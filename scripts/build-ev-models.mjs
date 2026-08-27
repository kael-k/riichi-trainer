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

const text = await read(CSV)
const byRank = waitByRank(await read(CALIBRATION_CSV))
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

writeFileSync(
  OUT,
  `// GENERATED by scripts/build-ev-models.mjs — do not edit by hand.
//
// Wait-shape counts for a seat that has declared riichi, measured over Tenhou houou four-player
// hanchan logs.
//
//   source   https://github.com/${REPO}/blob/${COMMIT}/${CSV}
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
