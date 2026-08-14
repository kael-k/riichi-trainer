/** Mahjong jargon explained inline via GlossaryTerm, one entry per term id. Each wikiUrl is
 *  hand-checked against riichi.wiki, not derived from the term id — a naming-convention guess
 *  would silently drift the moment the wiki's own slugs don't match ours. */
export const GLOSSARY = {
  ukeire: {
    labelKey: 'glossary.ukeire.term',
    descKey: 'glossary.ukeire.desc',
    wikiUrl: 'https://riichi.wiki/Ukeire',
  },
  // one combined wiki page covers both terms — riichi.wiki has no separate Tedashi/Tsumogiri pages
  tedashi: {
    labelKey: 'glossary.tedashi.term',
    descKey: 'glossary.tedashi.desc',
    wikiUrl: 'https://riichi.wiki/Tedashi_and_tsumogiri',
  },
  tsumogiri: {
    labelKey: 'glossary.tsumogiri.term',
    descKey: 'glossary.tsumogiri.desc',
    wikiUrl: 'https://riichi.wiki/Tedashi_and_tsumogiri',
  },
  shanten: {
    labelKey: 'glossary.shanten.term',
    descKey: 'glossary.shanten.desc',
    wikiUrl: 'https://riichi.wiki/Shanten',
  },
  genbutsu: {
    labelKey: 'glossary.genbutsu.term',
    descKey: 'glossary.genbutsu.desc',
    wikiUrl: 'https://riichi.wiki/Genbutsu',
  },
  suji: {
    labelKey: 'glossary.suji.term',
    descKey: 'glossary.suji.desc',
    wikiUrl: 'https://riichi.wiki/Suji',
  },
  dora: {
    labelKey: 'glossary.dora.term',
    descKey: 'glossary.dora.desc',
    wikiUrl: 'https://riichi.wiki/Dora',
  },
  uraDora: {
    labelKey: 'glossary.uraDora.term',
    descKey: 'glossary.uraDora.desc',
    wikiUrl: 'https://riichi.wiki/Dora#Ura_dora',
  },
} satisfies Record<string, { labelKey: string; descKey: string; wikiUrl: string }>

export type GlossaryTermId = keyof typeof GLOSSARY
