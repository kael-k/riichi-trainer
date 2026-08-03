import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { TrainerLayout } from '../../components/TrainerLayout'
import { TileButton } from '../../components/tiles/Tile'
import { HONOR, MAN, NUM_TILE_TYPES, PIN, SOU, suitOf, type ParsedTile } from '../../core/tiles'
import {
  allTiles,
  decodeSituation,
  encodeSituation,
  validateSituation,
  type Situation,
  type Wind,
} from './urlCodec'

type ZoneKey = 'hand' | 'wall' | 'river0' | 'river1' | 'river2' | 'river3'

const ZONES: { key: ZoneKey; label: string }[] = [
  { key: 'hand', label: 'Hand' },
  { key: 'wall', label: 'Wall' },
  { key: 'river0', label: 'River E' },
  { key: 'river1', label: 'River S' },
  { key: 'river2', label: 'River W' },
  { key: 'river3', label: 'River N' },
]

const WINDS: Wind[] = ['E', 'S', 'W', 'N']

function zoneTiles(s: Situation, zone: ZoneKey): ParsedTile[] {
  if (zone === 'hand') return s.hand
  if (zone === 'wall') return s.wall
  return s.rivers[Number(zone[5])]
}

const PICKER_ROWS = [
  { offset: MAN, count: 9, redSuit: 'm' },
  { offset: PIN, count: 9, redSuit: 'p' },
  { offset: SOU, count: 9, redSuit: 's' },
  { offset: HONOR, count: 7 },
] as const

export function SituationEditor() {
  const [params, setParams] = useSearchParams()
  const situation = useMemo(() => decodeSituation(params), [params])
  const [zone, setZone] = useState<ZoneKey>('hand')
  const [copied, setCopied] = useState(false)

  const update = (mutate: (s: Situation) => void) => {
    const next = structuredClone(situation)
    mutate(next)
    setParams(encodeSituation(next), { replace: true })
  }

  const used = useMemo(() => {
    const counts = new Uint8Array(NUM_TILE_TYPES)
    const reds: Record<string, boolean> = {}
    for (const tile of allTiles(situation)) {
      counts[tile.id]++
      if (tile.red) reds[suitOf(tile.id)] = true
    }
    return { counts, reds }
  }, [situation])

  const errors = validateSituation(situation)
  const query = encodeSituation(situation)
  const tiles = zoneTiles(situation, zone)

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <TrainerLayout title="Situation editor" showLog={false}>
      <div className="flex flex-col gap-4">
        {/* zone tabs */}
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Edit target">
          {ZONES.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={zone === key}
              onClick={() => setZone(key)}
              className={`min-h-11 shrink-0 rounded-full px-3 text-sm ${
                zone === key
                  ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                  : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
              }`}
            >
              {label}{' '}
              {zoneTiles(situation, key).length > 0 && `(${zoneTiles(situation, key).length})`}
            </button>
          ))}
        </div>

        {/* active zone contents — tap a tile to remove it */}
        <div className="min-h-16 rounded-lg border border-dashed border-neutral-300 p-2 dark:border-neutral-700">
          {tiles.length === 0 ? (
            <p className="text-sm text-neutral-400">
              Tap tiles below to add them here. Tap a placed tile to remove it.
            </p>
          ) : (
            <div className="flex flex-wrap">
              {tiles.map((tile, i) => (
                <TileButton
                  key={i}
                  id={tile.id}
                  red={tile.red}
                  onClick={() => update((s) => void zoneTiles(s, zone).splice(i, 1))}
                />
              ))}
            </div>
          )}
        </div>

        {errors.length > 0 && (
          <ul className="text-sm text-red-600 dark:text-red-400">
            {errors.map((e) => (
              <li key={e}>⚠ {e}</li>
            ))}
          </ul>
        )}

        {/* tile picker */}
        <div className="flex flex-col gap-1 [--tile-w:calc(var(--tile-w-base)*0.9)]">
          {PICKER_ROWS.map((row) => (
            <div key={row.offset} className="flex flex-wrap gap-0.5">
              {Array.from({ length: row.count }, (_, i) => {
                const id = row.offset + i
                const left = 4 - used.counts[id]
                return (
                  <TileButton
                    key={id}
                    id={id}
                    badge={String(left)}
                    disabled={left <= 0}
                    onClick={() => update((s) => void zoneTiles(s, zone).push({ id, red: false }))}
                  />
                )
              })}
              {'redSuit' in row && (
                <TileButton
                  id={row.offset + 4}
                  red
                  badge={used.reds[row.redSuit] ? '0' : '1'}
                  disabled={used.reds[row.redSuit] || used.counts[row.offset + 4] >= 4}
                  onClick={() =>
                    update(
                      (s) =>
                        void zoneTiles(s, zone).push({
                          id: row.offset + 4,
                          red: true,
                        }),
                    )
                  }
                />
              )}
            </div>
          ))}
        </div>

        {/* seed / turn / winds */}
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <label className="flex flex-col gap-1">
            Seed
            <input
              type="text"
              value={situation.seed}
              placeholder="random"
              onChange={(e) => update((s) => void (s.seed = e.target.value))}
              className="min-h-11 rounded border border-neutral-300 px-2 dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
          <label className="flex flex-col gap-1">
            Turn
            <input
              type="number"
              min={0}
              value={situation.turn}
              onChange={(e) =>
                update((s) => void (s.turn = Math.max(0, Number(e.target.value) || 0)))
              }
              className="min-h-11 rounded border border-neutral-300 px-2 dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
          {(['round', 'seat'] as const).map((field) => (
            <label key={field} className="flex flex-col gap-1 capitalize">
              {field}
              <select
                value={situation[field]}
                onChange={(e) => update((s) => void (s[field] = e.target.value as Wind))}
                className="min-h-11 rounded border border-neutral-300 px-2 dark:border-neutral-700 dark:bg-neutral-900"
              >
                {WINDS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={copyLink}
            className="min-h-11 rounded-lg bg-neutral-900 px-4 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
          >
            {copied ? 'Copied ✓' : 'Copy link'}
          </button>
          <Link
            to={`/efficiency${query ? `?${query}` : ''}`}
            className="flex min-h-11 items-center rounded-lg border border-neutral-300 px-4 font-medium dark:border-neutral-700"
          >
            Train efficiency →
          </Link>
          <button
            type="button"
            onClick={() => setParams('', { replace: true })}
            className="ml-auto min-h-11 rounded-lg px-4 text-sm text-neutral-500"
          >
            Reset
          </button>
        </div>
      </div>
    </TrainerLayout>
  )
}
