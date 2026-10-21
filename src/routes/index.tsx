import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { generateRecipe, getRecipes, reviseRecipe } from "../lib/catalog";
import {
  buildShoppingList,
  countIngredients,
  filterRecipes,
  formatAmount,
  generateWeeklyPlan,
  planItemKey,
  replacePlannedRecipe,
} from "../lib/recipes";
import type {
  Filters,
  MealType,
  PlanItem,
  Recipe,
  Weekday,
  WeeklySchedule,
} from "../lib/types";

export const Route = createFileRoute("/")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { recipe?: string; slot?: string } => ({
    recipe: typeof search.recipe === "string" ? search.recipe : undefined,
    slot: typeof search.slot === "string" ? search.slot : undefined,
  }),
  loader: () => getRecipes(),
  component: Home,
});
const initialFilters: Filters = {
  search: "",
  diet: "",
  maxMinutes: null,
  difficulty: "",
  tags: [],
  excludedAllergens: [],
  pantryOnly: false,
  excludedIngredients: [],
  maxIngredients: null,
};
const labels: Record<string, string> = {
  "one-pot": "One Pot",
  "meal-prep": "Meal prep",
  "protein-source": "25 g+ protein",
  vegan: "Vegan",
  vegetarian: "Vegetarian",
  mixed: "Meat / fish",
  easy: "Easy",
  medium: "Medium",
  involved: "More involved",
  unknown: "Not specified",
};
const allergenLabels: Record<string, string> = {
  Erdnüsse: "Peanuts",
  Gluten: "Gluten",
  Milch: "Milk",
  Fisch: "Fish",
  Sellerie: "Celery",
  Ei: "Egg",
  Nüsse: "Nuts",
  Krebstiere: "Crustaceans",
  Senf: "Mustard",
  Soja: "Soy",
  Sesam: "Sesame",
};
const stores = [
  { id: "billa", name: "BILLA", detail: "Your weekly grocery shop" },
  { id: "spar", name: "SPAR", detail: "A familiar stop for your shop" },
  { id: "hofer", name: "HOFER", detail: "Keep your grocery shop simple" },
  { id: "lidl", name: "Lidl", detail: "Your shop, your plan" },
  { id: "penny", name: "PENNY", detail: "Ready for your next shop" },
  {
    id: "other",
    name: "Another supermarket",
    detail: "Any supermarket works",
  },
];
type SetupStep = "store" | "preferences" | "week" | "pantry";
const setupSteps: SetupStep[] = ["store", "preferences", "week", "pantry"];
const stepTitles = {
  store: "Your supermarket",
  preferences: "Your preferences",
  week: "Your week",
  pantry: "Your pantry",
};
const staples = new Set(["wasser", "salz", "pfeffer"]);
const pantryStaples = [
  "butter",
  "olivenoel",
  "oel",
  "knoblauch",
  "salz",
  "pfeffer",
  "zwiebeln",
  "mehl",
  "zucker",
  "reis",
  "nudeln",
  "eier",
  "milch",
  "essig",
  "haferflocken",
];
const weekdays = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const meals: { id: MealType; name: string; icon: string }[] = [
  { id: "breakfast", name: "Breakfast", icon: "🥣" },
  { id: "lunch", name: "Lunch", icon: "🥗" },
  { id: "dinner", name: "Dinner", icon: "🍲" },
];
const initialSchedule: WeeklySchedule = {
  days: [0, 1, 2, 3, 4],
  meals: ["dinner"],
  portions: 2,
};
const portionNumber = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= 12;

function Icon({
  name,
  size = 20,
}: {
  name:
    | "search"
    | "plus"
    | "check"
    | "clock"
    | "close"
    | "bag"
    | "leaf"
    | "arrow"
    | "copy"
    | "book";
  size?: number;
}) {
  const paths = {
    search: "m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
    plus: "M12 5v14M5 12h14",
    check: "m5 12 4 4L19 6",
    clock: "M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
    close: "m6 6 12 12M6 18 18 6",
    bag: "M5 7h14l2 14H3L5 7ZM8 8V6a4 4 0 0 1 8 0v2",
    leaf: "M20 3C7 2 1 8 5 16s17 6 15-13ZM5 20 16 8",
    arrow: "M5 12h14m-5-5 5 5-5 5",
    copy: "M8 8h12v13H8V8ZM16 8V3H3v13h5",
    book: "M12 5C8 2 4 3 2 4v16c3-2 7-2 10 0m0-15c4-3 8-2 10-1v16c-3-2-7-2-10 0V5Z",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

function DishArt({
  recipe,
  small = false,
}: {
  recipe: Recipe;
  small?: boolean;
}) {
  if (recipe.image) {
    return (
      <div className={`dish-art recipe-photo ${small ? "small" : ""}`}>
        <img
          src={recipe.image.url}
          alt={recipe.image.alt}
          loading="lazy"
          decoding="async"
        />
      </div>
    );
  }
  const theme =
    /noodle|nudel|pasta|spaghetti|lasagne|tagliatelle|bolognese/i.test(
      recipe.title,
    )
      ? "pasta"
      : /soup|stew|suppe|eintopf|gulasch|curry|chili/i.test(recipe.title)
        ? "soup"
        : /potato|kartoffel|puffer|rösti|gratin/i.test(recipe.title)
          ? "potato"
          : /salad|vegetable|spinach|salat|gemüse|zucchini|spinat/i.test(
                recipe.title,
              )
            ? "greens"
            : "grains";
  return (
    <div
      className={`dish-art ${theme} ${small ? "small" : ""}`}
      aria-hidden="true"
    >
      <div className="plate">
        <div className="food">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
        <span className="garnish">✦</span>
      </div>
      <span className="art-sprig">⌁</span>
    </div>
  );
}

function RecipeMacros({ recipe }: { recipe: Recipe }) {
  if (!recipe.nutrition) return null;
  const { kcal, protein, carbs, fat } = recipe.nutrition;
  return (
    <div className="recipe-macros" aria-label="Nutrition per portion">
      <span className="macro-basis">
        {recipe.nutritionMetadata ? "Estimates per portion" : "Per portion"}
      </span>
      <span>
        <strong>{Math.round(kcal)}</strong> kcal
      </span>
      <span>
        <strong>{Math.round(protein)}</strong> g protein
      </span>
      <span>
        <strong>{Math.round(carbs)}</strong> g carbs
      </span>
      <span>
        <strong>{Math.round(fat)}</strong> g fat
      </span>
    </div>
  );
}

function Home() {
  const recipes = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [setupStep, setSetupStep] = useState<SetupStep | null>("store");
  const [journeyComplete, setJourneyComplete] = useState(false);
  const [store, setStore] = useState<string | null>(null);
  const [dislikeSearch, setDislikeSearch] = useState("");
  const [tab, setTab] = useState<"recipes" | "plan" | "shopping">("recipes");
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [sort, setSort] = useState("name");
  const [discoveryMeal, setDiscoveryMeal] = useState<MealType | "">("");
  const [pantry, setPantry] = useState<string[]>([]);
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [schedule, setSchedule] = useState<WeeklySchedule>(initialSchedule);
  const [scheduleDraft, setScheduleDraft] =
    useState<WeeklySchedule>(initialSchedule);
  const [planMessage, setPlanMessage] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [portions, setPortions] = useState(2);
  const selected = recipes.find((recipe) => recipe.id === search.recipe);
  const [detailPortions, setDetailPortions] = useState(2);
  const [baseServings, setBaseServings] = useState<number | undefined>(
    selected?.servings ?? undefined,
  );
  const [copied, setCopied] = useState(false);
  const router = useRouter();
  const [dishWish, setDishWish] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [revising, setRevising] = useState(false);
  const [revisionError, setRevisionError] = useState("");
  const activeRecipe = useRef({ recipe: search.recipe, slot: search.slot });
  activeRecipe.current = { recipe: search.recipe, slot: search.slot };
  const generate = async (event: React.FormEvent) => {
    event.preventDefault();
    setGenerating(true);
    setGenerateError("");
    try {
      const id = await generateRecipe({ data: dishWish });
      await router.invalidate();
      setDishWish("");
      void navigate({ search: { recipe: id } });
    } catch (error) {
      setGenerateError(
        error instanceof Error ? error.message : "Recipe generation failed.",
      );
    } finally {
      setGenerating(false);
    }
  };
  const ingredientMap = new Map(
    recipes.flatMap((recipe) =>
      recipe.ingredients.map(
        (ingredient) => [ingredient.id, ingredient] as const,
      ),
    ),
  );
  const ingredients = [...ingredientMap.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "de"),
  );
  const pantryOptions = pantryStaples.flatMap((id) =>
    ingredientMap.has(id) ? [ingredientMap.get(id)!] : [],
  );
  const dislikeOptions = ingredients.filter(
    (ingredient) =>
      ingredient.id !== "wasser" &&
      ingredient.category !== "Prüfen" &&
      !/Alternative \/ kombinierte|Zutatenzuordnung prüfen/.test(
        ingredient.note ?? "",
      ),
  );
  const tags = [...new Set(recipes.flatMap((recipe) => recipe.tags))].sort();
  const allergens = [
    ...new Set(recipes.flatMap((recipe) => recipe.allergens)),
  ].sort();

  useEffect(() => {
    if (loaded) return;
    try {
      const saved =
        JSON.parse(localStorage.getItem("batchday-poc") || "{}") ?? {};
      const validStore = stores.some((item) => item.id === saved.store)
        ? saved.store
        : null;
      const completed = saved.journeyComplete === true && validStore !== null;
      setStore(validStore);
      setJourneyComplete(completed);
      if (["recipes", "plan", "shopping"].includes(saved.tab))
        setTab(saved.tab);
      setSetupStep(
        validStore && setupSteps.includes(saved.setupStep)
          ? saved.setupStep
          : completed
            ? null
            : "store",
      );
      if (saved.filters && typeof saved.filters === "object") {
        const value = saved.filters;
        setFilters({
          search: typeof value.search === "string" ? value.search : "",
          diet: ["", "vegan", "vegetarian", "mixed"].includes(value.diet)
            ? value.diet
            : "",
          maxMinutes: [15, 30, 45, 60, 90].includes(value.maxMinutes)
            ? value.maxMinutes
            : null,
          difficulty: ["", "easy", "medium", "involved"].includes(
            value.difficulty,
          )
            ? value.difficulty
            : "",
          tags: Array.isArray(value.tags)
            ? value.tags.filter(
                (tag: unknown) =>
                  typeof tag === "string" &&
                  recipes.some((recipe) => recipe.tags.includes(tag)),
              )
            : [],
          excludedAllergens: Array.isArray(value.excludedAllergens)
            ? value.excludedAllergens
                .map((allergen: unknown) =>
                  typeof allergen === "string"
                    ? (allergenLabels[allergen] ?? allergen)
                    : null,
                )
                .filter(
                  (allergen: unknown): allergen is string =>
                    typeof allergen === "string" &&
                    recipes.some((recipe) =>
                      recipe.allergens.includes(allergen),
                    ),
                )
            : [],
          pantryOnly: value.pantryOnly === true,
          excludedIngredients: Array.isArray(value.excludedIngredients)
            ? value.excludedIngredients.filter(
                (id: unknown): id is string =>
                  typeof id === "string" && ingredientMap.has(id),
              )
            : [],
          maxIngredients: [5, 8, 10, 12].includes(value.maxIngredients)
            ? value.maxIngredients
            : null,
        });
      }
      if (Array.isArray(saved.plan))
        setPlan(
          saved.plan
            .filter(
              (item: PlanItem) =>
                item &&
                recipes.some((recipe) => recipe.id === item.recipeId) &&
                portionNumber(item.portions) &&
                (item.baseServings === undefined ||
                  portionNumber(item.baseServings)) &&
                ((item.day === undefined && item.meal === undefined) ||
                  (Number.isInteger(item.day) &&
                    item.day! >= 0 &&
                    item.day! <= 6 &&
                    meals.some((meal) => meal.id === item.meal))),
            )
            .filter(
              (item: PlanItem, index: number, all: PlanItem[]) =>
                all.findIndex(
                  (entry) => planItemKey(entry) === planItemKey(item),
                ) === index,
            ),
        );
      if (saved.schedule && typeof saved.schedule === "object") {
        const value = saved.schedule;
        const savedDays: unknown[] = Array.isArray(value.days)
          ? value.days
          : initialSchedule.days;
        const savedMeals: unknown[] = Array.isArray(value.meals)
          ? value.meals
          : initialSchedule.meals;
        const restoredSchedule: WeeklySchedule = {
          days: [
            ...new Set(
              savedDays.filter(
                (day): day is Weekday =>
                  typeof day === "number" &&
                  Number.isInteger(day) &&
                  day >= 0 &&
                  day <= 6,
              ),
            ),
          ],
          meals: [
            ...new Set(
              savedMeals.filter((meal): meal is MealType =>
                meals.some((option) => option.id === meal),
              ),
            ),
          ],
          portions: portionNumber(value.portions)
            ? value.portions
            : initialSchedule.portions,
        };
        setSchedule(restoredSchedule);
        setScheduleDraft(restoredSchedule);
        if (portionNumber(value.portions)) setPortions(value.portions);
      }
      if (Array.isArray(saved.pantry))
        setPantry(
          saved.pantry.filter(
            (id: unknown): id is string =>
              typeof id === "string" &&
              recipes.some((recipe) =>
                recipe.ingredients.some((ingredient) => ingredient.id === id),
              ),
          ),
        );
      if (Array.isArray(saved.checked))
        setChecked(
          saved.checked.filter(
            (id: unknown): id is string => typeof id === "string",
          ),
        );
    } catch {
      setStorageError(true);
    }
    setLoaded(true);
  }, [recipes, loaded]);
  useEffect(() => {
    if (loaded) {
      try {
        localStorage.setItem(
          "batchday-poc",
          JSON.stringify({
            plan,
            pantry,
            checked,
            store,
            filters,
            journeyComplete,
            setupStep,
            schedule,
            tab,
          }),
        );
      } catch {
        setStorageError(true);
      }
    }
  }, [
    loaded,
    plan,
    pantry,
    checked,
    store,
    filters,
    journeyComplete,
    setupStep,
    schedule,
    tab,
  ]);
  useEffect(() => {
    if (selected) {
      setFeedback("");
      setRevisionError("");
      const item = plan.find((item) =>
        selectedTarget?.day !== undefined
          ? item.day === selectedTarget.day && item.meal === selectedTarget.meal
          : item.recipeId === selected.id && item.day === undefined,
      );
      setDetailPortions(item?.portions ?? portions);
      setBaseServings(
        selected.servings ??
          (item?.recipeId === selected.id ? item.baseServings : undefined),
      );
      window.scrollTo(0, 0);
    }
  }, [selected?.id, search.slot, loaded]);

  const selectedStore = stores.find((item) => item.id === store);
  const showTab = (nextTab: "recipes" | "plan" | "shopping") => {
    if (search.recipe) void navigate({ search: {} });
    setTab(nextTab);
    if (journeyComplete) setSetupStep(null);
  };
  const editWeek = () => {
    setScheduleDraft(schedule);
    setSetupStep("week");
  };
  const makeWeeklyPlan = (week = schedule) => {
    const result = generateWeeklyPlan(recipes, week, filters, pantry);
    changePlan(() => result.plan);
    setPortions(week.portions);
    setPlanMessage(
      result.unfilled.length
        ? `${result.unfilled.length} meals are unfilled: no matching recipe has a known serving count. Adjust your preferences or choose a recipe yourself.`
        : `${result.plan.length} meals planned. You can swap any recipe.`,
    );
    setTab("plan");
  };
  const finishSetup = () => {
    if (setupStep === "week") {
      setSchedule(scheduleDraft);
      if (journeyComplete) makeWeeklyPlan(scheduleDraft);
    }
    if (journeyComplete || setupStep === "pantry") {
      if (!journeyComplete) makeWeeklyPlan();
      setJourneyComplete(true);
      setSetupStep(null);
    } else if (setupStep === "store") setSetupStep("preferences");
    else if (setupStep === "preferences") editWeek();
    else setSetupStep("pantry");
  };
  const backSetup = () => {
    if (journeyComplete) setSetupStep(null);
    else if (setupStep === "pantry") editWeek();
    else if (setupStep === "week") setSetupStep("preferences");
    else if (setupStep === "preferences") setSetupStep("store");
  };
  const changePlan = (update: (current: PlanItem[]) => PlanItem[]) => {
    setChecked([]);
    setCopied(false);
    setPlanMessage("");
    setPlan(update);
  };
  const changePantry = (update: (current: string[]) => string[]) => {
    setChecked([]);
    setCopied(false);
    setPantry(update);
  };
  const addPantry = (id: string) => {
    if (id) changePantry((current) => [...current, id]);
  };
  const changePortions = (id: string, count: number) =>
    changePlan((current) =>
      current.map((item) =>
        planItemKey(item) === id ? { ...item, portions: count } : item,
      ),
    );
  const missing = (recipe: Recipe) =>
    new Set(
      recipe.ingredients
        .filter(
          (ingredient) =>
            !staples.has(ingredient.id) && !pantry.includes(ingredient.id),
        )
        .map((ingredient) => ingredient.id),
    ).size;
  const matchingRecipes = filterRecipes(recipes, filters, pantry).sort(
    (a, b) =>
      sort === "pantry"
        ? missing(a) - missing(b) || a.title.localeCompare(b.title, "en")
        : a.title.localeCompare(b.title, "en"),
  );
  const visible = matchingRecipes.filter(
    (recipe) =>
      !discoveryMeal ||
      (recipe.mealTypes ?? ["lunch", "dinner"]).includes(discoveryMeal),
  );
  const weekSlots = [...schedule.days]
    .sort()
    .flatMap((day) =>
      meals
        .filter((meal) => schedule.meals.includes(meal.id))
        .map((meal) => ({ day, meal: meal.id })),
    );
  const unfilledSlots = weekSlots.filter(
    (slot) =>
      !plan.some((item) => item.day === slot.day && item.meal === slot.meal),
  );
  const recipeSlots = selected
    ? weekSlots.filter((slot) =>
        (selected.mealTypes ?? ["lunch", "dinner"]).includes(slot.meal),
      )
    : [];
  const selectedTarget =
    selected && search.slot
      ? (recipeSlots.find(
          (slot) => `${slot.day}-${slot.meal}` === search.slot,
        ) ??
        plan.find(
          (item) =>
            planItemKey(item) === search.slot &&
            (item.day === undefined
              ? item.recipeId === selected.id
              : (selected.mealTypes ?? ["lunch", "dinner"]).includes(
                  item.meal!,
                )),
        ))
      : undefined;
  const revise = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || revising) return;
    const originalId = selected.id;
    const targetKey = selectedTarget
      ? planItemKey({ ...selectedTarget, recipeId: originalId, portions: detailPortions })
      : `recipe:${originalId}`;
    const slot = search.slot;
    const stillViewing = () => activeRecipe.current.recipe === originalId && activeRecipe.current.slot === slot;
    setRevising(true);
    setRevisionError("");
    try {
      const id = await reviseRecipe({ data: { recipeId: originalId, feedback } });
      await router.invalidate();
      const variant = (await getRecipes()).find((recipe) => recipe.id === id);
      if (!variant) throw new Error("The updated recipe could not be loaded.");
      const compatible = selectedTarget?.meal === undefined ||
        (variant.mealTypes ?? ["lunch", "dinner"]).includes(selectedTarget.meal);
      if (compatible) changePlan((current) => replacePlannedRecipe(current, targetKey, originalId, id));
      if (stillViewing()) {
        setFeedback("");
        await navigate({ search: { recipe: id, slot: compatible ? (slot?.startsWith("recipe:") ? `recipe:${id}` : slot) : undefined } });
      }
    } catch (error) {
      if (stillViewing()) setRevisionError(error instanceof Error ? error.message : "Recipe changes failed.");
    } finally {
      setRevising(false);
    }
  };
  const shopping = buildShoppingList(recipes, plan, pantry);
  const groups = [...new Set(shopping.map((item) => item.category))];
  const remaining = shopping.filter(
    (item) => !checked.includes(item.id),
  ).length;
  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));
  const toggleFilter = (
    key: "tags" | "excludedAllergens" | "excludedIngredients",
    value: string,
  ) =>
    setFilter(
      key,
      (filters[key] ?? []).includes(value)
        ? (filters[key] ?? []).filter((item) => item !== value)
        : [...(filters[key] ?? []), value],
    );
  const openRecipe = (recipe: Recipe, item?: PlanItem) => {
    void navigate({
      search: {
        recipe: recipe.id,
        ...(item ? { slot: planItemKey(item) } : {}),
      },
    });
  };
  const addToPlan = (
    recipe: Recipe,
    count = portions,
    base = recipe.servings ?? undefined,
  ) => {
    if (!base) {
      openRecipe(recipe);
      return;
    }
    const targetSlot = selected?.id === recipe.id ? selectedTarget : undefined;
    changePlan((current) => [
      ...current.filter((item) =>
        targetSlot?.day !== undefined
          ? !(item.day === targetSlot.day && item.meal === targetSlot.meal)
          : !(item.recipeId === recipe.id && item.day === undefined),
      ),
      {
        ...(targetSlot?.day !== undefined
          ? { day: targetSlot.day, meal: targetSlot.meal }
          : {}),
        recipeId: recipe.id,
        portions: count,
        ...(recipe.servings === null ? { baseServings: base } : {}),
      },
    ]);
  };
  const copyList = async () => {
    const text = groups
      .map(
        (group) =>
          `${group}\n${shopping
            .filter(
              (item) => item.category === group && !checked.includes(item.id),
            )
            .map(
              (item) =>
                `☐ ${formatAmount(item.amount, item.unit)} ${item.name}${item.unresolved ? " (check quantity)" : ""}${item.note ? ` — ${item.note}` : ""}`,
            )
            .join("\n")}`,
      )
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
      window.alert(
        "Copying is unavailable in this browser. Your list is still visible here.",
      );
    }
  };

  return (
    <div className={`app-shell ${setupStep ? "setup-mode" : "workspace-mode"}`}>
      <header className="app-header">
        <button
          className="brand"
          onClick={() => showTab("recipes")}
          aria-label="Batchday recipes"
        >
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          batchday
        </button>
        {journeyComplete && (
          <nav className="main-nav" aria-label="Main navigation">
            <button
              className={tab === "recipes" ? "active" : ""}
              aria-current={tab === "recipes" ? "page" : undefined}
              onClick={() => showTab("recipes")}
            >
              <Icon name="book" size={18} />
              Recipes
            </button>
            <button
              className={tab === "plan" ? "active" : ""}
              aria-current={tab === "plan" ? "page" : undefined}
              onClick={() => showTab("plan")}
            >
              <Icon name="leaf" size={18} />
              This week<span className="nav-count">{plan.length}</span>
            </button>
            <button
              className={tab === "shopping" ? "active" : ""}
              aria-current={tab === "shopping" ? "page" : undefined}
              onClick={() => showTab("shopping")}
            >
              <Icon name="bag" size={18} />
              Shopping list
              {shopping.length > 0 && (
                <span className="nav-count">{remaining}</span>
              )}
            </button>
          </nav>
        )}
        <span className="local-status">
          <span />
          Your local kitchen
        </span>
      </header>
      <main className="app-main">
        {storageError && (
          <p className="notice" role="status">
            Your browser could not read or save all local data. Your current
            plan still works for this session.
          </p>
        )}
        {selected ? (
          <article className="recipe-page" aria-labelledby="recipe-page-title">
            <div className="dialog-top">
              <p className="eyebrow">YOUR RECIPE, READY TO COOK.</p>
              <button
                className="text-button"
                onClick={() => void navigate({ search: {} })}
                aria-label="Back to overview"
              >
                <span>← Back</span>
              </button>
            </div>
            <div className="dialog-heading">
              <div>
                <div className="card-meta">
                  <span>{labels[selected.diet]}</span>
                  <span>·</span>
                  <span>
                    {selected.minutes
                      ? `${selected.minutes} min`
                      : "Cooking time unknown"}
                  </span>
                </div>
                <h1 id="recipe-page-title">{selected.title}</h1>
                <p>
                  {selected.ingredients
                    .slice(0, 4)
                    .map((ingredient) => ingredient.name)
                    .join(" · ")}
                </p>
              </div>
              <div className="recipe-heading-photo">
                <DishArt recipe={selected} />
                {selected.image?.credit && (
                  <small className="image-credit">
                    Representative dish photo · {selected.image.credit}
                  </small>
                )}
              </div>
            </div>
            <div className="recipe-page-nutrition">
              <RecipeMacros recipe={selected} />
              {selected.nutritionMetadata && (
                <p className="data-note">
                  {selected.nutritionMetadata.source}
                  {selected.nutritionMetadata.note
                    ? ` · ${selected.nutritionMetadata.note}`
                    : ""}
                </p>
              )}
              {!selected.nutrition && (
                <p className="data-note">
                  {selected.nutritionMissing?.length
                    ? `Nutrition incomplete for ${selected.nutritionMissing.join(", ")}.`
                    : "Nutrition is not available for this recipe."}
                </p>
              )}
            </div>
            <div className="recipe-portion-bar">
              <label>
                I am cooking{" "}
                <select
                  aria-label="Recipe portions"
                  value={detailPortions}
                  onChange={(event) =>
                    setDetailPortions(Number(event.target.value))
                  }
                >
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i + 1}>{i + 1}</option>
                  ))}
                </select>{" "}
                portions
              </label>
              {selected.servings ? (
                <span>Original recipe: {selected.servings} portions</span>
              ) : (
                <label className="base-input">
                  Original recipe:{" "}
                  <input
                    type="number"
                    min="1"
                    max="12"
                    step="1"
                    value={baseServings ?? ""}
                    aria-label="Original recipe serving count"
                    placeholder="?"
                    onChange={(event) =>
                      setBaseServings(
                        portionNumber(Number(event.target.value))
                          ? Number(event.target.value)
                          : undefined,
                      )
                    }
                  />{" "}
                  portions
                </label>
              )}
            </div>
            <div className="recipe-slot-bar">
              <label>
                Plan for{" "}
                <select
                  aria-label="Meal for this recipe"
                  value={
                    selectedTarget?.day !== undefined
                      ? `${selectedTarget.day}-${selectedTarget.meal}`
                      : ""
                  }
                  onChange={(event) =>
                    void navigate({
                      search: {
                        recipe: selected.id,
                        slot: event.target.value || undefined,
                      },
                    })
                  }
                >
                  <option value="">Extra meal, no set day</option>
                  {recipeSlots.map((slot) => (
                    <option
                      key={`${slot.day}-${slot.meal}`}
                      value={`${slot.day}-${slot.meal}`}
                    >
                      {weekdays[slot.day]} ·{" "}
                      {meals.find((meal) => meal.id === slot.meal)?.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {!baseServings && (
              <p className="notice">
                The source does not give a serving count. Add your own estimate
                to scale the quantities and plan this recipe. Until then, the
                original quantities are shown.
              </p>
            )}
            <div className="recipe-detail-columns">
              <section>
                <h3>
                  Ingredients{" "}
                  <span>
                    {baseServings
                      ? `for ${detailPortions} portions`
                      : "Original quantities"}
                  </span>
                </h3>
                <ul className="ingredient-list">
                  {selected.ingredients.map((ingredient, index) => (
                    <li key={`${ingredient.id}-${index}`}>
                      <span>
                        <strong>{ingredient.name}</strong>
                        {(ingredient.note || ingredient.amount === null) && (
                          <small>
                            {ingredient.note || ingredient.original}
                          </small>
                        )}
                      </span>
                      <b
                        className={
                          ingredient.amount === null ? "unresolved" : ""
                        }
                      >
                        {formatAmount(
                          ingredient.amount === null
                            ? null
                            : ingredient.amount *
                                (baseServings
                                  ? detailPortions / baseServings
                                  : 1),
                          ingredient.unit,
                        )}
                      </b>
                    </li>
                  ))}
                </ul>
                <details className="source-details">
                  <summary>Source & original quantities</summary>
                  <p>
                    AI-generated by {selected.source.model} from “
                    {selected.source.request}” on{" "}
                    {new Date(selected.source.createdAt).toLocaleDateString(
                      "en-AT",
                    )}
                    . Untested: check amounts and times when you cook it.
                  </p>
                  {selected.source.basedOn && (
                    <p>
                      Changed from{" "}
                      <button className="text-button" onClick={() => void navigate({ search: { recipe: selected.source.basedOn } })}>
                        the previous recipe
                      </button>
                      : “{selected.source.feedback}”
                    </p>
                  )}
                  <ul>
                    {selected.ingredients.map((ingredient, index) => (
                      <li key={index}>{ingredient.original}</li>
                    ))}
                  </ul>
                </details>
              </section>
              <section className="instructions">
                <h3>Method</h3>
                <ol>
                  {selected.instructions.map((step, index) => (
                    <li key={index}>
                      <span>{index + 1}</span>
                      <p>{step}</p>
                    </li>
                  ))}
                </ol>
                <p className="data-note">
                  Quantities in the method are from the original recipe. Use the
                  ingredient list when scaling.
                </p>
              </section>
            </div>
            <section aria-label="Customize this recipe">
              <h3>Make it yours</h3>
              <p className="data-note">Ask for a swap or different amounts. Ingredients, method and macros update together.</p>
              <form className="catalog-toolbar" onSubmit={revise}>
                <label className="search-field">
                  <input
                    value={feedback}
                    maxLength={500}
                    onChange={(event) => setFeedback(event.target.value)}
                    placeholder="e.g. Use half the pasta and add more vegetables"
                    aria-label="Recipe changes"
                    disabled={revising}
                  />
                </label>
                <button className="primary-button" disabled={revising || !feedback.trim()}>
                  {revising ? "Updating …" : "Update recipe"}
                </button>
              </form>
              {revisionError && <p className="notice" role="alert">{revisionError}</p>}
            </section>
            <div className="dialog-bottom">
              <p>
                {!baseServings
                  ? "Add the original serving count first."
                  : selected.servings === null
                    ? "Serving count supplied by you."
                    : "Ready for your next meal."}
              </p>
              <button
                className="primary-button"
                disabled={!baseServings}
                onClick={() => {
                  addToPlan(selected, detailPortions, baseServings);
                  void navigate({ search: {} });
                }}
              >
                <Icon name="plus" size={18} />
                {selectedTarget?.day !== undefined ||
                plan.some(
                  (item) =>
                    item.recipeId === selected.id && item.day === undefined,
                )
                  ? "Update meal plan"
                  : "Add to meal plan"}
              </button>
            </div>
          </article>
        ) : setupStep ? (
          <section className="setup-journey" aria-label="Prepare your week">
            <ol className="journey-stepper" aria-label="Your four setup steps">
              {setupSteps.map((step, index) => (
                <li
                  key={step}
                  className={
                    setupStep === step
                      ? "current"
                      : setupSteps.indexOf(setupStep) > index || journeyComplete
                        ? "done"
                        : ""
                  }
                >
                  <button
                    disabled={
                      !journeyComplete &&
                      setupSteps.indexOf(step) > setupSteps.indexOf(setupStep)
                    }
                    aria-current={setupStep === step ? "step" : undefined}
                    onClick={() =>
                      step === "week" ? editWeek() : setSetupStep(step)
                    }
                  >
                    <span>
                      {setupSteps.indexOf(setupStep) > index ||
                      (journeyComplete && setupStep !== step) ? (
                        <Icon name="check" size={14} />
                      ) : (
                        index + 1
                      )}
                    </span>
                    {stepTitles[step]}
                  </button>
                </li>
              ))}
            </ol>
            <div className="journey-heading">
              <p className="eyebrow">
                {journeyComplete
                  ? "EDIT YOUR CHOICES"
                  : `STEP ${setupSteps.indexOf(setupStep) + 1} OF ${setupSteps.length}`}
              </p>
              <h1>
                {setupStep === "store" ? (
                  <>
                    Where do you <em>shop?</em>
                  </>
                ) : setupStep === "preferences" ? (
                  <>
                    What do you <em>enjoy eating?</em>
                  </>
                ) : setupStep === "week" ? (
                  <>
                    When will you <em>cook?</em>
                  </>
                ) : (
                  <>
                    What is already <em>at home?</em>
                  </>
                )}
              </h1>
              <p>
                {setupStep === "store"
                  ? "A good week starts with your next grocery shop."
                  : setupStep === "preferences"
                    ? "Choose what suits you. You can change everything later."
                    : setupStep === "week"
                      ? "Choose your days, meals and portions. We will suggest a matching recipe for each meal."
                      : "Choose your pantry staples. We will leave these ingredients off your shopping list."}
              </p>
            </div>
            {setupStep === "store" ? (
              <div className="store-grid">
                {stores.map((item) => (
                  <button
                    key={item.id}
                    className={`store-card ${store === item.id ? "selected" : ""}`}
                    aria-pressed={store === item.id}
                    onClick={() => setStore(item.id)}
                  >
                    <span className="selection-mark">
                      {store === item.id && <Icon name="check" size={12} />}
                    </span>
                    <span className="store-icon" aria-hidden="true">
                      <Icon name="bag" size={36} />
                    </span>
                    <strong>{item.name}</strong>
                    <span>{item.detail}</span>
                  </button>
                ))}
              </div>
            ) : setupStep === "preferences" ? (
              <div className="preferences-screen">
                <div className="preference-grid">
                  {[
                    ["vegan", "Vegan", "All plant-based", "🌱"],
                    [
                      "vegetarian",
                      "Vegetarian",
                      "Let vegetables take the lead",
                      "🥦",
                    ],
                    ["mixed", "Meat & fish", "A little of everything", "🍲"],
                  ].map(([value, title, detail, illustration]) => (
                    <button
                      key={value}
                      className={`preference-card ${filters.diet === value ? "selected" : ""}`}
                      aria-pressed={filters.diet === value}
                      onClick={() =>
                        setFilter("diet", filters.diet === value ? "" : value)
                      }
                    >
                      <span className="preference-art" aria-hidden="true">
                        {illustration}
                      </span>
                      <span>
                        <strong>{title}</strong>
                        <small>{detail}</small>
                      </span>
                      <span className="selection-mark">
                        {filters.diet === value && (
                          <Icon name="check" size={12} />
                        )}
                      </span>
                    </button>
                  ))}
                  {tags.map((tag) => (
                    <button
                      key={tag}
                      className={`preference-card ${filters.tags.includes(tag) ? "selected" : ""}`}
                      aria-pressed={filters.tags.includes(tag)}
                      onClick={() => toggleFilter("tags", tag)}
                    >
                      <span className="preference-art" aria-hidden="true">
                        {tag === "one-pot"
                          ? "🥘"
                          : tag === "protein-source"
                            ? "🫘"
                            : "🥡"}
                      </span>
                      <span>
                        <strong>{labels[tag] ?? tag}</strong>
                        <small>
                          {tag === "one-pot"
                            ? "Fewer pans, less washing up"
                            : tag === "protein-source"
                              ? "Estimated protein per portion"
                              : "Cook once, enjoy later"}
                        </small>
                      </span>
                      <span className="selection-mark">
                        {filters.tags.includes(tag) && (
                          <Icon name="check" size={12} />
                        )}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="preference-footnote">
                  Nothing selected? All recipes stay available. 25 g+ protein
                  uses the estimate per portion. Meal prep is a
                  broad tag, not storage advice.
                </p>
                <div className="preference-refinements">
                  <fieldset>
                    <legend>Time & effort</legend>
                    <div className="refinement-selects">
                      <label>
                        Maximum total time
                        <select
                          value={filters.maxMinutes ?? ""}
                          onChange={(event) =>
                            setFilter(
                              "maxMinutes",
                              event.target.value
                                ? Number(event.target.value)
                                : null,
                            )
                          }
                        >
                          <option value="">No time limit</option>
                          {[15, 30, 45, 60, 90].map((time) => (
                            <option key={time} value={time}>
                              Up to {time} minutes
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Difficulty
                        <select
                          value={filters.difficulty}
                          onChange={(event) =>
                            setFilter("difficulty", event.target.value)
                          }
                        >
                          <option value="">All difficulty levels</option>
                          <option value="easy">Easy</option>
                          <option value="medium">Medium</option>
                          <option value="involved">More involved</option>
                        </select>
                      </label>
                    </div>
                    <p className="filter-help">
                      Total time includes preparation and cooking. A time limit
                      hides recipes with no known total time (
                      {
                        recipes.filter((recipe) => recipe.minutes !== null)
                          .length
                      }{" "}
                      of {recipes.length} have a time). Difficulty describes the
                      effort, separately from time.
                    </p>
                  </fieldset>
                  <fieldset>
                    <legend>Exclude allergens</legend>
                    <div className="allergen-options">
                      {allergens.map((allergen) => (
                        <button
                          key={allergen}
                          className={
                            filters.excludedAllergens.includes(allergen)
                              ? "selected"
                              : ""
                          }
                          aria-pressed={filters.excludedAllergens.includes(
                            allergen,
                          )}
                          onClick={() =>
                            toggleFilter("excludedAllergens", allergen)
                          }
                        >
                          {filters.excludedAllergens.includes(allergen) && (
                            <Icon name="close" size={11} />
                          )}
                          {allergenLabels[allergen] ?? allergen}
                        </button>
                      ))}
                    </div>
                    <p className="filter-help">
                      Detected from ingredients. Check the recipe and product
                      labels yourself.
                    </p>
                  </fieldset>
                  <fieldset>
                    <legend>Fewer ingredients</legend>
                    <label className="ingredient-limit">
                      Maximum ingredient count
                      <select
                        value={filters.maxIngredients ?? ""}
                        onChange={(event) =>
                          setFilter(
                            "maxIngredients",
                            event.target.value
                              ? Number(event.target.value)
                              : null,
                          )
                        }
                      >
                        <option value="">No limit</option>
                        {[5, 8, 10, 12].map((count) => (
                          <option key={count} value={count}>
                            At most {count} ingredients
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="filter-help">
                      Distinct ingredients, excluding water, salt and pepper.
                    </p>
                  </fieldset>
                  <fieldset>
                    <legend>Ingredients I dislike</legend>
                    <div className="allergen-options">
                      {(filters.excludedIngredients ?? []).map((id) => (
                        <button
                          key={id}
                          className="selected"
                          aria-label={`Allow ${ingredientMap.get(id)?.name} again`}
                          onClick={() =>
                            toggleFilter("excludedIngredients", id)
                          }
                        >
                          {ingredientMap.get(id)?.name}{" "}
                          <Icon name="close" size={11} />
                        </button>
                      ))}
                    </div>
                    <input
                      type="search"
                      aria-label="Search for an ingredient to exclude"
                      placeholder="Try Pilze, Oliven, Zwiebeln …"
                      value={dislikeSearch}
                      onChange={(event) => setDislikeSearch(event.target.value)}
                    />
                    <div className="allergen-options dislike-options">
                      {dislikeOptions
                        .filter(
                          (ingredient) =>
                            !(filters.excludedIngredients ?? []).includes(
                              ingredient.id,
                            ) &&
                            (dislikeSearch
                              ? ingredient.name
                                  .toLocaleLowerCase("de")
                                  .includes(
                                    dislikeSearch.toLocaleLowerCase("de"),
                                  )
                              : [
                                  "champignons",
                                  "oliven",
                                  "zwiebeln",
                                  "knoblauch",
                                  "fischfilet",
                                  "garnelen",
                                ].includes(ingredient.id)),
                        )
                        .slice(0, 10)
                        .map((ingredient) => (
                          <button
                            key={ingredient.id}
                            onClick={() =>
                              toggleFilter("excludedIngredients", ingredient.id)
                            }
                          >
                            <Icon name="plus" size={11} />
                            {ingredient.name}
                          </button>
                        ))}
                    </div>
                    <p className="filter-help">
                      Hide recipes containing these mapped ingredients.
                      Ingredient mappings are still provisional.
                    </p>
                  </fieldset>
                </div>
                {filters.diet ||
                filters.tags.length ||
                filters.maxMinutes ||
                filters.difficulty ||
                filters.excludedAllergens.length ||
                filters.excludedIngredients?.length ||
                filters.maxIngredients ? (
                  <button
                    className="text-button"
                    onClick={() => setFilters(initialFilters)}
                  >
                    Reset preferences
                  </button>
                ) : null}
              </div>
            ) : setupStep === "week" ? (
              <div className="week-setup-screen">
                <fieldset>
                  <legend>Which days?</legend>
                  <p>
                    {scheduleDraft.days.length}{" "}
                    {scheduleDraft.days.length === 1
                      ? "cooking day"
                      : "cooking days"}{" "}
                    selected
                  </p>
                  <div className="weekday-options">
                    {weekdays.map((name, index) => (
                      <button
                        key={name}
                        className={
                          scheduleDraft.days.includes(index as Weekday)
                            ? "selected"
                            : ""
                        }
                        aria-pressed={scheduleDraft.days.includes(
                          index as Weekday,
                        )}
                        onClick={() =>
                          setScheduleDraft((current) => ({
                            ...current,
                            days: current.days.includes(index as Weekday)
                              ? current.days.filter((day) => day !== index)
                              : [...current.days, index as Weekday].sort(),
                          }))
                        }
                      >
                        <span>{name.slice(0, 2)}</span>
                        <small>{name}</small>
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend>Which meals on these days?</legend>
                  <div className="meal-options">
                    {meals.map((meal) => (
                      <button
                        key={meal.id}
                        className={`preference-card ${scheduleDraft.meals.includes(meal.id) ? "selected" : ""}`}
                        aria-pressed={scheduleDraft.meals.includes(meal.id)}
                        onClick={() =>
                          setScheduleDraft((current) => ({
                            ...current,
                            meals: current.meals.includes(meal.id)
                              ? current.meals.filter(
                                  (value) => value !== meal.id,
                                )
                              : [...current.meals, meal.id],
                          }))
                        }
                      >
                        <span className="preference-art" aria-hidden="true">
                          {meal.icon}
                        </span>
                        <strong>{meal.name}</strong>
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend>How many portions per meal?</legend>
                  <label className="schedule-portions">
                    Portions{" "}
                    <select
                      aria-label="Portions per meal"
                      value={scheduleDraft.portions}
                      onChange={(event) =>
                        setScheduleDraft((current) => ({
                          ...current,
                          portions: Number(event.target.value),
                        }))
                      }
                    >
                      {Array.from({ length: 12 }, (_, index) => (
                        <option key={index + 1}>{index + 1}</option>
                      ))}
                    </select>
                  </label>
                  <p>
                    The starting amount for every meal. You can change
                    individual portions in your weekly plan.
                  </p>
                </fieldset>
                <p className="notice">
                  {scheduleDraft.days.length * scheduleDraft.meals.length} meals
                  · {scheduleDraft.portions} portions each. We use your
                  preferences and choose a variety of recipes. If there is no
                  matching suggestion, the meal stays unfilled.
                  {journeyComplete
                    ? " A new weekly plan replaces the meals currently planned."
                    : ""}
                </p>
              </div>
            ) : (
              <div className="pantry-screen">
                <div className="pantry-search-row">
                  <p>Just the everyday basics. Choose what you have.</p>
                  <span>{pantry.length} selected</span>
                </div>
                {pantry.length > 0 && (
                  <div className="selected-pantry">
                    <span>Already at home:</span>
                    {pantry.map((id) => (
                      <button
                        key={id}
                        onClick={() =>
                          changePantry((current) =>
                            current.filter((item) => item !== id),
                          )
                        }
                        aria-label={`Remove ${ingredientMap.get(id)?.name} from pantry`}
                      >
                        {ingredientMap.get(id)?.name}
                        <Icon name="close" size={12} />
                      </button>
                    ))}
                  </div>
                )}
                <div className="pantry-ingredient-grid">
                  {pantryOptions.map((ingredient) => (
                    <button
                      key={ingredient.id}
                      className={`pantry-ingredient ${pantry.includes(ingredient.id) ? "selected" : ""}`}
                      aria-pressed={pantry.includes(ingredient.id)}
                      onClick={() =>
                        pantry.includes(ingredient.id)
                          ? changePantry((current) =>
                              current.filter((id) => id !== ingredient.id),
                            )
                          : addPantry(ingredient.id)
                      }
                    >
                      <span className="ingredient-symbol" aria-hidden="true">
                        {/Gemüse|Obst/i.test(ingredient.category)
                          ? "🥕"
                          : /Milch|Kühl|Käse/i.test(ingredient.category)
                            ? "🥛"
                            : /Fleisch|Fisch/i.test(ingredient.category)
                              ? "🍽️"
                              : /Gewürz|Öl/i.test(ingredient.category)
                                ? "🌿"
                                : "🫙"}
                      </span>
                      <span>
                        <strong>{ingredient.name}</strong>
                        <small>{ingredient.category}</small>
                      </span>
                      <span className="selection-mark">
                        {pantry.includes(ingredient.id) ? (
                          <Icon name="check" size={12} />
                        ) : (
                          <Icon name="plus" size={12} />
                        )}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="pantry-bottom-note">
                  <label className="check-option">
                    <input
                      type="checkbox"
                      checked={filters.pantryOnly}
                      onChange={(event) =>
                        setFilter("pantryOnly", event.target.checked)
                      }
                    />
                    <span>Only recipes I have all the ingredients for</span>
                  </label>
                  <p>
                    Your choices are left off the shopping list. We track
                    ingredients, not remaining quantities. Water is never on the
                    list.
                  </p>
                </div>
              </div>
            )}

            <div className="journey-actions">
              <button
                className="back-button"
                onClick={backSetup}
                disabled={!journeyComplete && setupStep === "store"}
              >
                <span>←</span>
                {journeyComplete ? "Back to overview" : "Back"}
              </button>
              <span className="journey-hint">
                {setupStep === "store"
                  ? "Store prices and availability are not supported yet."
                  : setupStep === "preferences"
                    ? `${matchingRecipes.length} recipes match your preferences`
                    : setupStep === "week"
                      ? `${scheduleDraft.days.length} days · ${scheduleDraft.days.length * scheduleDraft.meals.length} meals`
                      : `${pantry.length} pantry ingredients · optional`}
              </span>
              <button
                className="primary-button"
                disabled={
                  !store ||
                  (setupStep === "week" &&
                    (!scheduleDraft.days.length ||
                      !scheduleDraft.meals.length)) ||
                  (setupStep === "pantry" &&
                    (!schedule.days.length || !schedule.meals.length))
                }
                onClick={finishSetup}
              >
                {journeyComplete
                  ? setupStep === "week"
                    ? "Create weekly plan"
                    : "Save changes"
                  : setupStep === "pantry"
                    ? "Create weekly plan"
                    : "Continue"}
                <Icon name="arrow" size={17} />
              </button>
            </div>
          </section>
        ) : (
          <>
            <section className="workspace-heading">
              <div>
                <p className="eyebrow">
                  {tab === "recipes"
                    ? "YOUR RECIPES FOR THE WEEK"
                    : "YOUR WEEK, A LITTLE EASIER"}
                </p>
                <h1>
                  {tab === "recipes" ? (
                    <>
                      Good food <em>starts here.</em>
                    </>
                  ) : tab === "plan" ? (
                    <>
                      Your week. <em>Your preferences.</em>
                    </>
                  ) : (
                    <>
                      Everything on <em>one list.</em>
                    </>
                  )}
                </h1>
              </div>
              <div className="workspace-summary">
                <button onClick={() => setSetupStep("store")}>
                  <Icon name="bag" size={14} />
                  {selectedStore?.name ?? "Supermarket"}
                  <span>edit</span>
                </button>
                <button onClick={() => setSetupStep("preferences")}>
                  <Icon name="leaf" size={14} />
                  {[
                    labels[filters.diet],
                    ...filters.tags.map((tag) => labels[tag]),
                    filters.maxMinutes ? `≤ ${filters.maxMinutes} min` : "",
                    filters.difficulty ? labels[filters.difficulty] : "",
                    filters.excludedAllergens.length
                      ? `${filters.excludedAllergens.length} excluded`
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" · ") || "All kinds of good food"}
                  <span>edit</span>
                </button>
                <button onClick={() => setSetupStep("pantry")}>
                  <Icon name="check" size={14} />
                  {pantry.length} ingredients at home<span>edit</span>
                </button>
                <button onClick={editWeek}>
                  <Icon name="book" size={14} />
                  {schedule.days.length} days · {schedule.meals.length} meals ·{" "}
                  {schedule.portions} portions<span>edit</span>
                </button>
              </div>
            </section>
            {tab === "recipes" ? (
              <div className="catalog-layout compact-catalog">
                <section className="recipe-results" aria-label="Recipes">
                  <form className="catalog-toolbar" onSubmit={generate}>
                    <label className="search-field">
                      <Icon name="plus" />
                      <input
                        value={dishWish}
                        maxLength={200}
                        onChange={(event) => setDishWish(event.target.value)}
                        placeholder="What do you feel like? e.g. high-protein chicken curry"
                        aria-label="Describe a dish to generate"
                        disabled={generating}
                      />
                    </label>
                    <button
                      className="primary-button"
                      disabled={generating || !dishWish.trim()}
                    >
                      {generating ? "Generating …" : "Generate recipe"}
                    </button>
                  </form>
                  {generateError && (
                    <p className="notice" role="alert">
                      {generateError}
                    </p>
                  )}
                  <div className="catalog-toolbar">
                    <label className="search-field">
                      <Icon name="search" />
                      <input
                        type="search"
                        placeholder="Search a recipe or ingredient …"
                        value={filters.search}
                        onChange={(event) =>
                          setFilter("search", event.target.value)
                        }
                        aria-label="Search recipes or ingredients"
                      />
                      {filters.search && (
                        <button
                          onClick={() => setFilter("search", "")}
                          aria-label="Clear search"
                        >
                          <Icon name="close" size={16} />
                        </button>
                      )}
                    </label>
                    <label className="sort-select">
                      <span className="sr-only">Sort recipes</span>
                      <select
                        value={sort}
                        onChange={(event) => setSort(event.target.value)}
                      >
                        <option value="name">Alphabetically</option>
                        <option value="pantry">
                          Fewest missing ingredients
                        </option>
                      </select>
                    </label>
                  </div>
                  <div
                    className="discovery-meals"
                    aria-label="Filter recipes by meal"
                  >
                    {[{ id: "", name: "All meals", icon: "" }, ...meals].map(
                      (meal) => (
                        <button
                          key={meal.id}
                          className={
                            discoveryMeal === meal.id ? "selected" : ""
                          }
                          aria-pressed={discoveryMeal === meal.id}
                          onClick={() =>
                            setDiscoveryMeal(meal.id as MealType | "")
                          }
                        >
                          {meal.icon && (
                            <span aria-hidden="true">{meal.icon}</span>
                          )}
                          {meal.name}
                        </button>
                      ),
                    )}
                  </div>
                  <div className="results-meta">
                    <p>
                      <strong>{visible.length}</strong>{" "}
                      {visible.length === 1 ? "recipe" : "recipes"} for you
                    </p>
                    <label className="default-portions">
                      I am cooking for{" "}
                      <select
                        aria-label="Default portions"
                        value={portions}
                        onChange={(event) =>
                          setPortions(Number(event.target.value))
                        }
                      >
                        {Array.from({ length: 12 }, (_, i) => (
                          <option key={i + 1} value={i + 1}>
                            {i + 1}
                          </option>
                        ))}
                      </select>{" "}
                      people
                    </label>
                  </div>
                  <div className="recipe-grid">
                    {visible.map((recipe) => {
                      const inPlan = plan.some(
                        (item) => item.recipeId === recipe.id,
                      );
                      return (
                        <article className="recipe-card" key={recipe.id}>
                          <button
                            className="recipe-visual"
                            onClick={() => openRecipe(recipe)}
                            aria-label={`Open ${recipe.title}`}
                          >
                            <DishArt recipe={recipe} />
                            <span className={`diet-badge ${recipe.diet}`}>
                              {recipe.diet === "vegan"
                                ? "Plant-based"
                                : recipe.diet === "vegetarian"
                                  ? "Vegetarian"
                                  : recipe.diet === "mixed"
                                    ? "Meat / fish"
                                    : "Discover recipe"}
                            </span>
                          </button>
                          <div className="card-body">
                            <div className="card-meta">
                              <span>
                                <Icon name="clock" size={14} />
                                {recipe.minutes
                                  ? `${recipe.minutes} min`
                                  : "Time unknown"}
                              </span>
                              <span>·</span>
                              <span>{labels[recipe.difficulty]}</span>
                            </div>
                            <button
                              className="card-title"
                              onClick={() => openRecipe(recipe)}
                            >
                              <h3>{recipe.title}</h3>
                            </button>
                            <p className="card-description">
                              {recipe.ingredients
                                .slice(0, 3)
                                .map((ingredient) => ingredient.name)
                                .join(" · ")}
                            </p>
                            <RecipeMacros recipe={recipe} />
                            <div className="card-footer">
                              <span>
                                {pantry.length
                                  ? `${missing(recipe)} ingredients missing`
                                  : `${countIngredients(recipe)} ingredients`}
                              </span>
                              <button
                                className={`add-recipe ${inPlan ? "added" : ""}`}
                                onClick={() =>
                                  inPlan
                                    ? openRecipe(recipe)
                                    : addToPlan(recipe)
                                }
                                aria-label={
                                  inPlan
                                    ? `View ${recipe.title} in your plan`
                                    : `Add ${recipe.title} to your meal plan`
                                }
                              >
                                <Icon
                                  name={inPlan ? "check" : "plus"}
                                  size={18}
                                />
                                {inPlan ? "In your plan" : "Add to plan"}
                              </button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  {!visible.length && (
                    <div className="empty-state">
                      <span>⌕</span>
                      <h2>
                        {recipes.length
                          ? "Nothing that suits you yet?"
                          : "No recipes yet"}
                      </h2>
                      <p>
                        {recipes.length
                          ? "Try fewer filters or a different ingredient."
                          : "Describe a dish above to generate your first recipe."}
                      </p>
                      {recipes.length > 0 && (
                      <button
                        className="primary-button"
                        onClick={() => {
                          setFilters(initialFilters);
                          setDiscoveryMeal("");
                        }}
                      >
                        Show all recipes
                      </button>
                      )}
                    </div>
                  )}
                  <p className="catalog-footnote">
                    <Icon name="book" size={15} />
                    AI-generated recipes, standardized for your kitchen.
                    Nutrition details are on each recipe page.
                  </p>
                </section>
              </div>
            ) : tab === "plan" ? (
              <section className="plan-section">
                <div className="section-toolbar">
                  <h2>
                    This week{" "}
                    <span>
                      {plan.length} meals · {unfilledSlots.length} unfilled
                    </span>
                  </h2>
                  <button
                    className="primary-button"
                    onClick={() => setTab(plan.length ? "shopping" : "recipes")}
                  >
                    {plan.length ? "View shopping list" : "Discover recipes"}
                    <Icon name="arrow" size={17} />
                  </button>
                </div>
                <div className="week-plan-toolbar">
                  <p>
                    {schedule.days.length} cooking days ·{" "}
                    {schedule.meals
                      .map((id) => meals.find((meal) => meal.id === id)?.name)
                      .join(", ")}{" "}
                    · starting at {schedule.portions} portions per meal
                  </p>
                  <button className="text-button" onClick={editWeek}>
                    Edit days, meals & portions
                  </button>
                </div>
                {planMessage && (
                  <p className="notice" role="status">
                    {planMessage}
                  </p>
                )}
                {plan.length || unfilledSlots.length ? (
                  <div className="plan-grid">
                    {[...plan]
                      .sort(
                        (a, b) =>
                          (a.day ?? 7) - (b.day ?? 7) ||
                          meals.findIndex((meal) => meal.id === a.meal) -
                            meals.findIndex((meal) => meal.id === b.meal),
                      )
                      .map((item) => {
                        const recipe = recipes.find(
                          (recipe) => recipe.id === item.recipeId,
                        )!;
                        return (
                          <article
                            className="plan-card"
                            key={planItemKey(item)}
                          >
                            <button
                              className="plan-image"
                              onClick={() => openRecipe(recipe, item)}
                              aria-label={`Open ${recipe.title}`}
                            >
                              <DishArt recipe={recipe} small />
                            </button>
                            <div className="plan-card-content">
                              <p className="eyebrow">
                                {item.day !== undefined
                                  ? `${weekdays[item.day]} · ${meals.find((meal) => meal.id === item.meal)?.name}`
                                  : "Extra meal, no set day"}
                              </p>
                              <button
                                className="card-title"
                                onClick={() => openRecipe(recipe, item)}
                              >
                                <h3>{recipe.title}</h3>
                              </button>
                              <p>
                                {recipe.minutes
                                  ? `${recipe.minutes} min · `
                                  : ""}
                                {countIngredients(recipe)} ingredients
                                {recipe.servings === null
                                  ? " · serving count supplied by you"
                                  : ""}
                              </p>
                              <div className="plan-controls">
                                <label>
                                  Portions{" "}
                                  <select
                                    aria-label={`Portions for ${item.day !== undefined ? `${weekdays[item.day]} ${meals.find((meal) => meal.id === item.meal)?.name}` : recipe.title}`}
                                    value={item.portions}
                                    onChange={(event) =>
                                      changePortions(
                                        planItemKey(item),
                                        Number(event.target.value),
                                      )
                                    }
                                  >
                                    {Array.from({ length: 12 }, (_, i) => (
                                      <option key={i + 1}>{i + 1}</option>
                                    ))}
                                  </select>
                                </label>
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    changePlan((current) =>
                                      current.filter(
                                        (entry) =>
                                          planItemKey(entry) !==
                                          planItemKey(item),
                                      ),
                                    )
                                  }
                                >
                                  Remove
                                </button>
                              </div>
                              {item.day !== undefined && (
                                <label className="swap-recipe">
                                  Swap recipe
                                  <select
                                    aria-label={`Recipe for ${weekdays[item.day]} ${meals.find((meal) => meal.id === item.meal)?.name}`}
                                    value={item.recipeId}
                                    onChange={(event) =>
                                      changePlan((current) =>
                                        current.map((entry) =>
                                          planItemKey(entry) ===
                                          planItemKey(item)
                                            ? {
                                                recipeId: event.target.value,
                                                day: item.day,
                                                meal: item.meal,
                                                portions: item.portions,
                                              }
                                            : entry,
                                        ),
                                      )
                                    }
                                  >
                                    <option value={recipe.id}>
                                      {recipe.title}
                                    </option>
                                    {matchingRecipes
                                      .filter(
                                        (candidate) =>
                                          candidate.id !== recipe.id &&
                                          candidate.servings !== null &&
                                          (
                                            candidate.mealTypes ?? [
                                              "lunch",
                                              "dinner",
                                            ]
                                          ).includes(item.meal!),
                                      )
                                      .map((candidate) => (
                                        <option
                                          key={candidate.id}
                                          value={candidate.id}
                                        >
                                          {candidate.title}
                                        </option>
                                      ))}
                                  </select>
                                </label>
                              )}
                            </div>
                          </article>
                        );
                      })}
                    {unfilledSlots.map((slot) => (
                      <article
                        className="unfilled-meal"
                        key={`${slot.day}-${slot.meal}`}
                      >
                        <p className="eyebrow">
                          {weekdays[slot.day]} ·{" "}
                          {meals.find((meal) => meal.id === slot.meal)?.name}
                        </p>
                        <h3>Still unfilled</h3>
                        <p>
                          No matching recipe with a known serving count. Adjust
                          your preferences or choose a recipe yourself.
                        </p>
                        <select
                          aria-label={`Unfilled recipe for ${weekdays[slot.day]} ${meals.find((meal) => meal.id === slot.meal)?.name}`}
                          value=""
                          onChange={(event) => {
                            const recipe = recipes.find(
                              (recipe) => recipe.id === event.target.value,
                            );
                            if (recipe)
                              void navigate({
                                search: {
                                  recipe: recipe.id,
                                  slot: `${slot.day}-${slot.meal}`,
                                },
                              });
                          }}
                        >
                          <option value="">Choose a recipe …</option>
                          {matchingRecipes
                            .filter((candidate) =>
                              (
                                candidate.mealTypes ?? ["lunch", "dinner"]
                              ).includes(slot.meal),
                            )
                            .map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                {candidate.title}
                                {candidate.servings === null
                                  ? " · serving count unknown"
                                  : ""}
                              </option>
                            ))}
                        </select>
                        <button
                          className="text-button"
                          onClick={() => setSetupStep("preferences")}
                        >
                          Edit preferences
                        </button>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <Icon name="leaf" size={44} />
                    <h2>Your next good meal starts here.</h2>
                    <p>
                      Choose a few recipes. We will combine their ingredients
                      into one shopping list.
                    </p>
                  </div>
                )}
              </section>
            ) : (
              <section className="shopping-section">
                <div className="section-toolbar">
                  <h2>
                    Your shopping{" "}
                    <span>
                      {remaining} of {shopping.length} remaining
                    </span>
                  </h2>
                  {shopping.length > 0 && (
                    <button className="primary-button" onClick={copyList}>
                      <Icon name={copied ? "check" : "copy"} size={17} />
                      {copied ? "List copied" : "Copy list"}
                    </button>
                  )}
                </div>
                <div className="shopping-layout">
                  <div>
                    {groups.map((group) => (
                      <section className="shopping-group" key={group}>
                        <h3>
                          {group}
                          <span>
                            {
                              shopping.filter((item) => item.category === group)
                                .length
                            }
                          </span>
                        </h3>
                        {shopping
                          .filter((item) => item.category === group)
                          .map((item) => (
                            <label
                              key={item.id}
                              className={`shopping-row ${checked.includes(item.id) ? "purchased" : ""}`}
                            >
                              <input
                                type="checkbox"
                                checked={checked.includes(item.id)}
                                onChange={() =>
                                  setChecked((current) =>
                                    current.includes(item.id)
                                      ? current.filter((id) => id !== item.id)
                                      : [...current, item.id],
                                  )
                                }
                              />
                              <span className="shopping-item-name">
                                <strong>{item.name}</strong>
                                <small>
                                  {item.recipes.join(" · ")}
                                  {item.note ? ` · ${item.note}` : ""}
                                </small>
                              </span>
                              <span
                                className={
                                  item.unresolved
                                    ? "amount unresolved"
                                    : "amount"
                                }
                              >
                                {formatAmount(item.amount, item.unit)}
                                {item.unresolved && (
                                  <small>Check quantity</small>
                                )}
                              </span>
                            </label>
                          ))}
                      </section>
                    ))}
                    {!shopping.length && (
                      <div className="empty-state">
                        <Icon name="bag" size={44} />
                        <h2>
                          {plan.length
                            ? "Everything is already at home."
                            : "One plan, one shop."}
                        </h2>
                        <p>
                          {plan.length
                            ? "Your recipes use ingredients you have at home."
                            : "Add some recipes to your meal plan first."}
                        </p>
                        <button
                          className="primary-button"
                          onClick={() => showTab("recipes")}
                        >
                          Browse recipes
                          <Icon name="arrow" size={17} />
                        </button>
                      </div>
                    )}
                  </div>
                  <aside className="shopping-note">
                    <span className="note-icon">
                      <Icon name="leaf" size={26} />
                    </span>
                    <h3>
                      A little less waste.
                      <br />A little more ease.
                    </h3>
                    <p>
                      Shared ingredients are added together. Anything already in
                      your pantry is left off the list.
                    </p>
                    <hr />
                    <p>
                      <strong>Shopping quantities</strong>
                      <br />
                      Missing amounts stay visible and are not estimated. Store
                      prices are not available yet.
                    </p>
                    <p className="filter-help">
                      Nutrition estimates are on each recipe. Daily macro targets are not applied yet.
                    </p>
                    <p className="filter-help">
                      Your pantry tracks ingredients, not remaining quantities.
                      Check what is left before you shop.
                    </p>
                  </aside>
                </div>
              </section>
            )}
          </>
        )}
      </main>
      <footer className="app-footer">
        <span>
          batchday <span>·</span> More joy in the everyday.
        </span>
      </footer>
    </div>
  );
}
