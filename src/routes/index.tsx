import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Fragment, useEffect, useRef, useState } from "react";
import {
  generateRecipe,
  getChatGPTAccount,
  getRecipes,
  planMenu,
} from "../lib/catalog";
import { getProductData, matchProducts } from "../lib/products";
import {
  allergenOptions,
  buildShoppingList,
  chooseProduct,
  commonDislikes,
  fillOpenSlot,
  filterRecipes,
  formatAmount,
  generateWeeklyPlan,
  ingredientId,
  ingredientIds,
  isLowerBound,
  pantryStaples,
  pickRules,
  planItemKey,
  productLine,
  readFilters,
  readSchedule,
  tagOptions,
} from "../lib/recipes";
import type {
  Filters,
  MealType,
  MenuDish,
  PickRule,
  PlanItem,
  ProductLine,
  Recipe,
  StoreProduct,
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
  loader: async () => {
    const [recipes, chatGPTAccount, productData] = await Promise.all([
      getRecipes(),
      getChatGPTAccount(),
      getProductData(),
    ]);
    return { recipes, chatGPTAccount, productData };
  },
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
// Removed discovery controls must not invisibly constrain the next plan.
const readPlanFilters = (value: unknown): Filters => ({
  ...readFilters(value),
  search: "",
  maxMinutes: null,
  difficulty: "",
  maxIngredients: null,
  pantryOnly: false,
});
const labels: Record<string, string> = {
  "one-pot": "One pot",
  "meal-prep": "Meal prep",
  "protein-source": "High protein",
  keto: "Keto",
  "low-calorie": "Low calorie",
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
  { id: "billa", name: "BILLA" },
  { id: "spar", name: "SPAR" },
  { id: "hofer", name: "HOFER" },
  { id: "lidl", name: "Lidl" },
  { id: "penny", name: "PENNY" },
  { id: "other", name: "Another supermarket" },
];
type SetupStep = "store" | "preferences" | "pantry" | "week";
const setupSteps: SetupStep[] = ["store", "preferences", "pantry", "week"];
const stepTitles = {
  store: "Store",
  preferences: "Preferences",
  pantry: "Pantry",
  week: "Schedule",
};
const stepHeadings = {
  store: "Where do you shop?",
  preferences: "What suits your week?",
  pantry: "What’s already at home?",
  week: "When are you eating?",
};
const stepDescriptions = {
  store: "One supermarket for your weekly shop.",
  preferences: "Pick what matters. Leave the rest open.",
  pantry: "We’ll leave these off your shopping list.",
  week: "Choose your days, meals and servings.",
};
const preferenceNotes: Record<string, string> = {
  "one-pot": "Less washing up",
  "protein-source": "25 g+ protein per serving",
  keto: "10 g carbs or less per serving",
  "low-calorie": "500 kcal or less per serving",
  "meal-prep": "Keeps and reheats well",
};
const pantryOptions = pantryStaples.map(([name, category]) => ({
  id: ingredientId(name),
  name,
  category,
}));
type RunDish = MenuDish & {
  day?: Weekday;
  status: "waiting" | "writing" | "ready" | "failed";
  recipeId?: string;
};
const weekdays = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const meals: { id: MealType; name: string }[] = [
  { id: "breakfast", name: "Breakfast" },
  { id: "lunch", name: "Lunch" },
  { id: "dinner", name: "Dinner" },
];
const initialSchedule: WeeklySchedule = {
  days: [0, 1, 2, 3, 4],
  meals: ["dinner"],
  portions: 2,
};
const pickRuleLabels: Record<PickRule, string> = {
  cheapest: "Cheapest",
  "store-brand": "Store brand first",
  bio: "Organic first",
};
const euro = new Intl.NumberFormat("de-AT", {
  style: "currency",
  currency: "EUR",
});
const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;
// fetch rejects with a TypeError when the request never reaches the server; server errors keep their message.
const failureMessage = (error: unknown, failed: string) =>
  error instanceof Error && !(error instanceof TypeError)
    ? error.message
    : `${failed} Check your connection and try again.`;
const packSize = (product: StoreProduct) =>
  formatAmount(
    product.quantity,
    product.unit === "stk" ? "Stück" : product.unit,
  );
const packDetails = (product: StoreProduct) =>
  product.weighted
    ? `${euro.format(product.price)} per ${packSize(product)}`
    : `${packSize(product)} · ${euro.format(product.price)}`;
const productText = (line: ProductLine) =>
  `${line.packs === null ? "" : `${line.packs} × `}${line.product.name} (${packDetails(line.product)})`;
const portionNumber = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= 12;

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
  const { recipes, chatGPTAccount, productData } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [setupStep, setSetupStep] = useState<SetupStep | null>("store");
  const [journeyComplete, setJourneyComplete] = useState(false);
  const [store, setStore] = useState<string | null>(null);
  const [dislikeSearch, setDislikeSearch] = useState("");
  const [tab, setTab] = useState<"plan" | "shopping">("plan");
  const [pantrySearch, setPantrySearch] = useState("");
  const [showProducts, setShowProducts] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [pantry, setPantry] = useState<string[]>([]);
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [schedule, setSchedule] = useState<WeeklySchedule>(initialSchedule);
  const [scheduleDraft, setScheduleDraft] =
    useState<WeeklySchedule>(initialSchedule);
  const [planMessage, setPlanMessage] = useState("");
  const [generationError, setGenerationError] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const [previousSetup, setPreviousSetup] = useState<{
    store: string;
    filters: Filters;
    pantry: string[];
    checked: string[];
  } | null>(null);
  const editingSetup = journeyComplete && !previousSetup;
  const [loaded, setLoaded] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  const [systemDark, setSystemDark] = useState(false);
  const dark = theme === "dark" || (theme === null && systemDark);
  const [storageError, setStorageError] = useState(false);
  const [portions, setPortions] = useState(2);
  const selected = recipes.find((recipe) => recipe.id === search.recipe);
  const [detailPortions, setDetailPortions] = useState(2);
  const [baseServings, setBaseServings] = useState<number | undefined>(
    selected?.servings ?? undefined,
  );
  const [copied, setCopied] = useState(false);
  const [pickRule, setPickRule] = useState<PickRule>("cheapest");
  // Manual product picks per `${store}:${ingredient id}`; everything else follows the pick rule.
  const [productChoices, setProductChoices] = useState<Record<string, string>>(
    {},
  );
  const [productMatches, setProductMatches] = useState<{
    store: string;
    latestChange: string;
    products: Record<string, StoreProduct[] | null>;
  } | null>(null);
  // The store whose products are being found, and the last matching error with its store.
  const [matching, setMatching] = useState<string | null>(null);
  const [matchError, setMatchError] = useState<{
    store: string;
    message: string;
  } | null>(null);
  const productNote = useRef<HTMLParagraphElement>(null);
  const refocus = useRef(false);
  const matchVersion = useRef(0);
  const currentStore = useRef(store);
  useEffect(() => {
    currentStore.current = store;
  }, [store]);
  const router = useRouter();
  const [run, setRun] = useState<{
    dishes: RunDish[];
    stopping: boolean;
  } | null>(null);
  const runToken = useRef<{ stopped: boolean } | null>(null);
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
  // Common dislikes come first so setup works before any recipe exists.
  const dislikeOptions = [
    ...commonDislikes.map((name) => ({ id: ingredientId(name), name })),
    ...ingredients.filter((ingredient) => ingredient.id !== "wasser"),
  ].filter(
    (option, index, all) =>
      all.findIndex((other) => other.id === option.id) === index,
  );
  const allPantryOptions = [
    ...pantryOptions,
    ...ingredients
      .filter((item) => item.id !== "wasser")
      .map((item) =>
        item.id === "oel" ? { ...item, name: "Öl (unspecified)" } : item,
      ),
    ...pantry
      .filter(
        (id) =>
          !pantryOptions.some((item) => item.id === id) &&
          !ingredients.some((item) => item.id === id),
      )
      .map((id) => ({
        id,
        name: id === "oel" ? "Öl (unspecified)" : id,
        category: "Already selected",
      })),
  ].filter(
    (item, index, all) =>
      all.findIndex((other) => other.id === item.id) === index,
  );
  const nameOf = (id: string) =>
    [...allPantryOptions, ...dislikeOptions].find((item) => item.id === id)
      ?.name ?? id;
  const pantryVisible = allPantryOptions.filter((item) =>
    pantrySearch.trim()
      ? item.name
          .toLocaleLowerCase("de")
          .includes(pantrySearch.trim().toLocaleLowerCase("de"))
      : pantryOptions.some((staple) => staple.id === item.id) ||
        pantry.includes(item.id),
  );

  useEffect(() => {
    if (loaded) return;
    try {
      const saved =
        JSON.parse(localStorage.getItem("batchday-poc") || "{}") ?? {};
      setTheme(
        saved.theme === "light" || saved.theme === "dark" ? saved.theme : null,
      );
      const validStore = stores.some((item) => item.id === saved.store)
        ? saved.store
        : null;
      const previous =
        saved.journeyComplete === true &&
        setupSteps.includes(saved.setupStep) &&
        stores.some((item) => item.id === saved.previousSetup?.store)
          ? {
              store: saved.previousSetup.store as string,
              filters: readPlanFilters(saved.previousSetup.filters),
              pantry: ingredientIds(saved.previousSetup.pantry),
              checked: Array.isArray(saved.previousSetup.checked)
                ? saved.previousSetup.checked.filter(
                    (id: unknown): id is string => typeof id === "string",
                  )
                : [],
            }
          : null;
      setPreviousSetup(previous);
      const completed = saved.journeyComplete === true && !!(validStore || previous);
      setStore(validStore);
      setJourneyComplete(completed);
      setTab(saved.tab === "shopping" ? "shopping" : "plan");
      setSetupStep(
        validStore && setupSteps.includes(saved.setupStep)
          ? saved.setupStep
          : completed && !previous
            ? null
            : "store",
      );
      setFilters(readPlanFilters(saved.filters));
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
      const restoredSchedule = readSchedule(saved.schedule, initialSchedule);
      setSchedule(restoredSchedule);
      setScheduleDraft(readSchedule(saved.scheduleDraft, restoredSchedule));
      setPortions(restoredSchedule.portions);
      if (Array.isArray(saved.pantry)) setPantry(ingredientIds(saved.pantry));
      if (Array.isArray(saved.checked))
        setChecked(
          saved.checked.filter(
            (id: unknown): id is string => typeof id === "string",
          ),
        );
      if (pickRules.includes(saved.pickRule)) setPickRule(saved.pickRule);
      if (saved.productChoices && typeof saved.productChoices === "object")
        setProductChoices(
          Object.fromEntries(
            Object.entries(saved.productChoices).filter(
              (entry): entry is [string, string] =>
                /^[a-z]{1,20}:[a-z0-9]{1,80}$/.test(entry[0]) &&
                typeof entry[1] === "string" &&
                entry[1].length <= 100,
            ),
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
            previousSetup,
            setupStep,
            schedule,
            scheduleDraft,
            tab,
            pickRule,
            productChoices,
            theme,
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
    previousSetup,
    setupStep,
    schedule,
    scheduleDraft,
    tab,
    pickRule,
    productChoices,
    theme,
  ]);
  useEffect(() => {
    if (selected) {
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

  useEffect(() => {
    const preference = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }, [theme, loaded]);

  const selectedStore = stores.find((item) => item.id === store);
  const showTab = (nextTab: "plan" | "shopping") => {
    if (search.recipe) void navigate({ search: {} });
    setTab(nextTab);
    if (journeyComplete) {
      if (previousSetup) {
        setStore(previousSetup.store);
        setFilters(previousSetup.filters);
        setPantry(previousSetup.pantry);
        setChecked(previousSetup.checked);
        setPreviousSetup(null);
      }
      setSetupStep(null);
      if (setupStep) setScheduleDraft(schedule);
    }
  };
  const editWeek = () => {
    setScheduleDraft(schedule);
    setSetupStep("week");
  };
  const startOver = () => {
    if (run || !store) return;
    setPreviousSetup({ store, filters, pantry, checked });
    setStore(null);
    setFilters(initialFilters);
    setPantry([]);
    setScheduleDraft(initialSchedule);
    setDislikeSearch("");
    setPantrySearch("");
    setSetupStep("store");
  };
  // The browser drives generation so each finished recipe shows up at once; server calls stay stateless.
  const generateWeek = async (week: WeeklySchedule) => {
    const token = { stopped: false };
    runToken.current = token;
    const active = () => runToken.current === token;
    const days = [...week.days].sort((a, b) => a - b);
    setTab("plan");
    setPlanMessage("");
    setGenerationError(false);
    setRun({ dishes: [], stopping: false });
    try {
      const menu = await planMenu({
        data: { meals: week.meals, days: days.length, filters, pantry },
      });
      if (!active() || token.stopped) return;
      // Each dish follows its meal type’s selected days in order.
      const dishes: RunDish[] = menu.map((dish, index) => ({
        ...dish,
        status: "waiting",
        day: days[
          menu.slice(0, index).filter((other) => other.meal === dish.meal)
            .length
        ],
      }));
      // Replace the week only once there is a menu, so a failed request keeps the current plan.
      setSchedule(week);
      changePlan(() => []);
      setPortions(week.portions);
      setRun({ dishes: [...dishes], stopping: false });
      const update = (index: number, change: Partial<RunDish>) => {
        dishes[index] = { ...dishes[index], ...change };
        if (active())
          setRun((current) => current && { ...current, dishes: [...dishes] });
      };
      const errors: string[] = [];
      let refresh = Promise.resolve();
      let next = 0;
      await Promise.all(
        Array.from({ length: 3 }, async () => {
          while (next < dishes.length && active() && !token.stopped) {
            const index = next++;
            const { meal, title, brief, day } = dishes[index];
            update(index, { status: "writing" });
            try {
              const recipeId = await generateRecipe({
                data: {
                  dish: { meal, title, brief },
                  portions: week.portions,
                  filters,
                  pantry,
                },
              });
              // Serialized reloads: a slot only references a recipe once the catalogue containing it has loaded.
              await (refresh = refresh
                .catch(() => undefined)
                .then(() => router.invalidate()));
              update(index, { status: "ready", recipeId });
              if (day !== undefined && active())
                changePlan((current) =>
                  fillOpenSlot(current, week, recipeId, meal, day),
                );
            } catch (error) {
              errors.push(
                error instanceof Error
                  ? error.message
                  : "Recipe generation failed.",
              );
              update(index, { status: "failed" });
            }
          }
        }),
      );
      if (!active()) return;
      const ready = dishes.filter((dish) => dish.recipeId).length;
      setPlanMessage(
        `${token.stopped ? "Stopped. " : ""}${ready} new ${ready === 1 ? "recipe" : "recipes"} with macros. ${
          errors.length
            ? `${errors.length} could not be written: ${errors[0]} `
            : ""
        }`,
      );
    } catch (error) {
      if (active()) {
        setGenerationError(true);
        setPlanMessage(
          error instanceof Error
            ? error.message
            : "Menu planning failed. Please try again.",
        );
      }
    } finally {
      if (active()) {
        runToken.current = null;
        setRun(null);
      }
    }
  };
  const stopRun = () => {
    if (runToken.current) runToken.current.stopped = true;
    setRun((current) => current && { ...current, stopping: true });
  };
  const makeWeeklyPlan = (week = schedule) => {
    if (run) return;
    setScheduleDraft(week);
    if (chatGPTAccount) {
      if (!plan.length) setSchedule(week);
      void generateWeek(week);
      return;
    }
    useSavedWeek(week);
  };
  const useSavedWeek = (week: WeeklySchedule) => {
    setGenerationError(false);
    const result = generateWeeklyPlan(recipes, week, filters, pantry);
    setSchedule(week);
    changePlan(() => result.plan);
    setPortions(week.portions);
    setPlanMessage(
      result.unfilled.length
        ? `${result.unfilled.length} meals are unfilled: no matching recipe has a known serving count. Try different preferences or connect ChatGPT to create recipes.`
        : `${result.plan.length} meals planned. You can swap any recipe.`,
    );
    setTab("plan");
  };
  const finishSetup = () => {
    if (editingSetup && setupStep !== "week") {
      setSetupStep(null);
      return;
    }
    if (setupStep === "week") {
      makeWeeklyPlan(scheduleDraft);
      setPreviousSetup(null);
      setJourneyComplete(true);
      setSetupStep(null);
    } else if (setupStep) {
      setSetupStep(setupSteps[setupSteps.indexOf(setupStep) + 1]);
    }
  };
  const backSetup = () => {
    if (editingSetup || (previousSetup && setupStep === "store")) {
      showTab("plan");
    } else if (setupStep && setupStep !== "store")
      setSetupStep(setupSteps[setupSteps.indexOf(setupStep) - 1]);
  };
  useEffect(() => {
    if (!loaded) return;
    document.title = `${selected?.title ?? (setupStep ? stepTitles[setupStep] : tab === "plan" ? "Your week" : "Shopping list")} · Batchday`;
    heading.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [setupStep, search.recipe, tab, loaded]);
  useEffect(
    () => () => {
      if (runToken.current) runToken.current.stopped = true;
    },
    [],
  );
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
  // Plan swaps follow preferences, not the text typed into the recipe search.
  const preferredRecipes = filterRecipes(
    recipes,
    { ...filters, search: "" },
    pantry,
  ).sort((a, b) => a.title.localeCompare(b.title, "en"));
  const swapSlot = (item: PlanItem, recipeId: string) =>
    changePlan((current) =>
      current.map((entry) =>
        planItemKey(entry) === planItemKey(item)
          ? {
              recipeId,
              day: item.day,
              meal: item.meal,
              portions: item.portions,
            }
          : entry,
      ),
    );
  const weekSlots = [...schedule.days]
    .sort()
    .flatMap((day) =>
      meals
        .filter((meal) => schedule.meals.includes(meal.id))
        .map((meal) => ({ day, meal: meal.id })),
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
  const shopping = buildShoppingList(recipes, plan, pantry);
  const groups = [...new Set(shopping.map((item) => item.category))];
  const remaining = shopping.filter(
    (item) => !checked.includes(item.id),
  ).length;
  const storeName = selectedStore?.name ?? "this supermarket";
  const productStock = store ? productData?.stores[store] : undefined;
  // Rows of one ingredient split by unit or unknown amount share one product line, shown on the first row.
  const ingredientRows = [
    ...new Set(shopping.map((item) => ingredientId(item.name))),
  ].map((id) => shopping.filter((item) => ingredientId(item.name) === id));
  const productNames = ingredientRows.map(([item]) => item.name);
  // undefined or null: not matched yet; []: nothing in this shop fits.
  const suitableProducts = (item: { name: string }) =>
    productMatches?.store === store
      ? productMatches.products[ingredientId(item.name)]
      : undefined;
  const choiceKey = (item: { name: string }) =>
    `${store}:${ingredientId(item.name)}`;
  const productLines = new Map(
    ingredientRows.flatMap((rows) => {
      const suitable = suitableProducts(rows[0]);
      const line =
        store && suitable?.length
          ? chooseProduct(
              rows,
              suitable,
              pickRule,
              store,
              productChoices[choiceKey(rows[0])],
            )
          : null;
      return line ? [[rows[0].id, line] as const] : [];
    }),
  );
  const unmatchedCount = productNames.filter(
    (name) => !suitableProducts({ name }),
  ).length;
  // A product sold by weight has no cost for pieces or spoons, so it stays out of the total.
  const pricedLines = [...productLines.values()].filter(
    (line) => line.cost !== null,
  );
  // Add the displayed cents, including Intl's half-cent rounding for weighed products.
  const productTotal =
    pricedLines.reduce(
      (sum, line) =>
        sum +
        Number(
          euro
            .formatToParts(line.cost ?? 0)
            .filter(
              (part) => part.type === "integer" || part.type === "fraction",
            )
            .map((part) => part.value)
            .join(""),
        ),
      0,
    ) / 100;
  const unpricedCount = productLines.size - pricedLines.length;
  const staleProducts =
    !!productData &&
    !!productStock &&
    Date.parse(productData.downloadedAt) -
      Date.parse(productStock.latestChange) >
      7 * 86_400_000;
  const productKey = productStock ? JSON.stringify([store, productNames]) : "";
  const finding =
    matching &&
    `Finding ${stores.find((item) => item.id === matching)?.name ?? ""} products…`;
  // Saved matches load with the list; new matching only runs from the explicit button.
  useEffect(() => {
    if (
      !loaded ||
      !showProducts ||
      tab !== "shopping" ||
      !store ||
      !productNames.length ||
      !productKey
    )
      return;
    let current = true;
    const version = matchVersion.current;
    setMatchError(null);
    matchProducts({ data: { store, names: productNames, cachedOnly: true } })
      .then((result) => {
        if (current && version === matchVersion.current)
          setProductMatches({ store, ...result });
      })
      .catch((error) => {
        if (current && version === matchVersion.current)
          setMatchError({
            store,
            message: failureMessage(
              error,
              "Saved products could not be loaded.",
            ),
          });
      });
    return () => {
      current = false;
    };
  }, [loaded, tab, productKey, showProducts]);
  // Success removes the focused Find button once everything is matched; if focus fell to the page, keep it in the panel.
  useEffect(() => {
    if (matching || !refocus.current) return;
    refocus.current = false;
    if (document.activeElement === document.body)
      productNote.current?.focus({ preventScroll: true });
  }, [matching]);
  const findProducts = async () => {
    // The button stays focusable while matching (aria-disabled), so a second press lands here.
    if (!store || matching) return;
    // A result updates only its own store and merges in, so a late answer cannot hide newer matches.
    const show = (result: {
      latestChange: string;
      products: Record<string, StoreProduct[] | null>;
    }) => {
      if (currentStore.current !== store) return;
      matchVersion.current += 1;
      setProductMatches((current) => ({
        store,
        latestChange: result.latestChange,
        products: {
          ...(current?.store === store ? current.products : {}),
          ...result.products,
        },
      }));
    };
    refocus.current = true;
    matchVersion.current += 1;
    setMatching(store);
    setMatchError(null);
    try {
      show(await matchProducts({ data: { store, names: productNames } }));
    } catch (error) {
      setMatchError({
        store,
        message: failureMessage(error, "Product matching failed."),
      });
      // Batches saved before the failure still show.
      await matchProducts({
        data: { store, names: productNames, cachedOnly: true },
      }).then(show, () => undefined);
    } finally {
      setMatching(null);
    }
  };
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
  const copyList = async () => {
    const remainingProducts = new Map(
      ingredientRows.flatMap((rows) => {
        const remainingRows = rows.filter((item) => !checked.includes(item.id));
        const selected = showProducts ? productLines.get(rows[0].id) : undefined;
        return selected && remainingRows.length
          ? [[remainingRows[0].id, productLine(remainingRows, selected.product)] as const]
          : [];
      }),
    );
    const text = groups
      .map(
        (group) =>
          `${group}\n${shopping
            .filter(
              (item) => item.category === group && !checked.includes(item.id),
            )
            .map((item) => {
              const line = remainingProducts.get(item.id);
              return `[ ] ${formatAmount(item.amount, item.unit)} ${item.name}${item.unresolved ? " (check quantity)" : ""}${item.note ? ` — ${item.note}` : ""}${line ? `\n   ${productText(line)}${line.check ? ", check amount" : ""}` : ""}`;
            })
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

  const togglePantry = (id: string) =>
    changePantry((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  const selectedPlanItem =
    selected && selectedTarget
      ? plan.find(
          (item) =>
            planItemKey(item) ===
              planItemKey({
                ...selectedTarget,
                recipeId: selected.id,
                portions: detailPortions,
              }) && item.recipeId === selected.id,
        )
      : undefined;
  const filledMeals = weekSlots.filter((slot) =>
    plan.some((item) => item.day === slot.day && item.meal === slot.meal),
  ).length;
  const summaryPreferences =
    [
      filters.diet && labels[filters.diet],
      ...filters.tags.map((tag) => labels[tag]),
    ]
      .filter(Boolean)
      .join(" · ") || "Open to anything";
  const runReady =
    run?.dishes.filter((dish) => dish.status === "ready").length ?? 0;
  const canContinue =
    !!store &&
    (setupStep !== "week" ||
      (!!scheduleDraft.days.length && !!scheduleDraft.meals.length)) &&
    !run;
  const renderMeal = (
    item: PlanItem | undefined,
    day?: Weekday,
    meal?: MealType,
  ) => {
    const recipe = item && recipes.find((entry) => entry.id === item.recipeId);
    const candidates = meal
      ? preferredRecipes.filter(
          (entry) =>
            entry.id !== recipe?.id &&
            entry.servings !== null &&
            (entry.mealTypes ?? ["lunch", "dinner"]).includes(meal),
        )
      : [];
    const writing = run?.dishes.find(
      (dish) => dish.day === day && dish.meal === meal,
    );
    return (
      <div
        className={`meal-row ${recipe ? "" : "empty-meal"}`}
        key={meal ?? item?.recipeId}
      >
        <span className="meal-label">
          {meals.find((entry) => entry.id === meal)?.name ?? "Extra meal"}
        </span>
        <div className="meal-main">
          {recipe ? (
            <>
              <button
                className="meal-title"
                onClick={() => openRecipe(recipe, item)}
              >
                {recipe.title}
              </button>
              <p className="meal-meta">
                {item!.portions} servings ·{" "}
                {recipe.minutes ? `${recipe.minutes} min` : "Time unknown"}
                {recipe.nutrition
                  ? ` · ${Math.round(recipe.nutrition.kcal)} kcal · ${Math.round(recipe.nutrition.protein)} g protein per serving`
                  : " · Nutrition incomplete"}
              </p>
            </>
          ) : (
            <>
              <span className="meal-title">
                {writing
                  ? writing.status === "failed"
                    ? "Couldn’t create this meal"
                    : writing.title
                  : "No meal planned"}
              </span>
              <p className="meal-meta">
                {writing && writing.status !== "failed"
                  ? writing.status === "writing"
                    ? "Writing recipe…"
                    : "Waiting…"
                  : "Choose a saved recipe or edit your plan."}
              </p>
            </>
          )}
        </div>
        {!!candidates.length && (
          <select
            className="meal-swap"
            aria-label={`${recipe ? "Swap" : "Choose"} ${meal} on ${day === undefined ? "extra meal" : weekdays[day]}`}
            value=""
            disabled={!!run}
            onChange={(event) => {
              if (!event.target.value || day === undefined || !meal) return;
              if (item) swapSlot(item, event.target.value);
              else
                changePlan((current) =>
                  fillOpenSlot(
                    current,
                    schedule,
                    event.target.value,
                    meal,
                    day,
                  ),
                );
            }}
          >
            <option value="">{recipe ? "Swap" : "Choose"}</option>
            {candidates.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.title}
              </option>
            ))}
          </select>
        )}
      </div>
    );
  };
  return (
    <div className="app-shell">
      <header className="app-header">
        <button
          className="brand"
          onClick={() => journeyComplete && showTab("plan")}
          aria-label="Batchday home"
        >
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          batchday
        </button>
        {journeyComplete && !setupStep && (
          <nav className="header-nav" aria-label="Main navigation">
            <button
              className={!selected && tab === "plan" ? "active" : ""}
              aria-current={!selected && tab === "plan" ? "page" : undefined}
              onClick={() => showTab("plan")}
            >
              Week
            </button>
            <button
              className={!selected && tab === "shopping" ? "active" : ""}
              aria-current={
                !selected && tab === "shopping" ? "page" : undefined
              }
              onClick={() => showTab("shopping")}
            >
              Shopping
            </button>
          </nav>
        )}
        <div className="header-actions">
          {journeyComplete && setupStep ? (
            <button className="text-button" onClick={() => showTab("plan")}>
              Back to week
            </button>
          ) : journeyComplete ? (
            <button
              className="text-button"
              disabled={!!run}
              onClick={() => {
                void navigate({ search: {} });
                editWeek();
              }}
            >
              Edit plan
            </button>
          ) : (
            <span className="header-note">
              A little planning. A better week.
            </span>
          )}
          <button
            className="theme-toggle"
            aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
            disabled={!loaded}
            onClick={() => setTheme(dark ? "light" : "dark")}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {dark ? (
                <>
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
                </>
              ) : (
                <path d="M20.5 13a8.5 8.5 0 0 1-9.5-9.5A8.5 8.5 0 1 0 20.5 13Z" />
              )}
            </svg>
            {dark ? "Light" : "Dark"}
          </button>
        </div>
      </header>
      <main className="main">
        {storageError && (
          <p className="notice error" role="alert">
            Your browser couldn’t restore or save all your choices. Changes may
            not survive a reload.
          </p>
        )}
        {!loaded ? (
          <h1 ref={heading} tabIndex={-1}>
            Opening your kitchen…
          </h1>
        ) : search.recipe && !selected ? (
          <div className="empty-state">
            <h1 ref={heading} tabIndex={-1}>
              Recipe not found
            </h1>
            <p>This recipe is no longer in your collection.</p>
            <button
              className="button secondary"
              onClick={() => void navigate({ search: {} })}
            >
              Back to your week
            </button>
          </div>
        ) : selected ? (
          <article className="recipe-detail">
            <button
              className="back-link text-button"
              onClick={() => void navigate({ search: {} })}
            >
              ← Back to {tab === "shopping" ? "shopping" : "your week"}
            </button>
            <div className="recipe-heading">
              <h1 ref={heading} tabIndex={-1}>
                {selected.title}
              </h1>
              <p className="recipe-meta">
                {selected.minutes
                  ? `${selected.minutes} min`
                  : "Cooking time unknown"}{" "}
                · {labels[selected.diet]} · Untested recipe
              </p>
            </div>
            <RecipeMacros recipe={selected} />
            {!selected.nutrition && (
              <p className="muted">
                Nutrition incomplete
                {selected.nutritionMissing?.length
                  ? `: ${selected.nutritionMissing.join(", ")}`
                  : ""}
                .
              </p>
            )}
            <div className="recipe-columns">
              <section className="ingredients-panel">
                <div className="day-heading">
                  <h2>Ingredients</h2>
                  <label className="portions-control">
                    <span className="sr-only">Recipe servings</span>
                    <select
                      aria-label="Recipe servings"
                      value={detailPortions}
                      onChange={(event) =>
                        setDetailPortions(Number(event.target.value))
                      }
                    >
                      {Array.from({ length: 12 }, (_, i) => (
                        <option key={i + 1} value={i + 1}>
                          {i + 1} servings
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {!baseServings && (
                  <p className="notice">
                    Original serving count unknown. Quantities below cannot be
                    scaled.
                  </p>
                )}
                <ul>
                  {selected.ingredients.map((ingredient, index) => (
                    <li
                      className="ingredient-row"
                      key={`${ingredient.id}-${index}`}
                    >
                      <span>
                        {ingredient.name}
                        {ingredient.note && <small>{ingredient.note}</small>}
                      </span>
                      <span className="shopping-amount">
                        {formatAmount(
                          ingredient.amount === null
                            ? null
                            : ingredient.amount *
                                (baseServings
                                  ? detailPortions / baseServings
                                  : 1),
                          ingredient.unit,
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                {selectedPlanItem &&
                  selectedPlanItem.portions !== detailPortions &&
                  baseServings && (
                    <button
                      className="button primary"
                      disabled={!!run}
                      onClick={() =>
                        changePlan((current) =>
                          current.map((item) =>
                            planItemKey(item) === planItemKey(selectedPlanItem)
                              ? { ...item, portions: detailPortions }
                              : item,
                          ),
                        )
                      }
                    >
                      Update planned servings
                    </button>
                  )}
              </section>
              <section className="instructions">
                <h2>Let’s cook</h2>
                <ol>
                  {selected.instructions.map((step, index) => (
                    <li key={index}>{step}</li>
                  ))}
                </ol>
                <p className="recipe-note">
                  When scaling, use the ingredient amounts on this page. Amounts
                  written in the method stay as originally generated.
                </p>
              </section>
            </div>
            <details className="disclosure">
              <summary>Recipe notes</summary>
              <p>
                AI-generated by {selected.source.model} on{" "}
                {new Date(selected.source.createdAt).toLocaleDateString(
                  "en-AT",
                )}
                . Check amounts and timing when cooking.
              </p>
              {selected.nutritionMetadata && (
                <p>
                  {selected.nutritionMetadata.source}
                  {selected.nutritionMetadata.note
                    ? ` · ${selected.nutritionMetadata.note}`
                    : ""}
                </p>
              )}
              <p>
                Diet and allergen labels are provisional. Check every ingredient
                for your needs.
              </p>
              {selected.source.basedOn && (
                <p>
                  Based on{" "}
                  <button
                    className="text-button"
                    onClick={() =>
                      void navigate({
                        search: { recipe: selected.source.basedOn },
                      })
                    }
                  >
                    an earlier recipe
                  </button>
                  .
                </p>
              )}
            </details>
          </article>
        ) : setupStep ? (
          <>
            <nav className="steps" aria-label="Plan setup">
              <ol>
                {setupSteps.map((step, index) => (
                  <li
                    key={step}
                    className={
                      setupStep === step
                        ? "active"
                        : index < setupSteps.indexOf(setupStep) ||
                            editingSetup
                          ? "complete"
                          : ""
                    }
                  >
                    <button
                      aria-current={setupStep === step ? "step" : undefined}
                      disabled={
                        !editingSetup &&
                        index > setupSteps.indexOf(setupStep)
                      }
                      onClick={() => {
                        setSetupStep(step);
                      }}
                    >
                      {stepTitles[step]}
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
            <div className="setup-layout">
              <div className="setup-intro">
                <h1 ref={heading} tabIndex={-1}>
                  {stepHeadings[setupStep]}
                </h1>
                <p>{stepDescriptions[setupStep]}</p>
                {previousSetup && (
                  <p className="field-note">
                    Your current week stays until you create a new one.
                  </p>
                )}
                {setupStep !== "store" && (
                  <p className="setup-context">
                    Shopping at <strong>{storeName}</strong>
                  </p>
                )}
              </div>
              <section
                className="setup-body"
                aria-label={stepTitles[setupStep]}
              >
                {setupStep === "store" ? (
                  <div
                    className="choice-list"
                    role="group"
                    aria-label="Supermarket"
                  >
                    {stores.map((option) => (
                      <button
                        key={option.id}
                        className={`choice ${store === option.id ? "selected" : ""}`}
                        aria-pressed={store === option.id}
                        onClick={() => setStore(option.id)}
                      >
                        <span className="choice-copy">{option.name}</span>
                        <span className="choice-mark" aria-hidden="true">
                          {""}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : setupStep === "preferences" ? (
                  <>
                    <div
                      className="choice-list"
                      role="group"
                      aria-label="Meal preferences"
                    >
                      {[
                        "one-pot",
                        "protein-source",
                        "keto",
                        "low-calorie",
                        "meal-prep",
                      ]
                        .filter((tag) => tagOptions.includes(tag))
                        .map((tag) => (
                          <button
                            key={tag}
                            className={`choice ${filters.tags.includes(tag) ? "selected" : ""}`}
                            aria-pressed={filters.tags.includes(tag)}
                            onClick={() => toggleFilter("tags", tag)}
                          >
                            <span className="choice-copy">
                              <strong>{labels[tag]}</strong>
                              <small>{preferenceNotes[tag]}</small>
                            </span>
                            <span className="choice-mark" aria-hidden="true">
                              {filters.tags.includes(tag) ? "" : "+"}
                            </span>
                          </button>
                        ))}
                    </div>
                    <details
                      className="disclosure"
                      open={
                        filters.diet !== "" ||
                        filters.excludedAllergens.length > 0 ||
                        !!filters.excludedIngredients?.length ||
                        undefined
                      }
                    >
                      <summary>Diet & ingredients to avoid</summary>
                      <fieldset className="field-group">
                        <legend>Diet</legend>
                        <div className="chip-row">
                          {["", "vegetarian", "vegan", "mixed"].map((diet) => (
                            <button
                              key={diet}
                              className={`chip ${filters.diet === diet ? "selected" : ""}`}
                              aria-pressed={filters.diet === diet}
                              onClick={() => setFilter("diet", diet)}
                            >
                              {diet ? labels[diet] : "Anything"}
                            </button>
                          ))}
                        </div>
                      </fieldset>
                      <fieldset className="field-group">
                        <legend>Allergens to avoid</legend>
                        <div className="chip-row">
                          {allergenOptions.map((allergen) => (
                            <button
                              key={allergen}
                              className={`chip ${filters.excludedAllergens.includes(allergen) ? "selected" : ""}`}
                              aria-pressed={filters.excludedAllergens.includes(
                                allergen,
                              )}
                              onClick={() =>
                                toggleFilter("excludedAllergens", allergen)
                              }
                            >
                              {allergenLabels[allergen] ?? allergen}
                            </button>
                          ))}
                        </div>
                        <p className="field-note">
                          AI labels aren’t verified. Always check the
                          ingredients.
                        </p>
                      </fieldset>
                      <fieldset className="field-group">
                        <legend>Ingredients to avoid</legend>
                        <input
                          type="search"
                          aria-label="Find ingredients to avoid"
                          placeholder="Search ingredients"
                          value={dislikeSearch}
                          onChange={(event) =>
                            setDislikeSearch(event.target.value)
                          }
                        />
                        <div className="chip-row">
                          {dislikeOptions
                            .filter((item) =>
                              dislikeSearch
                                ? item.name
                                    .toLocaleLowerCase("de")
                                    .includes(
                                      dislikeSearch.toLocaleLowerCase("de"),
                                    )
                                : commonDislikes.includes(item.name) ||
                                  filters.excludedIngredients?.includes(
                                    item.id,
                                  ),
                            )
                            .map((item) => (
                              <button
                                key={item.id}
                                className={`chip ${filters.excludedIngredients?.includes(item.id) ? "selected" : ""}`}
                                aria-pressed={
                                  filters.excludedIngredients?.includes(
                                    item.id,
                                  ) ?? false
                                }
                                onClick={() =>
                                  toggleFilter("excludedIngredients", item.id)
                                }
                              >
                                {item.name}
                              </button>
                            ))}
                        </div>
                      </fieldset>
                    </details>
                  </>
                ) : setupStep === "pantry" ? (
                  <>
                    <label className="pantry-search">
                      <span className="sr-only">Find pantry ingredients</span>
                      <input
                        type="search"
                        placeholder="Find an ingredient"
                        value={pantrySearch}
                        onChange={(event) =>
                          setPantrySearch(event.target.value)
                        }
                      />
                    </label>
                    <p className="selection-count">
                      {pantry.length
                        ? `${pantry.length} selected`
                        : "Optional — skip if you’re not sure."}
                    </p>
                    {[
                      ...new Set(pantryVisible.map((item) => item.category)),
                    ].map((category) => (
                      <fieldset className="pantry-group" key={category}>
                        <legend>{category}</legend>
                        <div className="pantry-options">
                          {pantryVisible
                            .filter((item) => item.category === category)
                            .map((item) => (
                              <button
                                key={item.id}
                                className={`pantry-choice ${pantry.includes(item.id) ? "selected" : ""}`}
                                aria-pressed={pantry.includes(item.id)}
                                onClick={() => togglePantry(item.id)}
                              >
                                <span
                                  className="choice-mark"
                                  aria-hidden="true"
                                >
                                  {pantry.includes(item.id) ? "" : "+"}
                                </span>
                                {item.name}
                              </button>
                            ))}
                        </div>
                      </fieldset>
                    ))}
                    {!pantryVisible.length && (
                      <p className="muted">
                        No matching ingredient in your recipes.
                      </p>
                    )}
                    <p className="field-note">
                      Select only what you have enough of. Pantry tracks
                      ingredients, not amounts.
                    </p>
                  </>
                ) : (
                  <>
                    <fieldset className="field-group">
                      <legend>Servings per meal</legend>
                      <div className="portions-control">
                        <button
                          className="button secondary"
                          aria-label="Fewer servings"
                          disabled={scheduleDraft.portions <= 1}
                          onClick={() =>
                            setScheduleDraft((current) => ({
                              ...current,
                              portions: current.portions - 1,
                            }))
                          }
                        >
                          −
                        </button>
                        <output aria-live="polite">
                          {scheduleDraft.portions}
                        </output>
                        <button
                          className="button secondary"
                          aria-label="More servings"
                          disabled={scheduleDraft.portions >= 12}
                          onClick={() =>
                            setScheduleDraft((current) => ({
                              ...current,
                              portions: current.portions + 1,
                            }))
                          }
                        >
                          +
                        </button>
                      </div>
                      <p className="field-note">
                        Each selected meal makes{" "}
                        {plural(scheduleDraft.portions, "serving")}.
                      </p>
                    </fieldset>
                    <fieldset className="field-group">
                      <legend>Meals</legend>
                      <div className="chip-row">
                        {meals.map((meal) => (
                          <button
                            key={meal.id}
                            className={`chip ${scheduleDraft.meals.includes(meal.id) ? "selected" : ""}`}
                            aria-pressed={scheduleDraft.meals.includes(meal.id)}
                            onClick={() =>
                              setScheduleDraft((current) => ({
                                ...current,
                                meals: current.meals.includes(meal.id)
                                  ? current.meals.filter((id) => id !== meal.id)
                                  : [...current.meals, meal.id],
                              }))
                            }
                          >
                            {meal.name}
                          </button>
                        ))}
                      </div>
                    </fieldset>
                    <fieldset className="field-group">
                      <legend>Days</legend>
                      <div className="day-heading">
                        <div className="chip-row">
                          <button
                            className="text-button"
                            onClick={() =>
                              setScheduleDraft((current) => ({
                                ...current,
                                days: [0, 1, 2, 3, 4],
                              }))
                            }
                          >
                            Weekdays
                          </button>
                          <button
                            className="text-button"
                            onClick={() =>
                              setScheduleDraft((current) => ({
                                ...current,
                                days: [0, 1, 2, 3, 4, 5, 6],
                              }))
                            }
                          >
                            Every day
                          </button>
                        </div>
                      </div>
                      <div className="schedule-days">
                        {weekdays.map((day, index) => (
                          <button
                            key={day}
                            className={`chip ${scheduleDraft.days.includes(index as Weekday) ? "selected" : ""}`}
                            aria-label={day}
                            aria-pressed={scheduleDraft.days.includes(
                              index as Weekday,
                            )}
                            onClick={() =>
                              setScheduleDraft((current) => ({
                                ...current,
                                days: current.days.includes(index as Weekday)
                                  ? current.days.filter(
                                      (value) => value !== index,
                                    )
                                  : [...current.days, index as Weekday],
                              }))
                            }
                          >
                            {day.slice(0, 3)}
                          </button>
                        ))}
                      </div>
                    </fieldset>
                    <p className="schedule-summary">
                      {plural(
                        scheduleDraft.days.length * scheduleDraft.meals.length,
                        "meal",
                      )}{" "}
                      · {plural(scheduleDraft.portions, "serving")} each
                    </p>
                    {!chatGPTAccount && (
                      <p className="field-note">
                        Using your saved recipes. Connect ChatGPT in the
                        installation setup to create new ones.
                      </p>
                    )}
                    {journeyComplete && (
                      <p className="field-note">
                        Creating a new week replaces the meals in your current
                        plan.
                      </p>
                    )}
                  </>
                )}
                <div className="setup-footer">
                  <button
                    className="text-button"
                    onClick={backSetup}
                    disabled={!journeyComplete && setupStep === "store"}
                  >
                    {(editingSetup && setupStep === "week") ||
                    (previousSetup && setupStep === "store")
                      ? "Cancel"
                      : "Back"}
                  </button>
                  <button
                    className="button primary"
                    disabled={!canContinue}
                    onClick={finishSetup}
                  >
                    {setupStep === "week"
                      ? journeyComplete
                        ? "Create new week"
                        : "Create my week"
                      : editingSetup
                        ? "Done"
                        : setupStep === "pantry" && !pantry.length
                          ? "Skip pantry →"
                          : "Continue →"}
                  </button>
                </div>
              </section>
            </div>
          </>
        ) : tab === "plan" ? (
          <>
            <div className="workspace-heading">
              <div>
                <h1 ref={heading} tabIndex={-1}>
                  {filledMeals > 0 && filledMeals === weekSlots.length
                    ? "Your week, sorted."
                    : "Your week"}
                </h1>
                <p className="summary-line">
                  {plural(filledMeals, "meal")} planned · Shopping at{" "}
                  {storeName}
                </p>
              </div>
              <button
                className="button primary"
                onClick={() => showTab("shopping")}
              >
                Shopping list →
              </button>
            </div>
            <div className="week-redo" aria-label="Redo your week">
              <div>
                <button
                  className="button secondary"
                  disabled={!!run || !weekSlots.length}
                  onClick={() => makeWeeklyPlan(schedule)}
                  aria-describedby="regenerate-description"
                >
                  Regenerate week
                </button>
                <p id="regenerate-description">Keep your current choices.</p>
              </div>
              <div>
                <button
                  className="text-button"
                  disabled={!!run}
                  onClick={startOver}
                  aria-describedby="restart-description"
                >
                  Start over
                </button>
                <p id="restart-description">Choose everything again.</p>
              </div>
            </div>
            {run && (
              <section
                className="progress-panel"
                aria-label="Creating your week"
              >
                <div className="day-heading">
                  <p role="status">
                    {run.stopping
                      ? "Finishing current recipes…"
                      : run.dishes.length
                        ? `${runReady} of ${run.dishes.length} meals ready`
                        : "Planning your menu…"}
                  </p>
                  <button
                    className="text-button"
                    onClick={stopRun}
                    disabled={run.stopping}
                  >
                    Stop
                  </button>
                </div>
                {!!run.dishes.length && (
                  <progress
                    aria-label="Recipes ready"
                    value={runReady}
                    max={run.dishes.length}
                  />
                )}
              </section>
            )}
            {planMessage && (
              <div className="notice" role="status">
                <p>{planMessage}</p>
                {generationError && !run && (
                  <div className="chip-row">
                    <button
                      className="button secondary"
                      onClick={() => makeWeeklyPlan(scheduleDraft)}
                    >
                      Try again
                    </button>
                    {recipes.length > 0 && (
                      <button
                        className="text-button"
                        onClick={() => useSavedWeek(scheduleDraft)}
                      >
                        Use saved recipes
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="week-layout">
              <div className="week-days">
                {[...schedule.days].sort().map((day) => (
                  <section className="day-group" key={day}>
                    <h2>{weekdays[day]}</h2>
                    {meals
                      .filter((meal) => schedule.meals.includes(meal.id))
                      .map((meal) =>
                        renderMeal(
                          plan.find(
                            (item) => item.day === day && item.meal === meal.id,
                          ),
                          day,
                          meal.id,
                        ),
                      )}
                  </section>
                ))}
                {plan.some((item) => item.day === undefined) && (
                  <section className="day-group">
                    <h2>Extra meals</h2>
                    {plan
                      .filter((item) => item.day === undefined)
                      .map((item) => renderMeal(item))}
                  </section>
                )}
                {!weekSlots.length && !plan.length && (
                  <div className="empty-state">
                    <h2>A week that works for you</h2>
                    <p>Choose your days and meals to get started.</p>
                    <button className="button secondary" onClick={editWeek}>
                      Plan your week
                    </button>
                  </div>
                )}
              </div>
              <aside className="week-summary" aria-label="Your plan choices">
                <h2>Made for your week</h2>
                <div className="summary-item">
                  <span>Supermarket</span>
                  <button
                    className="text-button"
                    disabled={!!run}
                    onClick={() => setSetupStep("store")}
                  >
                    {storeName} <span aria-hidden="true">↗</span>
                  </button>
                </div>
                <div className="summary-item">
                  <span>Preferences</span>
                  <p>{summaryPreferences}</p>
                  <button
                    className="text-button"
                    disabled={!!run}
                    onClick={() => setSetupStep("preferences")}
                  >
                    Edit preferences
                  </button>
                </div>
                <div className="summary-item">
                  <span>At home</span>
                  <p>
                    {pantry.length
                      ? pantry.slice(0, 4).map(nameOf).join(", ") +
                        (pantry.length > 4 ? ` +${pantry.length - 4}` : "")
                      : "Nothing selected"}
                  </p>
                  <button
                    className="text-button"
                    disabled={!!run}
                    onClick={() => setSetupStep("pantry")}
                  >
                    Edit pantry
                  </button>
                </div>
                <p className="field-note">
                  Recipes are AI-generated and untested. Nutrition is estimated
                  per serving.
                </p>
              </aside>
            </div>
          </>
        ) : (
          <>
            <div className="workspace-heading">
              <div>
                <h1 ref={heading} tabIndex={-1}>
                  Your shopping list
                </h1>
                <p className="summary-line">
                  {storeName} · {remaining} of {shopping.length} left to get
                </p>
              </div>
              {shopping.length > 0 && (
                <button className="button primary" onClick={copyList}>
                  {copied ? "Copied" : "Copy list"}
                </button>
              )}
            </div>
            <div className="shopping-layout">
              <div className="shopping-list">
                {groups.map((group) => (
                  <section className="shopping-group" key={group}>
                    <h2>{group}</h2>
                    {shopping
                      .filter((item) => item.category === group)
                      .map((item) => {
                        const line = showProducts
                          ? productLines.get(item.id)
                          : undefined;
                        const suitable = suitableProducts(item) ?? [];
                        const choice = productChoices[choiceKey(item)];
                        return (
                          <Fragment key={item.id}>
                            <label
                              className={`shopping-row ${checked.includes(item.id) ? "is-checked" : ""}`}
                            >
                              <input
                                type="checkbox"
                                checked={checked.includes(item.id)}
                                onChange={() => {
                                  setCopied(false);
                                  setChecked((current) =>
                                    current.includes(item.id)
                                      ? current.filter((id) => id !== item.id)
                                      : [...current, item.id],
                                  );
                                }}
                              />
                              <span className="shopping-name">
                                {item.name}
                                {item.note && <small>{item.note}</small>}
                              </span>
                              <span className="shopping-amount">
                                {formatAmount(item.amount, item.unit)}
                                {item.unresolved && (
                                  <small>Check quantity</small>
                                )}
                              </span>
                            </label>
                            {line && (
                              <div className="shopping-product">
                                <span>
                                  {line.packs !== null && `${line.packs} × `}
                                  {line.product.url ? (
                                    <a
                                      href={line.product.url}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      {line.product.name}
                                    </a>
                                  ) : (
                                    line.product.name
                                  )}
                                  <small>
                                    {packDetails(line.product)}
                                    {line.check && " · Check amount"}
                                  </small>
                                </span>
                                {line.cost !== null && (
                                  <span className="shopping-amount">
                                    {isLowerBound(line, item.category) &&
                                      "from "}
                                    {euro.format(line.cost)}
                                  </span>
                                )}
                                {suitable.length > 1 && (
                                  <select
                                    aria-label={`Product for ${item.name}`}
                                    value={
                                      suitable.some(
                                        (product) => product.id === choice,
                                      )
                                        ? choice
                                        : ""
                                    }
                                    onChange={(event) => {
                                      setCopied(false);
                                      setProductChoices(
                                        ({ [choiceKey(item)]: _, ...rest }) =>
                                          event.target.value
                                            ? {
                                                ...rest,
                                                [choiceKey(item)]:
                                                  event.target.value,
                                              }
                                            : rest,
                                      );
                                    }}
                                  >
                                    <option value="">
                                      Auto:{" "}
                                      {pickRuleLabels[pickRule].toLowerCase()}
                                    </option>
                                    {suitable.map((product) => (
                                      <option
                                        key={product.id}
                                        value={product.id}
                                      >
                                        {product.name} · {packDetails(product)}
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </div>
                            )}
                          </Fragment>
                        );
                      })}
                  </section>
                ))}
                {!shopping.length && (
                  <div className="empty-state">
                    <h2>
                      {plan.length
                        ? "You’re stocked up."
                        : "Plan first, shop once."}
                    </h2>
                    <p>
                      {plan.length
                        ? "Your selected pantry covers this list. Check you have enough before cooking."
                        : "Create your week to get a combined shopping list."}
                    </p>
                    <button
                      className="button secondary"
                      onClick={() => showTab("plan")}
                    >
                      Back to your week
                    </button>
                  </div>
                )}
              </div>
              <aside className="week-summary">
                <h2>One trip. Everything you need.</h2>
                <p className="field-note">
                  Amounts are combined across your meals. What’s in your pantry
                  is left out.
                </p>
                <button
                  className="text-button"
                  disabled={!!run}
                  onClick={() => setSetupStep("pantry")}
                >
                  Edit pantry
                </button>
                {!!shopping.length && (
                  <details
                    className="disclosure product-panel"
                    open={showProducts}
                    onToggle={(event) => {
                      setShowProducts(event.currentTarget.open);
                      setCopied(false);
                    }}
                  >
                    <summary>Products & prices</summary>
                    {productStock && productData ? (
                      <>
                        <label className="field-group">
                          <span className="field-label">
                            Choose products by
                          </span>
                          <select
                            aria-label="Choose products by"
                            value={pickRule}
                            onChange={(event) => {
                              setPickRule(event.target.value as PickRule);
                              setCopied(false);
                            }}
                          >
                            {pickRules.map((rule) => (
                              <option key={rule} value={rule}>
                                {pickRuleLabels[rule]}
                              </option>
                            ))}
                          </select>
                        </label>
                        {unmatchedCount > 0 && (
                          <button
                            className="button secondary"
                            onClick={findProducts}
                            disabled={!chatGPTAccount}
                            aria-disabled={matching !== null}
                          >
                            {finding || `Find ${storeName} products`}
                          </button>
                        )}
                        <p
                          className="product-total"
                          role="status"
                          tabIndex={-1}
                          ref={productNote}
                        >
                          {finding
                            ? finding
                            : pricedLines.length
                              ? `About ${euro.format(productTotal)}`
                              : "No prices matched yet"}
                        </p>
                        {pricedLines.length > 0 && (
                          <p className="field-note">
                            For {pricedLines.length} of{" "}
                            {plural(productNames.length, "ingredient")}.
                            {unpricedCount > 0 &&
                              ` ${plural(unpricedCount, "product")} sold by weight not included.`}
                          </p>
                        )}
                        <p className="field-note">
                          Price snapshot:{" "}
                          {new Date(
                            productData.downloadedAt,
                          ).toLocaleDateString("en-AT")}
                          . Prices may differ; stock isn’t checked.
                          {staleProducts &&
                            ` ${storeName} prices last changed ${new Date(productStock.latestChange).toLocaleDateString("en-AT")}.`}
                        </p>
                        {!chatGPTAccount && (
                          <p className="field-note">
                            Connect ChatGPT to find new matches.
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="field-note">
                        No product prices available for {storeName}.
                      </p>
                    )}
                    {matchError?.store === store && (
                      <p className="notice error" role="alert">
                        {matchError.message}
                      </p>
                    )}
                  </details>
                )}
              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
