import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Tile } from '../../components/tiles/Tile'
import type { ScoreResult } from '../../core/score'

function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <span className="text-neutral-500">{value}</span>
    </li>
  )
}

/** Itemized yaku list and fu breakdown, each gated by its own setting — off by default so
 *  reveal shows just the correct numbers, same as the original app. */
export function ScoreBreakdown({
  result,
  showYaku,
  showFu,
}: {
  result: ScoreResult
  showYaku: boolean
  showFu: boolean
}) {
  const { t } = useTranslation()
  const bonusHan: { key: string; count: number }[] = [
    { key: 'dora', count: result.dora.dora },
    { key: 'aka', count: result.dora.aka },
    { key: 'ura', count: result.dora.ura },
    { key: 'kita', count: result.dora.kita },
  ].filter((b) => b.count > 0)

  return (
    <div className="flex flex-col gap-3 text-sm">
      {showYaku && (
        <div>
          <p className="font-medium text-neutral-500">{t('scoring.yakuListLabel')}</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {result.yakuman.length > 0
              ? result.yakuman.map((name) => (
                  <Row key={name} label={t(`scoring.yakuman.${name}`)} value={t('scoring.yakumanLabel')} />
                ))
              : result.yaku.map((y, i) => (
                  <Row
                    key={i}
                    label={t(`scoring.yaku.${y.name}`)}
                    value={t('scoring.hanCount', { count: y.han })}
                  />
                ))}
            {result.yakuman.length === 0 &&
              bonusHan.map((b) => (
                <Row
                  key={b.key}
                  label={t(`scoring.${b.key}Label`)}
                  value={t('scoring.hanCount', { count: b.count })}
                />
              ))}
          </ul>
        </div>
      )}
      {showFu && result.fuItems.length > 0 && (
        <div>
          <p className="font-medium text-neutral-500">{t('scoring.fuListLabel')}</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {result.fuItems.map((item, i) => (
              <Row
                key={i}
                label={
                  <span className="flex items-center gap-1">
                    {t(`scoring.fu.${item.reason}`)}
                    {item.tile !== undefined && (
                      <span className="[--tile-w:calc(var(--tile-w-base)*0.5)]">
                        <Tile id={item.tile} />
                      </span>
                    )}
                  </span>
                }
                value={item.fu}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
