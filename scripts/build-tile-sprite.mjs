// Builds src/assets/tiles/sprite.svg from FluffyStuff/riichi-mahjong-tiles (CC0).
// Usage: node scripts/build-tile-sprite.mjs [path-to-Regular-dir]
// Without an argument it downloads the repo tarball to a temp dir first.
// The generated sprite is committed, so this only needs to run when tiles change.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const TARBALL =
  'https://github.com/FluffyStuff/riichi-mahjong-tiles/archive/refs/heads/master.tar.gz'

// file name -> symbol suffix (tile codes match tenhou notation; 0 = red five)
const FILES = {
  Front: 'front',
  Back: 'back',
  Ton: '1z',
  Nan: '2z',
  Shaa: '3z',
  Pei: '4z',
  Haku: '5z',
  Hatsu: '6z',
  Chun: '7z',
}
for (const [name, suit] of [
  ['Man', 'm'],
  ['Pin', 'p'],
  ['Sou', 's'],
]) {
  for (let n = 1; n <= 9; n++) FILES[`${name}${n}`] = `${n}${suit}`
  FILES[`${name}5-Dora`] = `0${suit}`
}

function toSymbol(svg, symbolId, prefix) {
  let s = svg
    .replace(/<\?xml[^>]*\?>/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<metadata[\s\S]*?<\/metadata>/g, '')
    .replace(/<(sodipodi|inkscape):[\w-]+\s[^>]*\/>/g, '')
    .replace(/<sodipodi:namedview[\s\S]*?(\/>|<\/sodipodi:namedview>)/g, '')
    // editor leftovers, and osb: in particular has to go: its xmlns declaration lives on the
    // <svg> root being replaced here, and an undeclared prefix makes the file invalid XML —
    // harmless inside the HTML-parsed sprite, fatal for favicon.svg, which is parsed as XML
    .replace(/\s(inkscape|sodipodi|osb|xmlns:\w+):[\w.-]+="[^"]*"/g, '')
    .replace(/\sxmlns="[^"]*"/g, '')
  const viewBox = s.match(/viewBox="([^"]+)"/)?.[1]
  if (!viewBox) throw new Error(`${symbolId}: no viewBox`)
  s = s
    .replace(/<svg[\s\S]*?>/, `<symbol id="${symbolId}" viewBox="${viewBox}">`)
    .replace(/<\/svg>\s*$/, '</symbol>')
    // ids repeat across the source files; prefix everything to avoid collisions
    .replace(/\bid="([^"]+)"/g, (m, id) => (id === symbolId ? m : `id="${prefix}-${id}"`))
    .replace(/url\(#([^)]+)\)/g, `url(#${prefix}-$1)`)
    .replace(/(xlink:href|href)="#([^"]+)"/g, `$1="#${prefix}-$2"`)
  return s.replace(/>\s+</g, '><').trim()
}

let srcDir = process.argv[2]
if (!srcDir) {
  const tmp = mkdtempSync(join(tmpdir(), 'riichi-tiles-'))
  const tar = join(tmp, 'tiles.tar.gz')
  console.log(`downloading ${TARBALL}`)
  const res = await fetch(TARBALL)
  if (!res.ok) throw new Error(`download failed: ${res.status}`)
  writeFileSync(tar, Buffer.from(await res.arrayBuffer()))
  execFileSync('tar', ['xzf', tar, '-C', tmp])
  srcDir = join(tmp, 'riichi-mahjong-tiles-master', 'Regular')
}

const symbols = Object.entries(FILES).map(([file, code]) => {
  const symbol = toSymbol(readFileSync(join(srcDir, `${file}.svg`), 'utf8'), `tile-${code}`, code)
  // FluffyStuff's back is red; every standard riichi set uses yellow
  return code === 'back' ? symbol.replaceAll('fill:#ff3737', 'fill:#eab308') : symbol
})

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'assets',
  'tiles',
  'sprite.svg',
)
mkdirSync(dirname(out), { recursive: true })
writeFileSync(
  out,
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${symbols.join('\n')}</svg>\n`,
)
console.log(`wrote ${out} (${symbols.length} symbols)`)
