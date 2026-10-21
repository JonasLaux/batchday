import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const metadata = JSON.parse(await readFile(new URL('../data/nutrition-source.json', import.meta.url), 'utf8'))
const output = new URL('../data/nutrition.json', import.meta.url)
const directory = await mkdtemp(join(tmpdir(), 'batchday-nutrition-'))
const decode = (text) => text.replace(/&#x([0-9a-f]+);/gi, (_, value) => String.fromCodePoint(parseInt(value, 16)))
  .replace(/&#([0-9]+);/g, (_, value) => String.fromCodePoint(Number(value)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

try {
  const archive = join(directory, 'bls.zip')
  execFileSync('curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '60', metadata.downloadUrl, '--output', archive])
  const workbook = execFileSync('unzip', ['-p', archive, metadata.sourceWorkbook], { maxBuffer: 20_000_000 })
  assert.equal(createHash('sha256').update(workbook).digest('hex'), metadata.workbookSha256, 'BLS workbook changed; review source metadata before importing')
  const workbookPath = join(directory, 'bls.xlsx')
  await writeFile(workbookPath, workbook)
  const stringsXml = execFileSync('unzip', ['-p', workbookPath, 'xl/sharedStrings.xml'], { encoding: 'utf8', maxBuffer: 10_000_000 })
  // shortcut: only the pinned BLS workbook's simple XLSX strings/cells are supported; use an XLSX library if its format changes.
  const strings = [...stringsXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => decode(
    [...match[1].matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g)].map((text) => text[1]).join('')))
  const sheet = execFileSync('unzip', ['-p', workbookPath, 'xl/worksheets/sheet1.xml'], { encoding: 'utf8', maxBuffer: 150_000_000 })
  const rows = [...sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((row) => Object.fromEntries(
    [...row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)].map((cell) => {
      const value = cell[2].match(/<v>(.*?)<\/v>/)?.[1]
      return [cell[1].match(/r="([A-Z]+)[0-9]+"/)?.[1], cell[1].includes('t="s"') ? strings[Number(value)] : value]
    })))
  const [header, ...data] = rows
  assert.equal(header.A, 'BLS Code')
  assert.equal(header.B, 'Lebensmittelbezeichnung')
  for (const [column, prefix] of Object.entries({ G: 'ENERCC ', M: 'PROT625 ', P: 'FAT ', S: 'CHO ' })) assert.ok(header[column].startsWith(prefix))
  const number = (value) => value != null && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null
  const all = new Map(data.map((row) => [row.A, {
    id: row.A, name: row.B, kcal: number(row.G), protein: number(row.M), carbs: number(row.S), fat: number(row.P),
  }]))
  assert.equal(all.size, 7140)
  const selected = metadata.includedFoodIds.map((id) => {
    const food = all.get(id)
    assert.ok(food, `BLS food missing: ${id}`)
    assert.ok(food.name && ['kcal', 'protein', 'carbs', 'fat'].every((key) => food[key] === null || Number.isFinite(food[key]) && food[key] >= 0))
    return food
  })
  assert.equal(selected.length, new Set(selected.map((food) => food.id)).size)
  assert.equal(selected.length, metadata.count)
  assert.equal(all.get('E111100').kcal, 135)
  assert.equal(all.get('G890702').fat, null)
  const temporaryOutput = new URL(`${output.href}.tmp`)
  try {
    await writeFile(temporaryOutput, `${JSON.stringify(selected, null, 2)}\n`)
    await rename(temporaryOutput, output)
  } finally {
    await rm(temporaryOutput, { force: true })
  }
  console.log(`Imported ${selected.length} BLS ${metadata.version} grocery foods; attribution in data/nutrition-source.json`)
} finally {
  await rm(directory, { recursive: true, force: true })
}
