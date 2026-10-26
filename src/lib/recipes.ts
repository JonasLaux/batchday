import type { Filters, Ingredient, MealType, MenuDish, PickRule, PlanItem, ProductLine, Recipe, ShoppingItem, StoreProduct, Weekday, WeeklySchedule } from './types.ts'

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(text)
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const optionalString = (value: unknown) => value === undefined || typeof value === 'string'
export const mealTypes: MealType[] = ['breakfast', 'lunch', 'dinner']
export const tagOptions = ['one-pot', 'meal-prep', 'protein-source', 'keto', 'low-calorie']
export const allergenOptions = ['Erdnüsse', 'Gluten', 'Milch', 'Fisch', 'Sellerie', 'Ei', 'Nüsse', 'Krebstiere', 'Senf', 'Soja', 'Sesam']
// Setup offers these before any recipe exists; generation uses the same names, so IDs match.
export const pantryStaples: [name: string, category: string][] = [
  ['Butter', 'Milch & Eier'], ['Olivenöl', 'Vorrat'], ['Rapsöl', 'Vorrat'], ['Knoblauch', 'Obst & Gemüse'], ['Salz', 'Gewürze'],
  ['Pfeffer', 'Gewürze'], ['Zwiebeln', 'Obst & Gemüse'], ['Mehl', 'Vorrat'], ['Zucker', 'Vorrat'], ['Reis', 'Vorrat'],
  ['Nudeln', 'Vorrat'], ['Eier', 'Milch & Eier'], ['Milch', 'Milch & Eier'], ['Essig', 'Vorrat'], ['Haferflocken', 'Brot & Getreide'],
]
export const commonDislikes = ['Champignons', 'Oliven', 'Zwiebeln', 'Knoblauch', 'Fischfilet', 'Garnelen']
const isMeal = (value: unknown): value is MealType => typeof value === 'string' && mealTypes.includes(value as MealType)
const isDay = (value: unknown): value is Weekday => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6

function sourceUrl(value: unknown) {
  if (!text(value)) return false
  try {
    return ['https:', 'http:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}


export function validateRecipes(value: unknown): Recipe[] {
  if (!Array.isArray(value)) throw new Error('The recipe catalogue must be a list.')
  const ids = new Set<string>()
  for (const [index, recipe] of value.entries()) {
    const nutrition = record(recipe) ? recipe.nutrition : undefined
    if (!record(recipe) || !text(recipe.id) || ids.has(recipe.id) || !text(recipe.title)
      || typeof recipe.description !== 'string'
      || !(recipe.servings === null || positive(recipe.servings))
      || !(recipe.minutes === null || positive(recipe.minutes))
      || typeof recipe.difficulty !== 'string' || !['easy', 'medium', 'involved', 'unknown'].includes(recipe.difficulty)
      || typeof recipe.diet !== 'string' || !['vegan', 'vegetarian', 'mixed', 'unknown'].includes(recipe.diet)
      || !strings(recipe.tags) || !strings(recipe.allergens)
      || !(recipe.nutritionMissing === undefined || strings(recipe.nutritionMissing))
      || !(recipe.searchTerms === undefined || strings(recipe.searchTerms))
      || !(recipe.image === undefined || (record(recipe.image) && sourceUrl(recipe.image.url)
        && text(recipe.image.alt) && optionalString(recipe.image.credit)
        && (recipe.image.sourceUrl === undefined || sourceUrl(recipe.image.sourceUrl))))
      || !(recipe.nutritionMetadata === undefined || (nutrition !== null && record(recipe.nutritionMetadata)
        && recipe.nutritionMetadata.basis === 'per-serving' && text(recipe.nutritionMetadata.source)
        && optionalString(recipe.nutritionMetadata.note)))
      || !(recipe.mealTypes === undefined || (Array.isArray(recipe.mealTypes) && recipe.mealTypes.length > 0
        && recipe.mealTypes.every(isMeal) && new Set(recipe.mealTypes).size === recipe.mealTypes.length))
      || !Array.isArray(recipe.ingredients) || !recipe.ingredients.length
      || !recipe.ingredients.every((ingredient: unknown) => record(ingredient)
        && text(ingredient.id) && text(ingredient.name)
        && (ingredient.amount === null || nonnegative(ingredient.amount))
        && typeof ingredient.unit === 'string' && text(ingredient.original)
        && text(ingredient.category) && optionalString(ingredient.note)
        && (ingredient.nutrition === undefined || (record(ingredient.nutrition)
          && text(ingredient.nutrition.foodId) && nonnegative(ingredient.nutrition.grams))))
      || !strings(recipe.instructions) || !recipe.instructions.length
      || !(nutrition === null || (record(nutrition)
        && ['kcal', 'protein', 'carbs', 'fat'].every((key) => nonnegative(nutrition[key]))))
      || !record(recipe.source) || !text(recipe.source.model) || !text(recipe.source.request)
      || !text(recipe.source.createdAt)
      || !optionalString(recipe.source.basedOn) || !optionalString(recipe.source.feedback)
      || (recipe.source.basedOn !== undefined && (!text(recipe.source.basedOn) || !text(recipe.source.feedback)))) {
      throw new Error(`Invalid recipe record at position ${index + 1}.`)
    }
    ids.add(recipe.id)
  }
  return value as Recipe[]
}

const staples = new Set(['wasser', 'salz', 'pfeffer'])
const searchable = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('de-AT')

export function countIngredients(recipe: Recipe): number {
  return new Set(recipe.ingredients.filter((ingredient) => !staples.has(ingredient.id)).map((ingredient) => ingredient.id)).size
}

export function filterRecipes(recipes: Recipe[], filters: Filters, pantry: string[]): Recipe[] {
  const available = new Set(pantry)
  const excluded = new Set(filters.excludedIngredients ?? [])
  const words = searchable(filters.search).trim().split(/\s+/).filter(Boolean)
  return recipes.filter((recipe) => {
    const haystack = searchable([recipe.title, recipe.description, ...(recipe.searchTerms ?? []),
      ...recipe.ingredients.flatMap((ingredient) => [ingredient.name, ingredient.original])].join(' '))
    return words.every((word) => haystack.includes(word))
      && (!filters.diet || filters.diet === 'all' || recipe.diet === filters.diet
        || (filters.diet === 'vegetarian' && recipe.diet === 'vegan'))
      && (filters.maxMinutes === null || (recipe.minutes !== null && recipe.minutes <= filters.maxMinutes))
      && (!filters.difficulty || filters.difficulty === 'all' || recipe.difficulty === filters.difficulty)
      && filters.tags.every((tag) => {
        if (tag === 'protein-source') return recipe.nutrition !== null && recipe.nutrition.protein >= 25
        if (tag === 'keto') return recipe.nutrition !== null && recipe.nutrition.carbs <= 10
        if (tag === 'low-calorie') return recipe.nutrition !== null && recipe.nutrition.kcal <= 500
        return recipe.tags.includes(tag)
      })
      && !filters.excludedAllergens.some((allergen) => recipe.allergens.includes(allergen))
      && !recipe.ingredients.some((ingredient) => excluded.has(ingredient.id))
      && (filters.maxIngredients == null || countIngredients(recipe) <= filters.maxIngredients)
      // Salt, pepper and water are assumed staples only for the pantry filter.
      && (!filters.pantryOnly || recipe.ingredients.every((ingredient) => staples.has(ingredient.id) || available.has(ingredient.id)))
  })
}

export const ingredientIds = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((id): id is string => typeof id === 'string' && /^[a-z0-9]+$/.test(id)))].slice(0, 60)
  : []
const oneOf = <T>(options: readonly T[], value: unknown, fallback: T): T => options.includes(value as T) ? value as T : fallback

// Browser storage and server requests are untrusted: keep only known preference values.
export function readFilters(value: unknown): Filters {
  const input: Record<string, unknown> = record(value) ? value : {}
  const known = (options: string[], items: unknown) => Array.isArray(items) ? options.filter((option) => items.includes(option)) : []
  return {
    search: typeof input.search === 'string' ? input.search.slice(0, 200) : '',
    diet: oneOf(['', 'vegan', 'vegetarian', 'mixed'], input.diet, ''),
    maxMinutes: oneOf([null, 15, 30, 45, 60, 90], input.maxMinutes, null),
    difficulty: oneOf(['', 'easy', 'medium', 'involved'], input.difficulty, ''),
    tags: known(tagOptions, input.tags),
    excludedAllergens: known(allergenOptions, input.excludedAllergens),
    excludedIngredients: ingredientIds(input.excludedIngredients),
    maxIngredients: oneOf([null, 5, 8, 10, 12], input.maxIngredients, null),
    pantryOnly: input.pantryOnly === true,
  }
}

export function readSchedule(value: unknown, fallback: WeeklySchedule): WeeklySchedule {
  const input = record(value) ? value : {}
  return {
    days: [...new Set(Array.isArray(input.days) ? input.days.filter(isDay) : fallback.days)],
    meals: [...new Set(Array.isArray(input.meals) ? input.meals.filter(isMeal) : fallback.meals)],
    portions: typeof input.portions === 'number' && Number.isInteger(input.portions) && input.portions >= 1 && input.portions <= 12
      ? input.portions : fallback.portions,
  }
}

export function planItemKey(item: PlanItem): string {
  return item.day !== undefined && item.meal !== undefined ? `${item.day}-${item.meal}` : `recipe:${item.recipeId}`
}

export function replacePlannedRecipe(plan: PlanItem[], key: string, originalId: string, recipeId: string): PlanItem[] {
  return plan.map((item) => item.recipeId === originalId && planItemKey(item) === key
    ? { recipeId, portions: item.portions, ...(item.day !== undefined ? { day: item.day, meal: item.meal } : {}) }
    : item)
}

export function generateWeeklyPlan(recipes: Recipe[], schedule: WeeklySchedule, filters: Filters, pantry: string[]): {
  plan: PlanItem[]; unfilled: { day: Weekday; meal: MealType }[]
} {
  if (!record(schedule) || !Array.isArray(schedule.days) || !schedule.days.every(isDay)
    || new Set(schedule.days).size !== schedule.days.length
    || !Array.isArray(schedule.meals) || !schedule.meals.every(isMeal)
    || new Set(schedule.meals).size !== schedule.meals.length
    || !Number.isInteger(schedule.portions) || schedule.portions < 1 || schedule.portions > 12) {
    throw new RangeError('Weekdays and meals must be unique and valid; portions must be between 1 and 12.')
  }
  const eligible = filterRecipes(recipes, filters, pantry).filter((recipe) => positive(recipe.servings))
  const uses = new Map<string, number>()
  const plan: PlanItem[] = []
  const unfilled: { day: Weekday; meal: MealType }[] = []
  for (const day of [...schedule.days].sort((a, b) => a - b)) {
    for (const meal of mealTypes.filter((item) => schedule.meals.includes(item))) {
      const candidates = eligible.filter((recipe) => (recipe.mealTypes ?? ['lunch', 'dinner']).includes(meal))
      const selected = candidates.reduce<Recipe | undefined>((leastUsed, candidate) =>
        !leastUsed || (uses.get(candidate.id) ?? 0) < (uses.get(leastUsed.id) ?? 0) ? candidate : leastUsed, undefined)
      if (!selected) {
        unfilled.push({ day, meal })
        continue
      }
      plan.push({ recipeId: selected.id, portions: schedule.portions, day, meal })
      uses.set(selected.id, (uses.get(selected.id) ?? 0) + 1)
    }
  }
  return { plan, unfilled }
}

// One new recipe per scheduled meal; swaps reuse the saved catalogue.
export const selectionSize = (days: number) => days

// Uses the preferred day when it is still open, else the first open day for that meal; a full week is unchanged.
export function fillOpenSlot(plan: PlanItem[], schedule: WeeklySchedule, recipeId: string, meal: MealType, preferredDay?: Weekday): PlanItem[] {
  if (!schedule.meals.includes(meal)) return plan
  const open = [...schedule.days].sort((a, b) => a - b).filter((day) => !plan.some((item) => item.day === day && item.meal === meal))
  const day = preferredDay !== undefined && open.includes(preferredDay) ? preferredDay : open[0]
  return day === undefined ? plan : [...plan, { recipeId, portions: schedule.portions, day, meal }]
}

function normalizedAmount(ingredient: Ingredient): { amount: number | null; unit: string } {
  const unit = ingredient.unit.trim()
  const conversions: Record<string, [string, number]> = {
    kg: ['g', 1000], l: ['ml', 1000], dl: ['ml', 100], cl: ['ml', 10],
    Stueck: ['Stück', 1], Stück: ['Stück', 1], stk: ['Stück', 1],
  }
  const [normalized, factor] = conversions[unit] ?? [unit, 1]
  return { amount: ingredient.amount === null ? null : ingredient.amount * factor, unit: normalized }
}

// Rounds up to whole pieces or packs, ignoring float noise such as 500.00000000000006 g from scaled sums.
const wholeUp = (value: number) => Math.ceil(Math.round(value * 1e6) / 1e6)

export function buildShoppingList(recipes: Recipe[], plan: PlanItem[], pantry: string[]): ShoppingItem[] {
  const available = new Set(pantry)
  const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]))
  const result = new Map<string, ShoppingItem>()
  for (const [planIndex, selection] of plan.entries()) {
    if (!positive(selection.portions) || (selection.baseServings !== undefined && !positive(selection.baseServings))) {
      throw new RangeError('Portions and base servings must be positive, finite numbers.')
    }
    const recipe = byId.get(selection.recipeId)
    if (!recipe) continue
    const base = selection.baseServings ?? recipe.servings
    for (const ingredient of recipe.ingredients) {
      if (ingredient.id === 'wasser' || available.has(ingredient.id)) continue
      const normalized = normalizedAmount(ingredient)
      const unresolved = base === null || normalized.amount === null
      const amount = normalized.amount === null ? null : normalized.amount * (base === null ? 1 : selection.portions / base)
      if (amount !== null && !Number.isFinite(amount)) throw new RangeError('The ingredient quantity is too large.')
      const note = [ingredient.note,
        base === null ? `Base servings missing: original quantity, not scaled to ${selection.portions} portions.` : '',
        ingredient.amount === null ? `Amount missing: ${ingredient.original}` : '',
      ].filter(Boolean).join(' ')
      // Unknown yields remain per recipe: adding their original amounts would imply a scaled total.
      const key = JSON.stringify([ingredient.id, normalized.unit, ingredient.note ?? '',
        base === null ? [recipe.id, planIndex] : normalized.amount === null ? 'unknown-amount' : 'known'])
      const existing = result.get(key)
      if (existing) {
        if (amount !== null && existing.amount !== null) {
          const total = existing.amount + amount
          if (!Number.isFinite(total)) throw new RangeError('The ingredient quantity is too large.')
          existing.amount = total
        }
        if (!existing.recipes.includes(recipe.title)) existing.recipes.push(recipe.title)
        if (note && existing.note !== note) existing.note = `${existing.note ?? ''} ${note}`.trim()
      } else {
        result.set(key, { id: key, name: ingredient.name, amount, unit: normalized.unit,
          category: ingredient.category, recipes: [recipe.title], unresolved, ...(note ? { note } : {}) })
      }
    }
  }
  const items = [...result.values()]
  for (const item of items) {
    if (item.unit === 'Stück' && item.amount !== null && !item.unresolved) item.amount = wholeUp(item.amount)
  }
  return items.sort((a, b) => a.category.localeCompare(b.category, 'de-AT') || a.name.localeCompare(b.name, 'de-AT'))
}

export function formatAmount(amount: number | null, unit: string): string {
  if (amount === null) return unit ? `Amount missing (${unit})` : 'Amount missing'
  if (!Number.isFinite(amount)) return 'Amount missing'
  return `${new Intl.NumberFormat('de-AT', { maximumFractionDigits: 2 }).format(amount)}${unit ? ` ${unit}` : ''}`
}

export const pickRules: PickRule[] = ['cheapest', 'store-brand', 'bio']
const storeBrands: Record<string, RegExp> = { billa: /^(clever|billa|ja! natürlich|da komm ich her)\b/i, spar: /^(s-budget|spar)\b/i }
const packUnits: Record<string, StoreProduct['unit']> = { g: 'g', ml: 'ml', Stück: 'stk' }
const spoons = ['EL', 'TL', 'Prise']

// One line for all rows of an ingredient: rows in the product's unit add up to whole packs; other rows share them.
// Flagged when a row cannot be compared (a few spoons of a packed product excepted). Sold by weight, an amount it
// cannot weigh has no cost.
export function productLine(rows: ShoppingItem[], product: StoreProduct): ProductLine {
  const known = rows.filter((row) => !row.unresolved && row.amount !== null && packUnits[row.unit] === product.unit)
  const amount = known.length ? known.reduce((sum, row) => sum + (row.amount ?? 0), 0) : null
  const check = rows.some((row) => !known.includes(row)
    && !(spoons.includes(row.unit) && !product.weighted && row.amount !== null && row.amount <= 4))
  if (product.weighted) return { product, packs: null, cost: amount === null ? null : product.price * amount / product.quantity, check }
  const packs = amount === null ? 1 : Math.max(1, wholeUp(amount / product.quantity))
  return { product, packs, cost: packs * product.price, check }
}

// Loose fruit and vegetables are weighed out to the amount; any other weighed good (a loaf, a meat pack) costs at
// least its exact-amount price.
export const isLowerBound = (line: ProductLine, category: string) => line.packs === null && line.cost !== null && category !== 'Obst & Gemüse'

// The rule narrows suitable products (store brand or bio when any exist). Lines win on cost, flagged or not (a flagged
// line keeps its label; on equal cost the unflagged one wins); lower-bound costs follow, then lines without a cost.
export function chooseProduct(rows: ShoppingItem[], suitable: StoreProduct[], rule: PickRule, store: string, chosenId?: string): ProductLine | null {
  const chosen = suitable.find((product) => product.id === chosenId)
  if (chosen) return productLine(rows, chosen)
  const preferred = suitable.filter((product) => rule === 'bio' ? product.bio : rule === 'store-brand' && !!storeBrands[store]?.test(product.name))
  const tier = (line: ProductLine) => line.cost === null ? 2 : isLowerBound(line, rows[0]?.category ?? '') ? 1 : 0
  return (preferred.length ? preferred : suitable).map((product) => productLine(rows, product))
    .sort((a, b) => tier(a) - tier(b) || (a.cost ?? Infinity) - (b.cost ?? Infinity) || Number(a.check) - Number(b.check))[0] ?? null
}

// Saved product IDs of one ingredient: [] when nothing fits; null (match again) when never matched or every product left the shop.
export function savedProducts(ids: string[] | undefined, byId: ReadonlyMap<string, StoreProduct>): StoreProduct[] | null {
  return ids && (!ids.length || ids.some((id) => byId.has(id))) ? ids.flatMap((id) => byId.get(id) ?? []) : null
}

const ascii = (value: string) => value.toLocaleLowerCase('de-AT')
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .normalize('NFD').replace(/\p{Diacritic}/gu, '')
export const ingredientId = (name: string) => ascii(name).replace(/[^a-z0-9]/g, '')

// Crude German stem so inflections (Tomaten, Zwiebeln) match their base word rather than compounds (Tomatensoße).
const stems = (value: string) => ascii(value).split(/[^a-z0-9]+/).filter(Boolean).map((word) => word.length > 4 ? word.replace(/(en|es|e|n|s)$/, '') : word)
// Character trigrams tolerate compounds and plural/spelling variants (Brustfilet, Tomaten, Hühner/Huehner).
function trigrams(words: string[]) {
  const padded = ` ${words.join(' ')} `
  const grams = new Set<string>()
  for (let index = 0; index + 3 <= padded.length; index++) grams.add(padded.slice(index, index + 3))
  return grams
}
const itemCache = new WeakMap<object, { grams: Set<string>; words: string[] }>()

// Best matches for the search terms, so a model only chooses among real IDs instead of reading whole lists.
// Rare words (Skyr, Kidney) outweigh common ones (natur, Fett) and a term's first word, usually the food, counts double.
// Each term ranks on its own and the lists take turns, so a broad term cannot crowd out a specific one.
// Tuned on 147 logged recipe lookups (146 found).
export function shortlist<T extends { name: string }>(terms: string[], items: readonly T[], count = 8): T[] {
  const cached = items.map((item) => {
    let entry = itemCache.get(item)
    if (!entry) {
      const words = stems(item.name)
      itemCache.set(item, entry = { grams: trigrams(words), words })
    }
    return entry
  })
  const words = new Map<string, { weight: number; matches: Float64Array }>()
  const word = (value: string) => {
    let found = words.get(value)
    if (!found) {
      const grams = trigrams(stems(value))
      const matches = Float64Array.from(cached, (item) => [...grams].filter((gram) => item.grams.has(gram)).length / grams.size)
      const frequency = matches.filter((match) => match >= 0.7).length
      words.set(value, found = { weight: Math.max(0.1, Math.log(items.length / (1 + frequency))), matches })
    }
    return found
  }
  const queries = new Set(terms.map((term) => ascii(term).replace(/[^a-z0-9]+/g, ' ').trim()).filter((term) => trigrams(stems(term)).size > 2))
  const lists = [...queries].map((query) => {
    const values = [...new Set(query.split(' '))]
    const parts = values.map((value, position) => ({ ...word(value), boost: position ? 1 : 2 }))
    const weight = parts.reduce((sum, part) => sum + part.weight * part.boost, 0)
    // Equal scores prefer query words that stand alone or end a compound (Eier, Teebutter) over ones that begin it (Eierlikör).
    const ends = values.flatMap(stems).filter((end) => end.length > 2)
    const fit = (index: number) => ends.filter((end) => cached[index].words.some((value) => value.endsWith(end))).length
    return items.map((item, index) => ({ item, index, score: parts.reduce((sum, part) => sum + part.weight * part.boost * part.matches[index], 0) / weight }))
      .filter(({ score }) => score >= 0.5)
      .sort((a, b) => b.score - a.score || fit(b.index) - fit(a.index) || a.item.name.length - b.item.name.length)
  })
  const result = new Set<T>()
  for (let rank = 0; result.size < count && lists.some((list) => rank < list.length); rank++) {
    for (const list of lists) if (list[rank] && result.size < count) result.add(list[rank].item)
  }
  return [...result]
}

// Menu ideas are untrusted model output: keep well-formed dishes for the requested meals only.
export function toMenu(output: unknown, meals: MealType[]): MenuDish[] {
  const dishes = meals.flatMap((meal) => {
    const items: unknown = record(output) ? output[meal] : undefined
    return (Array.isArray(items) ? items : []).flatMap((item: unknown) => record(item) && text(item.title) && typeof item.brief === 'string'
      ? [{ meal, title: item.title.trim().slice(0, 120), brief: item.brief.trim().slice(0, 300) }] : [])
  })
  if (!dishes.length) throw new Error('The menu came back empty.')
  return dishes
}

// The recipe names each ingredient's food in words; these terms feed the food shortlist.
export function foodQueries(output: unknown): string[][] {
  const items: unknown[] = record(output) && Array.isArray(output.ingredients) ? output.ingredients : []
  return items.map((item) => record(item) && record(item.food) && strings(item.food.terms)
    ? [...item.food.terms, ...(text(item.name) ? [item.name] : [])].slice(0, 4) : [])
}

// Keeps a picked food only when it came from that ingredient's own shortlist; anything else stays unmatched.
export function withFoodPicks(output: unknown, candidates: { id: string }[][], picks: unknown): unknown {
  if (!record(output) || !Array.isArray(output.ingredients)) return output
  const chosen: unknown[] = record(picks) && Array.isArray(picks.foods) ? picks.foods : []
  return { ...output, ingredients: output.ingredients.map((item: unknown, index) => {
    if (!record(item)) return item
    const { food, ...rest } = item
    const id = chosen[index]
    const grams = record(food) ? food.grams : undefined
    return { ...rest, nutrition: typeof id === 'string' && nonnegative(grams) && candidates[index]?.some((candidate) => candidate.id === id)
      ? { foodId: id, grams } : null }
  }) }
}

// Per-item string lists from a model answer; with candidates, only that item's own IDs survive.
// null marks an unusable answer (not a list, nothing valid in it, or no candidates to pick), unlike a deliberate empty list.
export function listAnswer(output: unknown, key: string, count: number, candidates?: { id: string }[][]): (string[] | null)[] {
  const lists: unknown[] = record(output) && Array.isArray(output[key]) ? output[key] : []
  return Array.from({ length: count }, (_, index) => {
    const list = lists[index]
    const own = candidates && (candidates[index] ?? [])
    if (!Array.isArray(list) || own?.length === 0) return null
    const kept = [...new Set(list.filter((value): value is string => text(value) && (!own || own.some((candidate) => candidate.id === value))))]
    return kept.length || !list.length ? kept : null
  })
}

// Generated recipes arrive as untrusted model output; map to the stored shape, then validate like any catalogue record.
export function toGeneratedRecipe(output: unknown, source: Recipe['source'], existingIds: string[], original?: Recipe): Recipe {
  if (!record(output) || !text(output.title) || !Array.isArray(output.ingredients)) throw new Error('The generated recipe is incomplete.')
  const base = `gen-${ascii(output.title).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'recipe'}`
  let id = base
  for (let n = 2; existingIds.includes(id); n++) id = `${base}-${n}`
  const recipe = {
    id, title: output.title.trim(), description: output.description, servings: output.servings, minutes: output.minutes,
    difficulty: output.difficulty, diet: output.diet, tags: output.tags, allergens: output.allergens, mealTypes: output.mealTypes,
    ingredients: output.ingredients.map((item: unknown) => {
      if (!record(item) || !text(item.name)) throw new Error('A generated ingredient has no name.')
      const amount = item.amount ?? null
      const unit = typeof item.unit === 'string' ? item.unit : ''
      const key = ingredientId(item.name)
      const previous = original?.ingredients.find((ingredient) => ingredient.id === key
        && ingredient.amount === amount && ingredient.unit === unit)
      // Unchanged quantities keep their food match and estimated weight across feedback revisions.
      const nutrition = previous?.nutrition ?? item.nutrition
      return {
        id: key, name: item.name.trim(), amount, unit,
        original: amount === null ? `${item.name.trim()} (to taste)` : `${amount}${unit ? ` ${unit}` : ''} ${item.name.trim()}`,
        category: item.category,
        ...(nutrition !== null && nutrition !== undefined ? { nutrition: record(nutrition) ? { ...nutrition } : nutrition } : {}),
      }
    }),
    instructions: output.instructions, nutrition: null, source,
  }
  return validateRecipes([recipe])[0]
}
