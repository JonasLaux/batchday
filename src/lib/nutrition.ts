import type { Ingredient, Recipe } from './types.ts'

export type NutritionFood = {
  id: string
  name: string
  kcal: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
}

const macros = ['kcal', 'protein', 'carbs', 'fat'] as const
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

export function calculateNutrition(ingredients: readonly Ingredient[], servings: number | null, foods: readonly NutritionFood[]): { nutrition: Recipe['nutrition']; missing: string[] } {
  if (!ingredients.length || !nonnegative(servings) || servings === 0) return { nutrition: null, missing: [...new Set(ingredients.map((ingredient) => ingredient.name))] }

  const byId = new Map(foods.map((food) => [food.id, food]))
  const total = { kcal: 0, protein: 0, carbs: 0, fat: 0 }
  const missing = new Set<string>()

  for (const ingredient of ingredients) {
    const mapping = ingredient.nutrition
    const food = mapping && typeof mapping.foodId === 'string' && mapping.foodId.trim() ? byId.get(mapping.foodId) : undefined
    // Herbs and spices go by the pinch or bunch; one the database lacks counts as zero instead of blocking the total.
    if (!food && ingredient.category === 'Gewürze') continue
    if (!food || !mapping || !nonnegative(mapping.grams) || (ingredient.amount !== null && ingredient.amount > 0 && mapping.grams === 0) || !macros.every((macro) => nonnegative(food[macro]))) {
      missing.add(ingredient.name)
      continue
    }
    for (const macro of macros) {
      total[macro] += food[macro]! * (mapping.grams / 100)
      if (!Number.isFinite(total[macro])) missing.add(ingredient.name)
    }
  }

  if (missing.size) return { nutrition: null, missing: [...missing] }
  for (const macro of macros) total[macro] /= servings
  if (!macros.every((macro) => Number.isFinite(total[macro]))) return { nutrition: null, missing: [...new Set(ingredients.map((ingredient) => ingredient.name))] }
  return { nutrition: total, missing: [] }
}
