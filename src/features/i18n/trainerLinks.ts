/** riichi.wiki page with the full rules/theory behind each trainer, kept in one place since
 *  both the home page cards and each trainer's own info button link to the same page. */
export const TRAINER_WIKI = {
  efficiency: 'https://riichi.wiki/Tile_efficiency',
  efficiencySolo: 'https://riichi.wiki/Tile_efficiency',
  shanten: 'https://riichi.wiki/Shanten',
  scoring: 'https://riichi.wiki/Japanese_mahjong_scoring_rules',
  folding: 'https://riichi.wiki/Defense',
} as const satisfies Record<string, string>
