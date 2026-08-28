import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { dealtIndices } from '../src/core/wall.ts'

/** The trainers that draw a `Table`. Scoring keeps its board behind its own setting and the lab's
 *  design is still open, so neither is asserted here. */
const TABLE_TRAINERS = ['efficiency', 'folding'] as const

/** Pacing off for every blob in this file. These tests measure layout, not timing, and the
 *  shipped default holds an opponent's turn for two seconds — long enough that a board still
 *  playing itself out re-renders under a click already aimed at a node, which detaches it. A
 *  paced board is covered by `useRound.test.ts`; what is asserted here is where things sit. */
const NO_PACE = { botDelay: 0 }

/** Advanced on, so every seat draws its info strip (the plate whose old home — a ring outboard of
 *  the felt — is what these tests exist to keep it out of), and waits on, which is the tallest
 *  that plate ever gets. `version` must match the store's own or zustand drops the blob, and the
 *  table settings are two override layers deep (`global`, then per-app) — a bare
 *  `table: { showSeatWaits }` sets a key nothing ever reads, which is exactly how this suite spent
 *  its first few commits believing it had waits on. `apps` is spread wholesale by the store's own
 *  merge, so it has to be present. */
const SETTINGS = JSON.stringify({
  state: {
    advanced: true,
    ...NO_PACE,
    table: { global: { showSeatWaits: true }, apps: {} },
  },
  version: 3,
})

test.beforeEach(async ({ context }) => {
  await context.addInitScript(
    `localStorage.setItem('riichi-trainer-settings', ${JSON.stringify(SETTINGS)})`,
  )
})

/** Where the session panel stops being a drawer and docks beside the board instead — the same
 *  `lg` the stage keys on. */
const WIDE = 1024

/** The stage is the whole page now, so there is nothing to enter: this only waits for it. Folding
 *  searches fresh random walls for a hand worth drilling, so the hand is not on screen the instant
 *  the route loads. */
async function waitForStage(page: Page) {
  await expect(page.getByTestId('hand-strip')).toBeVisible({ timeout: 20_000 })
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: typeof a) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/** What a box actually draws, which is not the box: the plate is its whole grid track and the ring
 *  is the whole square, so both report a box far larger than their contents — and both can spill
 *  *out* of it, which is the failure these tests are looking for. */
async function drawnBox(locator: Locator) {
  return await locator.evaluate((el) => {
    const rects = [...el.querySelectorAll('*')]
      .map((c) => c.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
    const x = Math.min(...rects.map((r) => r.left))
    const y = Math.min(...rects.map((r) => r.top))
    return {
      x,
      y,
      width: Math.max(...rects.map((r) => r.right)) - x,
      height: Math.max(...rects.map((r) => r.bottom)) - y,
    }
  })
}

/** Everything a seat's corner holds has to stay inside the board and off every river — the plate
 *  (its wind, its settings trigger, its waits) and, for whoever the board is *not* drawn from,
 *  its calls out in the ring. */
async function fitsTheBoard(page: Page, box: Locator, what: string) {
  const square = (await page.getByTestId('board').first().boundingBox())!
  const content = await drawnBox(box)

  expect(content.x, `${what} runs off the board`).toBeGreaterThanOrEqual(square.x - 1)
  expect(content.y, `${what} runs off the board`).toBeGreaterThanOrEqual(square.y - 1)
  expect(content.x + content.width, `${what} runs off the board`).toBeLessThanOrEqual(
    square.x + square.width + 1,
  )
  expect(content.y + content.height, `${what} runs off the board`).toBeLessThanOrEqual(
    square.y + square.height + 1,
  )
  for (const river of await page.getByTestId('river').all()) {
    const r = await river.boundingBox()
    if (r) expect(overlaps(content, r), `${what} overlaps a river`).toBe(false)
  }
}

/** Every tile kind, in id order — the alphabet both the `wall` param and the `log` param are
 *  written in (`core/tiles.ts#parseTenhou`). */
const KINDS = [
  ...['m', 'p', 's'].flatMap((suit) => Array.from({ length: 9 }, (_, i) => `${i + 1}${suit}`)),
  ...Array.from({ length: 7 }, (_, i) => `${i + 1}z`),
]

/** Tiles to one ordered tenhou string (`111m5m…`) — runs of digits closed by their suit letter, so
 *  draw order survives, which is the whole point of the `wall` param. */
function tenhou(tiles: string[]): string {
  let out = ''
  let digits = ''
  let suit = ''
  for (const tile of tiles) {
    if (suit && tile[1] !== suit) {
      out += digits + suit
      digits = ''
    }
    suit = tile[1]
    digits += tile[0]
  }
  return out + digits + suit
}

/** The seat the suukantsu hand is dealt to. Deliberately *not* the reader's own seat: a seat's
 *  waits are read off the hand it is holding, and the seat whose turn it is is always holding its
 *  14th tile at rest, so its wait row is empty by construction. Toimen rests on 13 and shows the
 *  tanki — which also puts the four melds in a rotated ring rather than the upright one. */
const KAN_SEAT = 2

/** Four seats' starting hands laid into the wall the way a table deals them — four apiece, three
 *  times round, then one each (`DEAL_CHUNKS`). Written through `dealtIndices` rather than as four
 *  slabs of thirteen, so these fixtures follow the engine if the dealing pattern ever moves again:
 *  slabs are what the 4/4/4+1 deal quietly turned into four scrambled hands. */
function dealt(hands: string[][], players = hands.length): string[] {
  const out: string[] = []
  hands.forEach((hand, seat) =>
    dealtIndices(seat, players).forEach((index, i) => {
      out[index] = hand[i]
    }),
  )
  return out
}

/**
 * A wall dealt so one seat kans its way to suukantsu: four concealed triplets and a lone 5m, then
 * the fourth copy of each triplet arrives on its next four draws. Four ankan flip four more dora
 * indicators on top of the opening one, so the board ends up drawing every indicator slot it has,
 * one seat's ring has to hold four melds beside its hand, and that seat's plate has to show the
 * winning tile — every extreme the corner is asked for, in one hand.
 *
 * `kanSeat` moves the whole thing to another seat: at `KAN_SEAT` it is an opponent's ring, at the
 * link's own `seat=` it is the reader's own calls, which the board hands to `HandDisplay` under it
 * instead of drawing on the felt.
 *
 * The wall is given in full (136 tiles) rather than as a prefix on purpose: a short wall is
 * completed at random, and the dead wall — which is where every kan replacement comes from — would
 * then be tiles the `log` below could not name.
 */
function suukantsuBoard(kanSeat = KAN_SEAT): string {
  // 13 each. The kan seat's is the hand being built; the rest are junk that stays far from tenpai,
  // so nobody claims a discard and derails the replay
  const quads = ['1m', '1m', '1m', '2m', '2m', '2m', '3m', '3m', '3m', '4m', '4m', '4m', '5m']
  const junkPin = [...Array.from({ length: 9 }, (_, i) => `${i + 1}p`), '1s', '2s', '3s', '4s']
  const junkSou = [
    ...Array.from({ length: 9 }, (_, i) => `${i + 1}s`),
    ...Array.from({ length: 4 }, (_, i) => `${i + 1}z`),
  ]
  const spare = [junkPin, junkPin, junkSou]
  const deal = dealt([0, 1, 2, 3].map((seat) => (seat === kanSeat ? quads : spare.pop()!)))

  // live draws, in turn order from the dealer: the kan seat takes its own slot of every four and
  // it is always the quad's last copy, the other three take a terminal they throw straight back
  const live = ['9m', '8m', '7m', '6m'].flatMap((junk, cycle) =>
    [0, 1, 2, 3].map((seat) => (seat === kanSeat ? ['1m', '2m', '3m', '4m'][cycle] : junk)),
  )

  // the last 14: five dora indicators, five ura, then the four replacement tiles a kan draws —
  // popped off the end, so the kan seat discards 4z, 3z, 2z, 1z in that order
  const dead = ['1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p', '1s', '1z', '2z', '3z', '4z']

  const placed = [...deal, ...live, ...dead]
  const left = new Map(KINDS.map((kind) => [kind, 4]))
  for (const tile of placed) left.set(tile, left.get(tile)! - 1)
  // reverse id order, so the 5m copies land at the very end of the live wall rather than as the
  // next draw off the front — a second 5m in that hand is not the tanki this board is posing
  const filler = [...left.entries()]
    .reverse()
    .flatMap(([kind, count]) => Array.from({ length: count }, () => kind))

  const wall = [...deal, ...live, ...filler, ...dead]
  const log = ['1m', '2m', '3m', '4m']
    .map((quad, cycle) => {
      const replacement = ['4z', '3z', '2z', '1z'][cycle]
      const junk = ['9m', '8m', '7m', '6m'][cycle]
      // one full cycle in turn order: the kan seat kans and discards its replacement, everyone
      // else throws back the terminal they drew
      return [0, 1, 2, 3]
        .map((seat) =>
          seat === kanSeat ? `A${seat}${quad}D${seat}${replacement}T` : `D${seat}${junk}T`,
        )
        .join('')
    })
    .join('')

  expect(wall, 'the fixture wall is not a full wall').toHaveLength(136)
  for (const [kind, count] of left) expect(count, `${kind} is over-used`).toBeGreaterThanOrEqual(0)
  return `/efficiency?wall=${tenhou(wall)}&log=${log}&seat=0&deadWall=1&aka=0&sanma=0`
}

test('four kans: they lie beside that seat and every indicator flips', async ({ page }, info) => {
  await page.goto(suukantsuBoard())
  const board = page.getByTestId('board').first()
  await expect(board).toBeVisible()

  // four ankan in that seat's own ring, off the felt at the right-hand end of its hand — twelve
  // faces and four backs, since an ankan hides its outer two
  const ring = page.locator(`[data-testid=seat-ring][data-seat="${KAN_SEAT}"]`)
  const calls = ring.getByTestId('seat-calls')
  await expect(calls.locator('> div')).toHaveCount(4)
  await expect(calls.getByRole('img')).toHaveCount(16)

  // the winning tile, on that seat's plate: tanki on 5m, and three copies are still out there —
  // the hand holds the fourth
  const plate = page.locator(`[data-testid=seat-plate][data-seat="${KAN_SEAT}"]`)
  await expect(plate.getByRole('img')).toHaveCount(1)
  await expect(plate.getByRole('img', { name: '5m' })).toBeVisible()
  await expect(plate).toContainText('3')

  // the opening indicator plus one per kan fills every slot the board has, so nothing in that row
  // is still face down
  const dora = page.getByTestId('dora-row')
  await expect(dora.getByRole('img')).toHaveCount(5)
  await expect(dora.getByRole('img', { name: 'Face-down tile' })).toHaveCount(0)

  await fitsTheBoard(page, calls, 'four kans')
  await fitsTheBoard(page, plate, 'the four-kan plate')
  await page.screenshot({ path: info.outputPath('four-kans.png') })
})

test('the reader’s own calls go under the board, not onto the felt', async ({ page }) => {
  // the same four kans, dealt to the seat the board is drawn from: it has no hand on the felt to
  // put them beside, so they belong with the hand below it, at a size that reads against it
  await page.goto(suukantsuBoard(0))
  await expect(page.getByTestId('board').first()).toBeVisible()

  await expect(page.locator('[data-testid=seat-ring][data-seat="0"]')).toHaveCount(0)
  const calls = page.getByTestId('hand-calls')
  await expect(calls.locator('> div')).toHaveCount(4)
  await expect(calls.getByRole('img')).toHaveCount(16)

  // after the hand it belongs to in reading order, and smaller than it. "After" is two cases and
  // the phone is the second one: four kans plus the hand are wider than a 390px strip, so the
  // calls wrap onto their own line *below* the tiles rather than being squeezed beside them at a
  // size nobody can read. Only when they do share a line does "after" mean "to the right" — and
  // the old x-only form quietly passed the wrapped case on an accident of the calls' left margin,
  // which is why it kept holding until the hand row was centred
  const hand = (await page.getByRole('button', { name: '5m' }).first().boundingBox())!
  const meld = (await calls.getByRole('img').first().boundingBox())!
  const sameLine = meld.y < hand.y + hand.height && hand.y < meld.y + meld.height
  if (sameLine) {
    expect(meld.x, 'the calls sit left of the hand they belong to').toBeGreaterThan(hand.x)
  } else {
    expect(meld.y, 'the calls wrapped above the hand they belong to').toBeGreaterThan(hand.y)
  }
  expect(meld.width, 'the calls are drawn at hand size').toBeLessThan(hand.width)
})

/** The thirteen orphans, dealt straight to toimen: kokushi's thirteen-sided wait is the widest
 *  wait in the game, so the plate's wait row has to draw every kind at once. No `log` and no dead
 *  wall to control — the shape is in the deal itself, and the rest of the wall can be completed at
 *  random. */
function thirteenOrphansBoard(): string {
  const orphans = [
    '1m',
    '9m',
    '1p',
    '9p',
    '1s',
    '9s',
    ...Array.from({ length: 7 }, (_, i) => `${i + 1}z`),
  ]
  const junkPin = [...Array.from({ length: 9 }, (_, i) => `${i + 1}p`), '1s', '2s', '3s', '4s']
  const junkSou = [
    ...Array.from({ length: 5 }, (_, i) => `${i + 5}s`),
    ...Array.from({ length: 4 }, (_, i) => `${i + 2}p`),
    ...Array.from({ length: 4 }, (_, i) => `${i + 1}m`),
  ]
  // a prefix, not a full wall: only the deal matters here, and the rest completes at random
  const deal = dealt([junkPin, junkSou, orphans, junkPin])
  return `/efficiency?wall=${tenhou(deal)}&seat=0&sanma=0`
}

test('a thirteen-sided wait fits on the seat that holds it', async ({ page }, info) => {
  await page.goto(thirteenOrphansBoard())
  await expect(page.getByTestId('board').first()).toBeVisible()

  const plate = page.locator(`[data-testid=seat-plate][data-seat="${KAN_SEAT}"]`)
  // all thirteen, drawn small rather than trimmed to the five that used to fit: the whole corner
  // is the plate's now, and a wait you cannot read in full is not a wait you can defend against
  await expect(plate.getByRole('img')).toHaveCount(13)

  // and they wrap inside the corner cell — in one line they ran straight over the next seat's
  // river, which is what the size is chosen against
  const cell = (await plate.boundingBox())!
  const drawn = await drawnBox(plate)
  expect(drawn.width, 'the wait row is wider than its own corner').toBeLessThanOrEqual(
    cell.width + 1,
  )
  expect(drawn.height, 'the plate is taller than its own corner').toBeLessThanOrEqual(
    cell.height + 1,
  )
  await fitsTheBoard(page, plate, 'the thirteen-wait plate')
  await page.screenshot({ path: info.outputPath('thirteen-wait.png') })
})

for (const trainer of TABLE_TRAINERS) {
  test(`${trainer}: the board is square`, async ({ page }) => {
    await page.goto(`/${trainer}`)
    const board = page.getByTestId('board').first()
    await expect(board).toBeVisible()
    const box = (await board.boundingBox())!
    // one physical pixel of tolerance: a device pixel ratio of 3 rounds the CSS box
    expect(
      Math.abs(box.width - box.height),
      `board ${box.width}x${box.height}`,
    ).toBeLessThanOrEqual(1)
  })

  test(`${trainer}: the whole board and the hand fit on screen`, async ({ page }) => {
    await page.goto(`/${trainer}`)
    await waitForStage(page)

    const viewport = page.viewportSize()!
    const board = (await page.getByTestId('board').first().boundingBox())!
    const hand = (await page.getByTestId('hand-strip').boundingBox())!

    expect(Math.abs(board.width - board.height)).toBeLessThanOrEqual(1)
    expect(board.x).toBeGreaterThanOrEqual(-1)
    expect(board.y).toBeGreaterThanOrEqual(-1)
    expect(board.x + board.width).toBeLessThanOrEqual(viewport.width + 1)
    expect(board.y + board.height).toBeLessThanOrEqual(viewport.height + 1)
    // the hand is the rest of what has to fit: below the board, not over it, not off the bottom
    expect(hand.y).toBeGreaterThanOrEqual(board.y + board.height - 1)
    expect(hand.y + hand.height).toBeLessThanOrEqual(viewport.height + 1)
  })

  test(`${trainer}: the board fills the room it is given`, async ({ page }) => {
    await page.goto(`/${trainer}`)
    await waitForStage(page)

    // the other half of "it fits": a square that fits inside a room it only half fills passes
    // every test above and is still the bug — the `--board-max-h` estimate used to spend a slice
    // of every default board on margin. Measured against the *content* box of the stage's board
    // area, which is the room the square sizes itself off (`100cqh`) — the padding a wide screen
    // puts around it is not unused space. Times `--board-scale`, which is the reader's own share
    // of that room and is 1 on anything narrower than a tablet (see the size-setting test below)
    const room = await page.getByTestId('board-area').evaluate((el) => {
      const style = getComputedStyle(el)
      const px = (value: string) => parseFloat(value) || 0
      return Math.min(
        el.clientWidth - px(style.paddingLeft) - px(style.paddingRight),
        el.clientHeight - px(style.paddingTop) - px(style.paddingBottom),
      )
    })
    const boardEl = page.getByTestId('board').first()
    const scale = await boardEl.evaluate((el) =>
      parseFloat(getComputedStyle(el).getPropertyValue('--board-scale')),
    )
    const board = (await boardEl.boundingBox())!
    expect(board.width, `board ${board.width} in ${room} at ${scale}`).toBeGreaterThan(
      room * scale * 0.97,
    )
    // and no more than that share either, so the default's own scale is asserted rather than
    // merely allowed — a board ignoring `--board-scale` passes the lower bound on its own
    expect(board.width, `board ${board.width} in ${room} at ${scale}`).toBeLessThan(
      room * scale * 1.03,
    )
  })

  test(`${trainer}: the size setting scales the board only where there is room`, async ({
    page,
    context,
    viewport,
  }) => {
    // S (`BOARD_SCALES[0]`, 0.7) against the default M. A tablet or desktop gives the reader that
    // choice; a phone does not, because a square smaller than its room pulls the side seats' hands
    // off the screen edge — so the same setting must move the board on one and not the other.
    await context.addInitScript(
      `localStorage.setItem('riichi-trainer-settings', ${JSON.stringify(
        JSON.stringify({
          state: { advanced: true, ...NO_PACE, tileScale: 1, table: { global: {}, apps: {} } },
          version: 3,
        }),
      )})`,
    )
    await page.goto(`/${trainer}`)
    await waitForStage(page)

    const sizable = !!viewport && viewport.width >= 768 && viewport.height >= 521
    const board = (await page.getByTestId('board').first().boundingBox())!
    const room = await page.getByTestId('board-area').evaluate((el) => {
      const style = getComputedStyle(el)
      const px = (value: string) => parseFloat(value) || 0
      return Math.min(
        el.clientWidth - px(style.paddingLeft) - px(style.paddingRight),
        el.clientHeight - px(style.paddingTop) - px(style.paddingBottom),
      )
    })

    const ratio = board.width / room
    if (sizable) {
      expect(ratio, `board ${board.width} in ${room}`).toBeGreaterThan(0.7 * 0.97)
      expect(ratio, `board ${board.width} in ${room}`).toBeLessThan(0.8)
    } else {
      expect(ratio, `board ${board.width} in ${room}`).toBeGreaterThan(0.97)
    }
  })

  test(`${trainer}: the hand stays one row at the largest tile size`, async ({
    page,
    context,
    viewport,
  }) => {
    // XL, the size that used to break this. Where the size setting applies at all it is a
    // *ceiling* on the hand, not a width: a hand that wraps costs the board a tile row of height,
    // which is how asking for bigger tiles used to make the table smaller. A phone is skipped
    // because it is skipped by the setting itself — the tiles are at the default there.
    test.skip(!viewport || viewport.width < 768 || viewport.height < 521, 'the size setting is off')
    await context.addInitScript(
      `localStorage.setItem('riichi-trainer-settings', ${JSON.stringify(
        JSON.stringify({
          state: { advanced: true, ...NO_PACE, tileScale: 1.8, table: { global: {}, apps: {} } },
          version: 3,
        }),
      )})`,
    )
    await page.goto(`/${trainer}`)
    await waitForStage(page)

    const hand = await page.getByTestId('hand-strip').evaluate((el) => {
      // the calls ride on the same line at 0.75 size, so their tops differ by design
      const tiles = [...el.querySelectorAll('svg[role="img"]')].filter(
        (tile) => !tile.closest('[data-testid="hand-calls"]'),
      )
      return {
        count: tiles.length,
        rows: new Set(tiles.map((tile) => Math.round(tile.getBoundingClientRect().top))).size,
      }
    })
    expect(hand.count).toBeGreaterThanOrEqual(8)
    expect(hand.rows, `${hand.count} tiles over ${hand.rows} rows`).toBe(1)
  })

  test(`${trainer}: no seat plate lands on a river`, async ({ page }) => {
    await page.goto(`/${trainer}`)
    await expect(page.getByTestId('board').first()).toBeVisible()

    const plates = await page.getByTestId('seat-strip').all()
    expect(plates.length).toBeGreaterThan(0)
    const rivers = await page.getByTestId('river').all()

    for (const plate of plates) {
      const p = await plate.boundingBox()
      if (!p) continue
      const seat = await plate.getAttribute('data-seat')
      for (const river of rivers) {
        const r = await river.boundingBox()
        if (!r) continue
        const on = await river.getAttribute('data-seat')
        expect(
          overlaps(p, r),
          `seat ${seat} plate ${JSON.stringify(p)} overlaps seat ${on} river ${JSON.stringify(r)}`,
        ).toBe(false)
      }
    }
  })
}

/**
 * Two pons by the same seat, called from the dealer. Open calls are the shape ankan never tests:
 * the claimed tile lies on its side, 4/3 of a tile wide, so a called hand is wider than its tile
 * count says. Written as an explicit `log` rather than fished out of a random wall, because
 * whether an algorithm calls at all depends on the hand it happens to be dealt.
 */
function ponBoard(): string {
  const caller = 1
  // the dealer holds the two tiles it will throw; the caller holds the pairs that claim them
  const east = ['1m', '2m', '3p', '4p', '5p', '6p', '7p', '8p', '9p', '2s', '3s', '4s', '5s']
  const pairs = ['1m', '1m', '2m', '2m', '6s', '7s', '8s', '2p', '3p', '4p', '6p', '7p', '8p']
  const junk = [...Array.from({ length: 9 }, (_, i) => `${i + 1}s`), '3m', '4m', '5m', '6m']
  const junkToo = ['7m', '8m', '9m', '1p', '2p', '5p', '9p', '1s', '9s', '3z', '4z', '5z', '6z']
  const deal = dealt([east, pairs, junk, junkToo])
  // east throws 1m, the caller pons it and discards; the turn passes to the caller's shimocha, so
  // the two seats after it play a turn each before east is back on and throws 2m for the second
  const log =
    `D0${'1m'}C${caller}0P1m1mD${caller}6sD2${'1s'}TD3${'7m'}T` +
    `D0${'2m'}C${caller}0P2m2mD${caller}7sD2${'2s'}TD3${'8m'}T`
  return `/efficiency?wall=${tenhou(deal)}&log=${log}&seat=0&deadWall=1&aka=0&sanma=0`
}

test('an open call lies beside the hand and off every river', async ({ page }) => {
  await page.goto(ponBoard())
  await expect(page.getByTestId('board').first()).toBeVisible()

  const calls = page.locator('[data-testid=seat-ring][data-seat="1"]').getByTestId('seat-calls')
  await expect(calls.locator('> div')).toHaveCount(2)
  await expect(calls.getByRole('img')).toHaveCount(6)

  await fitsTheBoard(page, calls, "the caller's calls")
  for (const plate of await page.getByTestId('seat-plate').all()) {
    await fitsTheBoard(page, plate, `seat ${await plate.getAttribute('data-seat')}'s plate`)
  }
})

test('every seat’s score sits the same distance from the centre panel', async ({ page }) => {
  await page.goto(suukantsuBoard())
  await expect(page.getByTestId('board').first()).toBeVisible()

  // the scores are laid out upright and then turned to face their seat, and a transform does not
  // move the box it was laid out in: positioned per seat, the two side ones came out half a text
  // width further in than the top and bottom. Measured off the panel, whose own box is square
  const panel = (await page.getByTestId('centre-panel').boundingBox())!
  const scores = await page.getByTestId('seat-points').all()
  expect(scores).toHaveLength(4)

  const gaps = await Promise.all(
    scores.map(async (score) => {
      const b = (await score.boundingBox())!
      // each score hugs one edge; the gap is to whichever that is
      return Math.min(
        b.x - panel.x,
        b.y - panel.y,
        panel.x + panel.width - (b.x + b.width),
        panel.y + panel.height - (b.y + b.height),
      )
    }),
  )
  expect(Math.max(...gaps) - Math.min(...gaps), `gaps ${gaps.join(', ')}`).toBeLessThanOrEqual(2)
})

test('the session panel is docked and open on a wide screen, a drawer below that', async ({
  page,
  viewport,
}) => {
  await page.goto('/efficiency')
  await waitForStage(page)

  // wide enough to hold both: the panel is a column beside the board, already open, and there is
  // no drawer at all. Narrower, the board keeps the whole width and the panel waits behind its
  // own button — a phone mid-drill cannot spare 320px of felt for a log
  if (viewport && viewport.width >= WIDE) {
    await expect(page.getByTestId('session-panel')).toBeVisible()
    await expect(page.getByTestId('log-drawer')).toHaveCount(0)
    return
  }
  await expect(page.getByTestId('session-panel')).toHaveCount(0)
  await expect(page.getByTestId('log-drawer')).toHaveCount(0)
  await page.getByRole('button', { name: 'Show log' }).click()
  await expect(page.getByTestId('log-drawer')).toBeVisible()
})

test('on an ultrawide screen the panel and the settings sheet sit near the board, not the screen edge', async ({
  page,
  viewport,
}) => {
  // the `ultrawide:` gate is the point of this test; on anything narrower there is nothing to
  // assert that the panel test above does not already cover
  test.skip(!viewport || viewport.width < 2000, 'not an ultrawide viewport')
  await page.goto('/efficiency')
  await waitForStage(page)

  const viewportWidth = viewport!.width
  const board = (await page.getByTestId('board').first().boundingBox())!
  const panel = (await page.getByTestId('session-panel').boundingBox())!

  // a real gutter exists between the panel and the physical screen edge
  expect(viewportWidth - (panel.x + panel.width)).toBeGreaterThan(100)
  // reachability, not a pixel count that will rot: the gap from the board to the panel is less
  // than half the board's own width
  expect(panel.x - (board.x + board.width)).toBeLessThan(board.width / 2)

  // the settings sheet mounts inside the stage, so it lands on the same capped right edge and
  // takes the same column the panel it covers does — both edges, not just the one it hangs off
  await page.getByRole('button', { name: 'Settings' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const sheet = (await dialog.locator('> div').first().boundingBox())!
  expect(Math.abs(sheet.x + sheet.width - (panel.x + panel.width))).toBeLessThanOrEqual(2)
  expect(Math.abs(sheet.x - panel.x)).toBeLessThanOrEqual(2)

  // and its scrim stops at the stage rather than dimming the surround: the element carrying
  // role=dialog is the scrim itself, so its own box is the assertion
  const scrim = (await dialog.boundingBox())!
  expect(scrim.x).toBeGreaterThan(100)
  expect(Math.abs(scrim.x + scrim.width - (panel.x + panel.width))).toBeLessThanOrEqual(2)
})

test('on an ultrawide screen the home page docks its settings sheet where the app stops', async ({
  page,
  viewport,
}) => {
  test.skip(!viewport || viewport.width < 2000, 'not an ultrawide viewport')
  await page.goto('/')

  // home has no board to cap the box against, so it takes the same `--stage-max` a trainer does:
  // the sheet lands on the menu's own right-hand edge rather than a monitor's
  const menu = (await page.getByRole('navigation').boundingBox())!
  await page.getByRole('button', { name: 'Settings' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const sheet = (await dialog.locator('> div').first().boundingBox())!

  expect(viewport!.width - (sheet.x + sheet.width)).toBeGreaterThan(100)
  // reachability, the same measure the panel gets above: the sheet opens against the menu it was
  // opened from rather than half a screen away. It may sit over the menu's right-hand margin —
  // that is what a sheet does — so this is a distance, not a non-overlap
  expect(sheet.x - (menu.x + menu.width)).toBeLessThan(menu.width / 2)
})

test('efficiency-solo: your river is on screen', async ({ page }) => {
  await page.goto('/efficiency-solo')
  await waitForStage(page)

  // discard, so the river holds something to be seen at all
  await page.getByTestId('hand-strip').getByRole('button').first().click()

  const river = page.getByText('(you)')
  await expect(river).toBeVisible()
  const box = (await river.boundingBox())!
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1)
})

test('efficiency-solo: the log drawer covers the hand', async ({ page, viewport }) => {
  // the drawer shape only: wide enough and the panel docks beside the board instead, covering
  // nothing, which is the point of it docking
  test.skip(!viewport || viewport.width >= WIDE, 'the panel is docked, not a drawer')
  await page.goto('/efficiency-solo')
  await waitForStage(page)

  const hand = (await page.getByTestId('hand-strip').boundingBox())!
  await page.getByRole('button', { name: 'Show log' }).click()

  const drawer = page.getByTestId('log-drawer')
  await expect(drawer).toBeVisible()
  const box = (await drawer.boundingBox())!
  // the drawer spans the stage: it starts at or above the hand strip and ends at or below it,
  // rather than stopping at the board's bottom edge and leaving the tiles showing underneath
  expect(box.y).toBeLessThanOrEqual(hand.y)
  expect(box.y + box.height).toBeGreaterThanOrEqual(hand.y + hand.height - 1)
  // and it is genuinely on top: the topmost element over the hand's right edge is the drawer
  const onTop = await page.evaluate(
    ([x, y]) =>
      document.elementFromPoint(x, y)?.closest('[data-testid]')?.getAttribute('data-testid'),
    [hand.x + hand.width - 4, hand.y + hand.height / 2],
  )
  expect(onTop).toBe('log-drawer')
})

test('the log drawer is a dialog: over the chrome row, dismissed from outside', async ({
  page,
  viewport,
}) => {
  test.skip(!viewport || viewport.width >= WIDE, 'the panel is docked, not a drawer')
  await page.goto('/efficiency-solo')
  await waitForStage(page)

  const toggle = page.getByRole('button', { name: 'Show log' })
  const chrome = (await toggle.boundingBox())!
  await toggle.click()
  const drawer = page.getByTestId('log-drawer')
  await expect(drawer).toBeVisible()

  // it outranks the chrome row rather than being wedged under it — the button that opened it is
  // covered, which is only safe because the scrim below closes it
  const box = (await drawer.boundingBox())!
  expect(box.y, 'the drawer stops below the chrome row').toBeLessThanOrEqual(chrome.y)

  // a press on the scrim, well clear of the panel, closes it the way every other dialog does
  await page.mouse.click(Math.max(4, box.x / 2), box.y + box.height / 2)
  await expect(drawer).toHaveCount(0)
})

/**
 * Two seats in furiten at once: the reader's own (it threw the 1z it waits on) and toimen's
 * neighbour (it threw the 5s its tanki waits on). Every live draw is authored, so nothing after
 * the deal is random and both reads are the same on every run.
 */
function twoFuritenBoard(): string {
  const orphans = [
    '1m',
    '9m',
    '1p',
    '9p',
    '1s',
    '9s',
    ...Array.from({ length: 7 }, (_, i) => `${i + 1}z`),
  ]
  const tanki = ['1m', '2m', '3m', '4p', '5p', '6p', '7p', '8p', '9p', '2s', '3s', '4s', '5s']
  // spaced by 3, not 2: a chi needs two held tiles either side of the discard within a run of
  // three, which needs two held tiles 1 or 2 apart — spacing every held tile 3 apart makes that
  // impossible for *any* discard, so this hand can never react to one. `replayLog` forces claims
  // on for its own duration regardless of the live setting (`round.ts`), and replay temporarily
  // puts every seat on manual, so an unanswered claim opportunity anywhere in the log's own window
  // aborts the replay rather than being silently skipped — the original 2/4/6/8 spacing left seat
  // 1's own discard (5s, a fixed part of this scenario, not junk) chi-able via this hand's 4s+6s.
  // Honours fill the rest: never chi-able at all, and single copies here can never pon either.
  const spaced = (last: string) => [
    '1m',
    '4m',
    '7m',
    '1p',
    '4p',
    '7p',
    '1s',
    '4s',
    '7s',
    '2z',
    '3z',
    '4z',
    last,
  ]
  const deal = dealt([orphans, tanki, spaced('5m'), spaced('5p')])
  // seat 0 draws the 14th orphan and throws it; seat 1 draws a 5s and throws it; the rest is junk
  // — 1p and 9s rather than the original 3p/3s, which seat 1's own 4-9p/2-5s blocks could chi (4p+5p
  // makes 345p off a 3p; 2s+4s makes 234s off a 3s). Then seat 0's next draw — deliberately not an
  // orphan, so its thirteen-sided wait still stands
  const live = ['1z', '5s', '1p', '9s', '5m']
  return `/efficiency?wall=${tenhou([...deal, ...live])}&log=D01zTD15sT&seat=0&sanma=0`
}

/** This file's own `SETTINGS` turns the waits on, which reveals every seat's read. A test about
 *  what shows with *nothing* revealed has to put that back — a later init script wins. */
async function revealNothing(context: BrowserContext) {
  await context.addInitScript(
    `localStorage.setItem('riichi-trainer-settings', ${JSON.stringify(
      JSON.stringify({
        state: { advanced: true, ...NO_PACE, table: { global: {}, apps: {} } },
        version: 3,
      }),
    )})`,
  )
}

/** This file runs unpaced (`NO_PACE`) because these tests measure layout. The tedashi hole is the
 *  one thing that only exists *while* the board is paced, so it puts the delay back. */
async function paced(context: BrowserContext) {
  await context.addInitScript(
    `localStorage.setItem('riichi-trainer-settings', ${JSON.stringify(
      JSON.stringify({
        state: { advanced: true, botDelay: 1000, table: { global: {}, apps: {} } },
        version: 3,
      }),
    )})`,
  )
}

test('a tedashi holds its own slot open in the hand below the board', async ({ page, context }) => {
  // the unit tests pin each end of this separately (`Table.test.tsx` places the hole,
  // `useRound.test.ts` decides when to open one) and still passed with the two ends unconnected —
  // the reader's own hand was never handed the tile at all. This walks that chain in a browser:
  // a real discard, at a real pace, on the hand the reader is looking straight at.
  //
  // Watched, never polled. The hole is open for one flight (~260ms) and every poll interval here
  // is longer than that, so an assertion that looks for it directly passes or fails on load. The
  // felt's own copy of the hole is the same page expression one seat over, pinned by
  // `Table.test.tsx`; a board that stops at tenpai mid-test is not worth chasing for it.
  await paced(context)
  await page.goto('/efficiency')
  await expect(page.getByTestId('board').first()).toBeVisible()
  const hand = page.getByTestId('hand-strip')
  await expect(hand).toBeVisible()

  await page.evaluate(() => {
    const w = window as unknown as { hole?: boolean }
    w.hole = false
    const check = () => {
      w.hole ||= !!document.querySelector('[data-testid="hand-strip"] span.shrink-0')
    }
    check()
    new MutationObserver(check).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
    })
  })
  const hole = () => page.evaluate(() => (window as unknown as { hole: boolean }).hole)
  expect(await hole()).toBe(false)

  // the leftmost of the thirteen: out of the hand by construction, never the drawn tile
  await hand.getByRole('img').first().click()
  await expect.poll(hole, { timeout: 10_000 }).toBe(true)
})

test('a furiten seat is marked exactly when its tiles are on screen', async ({ page, context }) => {
  await revealNothing(context)
  await page.goto(twoFuritenBoard())
  await expect(page.getByTestId('board').first()).toBeVisible()

  const furiten = page.getByRole('button', { name: 'Explain: Furiten' })
  // the reader's own seat and nobody else's: their own furiten is information a real client shows
  // and their tiles are on screen whatever the reveal settings say, while the opponent that is
  // just as furiten is holding a hand nobody can see
  await expect(furiten).toHaveCount(1)

  // the badge explains itself rather than sitting there as a label — and the explanation comes up
  // upright, not turned with the seat plate it was opened from
  await furiten.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  expect(await dialog.evaluate((el) => getComputedStyle(el).transform)).toBe('none')
})

test('revealing the hands reveals the furiten that goes with them', async ({ page, context }) => {
  // `showOpponentHands` on: seeing an opponent's tiles is seeing its furiten, so the badge follows
  // the faces rather than needing the waits setting of its own
  await context.addInitScript(
    `localStorage.setItem('riichi-trainer-settings', ${JSON.stringify(
      JSON.stringify({
        state: {
          advanced: true,
          ...NO_PACE,
          table: { global: { showOpponentHands: true }, apps: {} },
        },
        version: 3,
      }),
    )})`,
  )
  await page.goto(twoFuritenBoard())
  await expect(page.getByTestId('board').first()).toBeVisible()

  // the reader's own seat plus the opponent whose hand is now face-up
  await expect(page.getByRole('button', { name: 'Explain: Furiten' })).toHaveCount(2)
})

/**
 * A shared link with one replayed discard already on its `log`, dealt so the reader's seat sits on
 * a chiitoitsu tenpai (six pairs of 1m-6m plus a lone 7m) the whole time: the replayed discard just
 * tosses that turn's junk draw straight back, and every live turn after it does the same, so
 * whichever tile the reader actually draws live, discarding it keeps the same tenpai shape. That is
 * what lets "New round" show up without hand-authoring the exact live draw — the point of this
 * fixture is the *replayed* log entry sitting on the situation, not the tenpai wait itself.
 */
function tenpaiWithReplayedLogBoard(): string {
  const seat0 = ['1m', '1m', '2m', '2m', '3m', '3m', '4m', '4m', '5m', '5m', '6m', '6m', '7m']
  const seat1 = ['1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p', '1s', '2s', '3s', '4s']
  const seat2 = ['5s', '6s', '7s', '8s', '9s', '1z', '2z', '3z', '4z', '5z', '6z', '7z', '9m']
  const seat3 = ['8m', '9m', '7m', '8p', '9p', '1s', '2s', '3s', '4s', '5s', '6s', '7s', '8s']
  const deal = dealt([seat0, seat1, seat2, seat3])
  // seat 0's opening draw, discarded straight back by the replayed log entry — a short wall
  // prefix, the rest completed at random since nothing after it needs to be a specific tile
  const draw = '9s'
  return `/efficiency?wall=${tenhou([...deal, draw])}&log=D0${draw}T&seat=0&deadWall=1&aka=0&sanma=0`
}

/** The hand strip's tiles — a readable alias for the common case, now that the transient buttons
 *  (kita/kan, the claim prompt) float over the board instead of sharing this strip with the hand
 *  (`BoardStage`'s `controls`). Its accessible name carries the label; a tile's is the tile alone. */
function handTiles(handStrip: Locator): Locator {
  return handStrip.getByRole('button')
}

/** Waits for the hand strip to reach a full 14-tile hand. Efficiency asks no claims (ADR-0035),
 *  so there is nothing to decline here any more; kept defensive in case a future trainer reusing
 *  this helper still does. */
async function waitForFullHand(page: Page, handStrip: Locator) {
  const pass = page.getByRole('button', { name: 'Pass' })
  await expect(async () => {
    if (await pass.isVisible()) await pass.click()
    await expect(handTiles(handStrip)).toHaveCount(14, { timeout: 500 })
  }).toPass({ timeout: 10_000 })
}

test('restarting a shared-link round with a replayed log does not crash', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto(tenpaiWithReplayedLogBoard())
  const handStrip = page.getByTestId('hand-strip')
  await expect(handStrip).toBeVisible()

  // wait for the reader's own turn to come back around with a live draw, then tsumogiri it —
  // the hand stays on the same tenpai shape whatever was drawn, which is what reaches tenpai and
  // surfaces "New round" without pinning the live draw itself
  await waitForFullHand(page, handStrip)
  await handTiles(handStrip).last().click()

  const newRound = page.getByRole('button', { name: 'New round' })
  await expect(newRound).toBeVisible()
  await newRound.click()

  // a fresh hand deals in, rather than the page crashing on the old link's log replayed against a
  // brand new random wall
  await waitForFullHand(page, handStrip)
  expect(errors).toEqual([])
})

/** Same deal as `tenpaiWithReplayedLogBoard`, but the log names a tile seat 0 never held or drew —
 *  the shape a hand-edited or stale link takes. `replayLog` throws immediately on load, which is
 *  what the router's `errorElement` (`CrashPage`) exists to catch rather than a blank page. */
function crashingBoard(): string {
  const seat0 = ['1m', '1m', '2m', '2m', '3m', '3m', '4m', '4m', '5m', '5m', '6m', '6m', '7m']
  const seat1 = ['1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p', '1s', '2s', '3s', '4s']
  const seat2 = ['5s', '6s', '7s', '8s', '9s', '1z', '2z', '3z', '4z', '5z', '6z', '7z', '9m']
  const seat3 = ['8m', '9m', '7m', '8p', '9p', '1s', '2s', '3s', '4s', '5s', '6s', '7s', '8s']
  const deal = dealt([seat0, seat1, seat2, seat3])
  return `/efficiency?wall=${tenhou([...deal, '9s'])}&log=D09mT&seat=0&deadWall=1&aka=0&sanma=0`
}

test('a crash falls to the report page with a prefilled GitHub issue link', async ({ page }) => {
  await page.goto(crashingBoard())

  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible()
  await expect(page.locator('p', { hasText: 'cannot remove tile' })).toBeVisible()

  const report = page.getByRole('link', { name: 'Report on GitHub' })
  // `URLSearchParams` encodes spaces as `+`, which plain `decodeURIComponent` leaves alone
  const href = decodeURIComponent((await report.getAttribute('href'))!.replace(/\+/g, ' '))
  expect(href).toContain('https://github.com/kael-k/riichi-trainer/issues/new')
  expect(href).toContain('template=bug_report.md')
  // the situation link, the browser's own UA and the actual thrown message all ride along
  expect(href).toContain(page.url())
  expect(href).toContain('cannot remove tile')
  expect(href.toLowerCase()).toContain(
    (await page.evaluate(() => navigator.userAgent)).toLowerCase(),
  )

  await expect(page.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/')
})

test('a declared seat may only throw the tile it just drew', async ({ page }) => {
  // seat 0 is dealt a shanpon tenpai on 1p/2p, draws a 9s it cannot use and declares riichi
  // throwing it straight back. Riichi locks every later discard to tsumogiri, so on its next turn
  // the thirteen tiles in hand must not be clickable at all — the engine would refuse any of them
  // (`forcedTsumogiri`), and a tile that looks live and silently throws a different one is worse
  // than one that does not look live
  const me = [...Array.from({ length: 9 }, (_, i) => `${i + 1}m`), '1p', '1p', '2p', '2p']
  const pin = Array.from({ length: 7 }, (_, i) => `${i + 3}p`)
  const deal = dealt([
    me,
    [...pin, '1s', '2s', '3s', '4s', '5s', '6s'],
    [...pin, '7s', '8s', '9s', '1z', '2z', '3z'],
    [...pin, '4z', '5z', '6z', '7z', '1s', '2s'],
  ])
  // seat 0's declaring draw, a junk draw each for the other three, then seat 0's next draw
  const live = ['9s', '1z', '2z', '3z', '4z']
  await page.goto(`/lab?wall=${tenhou([...deal, ...live])}&log=D09sTR&seat=0&sanma=0`)
  await expect(page.getByTestId('board').first()).toBeVisible()

  const hand = page.locator('div.flex.justify-center').last()
  await expect(hand.getByRole('img'), 'thirteen tiles plus the draw').toHaveCount(14)
  await expect(hand.getByRole('button'), 'only the drawn tile is live').toHaveCount(1)
})

/**
 * Seat 0 holds an open triplet of 3s plus the 2s/4s kanchan either side of it; seat 3 — its
 * kamicha, the only seat chi ever offers from — holds the fourth and last copy of 3s. Discarding
 * it is simultaneously pon-able (2+ held), chi-able (the kanchan) and shaped like a daiminkan
 * (3+ held) — one discard exercises all three named calls at once. Daiminkan stays unavailable
 * here specifically because efficiency never sets `RoundOptions.calledKan` (ADR-0041; it exists
 * now, gated to `/match` alone), not because the engine can never offer one. Everyone else's
 * tiles are single copies spaced 3 apart within every suit, which makes chi structurally
 * impossible off any of *their* discards too (a run needs two held tiles within 2 of each other),
 * so nothing but the engineered discard could ever be callable in the first place.
 */
function callableBoard(): string {
  const seat0 = ['3s', '3s', '3s', '2s', '4s', '2m', '5m', '8m', '2p', '5p', '8p', '1z', '5z']
  const spaced = (last: string) => [
    '1m',
    '4m',
    '7m',
    '1p',
    '4p',
    '7p',
    '1s',
    '4s',
    '7s',
    '2z',
    '3z',
    '4z',
    last,
  ]
  const seat1 = spaced('9m')
  const seat2 = spaced('9p')
  const seat3 = spaced('3s') // the last copy — seat 0's kamicha, discarding straight into it
  const deal = dealt([seat0, seat1, seat2, seat3])
  return `/efficiency?wall=${tenhou(deal)}&seat=0&sanma=0`
}

test('efficiency never offers a call: chi, pon and daiminkan all stay unavailable', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto(callableBoard())
  await waitForStage(page)
  const handStrip = page.getByTestId('hand-strip')

  // seat 3 (North), seat 0's kamicha, manual too — "two seats seated next to each other" — so
  // its discard is under this test's own control rather than the AI's
  await page.getByRole('button', { name: 'N seat' }).click()
  await page.getByRole('combobox', { name: 'Algorithm' }).selectOption('manual')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // seat 0's own turn: a filler, never touching the triplet or the kanchan. A tile button has no
  // accessible name of its own (`TileButton`, `Tile.tsx`) — its `<Tile>` child does, and clicking
  // that bubbles the same as tapping the glyph a reader actually sees
  await handStrip.getByRole('img', { name: '2m' }).click()

  // the AI seats (1, 2) play themselves out and the board lands on seat 3's turn. Rotating there
  // is the seat plate's own eye ("watch from here") — there is no waiting line with a button on it
  // any more, the felt's turn glow being the only thing that names who owes the decision
  await expect(page.locator('[data-testid="turn-mark"][data-seat="3"]')).toBeVisible({
    timeout: 10_000,
  })
  await page
    .locator('[data-testid="seat-plate"][data-seat="3"]')
    .getByRole('button', { name: 'Watch from here' })
    .click()

  // seat 3 discards the fourth 3s, straight into seat 0's kamicha-only chi eligibility
  await handStrip.getByRole('img', { name: '3s' }).click()

  // no prompt for chi, pon or kan ever appears, on any seat, at any point — play simply
  // continues rather than suspending on an answer nobody is ever asked for
  await expect(page.getByTestId('claim-prompt')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Pass' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Chi', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Pon', exact: true })).toHaveCount(0)
  await expect(handStrip).toBeVisible()
  expect(errors).toEqual([])
})

/**
 * A sanma seat given a closed kan and a kita at once: an open triplet of East plus a lone North
 * dealt straight in, and the dealer's very first live draw is the fourth East — so the very first
 * render of its turn already offers both together. Kita's own rinshan replacement, then the kan's,
 * are pinned as the wall's own last two rinshan slots (popped tail-first, `core/round.ts`'s dead
 * wall) rather than left to a random completion, so neither draw can hand back another North or
 * East and reopen a button this test has already watched close.
 */
function kitaKanBoard(): string {
  const sanmaKinds = KINDS.filter((kind) => kind[1] !== 'm' || kind === '1m' || kind === '9m')
  const seat0 = ['1z', '1z', '1z', '4z', '1p', '4p', '7p', '1s', '4s', '7s', '1m', '9m', '2z']
  const seat1 = ['2p', '5p', '8p', '2s', '5s', '8s', '1m', '9m', '3z', '5z', '6z', '7z', '2z']
  const seat2 = ['3p', '6p', '9p', '3s', '6s', '9s', '1m', '9m', '3z', '4z', '5z', '6z', '7z']
  const deal = dealt([seat0, seat1, seat2])
  const live = ['1z'] // the dealer's first draw: the fourth East, kan-eligible on arrival
  const rinshanTail = ['9p', '9s'] // the wall's last two rinshan slots, popped tail-first

  const placed = [...deal, ...live, ...rinshanTail]
  const left = new Map(sanmaKinds.map((kind) => [kind, 4]))
  for (const tile of placed) left.set(tile, left.get(tile)! - 1)
  const filler = [...left.entries()].flatMap(([kind, count]) =>
    Array.from({ length: count }, () => kind),
  )
  // the dead wall is its own last 14: whatever is left fills the twelve slots this test never
  // inspects, then the two pinned rinshan tiles
  const dead = [...filler.splice(0, 12), ...rinshanTail]
  const wall = [...deal, ...live, ...filler, ...dead]

  expect(wall, 'the fixture wall is not a full sanma wall').toHaveLength(108)
  for (const [kind, count] of left) expect(count, `${kind} is over-used`).toBeGreaterThanOrEqual(0)
  return `/efficiency?wall=${tenhou(wall)}&seat=0&aka=0&sanma=1`
}

function expectSameBox(
  a: { x: number; y: number; width: number; height: number } | null,
  b: typeof a,
  what: string,
) {
  expect(a, `${what}: box missing`).not.toBeNull()
  expect(b, `${what}: box missing`).not.toBeNull()
  expect(Math.abs(a!.x - b!.x), `${what}: x moved`).toBeLessThanOrEqual(1)
  expect(Math.abs(a!.y - b!.y), `${what}: y moved`).toBeLessThanOrEqual(1)
  expect(Math.abs(a!.width - b!.width), `${what}: width changed`).toBeLessThanOrEqual(1)
  expect(Math.abs(a!.height - b!.height), `${what}: height changed`).toBeLessThanOrEqual(1)
}

test('a kita and a kan appearing and disappearing never resize the board or move the hand', async ({
  page,
}) => {
  await page.goto(kitaKanBoard())
  await waitForStage(page)

  const board = page.getByTestId('board').first()
  const handStrip = page.getByTestId('hand-strip')
  const kita = page.getByRole('button', { name: 'Kita' })
  const kan = page.getByRole('button', { name: 'Kan' })

  // the turn opens with both already available — the dealer's first draw completed the quad
  await expect(kita).toBeVisible()
  await expect(kan).toBeVisible()
  const boardBefore = await board.boundingBox()
  const stripBefore = await handStrip.boundingBox()

  await kita.click()
  await expect(kita).toHaveCount(0)
  await expect(kan).toBeVisible()
  expectSameBox(await board.boundingBox(), boardBefore, 'the board, after Kita')
  expectSameBox(await handStrip.boundingBox(), stripBefore, 'the hand strip, after Kita')

  await kan.click()
  await expect(kan).toHaveCount(0)
  await expect(kita).toHaveCount(0)
  expectSameBox(await board.boundingBox(), boardBefore, 'the board, after Kan')
  expectSameBox(await handStrip.boundingBox(), stripBefore, 'the hand strip, after Kan')
})
