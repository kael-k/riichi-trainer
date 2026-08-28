/** riichi.wiki page with the full rules/theory behind each trainer, kept in one place since
 *  both the home page cards and each trainer's own info button link to the same page. */
export const TRAINER_WIKI = {
  efficiency: 'https://riichi.wiki/Tile_efficiency',
  efficiencySolo: 'https://riichi.wiki/Tile_efficiency',
  shanten: 'https://riichi.wiki/Shanten',
  scoring: 'https://riichi.wiki/Japanese_mahjong_scoring_rules',
  folding: 'https://riichi.wiki/Defense',
  // hand-picked, not derived from the key name: the lab's headline surface is the ukeire ranking
  lab: 'https://riichi.wiki/Tile_efficiency',
  // riichi.wiki blocked verification at commit time (403 on every URL, this one included) — the
  // general rules page rather than a guessed /Hanchan slug, so this never links a dead page
  match: 'https://riichi.wiki/Japanese_mahjong',
} as const satisfies Record<string, string>
