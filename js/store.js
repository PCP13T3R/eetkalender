/* global MEAL_CONFIG */
(function (global) {
  "use strict";

  const cfg = () => global.MEAL_CONFIG || {};
  const KEY = () => cfg().storageKey || "meal-calendar-v1";

  function uid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
  }

  async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function addDaysISO(iso, n) {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + n);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  }

  function startOfWeekISO(iso) {
    // Maandag als start
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const day = dt.getDay(); // 0 zo
    const diff = day === 0 ? -6 : 1 - day;
    dt.setDate(dt.getDate() + diff);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  }

  function emptyDay() {
    return {
      dinner: null,
      breakfast: null,
      lunch: null,
      showBreakfast: false,
      showLunch: false,
    };
  }

  function seedRecipes() {
    const now = new Date().toISOString();
    return [
      {
        id: uid(),
        name: "Spaghetti bolognese",
        notes: "Klassieker — 20 min pruttelen.",
        timeMinutes: 35,
        rating: 5,
        servingsBase: 2,
        kcalPerPerson: null,
        ingredients: [
          { name: "spaghetti", qty: 400, unit: "g" },
          { name: "gehakt", qty: 500, unit: "g" },
          { name: "ui", qty: 1, unit: "stuk" },
          { name: "knoflook", qty: 2, unit: "teen" },
          { name: "passata", qty: 500, unit: "ml" },
          { name: "olijfolie", qty: 2, unit: "el" },
          { name: "parmezaan", qty: 50, unit: "g" },
        ],
        updatedAt: now,
      },
      {
        id: uid(),
        name: "Kippensoep",
        notes: "Restjes kip werken perfect.",
        timeMinutes: 40,
        rating: 4,
        servingsBase: 2,
        kcalPerPerson: null,
        ingredients: [
          { name: "kippendijen", qty: 400, unit: "g" },
          { name: "wortel", qty: 2, unit: "stuk" },
          { name: "selder", qty: 2, unit: "stengel" },
          { name: "ui", qty: 1, unit: "stuk" },
          { name: "kippenbouillon", qty: 1, unit: "l" },
          { name: "noedels", qty: 150, unit: "g" },
        ],
        updatedAt: now,
      },
      {
        id: uid(),
        name: "Groentewok met rijst",
        notes: "Snel doordeweeks.",
        timeMinutes: 25,
        rating: 4,
        servingsBase: 2,
        kcalPerPerson: null,
        ingredients: [
          { name: "rijst", qty: 300, unit: "g" },
          { name: "roerbakgroenten", qty: 400, unit: "g" },
          { name: "sojasaus", qty: 3, unit: "el" },
          { name: "knoflook", qty: 1, unit: "teen" },
          { name: "sesamolie", qty: 1, unit: "el" },
        ],
        updatedAt: now,
      },
      {
        id: uid(),
        name: "Pannenkoeken",
        notes: "Voor ontbijt of avond.",
        timeMinutes: 20,
        rating: 5,
        servingsBase: 2,
        kcalPerPerson: null,
        ingredients: [
          { name: "bloem", qty: 250, unit: "g" },
          { name: "melk", qty: 500, unit: "ml" },
          { name: "ei", qty: 2, unit: "stuk" },
          { name: "boter", qty: 20, unit: "g" },
          { name: "suiker", qty: 1, unit: "el" },
        ],
        updatedAt: now,
      },
    ];
  }

  function defaultState() {
    return {
      version: 1,
      pinHash: null,
      unlocked: false,
      recipes: [],
      plan: {},
      shopping: {
        selectedDays: [],
        extras: [], // {id,name,qty,unit}
        backlog: [], // not taken from last trip {id,key,name,qty,unit,sources}
        cart: [], // active basket {id,key,name,qty,unit,sources,checked,tripDays}
        home: [], // {id,key,name,qty,unit,stickyHome,coveredUntilDays,confirmedAt}
        shopPresets: null, // null = use DEFAULT_SHOP_PRESETS; else [{id,name,unit}]
        checked: {}, // legacy
        generatedAt: null,
      },
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };
  }

  let state = defaultState();
  const listeners = new Set();

  function notify() {
    listeners.forEach((fn) => {
      try {
        fn(state);
      } catch (e) {
        console.error(e);
      }
    });
  }

  function persist() {
    state.meta.updatedAt = new Date().toISOString();
    try {
      const toSave = { ...state, unlocked: false };
      localStorage.setItem(KEY(), JSON.stringify(toSave));
    } catch (e) {
      console.error("localStorage write failed", e);
    }
    notify();
    if (global.MealSync && typeof global.MealSync.queuePush === "function") {
      global.MealSync.queuePush(state);
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY());
      if (!raw) {
        state = defaultState();
        state.recipes = seedRecipes();
        return state;
      }
      const parsed = JSON.parse(raw);
      state = { ...defaultState(), ...parsed, unlocked: false };
      if (!Array.isArray(state.recipes)) state.recipes = [];
      if (!state.plan || typeof state.plan !== "object") state.plan = {};
      if (!state.shopping) state.shopping = defaultState().shopping;
      migrateShopping(state.shopping);
      // migrate recipes without servingsBase / kcal
      state.recipes.forEach((r) => {
        if (r.servingsBase == null || !(Number(r.servingsBase) > 0)) r.servingsBase = 2;
        if (r.kcalPerPerson == null || r.kcalPerPerson === "") r.kcalPerPerson = null;
        else {
          const k = Number(r.kcalPerPerson);
          r.kcalPerPerson = !Number.isNaN(k) && k > 0 ? k : null;
        }
      });
      return state;
    } catch (e) {
      console.error(e);
      state = defaultState();
      state.recipes = seedRecipes();
      return state;
    }
  }

  function get() {
    return state;
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function migrateShopping(s) {
    if (!s) return;
    if (!s.selectedDays) s.selectedDays = [];
    if (!Array.isArray(s.extras)) s.extras = [];
    if (!Array.isArray(s.backlog)) s.backlog = [];
    if (!Array.isArray(s.cart)) s.cart = [];
    if (!Array.isArray(s.home)) s.home = [];
    if (!s.checked) s.checked = {};
    // shopPresets: null/missing = defaults; array = custom (may be empty)
    if (s.shopPresets != null && !Array.isArray(s.shopPresets)) s.shopPresets = null;
  }

  function replaceState(next, { unlock = false, silent = false } = {}) {
    const wasUnlocked = state.unlocked;
    state = { ...defaultState(), ...next };
    if (!Array.isArray(state.recipes)) state.recipes = [];
    if (!state.plan) state.plan = {};
    if (!state.shopping) state.shopping = defaultState().shopping;
    migrateShopping(state.shopping);
    state.unlocked = unlock ? true : wasUnlocked;
    if (!silent) {
      try {
        const toSave = { ...state, unlocked: false };
        localStorage.setItem(KEY(), JSON.stringify(toSave));
      } catch (e) {
        console.error(e);
      }
      notify();
    }
  }

  async function ensurePinInitialized() {
    const pin = String(cfg().defaultPin != null ? cfg().defaultPin : "1234");
    const ver = Number(cfg().pinVersion || 0);
    // pinVersion bump (or forceDefaultPin) rolls the family PIN out to all devices
    const force =
      !!cfg().forceDefaultPin ||
      (ver > 0 && state.pinVersion !== ver) ||
      !state.pinHash;
    if (!force) return;
    const hash = await sha256(pin);
    if (state.pinHash !== hash || state.pinVersion !== ver) {
      state.pinHash = hash;
      state.pinVersion = ver;
      persist();
    }
  }

  async function verifyPin(pin) {
    await ensurePinInitialized();
    const hash = await sha256(String(pin || ""));
    if (hash === state.pinHash) {
      state.unlocked = true;
      notify();
      return true;
    }
    return false;
  }

  function lock() {
    state.unlocked = false;
    notify();
  }

  async function changePin(currentPin, newPin) {
    const ok = await verifyPin(currentPin);
    if (!ok) return { ok: false, error: "Huidige pincode is fout." };
    const n = String(newPin || "").trim();
    if (!/^\d{4,12}$/.test(n)) {
      return { ok: false, error: "Nieuwe pincode: 4–12 cijfers." };
    }
    state.pinHash = await sha256(n);
    state.unlocked = true;
    persist();
    return { ok: true };
  }

  function getRecipe(id) {
    return state.recipes.find((r) => r.id === id) || null;
  }

  /** Most recent ISO day this recipe was planned, or null if never */
  function getRecipeLastPlanned(recipeId) {
    if (!recipeId) return null;
    let best = null;
    Object.keys(state.plan || {}).forEach((iso) => {
      const day = state.plan[iso];
      ["breakfast", "lunch", "dinner"].forEach((slot) => {
        if (getSlotRecipeId(day, slot) === recipeId) {
          if (!best || iso > best) best = iso;
        }
      });
    });
    return best;
  }

  function daysSinceLastPlanned(recipeId) {
    const last = getRecipeLastPlanned(recipeId);
    if (!last) return null;
    const [y, m, d] = last.split("-").map(Number);
    const a = new Date(y, m - 1, d);
    const t = new Date();
    const b = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    return Math.round((b - a) / 86400000);
  }

  /**
   * listRecipes(query, filters?)
   * filters: { minKcal, maxKcal, minStars, maxStars, lastPlanned: 'any'|'never'|'7'|'14'|'30'|'90' }
   */
  function listRecipes(query, filters) {
    const q = (query || "").trim().toLowerCase();
    const f = filters || {};
    let list = state.recipes.slice();
    if (q) {
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.notes || "").toLowerCase().includes(q) ||
          (r.ingredients || []).some((i) => (i.name || "").toLowerCase().includes(q))
      );
    }
    if (f.minKcal != null && f.minKcal !== "") {
      const min = Number(f.minKcal);
      list = list.filter((r) => {
        const k = getRecipeKcalPerPerson(r);
        return k != null && k >= min;
      });
    }
    if (f.maxKcal != null && f.maxKcal !== "") {
      const max = Number(f.maxKcal);
      list = list.filter((r) => {
        const k = getRecipeKcalPerPerson(r);
        return k != null && k <= max;
      });
    }
    if (f.minStars != null && f.minStars !== "" && Number(f.minStars) > 0) {
      const minS = Number(f.minStars);
      list = list.filter((r) => (Number(r.rating) || 0) >= minS);
    }
    if (f.maxStars != null && f.maxStars !== "" && Number(f.maxStars) > 0) {
      const maxS = Number(f.maxStars);
      list = list.filter((r) => (Number(r.rating) || 0) <= maxS && (Number(r.rating) || 0) > 0);
    }
    if (f.lastPlanned && f.lastPlanned !== "any") {
      if (f.lastPlanned === "never") {
        list = list.filter((r) => !getRecipeLastPlanned(r.id));
      } else {
        const minDays = Number(f.lastPlanned);
        list = list.filter((r) => {
          const d = daysSinceLastPlanned(r.id);
          // never used counts as "long ago"
          if (d == null) return true;
          return d >= minDays;
        });
      }
    }

    // sort: name, or by last planned if that filter is active
    if (f.lastPlanned && f.lastPlanned !== "any" && f.lastPlanned !== "never") {
      list.sort((a, b) => {
        const da = daysSinceLastPlanned(a.id);
        const db = daysSinceLastPlanned(b.id);
        const va = da == null ? 99999 : da;
        const vb = db == null ? 99999 : db;
        return vb - va || a.name.localeCompare(b.name, "nl");
      });
    } else if (f.lastPlanned === "never") {
      list.sort((a, b) => a.name.localeCompare(b.name, "nl"));
    } else {
      list.sort((a, b) => a.name.localeCompare(b.name, "nl"));
    }
    return list;
  }

  function saveRecipe(recipe) {
    const now = new Date().toISOString();
    const cleanIngredients = (recipe.ingredients || [])
      .map((i) => ({
        name: String(i.name || "").trim(),
        qty: i.qty === "" || i.qty == null ? null : Number(i.qty),
        unit: String(i.unit || "").trim(),
      }))
      .filter((i) => i.name);

    const servingsBase = Math.max(
      1,
      Math.round(Number(recipe.servingsBase != null && recipe.servingsBase !== "" ? recipe.servingsBase : 2) || 2)
    );
    let kcalPerPerson = null;
    if (recipe.kcalPerPerson !== "" && recipe.kcalPerPerson != null) {
      const k = Number(recipe.kcalPerPerson);
      if (!Number.isNaN(k) && k > 0) kcalPerPerson = Math.round(k);
    }
    let savedId = recipe.id || null;
    if (recipe.id) {
      const idx = state.recipes.findIndex((r) => r.id === recipe.id);
      if (idx >= 0) {
        state.recipes[idx] = {
          ...state.recipes[idx],
          name: String(recipe.name || "").trim() || "Naamloos recept",
          notes: String(recipe.notes || "").trim(),
          timeMinutes:
            recipe.timeMinutes === "" || recipe.timeMinutes == null
              ? null
              : Number(recipe.timeMinutes),
          rating: clampRating(recipe.rating ?? state.recipes[idx].rating),
          servingsBase,
          kcalPerPerson,
          ingredients: cleanIngredients,
          updatedAt: now,
        };
        savedId = state.recipes[idx].id;
      }
    } else {
      savedId = uid();
      state.recipes.push({
        id: savedId,
        name: String(recipe.name || "").trim() || "Naamloos recept",
        notes: String(recipe.notes || "").trim(),
        timeMinutes:
          recipe.timeMinutes === "" || recipe.timeMinutes == null
            ? null
            : Number(recipe.timeMinutes),
        rating: clampRating(recipe.rating || 0),
        servingsBase,
        kcalPerPerson,
        ingredients: cleanIngredients,
        updatedAt: now,
      });
    }
    persist();
    return savedId;
  }

  function deleteRecipe(id) {
    state.recipes = state.recipes.filter((r) => r.id !== id);
    Object.keys(state.plan).forEach((day) => {
      const p = state.plan[day];
      ["breakfast", "lunch", "dinner"].forEach((slot) => {
        if (getSlotRecipeId(p, slot) === id) p[slot] = null;
      });
    });
    persist();
  }

  /** Slot value: legacy string id OR { recipeId, servings } */
  function normalizeSlot(val) {
    if (!val) return null;
    if (typeof val === "string") return { recipeId: val, servings: null };
    if (val && val.recipeId) {
      const s = val.servings == null || val.servings === "" ? null : Number(val.servings);
      return {
        recipeId: val.recipeId,
        servings: s != null && !Number.isNaN(s) && s > 0 ? s : null,
      };
    }
    return null;
  }

  function getSlotRecipeId(day, slot) {
    const s = normalizeSlot(day && day[slot]);
    return s ? s.recipeId : null;
  }

  function getSlotServings(day, slot) {
    const s = normalizeSlot(day && day[slot]);
    if (!s) return null;
    if (s.servings != null && s.servings > 0) return s.servings;
    const recipe = getRecipe(s.recipeId);
    const base = recipe && recipe.servingsBase ? Number(recipe.servingsBase) : 2;
    return base > 0 ? base : 2;
  }

  function getRecipeServingsBase(recipe) {
    const b = recipe && recipe.servingsBase != null ? Number(recipe.servingsBase) : 2;
    return b > 0 ? b : 2;
  }

  /** Kcal per persoon (niet vermenigvuldigen met aantal personen) */
  function getRecipeKcalPerPerson(recipe) {
    if (!recipe || recipe.kcalPerPerson == null || recipe.kcalPerPerson === "") return null;
    const k = Number(recipe.kcalPerPerson);
    return !Number.isNaN(k) && k > 0 ? Math.round(k) : null;
  }

  function setRating(recipeId, rating) {
    const r = getRecipe(recipeId);
    if (!r) return;
    r.rating = clampRating(rating);
    r.updatedAt = new Date().toISOString();
    persist();
  }

  function clampRating(n) {
    const v = Number(n) || 0;
    if (v <= 0) return 0;
    return Math.max(1, Math.min(5, Math.round(v)));
  }

  function getDay(iso) {
    if (!state.plan[iso]) state.plan[iso] = emptyDay();
    return state.plan[iso];
  }

  function setSlot(iso, slot, recipeId, servings) {
    const day = getDay(iso);
    if (!["breakfast", "lunch", "dinner"].includes(slot)) return;
    if (!recipeId) {
      day[slot] = null;
    } else {
      const recipe = getRecipe(recipeId);
      const base = getRecipeServingsBase(recipe);
      let s = servings == null || servings === "" ? base : Number(servings);
      if (!(s > 0)) s = base;
      day[slot] = { recipeId: recipeId, servings: s };
      if (slot === "breakfast") day.showBreakfast = true;
      if (slot === "lunch") day.showLunch = true;
    }
    persist();
  }

  function setSlotServings(iso, slot, servings) {
    const day = getDay(iso);
    const cur = normalizeSlot(day[slot]);
    if (!cur) return;
    const recipe = getRecipe(cur.recipeId);
    const base = getRecipeServingsBase(recipe);
    let s = Number(servings);
    if (!(s > 0)) s = base;
    day[slot] = { recipeId: cur.recipeId, servings: s };
    persist();
  }

  function toggleExtraSlot(iso, slot, show) {
    const day = getDay(iso);
    if (slot === "breakfast") {
      day.showBreakfast = !!show;
      if (!show) day.breakfast = null;
    }
    if (slot === "lunch") {
      day.showLunch = !!show;
      if (!show) day.lunch = null;
    }
    persist();
  }

  function copySlot(fromDay, fromSlot, targets) {
    const src = getDay(fromDay);
    const val = src[fromSlot];
    targets.forEach(({ day, slot }) => {
      const d = getDay(day);
      d[slot] = val ? JSON.parse(JSON.stringify(normalizeSlot(val))) : null;
      if (slot === "breakfast" && val) d.showBreakfast = true;
      if (slot === "lunch" && val) d.showLunch = true;
    });
    persist();
  }

  function copyDay(fromDay, toDays) {
    const src = { ...getDay(fromDay) };
    (toDays || []).forEach((day) => {
      state.plan[day] = {
        dinner: src.dinner,
        breakfast: src.breakfast,
        lunch: src.lunch,
        showBreakfast: src.showBreakfast,
        showLunch: src.showLunch,
      };
    });
    persist();
  }

  function normalizeIngredientName(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  const DEFAULT_SHOP_PRESETS = [
    { name: "WC-papier", unit: "pak" },
    { name: "Keukenpapier", unit: "rol" },
    { name: "Vuilniszakken", unit: "rol" },
    { name: "Afwasmiddel", unit: "fles" },
    { name: "Wasmiddel", unit: "pak" },
    { name: "Tandenpasta", unit: "tube" },
    { name: "Shampoo", unit: "fles" },
    { name: "Cola", unit: "fles" },
    { name: "Cola zero", unit: "fles" },
    { name: "Fanta", unit: "fles" },
    { name: "Sprite", unit: "fles" },
    { name: "Water bruis", unit: "pak" },
    { name: "Water plat", unit: "pak" },
    { name: "Bier", unit: "blik" },
    { name: "Wijn", unit: "fles" },
    { name: "Koffie", unit: "pak" },
    { name: "Thee", unit: "doos" },
    { name: "Melk", unit: "l" },
    { name: "Boters", unit: "pak" },
    { name: "Eieren", unit: "doos" },
    { name: "Brood", unit: "stuk" },
    { name: "Beleg kaas", unit: "pak" },
    { name: "Beleg hesp", unit: "pak" },
    { name: "Fruit seizoen", unit: "stuk" },
    { name: "Bananen", unit: "tros" },
    { name: "Appels", unit: "kg" },
    { name: "Sla / salade", unit: "zak" },
    { name: "Tomaten", unit: "kg" },
    { name: "Aardappelen", unit: "kg" },
    { name: "Rijst", unit: "pak" },
    { name: "Pasta", unit: "pak" },
    { name: "Olijfolie", unit: "fles" },
    { name: "Zout", unit: "pak" },
    { name: "Peper", unit: "molen" },
    { name: "Chips", unit: "zak" },
    { name: "Chocolade", unit: "reep" },
    { name: "Ijs", unit: "bak" },
    { name: "Diepvries groenten", unit: "zak" },
    { name: "Batterijen", unit: "pak" },
    { name: "Aluminiumfolie", unit: "rol" },
    { name: "Vershoudfolie", unit: "rol" },
  ];

  function itemKey(name, unit) {
    return normalizeIngredientName(name) + "||" + String(unit || "").trim().toLowerCase();
  }

  function todayStart() {
    return todayISO();
  }

  function isDayPast(iso) {
    return iso < todayStart();
  }

  function cleanupExpiredHome() {
    migrateShopping(state.shopping);
    const today = todayStart();
    state.shopping.home = (state.shopping.home || []).filter((h) => {
      if (h.stickyHome) return true;
      const days = h.coveredUntilDays || [];
      if (!days.length) return false;
      // still covering if any day is today or future
      return days.some((d) => d >= today);
    });
  }

  function isCoveredByHome(key) {
    cleanupExpiredHome();
    return (state.shopping.home || []).some((h) => h.key === key && (h.stickyHome || (h.coveredUntilDays || []).some((d) => d >= todayStart())));
  }

  /** Raw need from selected plan days (scaled) */
  function buildNeedsFromDays(days) {
    const map = new Map();
    function addIng(name, qty, unit, source) {
      const nameKey = normalizeIngredientName(name);
      if (!nameKey) return;
      const key = itemKey(name, unit);
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: String(name || "").trim(),
          unit: String(unit || "").trim(),
          qty: null,
          sources: [],
          kind: "recipe",
        });
      }
      const row = map.get(key);
      const q = qty == null || qty === "" ? null : Number(qty);
      if (q != null && !Number.isNaN(q)) row.qty = (row.qty == null ? 0 : row.qty) + q;
      if (source && !row.sources.includes(source)) row.sources.push(source);
    }

    (days || []).forEach((iso) => {
      const day = state.plan[iso] || emptyDay();
      const slotNames = [];
      if (day.showBreakfast && getSlotRecipeId(day, "breakfast")) slotNames.push("breakfast");
      if (day.showLunch && getSlotRecipeId(day, "lunch")) slotNames.push("lunch");
      if (getSlotRecipeId(day, "dinner")) slotNames.push("dinner");
      slotNames.forEach((slot) => {
        const rid = getSlotRecipeId(day, slot);
        const recipe = getRecipe(rid);
        if (!recipe) return;
        const base = getRecipeServingsBase(recipe);
        const servings = getSlotServings(day, slot) || base;
        const factor = base > 0 ? servings / base : 1;
        const label = recipe.name + (servings !== base ? " (" + servings + "p)" : "");
        (recipe.ingredients || []).forEach((ing) => {
          const q = ing.qty == null || ing.qty === "" ? null : Number(ing.qty);
          const scaled = q == null || Number.isNaN(q) ? null : Math.round(q * factor * 100) / 100;
          addIng(ing.name, scaled, ing.unit, label);
        });
      });
    });
    return map;
  }

  /**
   * Voorbereiden list = needs from days + extras + backlog − home − already in cart
   */
  function getPrepList() {
    migrateShopping(state.shopping);
    cleanupExpiredHome();
    const days = state.shopping.selectedDays || [];
    const map = buildNeedsFromDays(days);

    (state.shopping.extras || []).forEach((ex) => {
      const key = itemKey(ex.name, ex.unit);
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: String(ex.name || "").trim(),
          unit: String(ex.unit || "").trim(),
          qty: ex.qty == null || ex.qty === "" ? null : Number(ex.qty),
          sources: ["Extra"],
          kind: "extra",
          extraId: ex.id,
        });
      } else {
        const row = map.get(key);
        const q = ex.qty == null || ex.qty === "" ? null : Number(ex.qty);
        if (q != null && !Number.isNaN(q)) row.qty = (row.qty == null ? 0 : row.qty) + q;
        if (!row.sources.includes("Extra")) row.sources.push("Extra");
      }
    });

    // merge backlog
    (state.shopping.backlog || []).forEach((b) => {
      if (!map.has(b.key)) {
        map.set(b.key, {
          key: b.key,
          name: b.name,
          unit: b.unit || "",
          qty: b.qty,
          sources: (b.sources || []).slice(),
          kind: "backlog",
          backlogId: b.id,
        });
      } else {
        const row = map.get(b.key);
        if (b.qty != null && !Number.isNaN(Number(b.qty))) {
          row.qty = (row.qty == null ? 0 : row.qty) + Number(b.qty);
        }
        (b.sources || []).forEach((s) => {
          if (!row.sources.includes(s)) row.sources.push(s);
        });
        if (!row.sources.includes("Niet meegenomen")) row.sources.push("Niet meegenomen");
      }
    });

    const cartKeys = new Set((state.shopping.cart || []).map((c) => c.key));
    const list = [];
    map.forEach((row) => {
      if (isCoveredByHome(row.key)) return; // already at home
      if (cartKeys.has(row.key)) return; // already in basket
      list.push(row);
    });
    return list.sort((a, b) => a.name.localeCompare(b.name, "nl"));
  }

  /** legacy helper used by older UI bits */
  function buildShoppingList(days) {
    const prev = state.shopping.selectedDays;
    if (days) state.shopping.selectedDays = days;
    const list = getPrepList();
    if (days) state.shopping.selectedDays = prev;
    return list;
  }

  function setShoppingDays(days) {
    migrateShopping(state.shopping);
    state.shopping.selectedDays = (days || []).slice().sort();
    state.shopping.generatedAt = new Date().toISOString();
    persist();
  }

  function cloneDefaultPresets() {
    return DEFAULT_SHOP_PRESETS.map((p, i) => ({
      id: "def-" + i + "-" + normalizeIngredientName(p.name).replace(/\s+/g, "-"),
      name: p.name,
      unit: p.unit || "",
    }));
  }

  /** Materialize custom list on first edit so it syncs; until then use defaults (not in cloud). */
  function materializeShopPresets() {
    migrateShopping(state.shopping);
    if (!Array.isArray(state.shopping.shopPresets)) {
      state.shopping.shopPresets = cloneDefaultPresets();
    }
    return state.shopping.shopPresets;
  }

  function getShopPresets() {
    migrateShopping(state.shopping);
    const src = Array.isArray(state.shopping.shopPresets)
      ? state.shopping.shopPresets
      : cloneDefaultPresets();
    return src.map((p) => ({
      id: p.id,
      name: p.name,
      unit: p.unit || "",
    }));
  }

  function addShopPreset(item) {
    const list = materializeShopPresets();
    const name = String(item.name || "").trim();
    if (!name) return null;
    const row = {
      id: uid(),
      name,
      unit: String(item.unit || "").trim(),
    };
    list.push(row);
    list.sort((a, b) => a.name.localeCompare(b.name, "nl"));
    persist();
    return row.id;
  }

  function updateShopPreset(id, patch) {
    const list = materializeShopPresets();
    const row = list.find((p) => p.id === id);
    if (!row) return false;
    if (patch.name != null) {
      const n = String(patch.name).trim();
      if (!n) return false;
      row.name = n;
    }
    if (patch.unit != null) row.unit = String(patch.unit).trim();
    list.sort((a, b) => a.name.localeCompare(b.name, "nl"));
    persist();
    return true;
  }

  function removeShopPreset(id) {
    const list = materializeShopPresets();
    state.shopping.shopPresets = list.filter((p) => p.id !== id);
    persist();
  }

  function resetShopPresets() {
    migrateShopping(state.shopping);
    state.shopping.shopPresets = cloneDefaultPresets();
    persist();
  }

  function addShoppingExtra(item) {
    migrateShopping(state.shopping);
    const name = String(item.name || "").trim();
    if (!name) return null;
    const row = {
      id: uid(),
      name,
      qty: item.qty == null || item.qty === "" ? null : Number(item.qty),
      unit: String(item.unit || "").trim(),
    };
    if (row.qty != null && Number.isNaN(row.qty)) row.qty = null;
    state.shopping.extras.push(row);
    persist();
    return row.id;
  }

  function removeShoppingExtra(id) {
    migrateShopping(state.shopping);
    state.shopping.extras = state.shopping.extras.filter((x) => x.id !== id);
    persist();
  }

  function clearShoppingExtras() {
    migrateShopping(state.shopping);
    state.shopping.extras = [];
    persist();
  }

  /** Prep: mark item as already at home (sticky). optional meta: {name, unit, qty} */
  function markPrepItemHome(key, meta) {
    migrateShopping(state.shopping);
    if (!key) return;
    const fromExtra = (state.shopping.extras || []).find((ex) => itemKey(ex.name, ex.unit) === key);
    const fromBacklog = (state.shopping.backlog || []).find((b) => b.key === key);
    const fromPrep = getPrepList().find((p) => p.key === key);
    const name =
      (meta && meta.name) ||
      (fromPrep && fromPrep.name) ||
      (fromExtra && fromExtra.name) ||
      (fromBacklog && fromBacklog.name) ||
      key.split("||")[0];
    const unit =
      (meta && meta.unit) ||
      (fromPrep && fromPrep.unit) ||
      (fromExtra && fromExtra.unit) ||
      (fromBacklog && fromBacklog.unit) ||
      key.split("||")[1] ||
      "";
    const qty =
      (meta && meta.qty) != null
        ? meta.qty
        : fromPrep
          ? fromPrep.qty
          : fromExtra
            ? fromExtra.qty
            : fromBacklog
              ? fromBacklog.qty
              : null;

    state.shopping.extras = (state.shopping.extras || []).filter((ex) => itemKey(ex.name, ex.unit) !== key);
    state.shopping.backlog = (state.shopping.backlog || []).filter((b) => b.key !== key);
    const existing = (state.shopping.home || []).find((h) => h.key === key);
    if (existing) {
      existing.stickyHome = true;
      existing.name = name;
      existing.unit = unit;
      existing.confirmedAt = new Date().toISOString();
    } else {
      state.shopping.home.push({
        id: uid(),
        key,
        name,
        unit,
        qty,
        stickyHome: true,
        coveredUntilDays: [],
        confirmedAt: new Date().toISOString(),
      });
    }
    persist();
  }

  function removeBacklogItem(id) {
    migrateShopping(state.shopping);
    state.shopping.backlog = (state.shopping.backlog || []).filter((b) => b.id !== id);
    persist();
  }

  function clearHomeStock() {
    migrateShopping(state.shopping);
    state.shopping.home = [];
    persist();
  }

  function getHomeList() {
    cleanupExpiredHome();
    return (state.shopping.home || []).slice();
  }

  function getCart() {
    migrateShopping(state.shopping);
    return (state.shopping.cart || []).slice();
  }

  function getBacklog() {
    migrateShopping(state.shopping);
    return (state.shopping.backlog || []).slice();
  }

  /** Transfer prep open items → cart (merge). mode: 'merge' | 'replace' */
  function transferPrepToCart(mode) {
    migrateShopping(state.shopping);
    const prep = getPrepList();
    const tripDays = (state.shopping.selectedDays || []).slice();
    if (mode === "replace") {
      // unbought cart items go back to backlog
      (state.shopping.cart || []).forEach((c) => {
        if (!c.checked) {
          state.shopping.backlog.push({
            id: uid(),
            key: c.key,
            name: c.name,
            qty: c.qty,
            unit: c.unit,
            sources: c.sources || [],
          });
        }
      });
      state.shopping.cart = [];
    }

    const byKey = new Map((state.shopping.cart || []).map((c) => [c.key, c]));
    prep.forEach((p) => {
      if (byKey.has(p.key)) {
        const c = byKey.get(p.key);
        if (p.qty != null && !Number.isNaN(Number(p.qty))) {
          c.qty = (c.qty == null ? 0 : Number(c.qty)) + Number(p.qty);
        }
        (p.sources || []).forEach((s) => {
          if (!c.sources) c.sources = [];
          if (!c.sources.includes(s)) c.sources.push(s);
        });
        c.tripDays = Array.from(new Set([].concat(c.tripDays || [], tripDays)));
      } else {
        const row = {
          id: uid(),
          key: p.key,
          name: p.name,
          qty: p.qty,
          unit: p.unit || "",
          sources: (p.sources || []).slice(),
          checked: false,
          tripDays: tripDays.slice(),
        };
        state.shopping.cart.push(row);
        byKey.set(p.key, row);
      }
    });

    // clear extras & backlog that were transferred (all prep items)
    const transferredKeys = new Set(prep.map((p) => p.key));
    state.shopping.extras = (state.shopping.extras || []).filter((ex) => !transferredKeys.has(itemKey(ex.name, ex.unit)));
    state.shopping.backlog = (state.shopping.backlog || []).filter((b) => !transferredKeys.has(b.key));
    persist();
    return state.shopping.cart.length;
  }

  function cartToggleCheck(id) {
    migrateShopping(state.shopping);
    const row = (state.shopping.cart || []).find((c) => c.id === id);
    if (!row) return;
    row.checked = !row.checked;
    persist();
  }

  function cartDeleteItem(id) {
    migrateShopping(state.shopping);
    state.shopping.cart = (state.shopping.cart || []).filter((c) => c.id !== id);
    persist();
  }

  function cartClearAll() {
    migrateShopping(state.shopping);
    state.shopping.cart = [];
    persist();
  }

  /**
   * Complete shopping trip:
   * - checked → home (coveredUntilDays = tripDays)
   * - unchecked → backlog
   * - cart cleared
   */
  function completeShoppingTrip() {
    migrateShopping(state.shopping);
    const cart = state.shopping.cart || [];
    let taken = 0;
    let left = 0;
    cart.forEach((c) => {
      if (c.checked) {
        taken++;
        const existing = (state.shopping.home || []).find((h) => h.key === c.key);
        const days = (c.tripDays || []).slice();
        if (existing) {
          existing.coveredUntilDays = Array.from(new Set([].concat(existing.coveredUntilDays || [], days)));
          existing.confirmedAt = new Date().toISOString();
          // keep sticky if was sticky
        } else {
          state.shopping.home.push({
            id: uid(),
            key: c.key,
            name: c.name,
            unit: c.unit || "",
            qty: c.qty,
            stickyHome: false,
            coveredUntilDays: days,
            confirmedAt: new Date().toISOString(),
          });
        }
      } else {
        left++;
        state.shopping.backlog.push({
          id: uid(),
          key: c.key,
          name: c.name,
          qty: c.qty,
          unit: c.unit || "",
          sources: (c.sources || []).concat(["Niet meegenomen"]),
        });
      }
    });
    state.shopping.cart = [];
    persist();
    return { taken, left };
  }

  // legacy aliases
  function toggleShoppingCheck(key) {
    const row = (state.shopping.cart || []).find((c) => c.key === key || c.id === key);
    if (row) cartToggleCheck(row.id);
  }

  function clearShoppingChecks() {
    migrateShopping(state.shopping);
    (state.shopping.cart || []).forEach((c) => {
      c.checked = false;
    });
    persist();
  }

  function exportJSON() {
    const payload = { ...state, unlocked: false };
    return JSON.stringify(payload, null, 2);
  }

  function importJSON(text) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") throw new Error("Ongeldig bestand");
    replaceState(parsed, { unlock: true });
    persist();
  }

  function resetDemo() {
    const pinHash = state.pinHash;
    state = defaultState();
    state.pinHash = pinHash;
    state.unlocked = true;
    state.recipes = seedRecipes();
    // Plan sample for this week
    const mon = startOfWeekISO(todayISO());
    const r = state.recipes;
    if (r[0]) setSlotSilent(mon, "dinner", r[0].id);
    if (r[1]) setSlotSilent(addDaysISO(mon, 1), "dinner", r[1].id);
    if (r[2]) setSlotSilent(addDaysISO(mon, 2), "dinner", r[2].id);
    if (r[3]) {
      const d = getDay(addDaysISO(mon, 5));
      d.showBreakfast = true;
      d.breakfast = r[3].id;
      d.dinner = r[0] ? r[0].id : null;
    }
    persist();
  }

  function setSlotSilent(iso, slot, recipeId) {
    const day = getDay(iso);
    const recipe = getRecipe(recipeId);
    const base = getRecipeServingsBase(recipe);
    day[slot] = recipeId ? { recipeId: recipeId, servings: base } : null;
  }

  global.MealStore = {
    uid,
    sha256,
    todayISO,
    addDaysISO,
    startOfWeekISO,
    load,
    get,
    subscribe,
    replaceState,
    ensurePinInitialized,
    verifyPin,
    lock,
    changePin,
    getRecipe,
    listRecipes,
    getRecipeLastPlanned,
    daysSinceLastPlanned,
    saveRecipe,
    deleteRecipe,
    setRating,
    getDay,
    setSlot,
    setSlotServings,
    getSlotRecipeId,
    getSlotServings,
    getRecipeServingsBase,
    getRecipeKcalPerPerson,
    normalizeSlot,
    toggleExtraSlot,
    copySlot,
    copyDay,
    buildShoppingList,
    getPrepList,
    setShoppingDays,
    toggleShoppingCheck,
    clearShoppingChecks,
    getShopPresets,
    addShopPreset,
    updateShopPreset,
    removeShopPreset,
    resetShopPresets,
    addShoppingExtra,
    removeShoppingExtra,
    clearShoppingExtras,
    markPrepItemHome,
    removeBacklogItem,
    clearHomeStock,
    getHomeList,
    getCart,
    getBacklog,
    transferPrepToCart,
    cartToggleCheck,
    cartDeleteItem,
    cartClearAll,
    completeShoppingTrip,
    cleanupExpiredHome,
    exportJSON,
    importJSON,
    resetDemo,
    persist,
  };
})(window);
