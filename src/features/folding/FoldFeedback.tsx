import { CheckCircle2, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { GlossaryTerm } from '../../components/GlossaryTerm'
import { Tile } from '../../components/tiles/Tile'
import type { SafetyTier, TileDanger } from '../../core/danger'
import type { GlossaryTermId } from '../i18n/glossary'
import { useSettings } from '../settings/settingsStore'
import { WINDS } from '../situation/urlCodec'
import type { TurnResult } from './useFoldingRound'

/** Only the tiers with a glossary entry get the popover; the rest (honour, non-suji, walled)
 *  aren't jargon that needs unpacking beyond what folding.reason.* already says inline. */
const TIER_GLOSSARY: Partial<Record<SafetyTier, GlossaryTermId>> = {
  genbutsu: 'genbutsu',
  suji: 'suji',
  doubleSuji: 'suji',
  halfSuji: 'suji',
}

/** Why this tile sits where it does, per threat. The tiers name a relationship to a *seat*, so
 *  the wind is part of the sentence: "genbutsu vs South" is a different claim from "genbutsu". */
function Reasons({ entry, seats }: { entry: TileDanger; seats: number[] }) {
  const { t } = useTranslation()
  if (entry.against.length === 0) return null
  return (
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
  )
}

function Row({ label, entry, seats }: { label: string; entry: TileDanger; seats: number[] }) {
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-2 text-sm font-medium">
        <span className="text-neutral-500">{label}</span>
        <Tile id={entry.tile} />
      </div>
      <Reasons entry={entry} seats={seats} />
    </div>
  )
}

/**
 * One graded discard. Tier only — the threat's hand stays hidden until the hand is over, because
 * showing it now would answer every turn still to come. No deal-in percentages anywhere: an
 * invented number is a number the reader learns.
 */
export function FoldFeedback({ result, seats }: { result: TurnResult; seats: number[] }) {
  const { t } = useTranslation()
  // opt-in: the tie list is a second answer to a question already answered right, and every tile
  // in it is one the reader didn't have to find themselves next turn
  const showEquallySafe = useSettings((s) => s.folding.showEquallySafe)
  const alsoSafe = showEquallySafe
    ? result.safest.filter((entry) => entry.tile !== result.yours.tile)
    : []
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <Row label={t('folding.yourDiscard')} entry={result.yours} seats={seats} />
      {result.correct ? (
        <>
          <p className="flex items-center gap-1.5 text-sm font-medium text-green-600 dark:text-green-400">
            <CheckCircle2 className="size-4 shrink-0" /> {t('folding.wasSafest')}
          </p>
          {alsoSafe.length > 0 && (
            <p className="flex flex-wrap items-center gap-1.5 text-sm text-neutral-500">
              {t('folding.equallySafe')}
              <span className="flex items-center [--tile-w:calc(var(--tile-w-base)*0.55)]">
                {alsoSafe.map((entry) => (
                  <Tile key={entry.tile} id={entry.tile} />
                ))}
              </span>
            </p>
          )}
        </>
      ) : (
        <>
          <p className="flex items-center gap-1.5 text-sm font-medium text-red-600 dark:text-red-400">
            <XCircle className="size-4 shrink-0" /> {t('folding.saferWasAvailable')}
          </p>
          <Row label={t('folding.safestDiscard')} entry={result.safest[0]} seats={seats} />
        </>
      )}
      <p className="text-xs text-neutral-500">{t(`folding.caveat.${caveatFor(result)}`)}</p>
    </div>
  )
}

/** The one thing a folding trainer must never do is let a tier read as "safe". Every tier below
 *  genbutsu still deals into a tanki or a shanpon, and suji only ever spoke about ryanmen. */
function caveatFor(result: TurnResult): 'genbutsu' | 'suji' | 'kabe' | 'general' {
  const tier: SafetyTier = result.yours.tier
  return tier === 'suji' || tier === 'doubleSuji' || tier === 'halfSuji'
    ? 'suji'
    : tier === 'noChance' || tier === 'oneChance'
      ? 'kabe'
      : tier === 'genbutsu'
        ? 'genbutsu'
        : 'general'
}
