import type { Filters, Ingredient, MealType, PlanItem, Recipe, ShoppingItem, Weekday, WeeklySchedule } from './types.ts'

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(text)
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const optionalString = (value: unknown) => value === undefined || typeof value === 'string'
const mealTypes: MealType[] = ['breakfast', 'lunch', 'dinner']
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
      && filters.tags.every((tag) => recipe.tags.includes(tag))
      && !filters.excludedAllergens.some((allergen) => recipe.allergens.includes(allergen))
      && !recipe.ingredients.some((ingredient) => excluded.has(ingredient.id))
      && (filters.maxIngredients == null || countIngredients(recipe) <= filters.maxIngredients)
      // Salt, pepper and water are assumed staples only for the pantry filter.
      && (!filters.pantryOnly || recipe.ingredients.every((ingredient) => staples.has(ingredient.id) || available.has(ingredient.id)))
  })
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

function normalizedAmount(ingredient: Ingredient): { amount: number | null; unit: string } {
  const unit = ingredient.unit.trim()
  const conversions: Record<string, [string, number]> = {
    kg: ['g', 1000], l: ['ml', 1000], dl: ['ml', 100], cl: ['ml', 10],
    Stueck: ['Stück', 1], Stück: ['Stück', 1], stk: ['Stück', 1],
  }
  const [normalized, factor] = conversions[unit] ?? [unit, 1]
  return { amount: ingredient.amount === null ? null : ingredient.amount * factor, unit: normalized }
}

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
    if (item.unit === 'Stück' && item.amount !== null && !item.unresolved) item.amount = Math.ceil(item.amount)
  }
  return items.sort((a, b) => a.category.localeCompare(b.category, 'de-AT') || a.name.localeCompare(b.name, 'de-AT'))
}

export function formatAmount(amount: number | null, unit: string): string {
  if (amount === null) return unit ? `Amount missing (${unit})` : 'Amount missing'
  if (!Number.isFinite(amount)) return 'Amount missing'
  return `${new Intl.NumberFormat('de-AT', { maximumFractionDigits: 2 }).format(amount)}${unit ? ` ${unit}` : ''}`
}

const ascii = (value: string) => value.toLocaleLowerCase('de-AT')
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .normalize('NFD').replace(/\p{Diacritic}/gu, '')

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
      const ingredientId = ascii(item.name).replace(/[^a-z0-9]/g, '')
      const previous = original?.ingredients.find((ingredient) => ingredient.id === ingredientId
        && ingredient.amount === amount && ingredient.unit === unit)
      // Unchanged quantities keep their food match and estimated weight across feedback revisions.
      const nutrition = previous?.nutrition ?? item.nutrition
      return {
        id: ingredientId, name: item.name.trim(), amount, unit,
        original: amount === null ? `${item.name.trim()} (to taste)` : `${amount}${unit ? ` ${unit}` : ''} ${item.name.trim()}`,
        category: item.category,
        ...(nutrition !== null && nutrition !== undefined ? { nutrition: record(nutrition) ? { ...nutrition } : nutrition } : {}),
      }
    }),
    instructions: output.instructions, nutrition: null, source,
  }
  return validateRecipes([recipe])[0]
}
