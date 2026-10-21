import assert from 'node:assert/strict'
import test from 'node:test'
import { buildShoppingList, filterRecipes, formatAmount, generateWeeklyPlan, planItemKey, replacePlannedRecipe, toGeneratedRecipe, validateRecipes } from './recipes.ts'
import type { Filters, Ingredient, Recipe, WeeklySchedule } from './types.ts'

const ingredient = (overrides: Partial<Ingredient> = {}): Ingredient => ({
  id: 'huhn', name: 'Hühnerfleisch', amount: 250, unit: 'g', original: '250 g Hühnerfleisch', category: 'Fleisch', ...overrides,
})
const recipe = (overrides: Partial<Recipe> = {}): Recipe => ({
  id: 'huhn-reis', title: 'Huhn mit Reis', description: '', servings: 2, minutes: 25,
  difficulty: 'easy', diet: 'mixed', tags: ['one-pot'], allergens: [],
  ingredients: [ingredient()], instructions: ['Zutaten garen.'], nutrition: null,
  source: { model: 'test-model', request: 'test', createdAt: '2026-10-19T00:00:00.000Z' }, ...overrides,
})
const filters: Filters = { search: '', diet: '', maxMinutes: null, difficulty: '', tags: [], excludedAllergens: [], pantryOnly: false }

test('scales 250 g for 2 to 375 g for 3 portions', () => {
  const [item] = buildShoppingList([recipe()], [{ recipeId: 'huhn-reis', portions: 3 }], [])
  assert.equal(item.amount, 375)
  assert.equal(item.unresolved, false)
})

test('merges matching ingredients across dishes and converts kilograms', () => {
  const second = recipe({ id: 'anderes-huhn', title: 'Anderes Huhn', ingredients: [ingredient({ amount: 0.5, unit: 'kg' })] })
  const items = buildShoppingList([recipe(), second], [{ recipeId: 'huhn-reis', portions: 2 }, { recipeId: second.id, portions: 2 }], [])
  assert.equal(items.length, 1)
  assert.equal(items[0].amount, 750)
  assert.deepEqual(items[0].recipes, ['Huhn mit Reis', 'Anderes Huhn'])
})

test('keeps mass, volume, pieces and incompatible preparation separate', () => {
  const data = recipe({ ingredients: [ingredient(), ingredient({ unit: 'ml' }), ingredient({ unit: 'Stück', amount: 1 }), ingredient({ note: 'Abtropfgewicht' })] })
  const items = buildShoppingList([data], [{ recipeId: data.id, portions: 2 }], [])
  assert.equal(items.length, 4)
  assert.equal(new Set(items.map((item) => item.id)).size, 4)
})

test('rounds shopping pieces up only after summing, without changing recipe quantities', () => {
  const first = recipe({ ingredients: [ingredient({ amount: 0.5, unit: 'Stück' })] })
  const second = recipe({ id: 'zweites', ingredients: [ingredient({ amount: 0.5, unit: 'Stück' })] })
  const [combined] = buildShoppingList([first, second], [{ recipeId: first.id, portions: 2 }, { recipeId: second.id, portions: 2 }], [])
  assert.equal(combined.amount, 1)
  const [scaled] = buildShoppingList([first], [{ recipeId: first.id, portions: 6 }], [])
  assert.equal(scaled.amount, 2)
  assert.equal(first.ingredients[0].amount, 0.5)
})

test('unknown quantities stay separate from known subtotals', () => {
  const data = recipe({ ingredients: [ingredient(), ingredient({ amount: null, original: 'Huhn nach Bedarf' })] })
  const items = buildShoppingList([data], [{ recipeId: data.id, portions: 3 }], [])
  assert.equal(items.length, 2)
  assert.equal(items.find((item) => !item.unresolved)?.amount, 375)
  assert.equal(items.find((item) => item.unresolved)?.amount, null)
  assert.match(items.find((item) => item.unresolved)!.note!, /Huhn nach Bedarf/)
})

test('unknown base servings retain original amounts until user supplies a base', () => {
  const data = recipe({ servings: null })
  const [unknown] = buildShoppingList([data], [{ recipeId: data.id, portions: 3 }], [])
  assert.equal(unknown.amount, 250)
  assert.equal(unknown.unresolved, true)
  assert.match(unknown.note!, /not scaled to 3 portions/)
  const second = recipe({ id: 'andere-basis', servings: null })
  const separate = buildShoppingList([data, second], [{ recipeId: data.id, portions: 3 }, { recipeId: second.id, portions: 3 }], [])
  assert.deepEqual(separate.map((item) => item.amount), [250, 250])
  const [resolved] = buildShoppingList([data], [{ recipeId: data.id, portions: 3, baseServings: 2 }], [])
  assert.equal(resolved.amount, 375)
  assert.equal(resolved.unresolved, false)
})

test('removes pantry ingredients and water from shopping but keeps salt to taste', () => {
  const data = recipe({ ingredients: [ingredient(), ingredient({ id: 'wasser' }), ingredient({ id: 'salz', name: 'Salz', amount: null, original: 'Salz nach Geschmack' })] })
  const items = buildShoppingList([data], [{ recipeId: data.id, portions: 2 }], ['huhn'])
  assert.deepEqual(items.map((item) => item.name), ['Salz'])
  assert.equal(items[0].unresolved, true)
})

test('filters combine search, vegetarian includes vegan, tags, time, difficulty and allergies', () => {
  const vegan = recipe({ id: 'kuerbis', title: 'Kürbisrisotto', diet: 'vegan', tags: ['one-pot', 'meal-prep'], ingredients: [ingredient({ id: 'reis', name: 'Reis' })] })
  const unknownTime = recipe({ ...vegan, id: 'unknown-time', minutes: null })
  const allergen = recipe({ ...vegan, id: 'with-milk', allergens: ['Milch'] })
  const result = filterRecipes([recipe(), vegan, unknownTime, allergen], {
    ...filters, search: 'kurbis reis', diet: 'vegetarian', maxMinutes: 30, difficulty: 'easy',
    tags: ['one-pot', 'meal-prep'], excludedAllergens: ['Milch'],
  }, [])
  assert.deepEqual(result.map((item) => item.id), ['kuerbis'])
})

test('pantry filter requires all main ingredients but ignores salt, pepper and water', () => {
  const data = recipe({ ingredients: [ingredient(), ingredient({ id: 'salz' }), ingredient({ id: 'pfeffer' }), ingredient({ id: 'wasser' })] })
  assert.equal(filterRecipes([data], { ...filters, pantryOnly: true }, []).length, 0)
  assert.equal(filterRecipes([data], { ...filters, pantryOnly: true }, ['huhn']).length, 1)
})

test('finds English recipes and ingredients alongside German grocery names and cuisine terms', () => {
  const data = recipe({ title: 'Lemon chicken', description: 'A simple skillet supper.', searchTerms: ['Mediterranean'],
    ingredients: [ingredient({ name: 'Hühnerbrust', original: '250 g chicken breast' })] })
  for (const search of ['chicken breast', 'huhnerbrust', 'mediterranean', 'skillet supper']) {
    assert.deepEqual(filterRecipes([data], { ...filters, search }, []).map((item) => item.id), [data.id])
  }
  assert.deepEqual(filterRecipes([data], { ...filters, search: 'beef' }, []), [])
})

test('validates cover photos and the explicit per-serving nutrition basis', () => {
  const data = recipe({ image: { url: 'https://example.org/lemon-chicken.jpg', alt: 'Lemon chicken', credit: 'Photographer, CC BY-SA 4.0', sourceUrl: 'https://example.org/photo.jpg' },
    nutrition: { kcal: 420, protein: 35, carbs: 28, fat: 18 }, nutritionMetadata: { basis: 'per-serving', source: 'Publisher estimate' } })
  assert.equal(validateRecipes([data])[0].nutrition?.protein, 35)
  assert.equal(validateRecipes([data])[0].image?.url, 'https://example.org/lemon-chicken.jpg')
  for (const url of ['javascript:alert(1)', '//example.org/tracker', '/recipe-images.local/lemon-chicken.jpg']) {
    assert.throws(() => validateRecipes([{ ...data, image: { ...data.image, url } }]))
  }
  assert.throws(() => validateRecipes([{ ...data, nutritionMetadata: { basis: 'per-100g', source: 'Publisher' } }]))
  assert.throws(() => validateRecipes([{ ...data, nutrition: null }]))
  assert.throws(() => validateRecipes([{ ...data, nutrition: { ...data.nutrition, protein: Number.NaN } }]))
})

test('excludes disliked canonical ingredients and counts distinct main ingredients', () => {
  const rice = recipe({ id: 'rice', ingredients: [ingredient({ id: 'reis', name: 'Reis' })] })
  assert.deepEqual(filterRecipes([recipe(), rice], { ...filters, excludedIngredients: ['huhn'] }, []).map((item) => item.id), ['rice'])
  const duplicateWithStaples = recipe({ ingredients: [ingredient(), ingredient({ amount: 50 }),
    ingredient({ id: 'salz' }), ingredient({ id: 'pfeffer' }), ingredient({ id: 'wasser' })] })
  assert.equal(filterRecipes([duplicateWithStaples], { ...filters, maxIngredients: 1 }, []).length, 1)
  const twoIngredients = recipe({ ingredients: [ingredient(), ingredient({ id: 'reis' })] })
  assert.equal(filterRecipes([twoIngredients], { ...filters, maxIngredients: 1 }, []).length, 0)
})

test('assigns six chronological meal slots for two days with three portions and compatible recipes', () => {
  const breakfast = recipe({ id: 'breakfast', mealTypes: ['breakfast'] })
  const lunch = recipe({ id: 'lunch' })
  const dinner = recipe({ id: 'dinner', mealTypes: ['dinner', 'lunch'] })
  const schedule: WeeklySchedule = { days: [1, 0], meals: ['dinner', 'breakfast', 'lunch'], portions: 3 }
  const result = generateWeeklyPlan([breakfast, lunch, dinner], schedule, filters, [])
  assert.deepEqual(result, { plan: [
    { recipeId: 'breakfast', portions: 3, day: 0, meal: 'breakfast' },
    { recipeId: 'lunch', portions: 3, day: 0, meal: 'lunch' },
    { recipeId: 'dinner', portions: 3, day: 0, meal: 'dinner' },
    { recipeId: 'breakfast', portions: 3, day: 1, meal: 'breakfast' },
    { recipeId: 'lunch', portions: 3, day: 1, meal: 'lunch' },
    { recipeId: 'dinner', portions: 3, day: 1, meal: 'dinner' },
  ], unfilled: [] })
  assert.deepEqual(generateWeeklyPlan([breakfast, lunch, dinner], schedule, filters, []), result)
})

test('uses every compatible candidate before repeating and keeps repeated meals in separate slots', () => {
  const recipes = [recipe({ id: 'a' }), recipe({ id: 'b' }), recipe({ id: 'c' })]
  const { plan } = generateWeeklyPlan(recipes, { days: [0, 1, 2, 3, 4], meals: ['dinner'], portions: 3 }, filters, [])
  assert.deepEqual(plan.map((item) => item.recipeId), ['a', 'b', 'c', 'a', 'b'])
  assert.equal(new Set(plan.map(planItemKey)).size, 5)
  assert.equal(planItemKey(plan[0]), '0-dinner')
  assert.equal(planItemKey({ recipeId: 'a', portions: 3 }), 'recipe:a')
  const [ingredientTotal] = buildShoppingList([recipes[0]], [plan[0], plan[3]], [])
  assert.equal(ingredientTotal.amount, 750)
})

test('planning applies filters and pantry restrictions, rejects missing yields and reports unfilled meals', () => {
  const known = recipe({ id: 'known', diet: 'vegan', ingredients: [ingredient({ id: 'reis', name: 'Reis' })] })
  const unknown = recipe({ ...known, id: 'unknown', servings: null, mealTypes: ['breakfast'] })
  const excluded = recipe({ id: 'disliked', diet: 'vegan', mealTypes: ['breakfast'] })
  const schedule: WeeklySchedule = { days: [0, 1], meals: ['breakfast', 'dinner'], portions: 3 }
  const activeFilters = { ...filters, diet: 'vegan', excludedIngredients: ['huhn'], pantryOnly: true }
  const result = generateWeeklyPlan([recipe(), known, unknown, excluded], schedule, activeFilters, ['reis'])
  assert.deepEqual(result.plan.map((item) => item.recipeId), ['known', 'known'])
  assert.deepEqual(result.unfilled, [{ day: 0, meal: 'breakfast' }, { day: 1, meal: 'breakfast' }])
  const empty = generateWeeklyPlan([known], schedule, activeFilters, [])
  assert.deepEqual(empty.plan, [])
  assert.equal(empty.unfilled.length, 4)
})

test('rejects duplicate or invalid weekly schedule values without modifying inputs', () => {
  const schedule: WeeklySchedule = { days: [0], meals: ['dinner'], portions: 3 }
  for (const invalid of [null, { ...schedule, days: [0, 0] }, { ...schedule, days: [-1] },
    { ...schedule, days: [7] }, { ...schedule, days: [0.5] }, { ...schedule, days: ['0'] },
    { ...schedule, meals: ['lunch', 'lunch'] }, { ...schedule, meals: ['snack'] },
    ...[0, 13, 2.5, NaN, Infinity].map((portions) => ({ ...schedule, portions })),
  ]) assert.throws(() => generateWeeklyPlan([recipe()], invalid as WeeklySchedule, filters, []), RangeError)
  assert.deepEqual(generateWeeklyPlan([recipe()], { ...schedule, days: [] }, filters, []), { plan: [], unfilled: [] })
  assert.deepEqual(schedule, { days: [0], meals: ['dinner'], portions: 3 })
})

test('rejects malformed catalogue fields, duplicate IDs and missing generation metadata', () => {
  assert.deepEqual(validateRecipes([recipe()]), [recipe()])
  assert.deepEqual(validateRecipes([recipe({ mealTypes: ['breakfast'] })]), [recipe({ mealTypes: ['breakfast'] })])
  for (const value of [null, {}, [recipe(), recipe()], [recipe({ servings: 0 })],
    [recipe({ ingredients: [ingredient({ amount: -1 })] })],
    [recipe({ ingredients: [ingredient({ amount: Infinity })] })],
    [recipe({ source: { model: '', request: 'test', createdAt: '2026-10-19T00:00:00.000Z' } })],
    [recipe({ nutrition: { kcal: 1, protein: NaN, carbs: 1, fat: 1 } })],
    [{ ...recipe(), instructions: [null] }], [{ ...recipe(), difficulty: ['easy'] }],
    [{ ...recipe(), mealTypes: [] }], [{ ...recipe(), mealTypes: ['snack'] }], [{ ...recipe(), mealTypes: ['dinner', 'dinner'] }],
  ]) assert.throws(() => validateRecipes(value))
})

test('rejects nonfinite or nonpositive plan portions and overflowing quantities', () => {
  for (const portions of [0, -1, NaN, Infinity]) {
    assert.throws(() => buildShoppingList([recipe()], [{ recipeId: 'huhn-reis', portions }], []), RangeError)
  }
  assert.throws(() => buildShoppingList([recipe()], [{ recipeId: 'huhn-reis', portions: 2, baseServings: 0 }], []), RangeError)
  assert.throws(() => buildShoppingList([recipe()], [{ recipeId: 'huhn-reis', portions: Number.MAX_VALUE }], []), RangeError)
})

test('formats display quantities with Austrian decimals and keeps missing amounts visible', () => {
  assert.equal(formatAmount(1.255, 'kg'), '1,26 kg')
  assert.equal(formatAmount(375, 'g'), '375 g')
  assert.equal(formatAmount(null, ''), 'Amount missing')
  assert.equal(formatAmount(null, 'Dose'), 'Amount missing (Dose)')
})

const generated = {
  title: 'Topfen-Hendl Bowl', description: 'Quick and filling.', servings: 2, minutes: 25, difficulty: 'easy', diet: 'mixed',
  tags: ['meal-prep'], allergens: ['Milch'], mealTypes: ['lunch', 'dinner'],
  ingredients: [
    { name: 'Hühnerbrust', amount: 300, unit: 'g', category: 'Fleisch & Fisch' },
    { name: 'Magertopfen', amount: 250, unit: 'g', category: 'Milch & Eier' },
    { name: 'Olivenöl', amount: 1, unit: 'EL', category: 'Vorrat' },
    { name: 'Salz', amount: null, unit: '', category: 'Gewürze' },
  ],
  instructions: ['Fry the chicken.', 'Stir in the Topfen.'],
}
const generatedSource = { model: 'claude-haiku-5-5', request: 'chicken bowl', createdAt: '2026-10-19T18:00:00.000Z' }

test('maps generated output to a stored recipe with pantry-compatible ingredient IDs', () => {
  const result = toGeneratedRecipe(generated, generatedSource, [])
  assert.equal(result.id, 'gen-topfen-hendl-bowl')
  assert.deepEqual(result.ingredients.map((item) => item.id), ['huehnerbrust', 'magertopfen', 'olivenoel', 'salz'])
  assert.deepEqual(result.ingredients.map((item) => item.original), ['300 g Hühnerbrust', '250 g Magertopfen', '1 EL Olivenöl', 'Salz (to taste)'])
  const second = toGeneratedRecipe({ ...generated, title: 'Topfen-Nudeln' }, generatedSource, [result.id])
  const merged = buildShoppingList([result, second], [{ recipeId: result.id, portions: 2 }, { recipeId: second.id, portions: 2 }], [])
  assert.equal(merged.find((item) => item.name === 'Magertopfen')?.amount, 500)
  assert.equal(result.nutrition, null)
  assert.equal(toGeneratedRecipe(generated, generatedSource, ['gen-topfen-hendl-bowl', 'gen-topfen-hendl-bowl-2']).id, 'gen-topfen-hendl-bowl-3')
  const [item] = buildShoppingList([result], [{ recipeId: result.id, portions: 3 }], [])
  assert.equal(item.amount, 450)
})

test('rejects incomplete or malformed generated output', () => {
  for (const output of [null, 'text', { ...generated, title: '' }, { ...generated, instructions: [] },
    { ...generated, servings: 0 }, { ...generated, ingredients: [{ amount: 1, unit: 'g', category: 'Vorrat' }] },
    { ...generated, diet: 'carnivore' }]) {
    assert.throws(() => toGeneratedRecipe(output, generatedSource, []))
  }
})

test('recipe feedback replaces only its intended meal and preserves portions', () => {
  const plan = [
    { recipeId: 'original', portions: 3, day: 0 as const, meal: 'dinner' as const },
    { recipeId: 'original', portions: 2, day: 1 as const, meal: 'dinner' as const },
    { recipeId: 'original', portions: 1 },
  ]
  const changed = replacePlannedRecipe(plan, '0-dinner', 'original', 'variant')
  assert.deepEqual(changed[0], { recipeId: 'variant', portions: 3, day: 0, meal: 'dinner' })
  assert.equal(changed[1], plan[1])
  assert.equal(changed[2], plan[2])
  assert.equal(plan[0].recipeId, 'original')
  assert.deepEqual(replacePlannedRecipe(changed, '0-dinner', 'original', 'later'), changed)
  assert.equal(replacePlannedRecipe(plan, 'recipe:original', 'original', 'extra')[2].recipeId, 'extra')
})

test('validates ingredient food mappings and keeps revision provenance', () => {
  const data = recipe({ ingredients: [ingredient({ nutrition: { foodId: 'food', grams: 250 } })],
    source: { model: 'test', request: 'wish', createdAt: '2026-10-21', basedOn: 'original', feedback: 'More vegetables' } })
  assert.equal(validateRecipes([data])[0], data)
  for (const grams of [NaN, Infinity, -1]) {
    assert.throws(() => validateRecipes([{ ...data, ingredients: [ingredient({ nutrition: { foodId: 'food', grams } })] }]), /Invalid recipe/)
  }
  assert.throws(() => validateRecipes([{ ...data, source: { ...data.source, feedback: undefined } }]), /Invalid recipe/)
})

test('feedback retains nutrition mappings for unchanged ingredients without mutating the original', () => {
  const original = toGeneratedRecipe({ ...generated, ingredients: [
    { ...generated.ingredients[0], nutrition: { foodId: 'chicken', grams: 300 } },
    { ...generated.ingredients[2], nutrition: { foodId: 'oil', grams: 12 } },
  ] }, generatedSource, [])
  const changed = toGeneratedRecipe({ ...generated, ingredients: [
    { ...generated.ingredients[0], amount: 150, nutrition: { foodId: 'chicken', grams: 150 } },
    { ...generated.ingredients[2], nutrition: { foodId: 'wrong-oil', grams: 20 } },
  ] }, { ...generatedSource, basedOn: original.id, feedback: 'Half the chicken' }, [original.id], original)
  assert.deepEqual(changed.ingredients[0].nutrition, { foodId: 'chicken', grams: 150 })
  assert.deepEqual(changed.ingredients[1].nutrition, { foodId: 'oil', grams: 12 })
  assert.equal(original.ingredients[0].amount, 300)
  assert.equal(original.ingredients[1].nutrition?.grams, 12)
})
