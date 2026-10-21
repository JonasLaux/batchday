import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateNutrition } from './nutrition.ts'
import type { NutritionFood } from './nutrition.ts'
import type { Ingredient } from './types.ts'

const food: NutritionFood = { id: 'food', name: 'Food', kcal: 200, protein: 20, carbs: 10, fat: 5 }
const ingredient = (overrides: Partial<Ingredient> = {}): Ingredient => ({
  id: 'food', name: 'Food', amount: 250, unit: 'g', original: '250 g Food', category: 'Other', nutrition: { foodId: 'food', grams: 250 }, ...overrides,
})

test('sums ingredient macros per serving without rounding or changing shopping amounts', () => {
  const ingredients = [ingredient(), ingredient({ amount: 1, unit: 'Stück', nutrition: { foodId: 'food', grams: 50 } })]
  assert.deepEqual(calculateNutrition(ingredients, 2, [food]), { nutrition: { kcal: 300, protein: 30, carbs: 15, fat: 7.5 }, missing: [] })
  assert.deepEqual(calculateNutrition(ingredients, 3, [food]).nutrition, { kcal: 200, protein: 20, carbs: 10, fat: 5 })
  assert.equal(ingredients[1].amount, 1)
  assert.equal(calculateNutrition([ingredient({ nutrition: { foodId: 'food', grams: 1 } })], 3, [food]).nutrition?.kcal, 2 / 3)
})

test('preserves genuine zero macros, zero grams and explicit grams for unknown shopping quantities', () => {
  const salt = { ...food, kcal: 0, protein: 0, carbs: 0, fat: 0 }
  assert.deepEqual(calculateNutrition([ingredient({ amount: null })], 2, [salt]), { nutrition: { kcal: 0, protein: 0, carbs: 0, fat: 0 }, missing: [] })
  assert.deepEqual(calculateNutrition([ingredient({ amount: 0, nutrition: { foodId: 'food', grams: 0 } })], 2, [food]).nutrition, { kcal: 0, protein: 0, carbs: 0, fat: 0 })
  for (const unit of ['g', 'ml', 'Stück', 'EL']) assert.deepEqual(calculateNutrition([ingredient({ unit, nutrition: { foodId: 'food', grams: 0 } })], 2, [food]), { nutrition: null, missing: ['Food'] })
})

test('missing food mappings or grams return an incomplete result instead of a partial total', () => {
  for (const nutrition of [undefined, { foodId: 'unknown', grams: 100 }, { foodId: '', grams: 100 }, { foodId: 'food', grams: NaN }, { foodId: 'food', grams: Infinity }, { foodId: 'food', grams: -1 }, { foodId: 'food' } as Ingredient['nutrition']]) {
    assert.deepEqual(calculateNutrition([ingredient(), ingredient({ name: 'Missing', nutrition })], 2, [food]), { nutrition: null, missing: ['Missing'] })
  }
  assert.deepEqual(calculateNutrition([ingredient({ nutrition: undefined }), ingredient({ nutrition: undefined })], 2, [food]).missing, ['Food'])
})

test('missing and invalid source values invalidate totals, including zero-gram ingredients', () => {
  for (const macro of ['kcal', 'protein', 'carbs', 'fat'] as const) {
    for (const value of [null, undefined, NaN, Infinity, -1]) {
      assert.deepEqual(calculateNutrition([ingredient({ amount: 0, nutrition: { foodId: 'food', grams: 0 } })], 2, [{ ...food, [macro]: value } as NutritionFood]), { nutrition: null, missing: ['Food'] })
    }
  }
})

test('unknown or invalid servings and empty recipes have no calculated nutrition', () => {
  for (const servings of [null, 0, -1, NaN, Infinity]) assert.deepEqual(calculateNutrition([ingredient()], servings, [food]), { nutrition: null, missing: ['Food'] })
  assert.deepEqual(calculateNutrition([], 2, [food]), { nutrition: null, missing: [] })
})

test('numeric overflow in an ingredient, sum or serving division invalidates nutrition', () => {
  const huge = { ...food, kcal: Number.MAX_VALUE }
  assert.equal(calculateNutrition([ingredient()], 2, [huge]).nutrition, null)
  const hugeIngredient = ingredient({ nutrition: { foodId: 'food', grams: 100 } })
  assert.equal(calculateNutrition([hugeIngredient, hugeIngredient], 2, [huge]).nutrition, null)
  assert.equal(calculateNutrition([ingredient()], Number.MIN_VALUE, [food]).nutrition, null)
})
