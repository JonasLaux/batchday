export type Ingredient = {
  id: string
  name: string
  amount: number | null
  unit: string
  original: string
  category: string
  note?: string
  nutrition?: { foodId: string; grams: number }
}

export type MealType = 'breakfast' | 'lunch' | 'dinner'
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6
export type WeeklySchedule = { days: Weekday[]; meals: MealType[]; portions: number }

export type Recipe = {
  id: string
  title: string
  description: string
  servings: number | null
  minutes: number | null
  difficulty: 'easy' | 'medium' | 'involved' | 'unknown'
  diet: 'vegan' | 'vegetarian' | 'mixed' | 'unknown'
  tags: string[]
  allergens: string[]
  mealTypes?: MealType[]
  searchTerms?: string[]
  image?: { url: string; alt: string; credit?: string; sourceUrl?: string }
  ingredients: Ingredient[]
  instructions: string[]
  nutrition: { kcal: number; protein: number; carbs: number; fat: number } | null
  nutritionMetadata?: { basis: 'per-serving'; source: string; note?: string }
  nutritionMissing?: string[]
  source: { model: string; request: string; createdAt: string; basedOn?: string; feedback?: string }
}

export type PlanItem = { recipeId: string; portions: number; baseServings?: number; day?: Weekday; meal?: MealType }

export type MenuDish = { meal: MealType; title: string; brief: string }

export type Filters = {
  search: string
  diet: string
  maxMinutes: number | null
  difficulty: string
  tags: string[]
  excludedAllergens: string[]
  excludedIngredients?: string[]
  maxIngredients?: number | null
  pantryOnly: boolean
}

export type ShoppingItem = {
  id: string
  name: string
  amount: number | null
  unit: string
  category: string
  recipes: string[]
  unresolved: boolean
  note?: string
}

// One product from the local store snapshot; weighted products are priced per `quantity` (1000 g).
export type StoreProduct = { id: string; name: string; price: number; quantity: number; unit: 'g' | 'ml' | 'stk'; bio: boolean; weighted: boolean; url?: string }
export type PickRule = 'cheapest' | 'store-brand' | 'bio'
// packs null: sold by weight; cost null: a weighed product for an amount it cannot weigh (pieces, spoons, to taste).
export type ProductLine = { product: StoreProduct; packs: number | null; cost: number | null; check: boolean }
