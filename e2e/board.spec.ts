import { expect, test, type Locator, type Page } from '@playwright/test'

/** The trainers that draw a `Table`. Scoring keeps its board behind its own setting and the lab's
 *  design is still open, so neither is asserted here. */
const TABLE_TRAINERS = ['efficiency', 'folding'] as const

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
    mobileFullscreen: true,
    table: { global: { showSeatWaits: true }, apps: {} },
  },
  version: 3,
})

test.beforeEach(async ({ context }) => {
  await context.addInitScript(
    `localStorage.setItem('riichi-trainer-settings', ${JSON.stringify(SETTINGS)})`,
  )
})

/** The fullscreen stage is the only layout with a hand strip of its own; phones auto-enter it, so
 *  every other viewport clicks the toggle. */
async function enterFullscreen(page: Page) {
  const strip = page.getByTestId('hand-strip')
  const toggle = page.getByRole('button', { name: 'Full screen table' })
  // folding searches fresh random walls for a hand worth drilling, so neither is on screen the
  // instant the route loads — wait for whichever this viewport is going to offer
  await expect(strip.or(toggle).first()).toBeVisible({ timeout: 20_000 })
  if (!(await strip.isVisible())) await toggle.click()
  await expect(strip).toBeVisible()
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: typeof a) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/** A corner cell's *content* box — the cell itself is its grid track, and what can overflow is
 *  what was put in it (the melds and the seat's plate). */
async function cornerFits(page: Page, corner: Locator, what: string) {
  const square = (await page.getByTestId('board').first().boundingBox())!
  const content = await corner.evaluate((el) => {
    const rects = [...el.children].map((c) => c.getBoundingClientRect())
    const x = Math.min(...rects.map((r) => r.left))
    const y = Math.min(...rects.map((r) => r.top))
    return {
      x,
      y,
      width: Math.max(...rects.map((r) => r.right)) - x,
      height: Math.max(...rects.map((r) => r.bottom)) - y,
    }
  })

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

/** A shared folding link whose seats call heavily — the corner cell has to hold several melds and
 *  the seat plate at once, which is the case that broke first. */
const CALLED_BOARD =
  '/folding?wall=0s32m4s2z3p98m9p2s9p44m8p5s32z6m45z1p8234s2z74p67m35s61z3p2m6p80m5z2s9m4s3p6z4s8p3m64z4m1z7s7473z2p1m2p3z36s5m8s1m7z8641p81s9m7p6s55m5z0p99s35p2m1z8p9s9m6s6m8s1z3s1m7z26p236m1s17p7s4m259s3m4z41975p25z7s7m4p1m95p7m2p8m3z7s6z8m6p161s7m&sanma=0&threats=1&wins=1'

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
 *  tanki — which also puts the four melds in a rotated corner rather than the upright one. */
const KAN_SEAT = 2

/**
 * A wall dealt so toimen kans its way to suukantsu: four concealed triplets and a lone 5m, then
 * the fourth copy of each triplet arrives on its next four draws. Four ankan flip four more dora
 * indicators on top of the opening one, so the board ends up drawing every indicator slot it has,
 * one corner has to hold four melds at once, and that seat's plate has to show the winning tile
 * beside them — every extreme the corner cell is asked for, in one hand.
 *
 * The wall is given in full (136 tiles) rather than as a prefix on purpose: a short wall is
 * completed at random, and the dead wall — which is where every kan replacement comes from — would
 * then be tiles the `log` below could not name.
 */
function suukantsuBoard(): string {
  // 13 each, in deal order. Toimen's is the hand being built; the rest are junk that stays far
  // from tenpai, so nobody claims a discard and derails the replay
  const quads = ['1m', '1m', '1m', '2m', '2m', '2m', '3m', '3m', '3m', '4m', '4m', '4m', '5m']
  const junkPin = [...Array.from({ length: 9 }, (_, i) => `${i + 1}p`), '1s', '2s', '3s', '4s']
  const junkSou = [
    ...Array.from({ length: 9 }, (_, i) => `${i + 1}s`),
    ...Array.from({ length: 4 }, (_, i) => `${i + 1}z`),
  ]
  const hands = [junkPin, junkPin, quads, junkSou]

  // live draws, in turn order: toimen takes every third-of-four and it is always the quad's last
  // copy, the other three take a terminal they throw straight back
  const live = ['9m', '8m', '7m', '6m'].flatMap((junk, cycle) => [
    junk,
    junk,
    ['1m', '2m', '3m', '4m'][cycle],
    junk,
  ])

  // the last 14: five dora indicators, five ura, then the four replacement tiles a kan draws —
  // popped off the end, so toimen discards 4z, 3z, 2z, 1z in that order
  const dead = ['1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p', '1s', '1z', '2z', '3z', '4z']

  const placed = [...hands.flat(), ...live, ...dead]
  const left = new Map(KINDS.map((kind) => [kind, 4]))
  for (const tile of placed) left.set(tile, left.get(tile)! - 1)
  // reverse id order, so the 5m copies land at the very end of the live wall rather than as the
  // next draw off the front — a second 5m in that hand is not the tanki this board is posing
  const filler = [...left.entries()]
    .reverse()
    .flatMap(([kind, count]) => Array.from({ length: count }, () => kind))

  const wall = [...hands.flat(), ...live, ...filler, ...dead]
  const log = ['1m', '2m', '3m', '4m']
    .map((quad, cycle) => {
      const replacement = ['4z', '3z', '2z', '1z'][cycle]
      const junk = ['9m', '8m', '7m', '6m'][cycle]
      // one full cycle in turn order: the two seats before toimen, toimen's kan and its discard,
      // then the seat after it
      return `D0${junk}TD1${junk}TA${KAN_SEAT}${quad}D${KAN_SEAT}${replacement}TD3${junk}T`
    })
    .join('')

  expect(wall, 'the fixture wall is not a full wall').toHaveLength(136)
  for (const [kind, count] of left) expect(count, `${kind} is over-used`).toBeGreaterThanOrEqual(0)
  return `/efficiency?wall=${tenhou(wall)}&log=${log}&seat=0&deadWall=1&aka=0&sanma=0`
}

test('four kans: the corner holds them all and every indicator flips', async ({ page }, info) => {
  await page.goto(suukantsuBoard())
  const board = page.getByTestId('board').first()
  await expect(board).toBeVisible()

  // four ankan in toimen's corner, and its plate still beside them
  const corner = page.locator(`[data-testid=corner][data-seat="${KAN_SEAT}"]`)
  const plate = corner.getByTestId('seat-strip')
  await expect(plate).toBeVisible()
  expect(await corner.evaluate((el) => el.children.length), 'four melds and the plate').toBe(5)

  // the winning tile, on the plate beside the melds: tanki on 5m, and three copies are still out
  // there — the hand holds the fourth
  await expect(plate.getByRole('img')).toHaveCount(1)
  await expect(plate.getByRole('img', { name: '5m' })).toBeVisible()
  await expect(plate).toContainText('3')

  // the opening indicator plus one per kan fills every slot the board has, so nothing in that row
  // is still face down
  const dora = page.getByTestId('dora-row')
  await expect(dora.getByRole('img')).toHaveCount(5)
  await expect(dora.getByRole('img', { name: 'Face-down tile' })).toHaveCount(0)

  await cornerFits(page, corner, 'the four-kan corner')
  await page.screenshot({ path: info.outputPath('four-kans.png') })
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
  return `/efficiency?wall=${tenhou([...junkPin, ...junkSou, ...orphans])}&seat=0&sanma=0`
}

test('a thirteen-sided wait fits on the seat that holds it', async ({ page }, info) => {
  await page.goto(thirteenOrphansBoard())
  await expect(page.getByTestId('board').first()).toBeVisible()

  const corner = page.locator(`[data-testid=corner][data-seat="${KAN_SEAT}"]`)
  const plate = corner.getByTestId('seat-strip')
  // five faces and a count for the rest: thirteen tiles at this size are unreadable, and drawn in
  // full they used to run straight off the corner and over the seat's river
  await expect(plate.getByRole('img')).toHaveCount(5)
  await expect(plate).toContainText('+8')

  await cornerFits(page, corner, 'the thirteen-wait corner')
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

  test(`${trainer}: fullscreen fits the whole board and the hand on screen`, async ({ page }) => {
    await page.goto(`/${trainer}`)
    await enterFullscreen(page)

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

test('a called hand keeps its melds and plate inside the felt', async ({ page }) => {
  await page.goto(CALLED_BOARD)
  const board = page.getByTestId('board').first()
  await expect(board).toBeVisible()
  const square = (await board.boundingBox())!

  const rivers = await page.getByTestId('river').all()
  const riverBoxes = (await Promise.all(rivers.map((r) => r.boundingBox()))).filter((b) => !!b)

  // the fixture is only worth anything if it really is a heavily called board: a corner cell holds
  // one child per call, plus the seat's own plate, so four children is three calls
  const busiest = await page
    .getByTestId('corner')
    .evaluateAll((cells) => Math.max(...cells.map((c) => c.children.length)))
  expect(
    busiest,
    'the fixture link no longer produces a heavily called board',
  ).toBeGreaterThanOrEqual(4)

  for (const corner of await page.getByTestId('corner').all()) {
    const seat = await corner.getAttribute('data-seat')
    // the cell's own box is its grid track; what can overflow is its content
    const content = await corner.evaluate((el) => {
      const rects = [...el.children].map((c) => c.getBoundingClientRect())
      const x = Math.min(...rects.map((r) => r.left))
      const y = Math.min(...rects.map((r) => r.top))
      return {
        x,
        y,
        width: Math.max(...rects.map((r) => r.right)) - x,
        height: Math.max(...rects.map((r) => r.bottom)) - y,
      }
    })

    expect(content.x, `seat ${seat} corner runs off the board`).toBeGreaterThanOrEqual(square.x - 1)
    expect(content.y, `seat ${seat} corner runs off the board`).toBeGreaterThanOrEqual(square.y - 1)
    expect(content.x + content.width).toBeLessThanOrEqual(square.x + square.width + 1)
    expect(content.y + content.height).toBeLessThanOrEqual(square.y + square.height + 1)
    for (const river of riverBoxes) {
      expect(overlaps(content, river), `seat ${seat} corner overlaps a river`).toBe(false)
    }
  }
})

test('only a phone-sized viewport comes up fullscreen', async ({ page, viewport }) => {
  // held sideways is the viewport with the least room of all, so it is the one that most needs
  // this — and on a width-only check it was the one that never auto-entered. Anywhere roomier the
  // stage must stay inline until the reader asks for it, which is the same rule read the other way
  const phone = !!viewport && (viewport.width <= 640 || viewport.height <= 520)
  await page.goto('/efficiency')

  const strip = page.getByTestId('hand-strip')
  if (phone) {
    await expect(strip).toBeVisible()
    return
  }
  await expect(page.getByRole('button', { name: 'Full screen table' })).toBeVisible()
  await expect(strip).toHaveCount(0)
  await enterFullscreen(page)
})

test('efficiency-solo: your river is on screen in fullscreen', async ({ page }) => {
  await page.goto('/efficiency-solo')
  await enterFullscreen(page)

  // discard, so the river holds something to be seen at all
  await page.getByTestId('hand-strip').getByRole('button').first().click()

  const river = page.getByText('(you)')
  await expect(river).toBeVisible()
  const box = (await river.boundingBox())!
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1)
})

test('efficiency-solo: the log drawer covers the hand', async ({ page }) => {
  await page.goto('/efficiency-solo')
  await enterFullscreen(page)

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
