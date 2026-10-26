import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Heisse Preise publishes an unofficial daily dump scraped from Austrian shops. It stays private and local: never commit or serve it.
const source = 'https://heisse-preise.io/data/latest-canonical.json'
const stores = ['billa', 'spar', 'hofer', 'lidl', 'penny']
const units = { g: ['g', 1], kg: ['g', 1000], ml: ['ml', 1], l: ['ml', 1000], stk: ['stk', 1], 'stück': ['stk', 1] }
const output = new URL('../data/products.local/products.json', import.meta.url)
const directory = await mkdtemp(join(tmpdir(), 'batchday-products-'))

try {
  const file = join(directory, 'dump.json')
  execFileSync('curl', ['--fail', '--location', '--silent', '--show-error', '--compressed', '--max-time', '600', source, '--output', file])
  const items = JSON.parse(await readFile(file, 'utf8'))
  assert.ok(Array.isArray(items) && items.length > 10000, 'Unexpected product dump; review the source before importing')
  const snapshot = { source, downloadedAt: new Date().toISOString(), stores: {} }
  for (const item of items) {
    if (!stores.includes(item?.store) || item.unavailable) continue
    // Pack units such as "0.25 kg" or "2 × 500ml" become grams, millilitres or pieces; washes, centimetres and blanks are dropped.
    const unit = /^(\d+(?:\.\d+)?)?(g|kg|ml|l|stk|stück)$/.exec(String(item.unit).trim().toLowerCase())
    const quantity = unit ? Number(item.quantity) * Number(unit[1] ?? 1) * units[unit[2]][1] : NaN
    if (!unit || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || !item.name.trim()
      || !(Number.isFinite(item.price) && item.price > 0) || !(Number.isFinite(quantity) && quantity > 0)) continue
    const store = snapshot.stores[item.store] ??= { latestChange: '', products: [] }
    const changed = item.priceHistory?.[0]?.date
    if (typeof changed === 'string' && changed > store.latestChange) store.latestChange = changed
    store.products.push({
      id: item.id, name: item.name.trim().replace(/\s+/g, ' '), price: item.price, quantity, unit: units[unit[2]][0],
      bio: item.bio === true, weighted: item.isWeighted === true,
      ...(item.store === 'billa' && /^[a-z0-9-]+$/.test(item.url ?? '') ? { url: `https://shop.billa.at/produkte/${item.url}` } : {}),
    })
  }
  assert.ok(snapshot.stores.billa?.products.length > 1000, 'BILLA products missing from the dump')
  await mkdir(new URL('.', output), { recursive: true })
  const temporaryOutput = new URL(`${output.href}.tmp`)
  try {
    await writeFile(temporaryOutput, JSON.stringify(snapshot))
    await rename(temporaryOutput, output)
  } finally {
    await rm(temporaryOutput, { force: true })
  }
  for (const [store, { latestChange, products }] of Object.entries(snapshot.stores)) {
    console.log(`${store}: ${products.length} products, latest price change ${latestChange || 'unknown'}`)
  }
} finally {
  await rm(directory, { recursive: true, force: true })
}
