import { useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { CopyLinkButton } from '../../components/CopyLinkButton'
import { GlossaryTerm } from '../../components/GlossaryTerm'
import { Table, type SeatView } from '../../components/tiles/Table'
import { HandDisplay, Tile, UkeireTiles, WallDetails } from '../../components/tiles/Tile'
import { TrainerLayout } from '../../components/TrainerLayout'
import type { SafetyTier, TileDanger } from '../../core/danger'
import type { DiscardOption } from '../../core/efficiency'
import { parseTenhou, serializeTenhouOrdered, tileCode, type ParsedTile } from '../../core/tiles'
import { validateWall, wallWithHand, type WallError } from '../../core/wall'
import type { GlossaryTermId } from '../i18n/glossary'
import { TRAINER_WIKI } from '../i18n/trainerLinks'
import { SettingRow } from '../settings/SettingsDialog'
import { useSettings } from '../settings/settingsStore'
import { useAdvancedSettings } from '../settings/useAdvancedSettings'
import { useTableSettings, type TableSettings } from '../settings/tableSettings'
import { decodeSituation, resolveSanma, WINDS, type Situation } from '../situation/urlCodec'
import { useUrlData } from '../situation/useUrlData'
import { useLabRound, type RoundOptions } from './useLabRound'

/** Only the tiers with a glossary entry get the popover — same subset `FoldFeedback` uses, since
 *  the rest (honour, non-suji, walled) aren't jargon that needs unpacking beyond the reason line. */
const TIER_GLOSSARY: Partial<Record<SafetyTier, GlossaryTermId>> = {
  genbutsu: 'genbutsu',
  suji: 'suji',
  doubleSuji: 'suji',
  halfSuji: 'suji',
}

/** One row of the full ukeire ranking — `DiscardFeedback`'s row shape (tile, shanten/ukeire
 *  label, improving tiles), rendered once per discard instead of once for a best/chosen pair. */
function RankedRow({ option }: { option: DiscardOption }) {
  const { t } = useTranslation()
  return (
    <div className="py-0.5">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-sm font-medium">
        <Tile id={option.discard} />
        <span className="text-neutral-500">
          <Trans
            i18nKey="discardFeedback.shantenLine"
            values={{ count: option.shanten }}
            components={{ term: <GlossaryTerm id="shanten" /> }}
          />
        </span>
        <span className="text-neutral-500">
          {t('discardFeedback.tilesSuffix', { count: option.ukeireCount })}
        </span>
      </div>
      <UkeireTiles tiles={option.ukeireTiles} />
    </div>
  )
}

/** One row of the full danger-tier breakdown — `FoldFeedback`'s row shape (tile, tier label,
 *  per-threat reasons), rendered once per held tile rather than once for the thrown/safest pair.
 *  Renders with no per-threat reasons when nobody is in riichi — `assessDiscards` is total over
 *  an empty threat list, so this is not an empty state. */
function DangerRow({ entry, seats }: { entry: TileDanger; seats: number[] }) {
  const { t } = useTranslation()
  return (
    <div className="py-0.5">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-sm font-medium">
        <Tile id={entry.tile} />
        <span className="text-neutral-500">{t(`folding.tier.${entry.tier}`)}</span>
      </div>
      {entry.against.length > 0 && (
        <div className="flex flex-col gap-1 text-sm text-neutral-600 dark:text-neutral-400">
          {entry.against.map((against, i) => (
            <p key={i} className="flex flex-wrap items-center gap-1.5">
              {entry.against.length > 1 && (
                <span className="text-neutral-500">{t(`wind.${WINDS[seats[i]]}`)}</span>
              )}
              <span className="font-medium">
                {TIER_GLOSSARY[against.tier] ? (
                  <GlossaryTerm id={TIER_GLOSSARY[against.tier]!}>
                    {t(`folding.tier.${against.tier}`)}
                  </GlossaryTerm>
                ) : (
                  t(`folding.tier.${against.tier}`)
                )}
              </span>
              <span>
                {t(`folding.reason.${against.tier}`, {
                  count: against.tier === 'honour' ? entry.visible : against.because.length,
                })}
              </span>
              <span className="flex items-center [--tile-w:calc(var(--tile-w-base)*0.55)]">
                {against.because.map((tile) => (
                  <Tile key={tile} id={tile} />
                ))}
              </span>
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

/** The inline, single-sentence wall-validation error (D-12): names the offending zone and tile,
 *  in the same red the wrong-answer feedback rows already use — never a modal, never a repaired
 *  board. */
function wallErrorMessage(t: (key: string, opts?: Record<string, unknown>) => string, error: WallError): string {
  const zone = t(`lab.zone.${error.zone}`)
  const detail = t(`lab.reason.${error.reason}`, {
    tile: error.tile !== undefined ? tileCode(error.tile) : '',
  })
  return t('lab.error', { zone, detail })
}

// stable references so an unchanged "nothing loaded"/"just reset" state doesn't hand
// useLabRound a fresh array identity every render — that would look like a new wall to
// useTableRound and redeal on every render instead of once
const EMPTY_WALL: ParsedTile[] = []
const EMPTY_RIVER: ParsedTile[] = []

export function LabPage() {
  const { t } = useTranslation()
  const urlSituation = useUrlData(decodeSituation)
  const sanma = useSettings((s) => s.sanma)
  const { aka } = useAdvancedSettings()
  const rawTable = useSettings((s) => s.table)
  const update = useSettings((s) => s.update)
  const { deadWall, showWall, opponentWins } = useTableSettings('lab')
  // `update` only merges at the section level, so a patch of `{ apps: {...} }` would otherwise
  // replace the whole apps layer instead of adding one app's key to it — merge the existing
  // `apps.lab` slice in first.
  const updateTable = (patch: Partial<TableSettings>) =>
    update('table', { apps: { ...rawTable.apps, lab: { ...rawTable.apps.lab, ...patch } } })

  const [wallInput, setWallInput] = useState('')
  // null: nothing hand-authored yet, fall back to the URL's own wall. Set once per Load/Build
  // press — `sanma` is resolved from the pasted wall's own length the same way a shared link's
  // is, so a pasted sanma wall doesn't get padded back out to 136 tiles under a stale yonma setting.
  const [manual, setManual] = useState<{ wall: ParsedTile[]; error?: WallError; sanma: boolean } | null>(
    null,
  )

  const loadWall = () => {
    const parsed = parseTenhou(wallInput)
    const wallSanma = resolveSanma(parsed, urlSituation.sanma, sanma)
    const error = validateWall(parsed, wallSanma ? 3 : 4, wallSanma)
    setManual(error ? { wall: EMPTY_WALL, error, sanma: wallSanma } : { wall: parsed, sanma: wallSanma })
  }
  // seeds the input from a fresh random wall so the reader edits a real board rather than typing
  // 136 tiles from nothing — parsed and validated only once Load is pressed afterward
  const buildWall = () => setWallInput(serializeTenhouOrdered(wallWithHand(0, [], sanma, aka)))
  // no confirmation dialog: the cleared state is session-local and reconstructable by re-loading
  // the same link, the same reasoning the log panel's clear button already relies on
  const resetWall = () => {
    setWallInput('')
    setManual(null)
  }

  const situation: Situation = useMemo(
    () =>
      manual
        ? { ...urlSituation, wall: manual.wall, wallError: manual.error, river: EMPTY_RIVER, sanma: manual.sanma }
        : urlSituation,
    [urlSituation, manual],
  )

  const options = useMemo<RoundOptions>(
    () => ({
      deadWall: situation.deadWall ?? deadWall,
      aka: situation.aka ?? aka,
      sanma: situation.sanma ?? sanma,
      opponentWins,
    }),
    [situation, deadWall, aka, sanma, opponentWins],
  )

  const round = useLabRound(situation, options)
  const threatSeats = round.riichi.flatMap((inRiichi, seat) => (inRiichi ? [seat] : []))

  const seats: SeatView[] = round.rivers.map((river, seat) => ({
    river,
    melds: round.melds[seat],
    nuki: round.nuki[seat],
    riichi: round.riichi[seat],
    hand: seat !== round.seatIndex ? round.boardHands[seat] : undefined,
    concealed: !round.finished,
  }))

  const wallError = situation.wallError
  const loaded = situation.wall.length > 0 && !wallError

  return (
    <TrainerLayout
      title={t('trainer.lab.title')}
      intro={{ text: t('trainer.lab.intro'), wikiUrl: TRAINER_WIKI.lab }}
      settings={
        <>
          <SettingRow label={t('folding.settings.opponentWins')}>
            <input
              type="checkbox"
              checked={opponentWins}
              onChange={(e) => updateTable({ opponentWins: e.target.checked })}
              className="size-5"
            />
          </SettingRow>
          <SettingRow label={t('efficiency.settings.deadWall')}>
            <input
              type="checkbox"
              checked={deadWall}
              onChange={(e) => updateTable({ deadWall: e.target.checked })}
              className="size-5"
            />
          </SettingRow>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="lab-wall-input" className="text-xs font-medium text-neutral-500">
            {t('lab.wallInputLabel')}
          </label>
          <input
            id="lab-wall-input"
            type="text"
            value={wallInput}
            onChange={(e) => setWallInput(e.target.value)}
            className="min-h-11 rounded-lg border border-neutral-300 px-3 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={loadWall}
              className="min-h-11 w-fit rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
            >
              {t('lab.loadWall')}
            </button>
            <button
              type="button"
              onClick={buildWall}
              className="min-h-11 w-fit rounded-lg border border-neutral-300 px-4 text-sm font-medium dark:border-neutral-700"
            >
              {t('lab.buildWall')}
            </button>
            <button
              type="button"
              onClick={resetWall}
              className="min-h-11 w-fit rounded-lg border border-neutral-300 px-4 text-sm font-medium dark:border-neutral-700"
            >
              {t('lab.resetWall')}
            </button>
          </div>
        </div>

        {wallError && (
          <p className="text-sm text-red-600 dark:text-red-400">{wallErrorMessage(t, wallError)}</p>
        )}
        {!wallError && !loaded && <p className="text-sm text-neutral-500">{t('lab.empty')}</p>}

        {loaded && (
          <div className="flex flex-col gap-4 short:flex-row short:items-start">
            <Table
              seats={seats}
              seatIndex={round.seatIndex}
              round={situation.round}
              doraIndicators={round.doraIndicators}
              wallCount={round.liveWall.length}
              wallTotal={round.liveWallSnapshot.length}
            />

            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <HandDisplay
                tiles={round.hand}
                drawn={round.drawn}
                onTileClick={round.finished ? undefined : (i) => round.discard(i)}
              />

              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-neutral-500">{t('lab.ranking')}</span>
                <div className="max-h-48 overflow-y-auto rounded-lg border border-neutral-200 p-2 dark:border-neutral-800">
                  {round.ranked.map((option) => (
                    <RankedRow key={option.discard} option={option} />
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-neutral-500">{t('lab.danger')}</span>
                <div className="max-h-48 overflow-y-auto rounded-lg border border-neutral-200 p-2 dark:border-neutral-800">
                  {round.danger.map((entry) => (
                    <DangerRow key={entry.tile} entry={entry} seats={threatSeats} />
                  ))}
                </div>
              </div>

              {showWall && (
                <WallDetails
                  liveWall={round.liveWallSnapshot}
                  liveWallDrawn={round.liveWallDrawn}
                  deadWall={round.deadWallSnapshot}
                  replacements={round.replacements}
                />
              )}

              <CopyLinkButton query={round.situationQuery} />
            </div>
          </div>
        )}
      </div>
    </TrainerLayout>
  )
}
