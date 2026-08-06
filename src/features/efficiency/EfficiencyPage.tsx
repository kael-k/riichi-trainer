import { Check, Link as LinkIcon, Pause, Play } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { SettingRow, TrainerLayout } from '../../components/TrainerLayout'
import { HandDisplay, River, Tile } from '../../components/tiles/Tile'
import { formatElapsed } from '../../lib/formatElapsed'
import { useSettings } from '../settings/settingsStore'
import { decodeSituation, WINDS } from '../situation/urlCodec'
import { DiscardFeedback } from './DiscardFeedback'
import { useEfficiencyRound, type RoundOptions } from './useEfficiencyRound'

export function EfficiencyPage() {
  const [params] = useSearchParams()
  const situation = useMemo(() => decodeSituation(params), [params])
  const settings = useSettings((s) => s.efficiency)
  const update = useSettings((s) => s.update)
  const showTileNumbers = useSettings((s) => s.showTileNumbers)
  const setShowTileNumbers = useSettings((s) => s.setShowTileNumbers)
  const [copied, setCopied] = useState(false)

  // situation overrides pin round behavior so shared links reproduce exactly
  const options = useMemo<RoundOptions>(
    () => ({
      opponents: situation.opponents ?? settings.opponents,
      deadWall: situation.deadWall ?? settings.deadWall,
      aka: situation.aka ?? settings.aka,
    }),
    [situation, settings.opponents, settings.deadWall, settings.aka],
  )

  const round = useEfficiencyRound(situation, options, settings.timerEnabled)

  const copySituation = async () => {
    const query = round.situationQuery()
    await navigator.clipboard.writeText(
      `${location.origin}${location.pathname}${query ? `?${query}` : ''}`,
    )
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const toggle = (key: keyof typeof settings, label: string) => (
    <SettingRow label={label}>
      <input
        type="checkbox"
        checked={settings[key]}
        onChange={(e) => update('efficiency', { [key]: e.target.checked })}
        className="size-5"
      />
    </SettingRow>
  )

  return (
    <TrainerLayout
      title="Efficiency trainer"
      settings={
        <>
          {toggle('showShanten', 'Show shanten')}
          {toggle('timerEnabled', 'Timer')}
          {toggle('showUkeire', 'Show ukeire tiles')}
          {toggle('opponents', 'Opponents (tsumogiri)')}
          {toggle('deadWall', 'Dead wall & dora')}
          {toggle('aka', 'Red fives')}
          {toggle('showWall', 'Show wall')}
          <SettingRow label="Numbers on tiles">
            <input
              type="checkbox"
              checked={showTileNumbers}
              onChange={(e) => setShowTileNumbers(e.target.checked)}
              className="size-5"
            />
          </SettingRow>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-neutral-500">
          <span>
            {situation.round} round · turn {round.turn}
          </span>
          {settings.timerEnabled && (
            <span className="flex items-center gap-1">
              <span className="font-mono tabular-nums">{formatElapsed(round.elapsed)}</span>
              <button
                type="button"
                aria-label={round.paused ? 'Resume timer' : 'Pause timer'}
                onClick={round.togglePause}
                className="flex size-6 items-center justify-center text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
              >
                {round.paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
              </button>
            </span>
          )}
          <span>Wall: {round.wallRemaining} tiles</span>
          {round.doraIndicator && (
            <span className="flex items-center gap-1 [--tile-w:calc(var(--tile-w-base)*0.5)]">
              Dora indicator <Tile id={round.doraIndicator.id} red={round.doraIndicator.red} />
            </span>
          )}
          <span className="ml-auto">Ukeire lost: {round.cumulativeLost}</span>
        </div>

        <HandDisplay
          tiles={round.hand}
          drawn={round.drawn}
          onTileClick={round.finished ? undefined : (i) => round.discard(i)}
        />

        {round.lastResult && (
          <DiscardFeedback
            result={round.lastResult}
            showShanten={settings.showShanten}
            showUkeire={settings.showUkeire}
          />
        )}

        {round.finished && (
          <div className="rounded-lg bg-neutral-100 p-4 dark:bg-neutral-900">
            <p className="font-semibold">Round complete</p>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              Total ukeire lost across {round.turn} turns: {round.cumulativeLost}
            </p>
            <button
              type="button"
              onClick={round.restart}
              className="mt-3 min-h-11 rounded-lg bg-neutral-900 px-4 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
            >
              New round
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-4">
          {round.rivers.map((river, seat) =>
            seat === round.seatIndex || options.opponents ? (
              <div key={seat} className="flex flex-col gap-1">
                <span className="text-xs text-neutral-500">
                  {WINDS[seat]}
                  {seat === round.seatIndex && ' (you)'}
                </span>
                {river.length > 0 ? (
                  <River tiles={river} />
                ) : (
                  <span className="text-xs text-neutral-400">—</span>
                )}
              </div>
            ) : null,
          )}
        </div>

        {settings.showWall && (
          <details className="text-sm text-neutral-500">
            <summary className="cursor-pointer">Wall ({round.wallRemaining} tiles, draw order)</summary>
            <div className="mt-2 flex flex-wrap [--tile-w:calc(var(--tile-w-base)*0.55)]">
              {round.liveWall.map((t, i) => (
                <Tile key={i} id={t.id} red={t.red} />
              ))}
            </div>
          </details>
        )}

        <button
          type="button"
          onClick={copySituation}
          className="flex min-h-11 w-fit items-center gap-1.5 rounded-lg border border-neutral-300 px-4 text-sm font-medium dark:border-neutral-700"
        >
          {copied ? <Check className="size-4" /> : <LinkIcon className="size-4" />}
          {copied ? 'Copied' : 'Copy situation link'}
        </button>
      </div>
    </TrainerLayout>
  )
}
