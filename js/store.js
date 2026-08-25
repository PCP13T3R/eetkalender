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
        servingsBase: 4,
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
        servingsBase: 4,
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
        servingsBase: 4,
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
        servingsBase: 4,
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
        checked: {},
        extras: [],
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
      if (!state.shopping) state.shopping = { selectedDays: [], checked: {}, extras: [], generatedAt: null };
      if (!Array.isArray(state.shopping.extras)) state.shopping.extras = [];
      // migrate recipes without servingsBase
      state.recipes.forEach((r) => {
        if (r.servingsBase == null || !(Number(r.servingsBase) > 0)) r.servingsBase = 4;
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

  function replaceState(next, { unlock = false, silent = false } = {}) {
    const wasUnlocked = state.unlocked;
    state = { ...defaultState(), ...next };
    if (!Array.isArray(state.recipes)) state.recipes = [];
    if (!state.plan) state.plan = {};
    if (!state.shopping) state.shopping = { selectedDays: [], checked: {}, extras: [], generatedAt: null };
    if (!Array.isArray(state.shopping.extras)) state.shopping.extras = [];
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

  function listRecipes(query) {
    const q = (query || "").trim().toLowerCase();
    let list = state.recipes.slice().sort((a, b) => a.name.localeCompare(b.name, "nl"));
    if (q) {
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.notes || "").toLowerCase().includes(q) ||
          (r.ingredients || []).some((i) => (i.name || "").toLowerCase().includes(q))
      );
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
      Math.round(Number(recipe.servingsBase != null && recipe.servingsBase !== "" ? recipe.servingsBase : 4) || 4)
    );
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
    const base = recipe && recipe.servingsBase ? Number(recipe.servingsBase) : 4;
    return base > 0 ? base : 4;
  }

  function getRecipeServingsBase(recipe) {
    const b = recipe && recipe.servingsBase != null ? Number(recipe.servingsBase) : 4;
    return b > 0 ? b : 4;
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

  const SHOP_PRESETS = [
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

  function buildShoppingList(days) {
    const map = new Map();

    function addIng(name, qty, unit, source) {
      const nameKey = normalizeIngredientName(name);
      if (!nameKey) return;
      const unitKey = String(unit || "").trim().toLowerCase();
      const key = nameKey + "||" + unitKey;
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
      if (q != null && !Number.isNaN(q)) {
        row.qty = (row.qty == null ? 0 : row.qty) + q;
      }
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
        const label =
          recipe.name + (servings !== base ? " (" + servings + "p)" : "");
        (recipe.ingredients || []).forEach((ing) => {
          const q = ing.qty == null || ing.qty === "" ? null : Number(ing.qty);
          const scaled = q == null || Number.isNaN(q) ? null : Math.round(q * factor * 100) / 100;
          addIng(ing.name, scaled, ing.unit, label);
        });
      });
    });

    // Extra boodschappen (los van recepten)
    (state.shopping.extras || []).forEach((ex) => {
      const nameKey = normalizeIngredientName(ex.name);
      const unitKey = String(ex.unit || "").trim().toLowerCase();
      const key = "extra||" + (ex.id || nameKey + "||" + unitKey);
      map.set(key, {
        key,
        name: String(ex.name || "").trim(),
        unit: String(ex.unit || "").trim(),
        qty: ex.qty == null || ex.qty === "" ? null : Number(ex.qty),
        sources: ["Extra"],
        kind: "extra",
        extraId: ex.id,
      });
    });

    return Array.from(map.values()).sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "extra" ? 1 : -1;
      return a.name.localeCompare(b.name, "nl");
    });
  }

  function setShoppingDays(days) {
    state.shopping.selectedDays = (days || []).slice().sort();
    state.shopping.generatedAt = new Date().toISOString();
    const items = buildShoppingList(state.shopping.selectedDays);
    const keys = new Set(items.map((i) => i.key));
    const nextChecked = {};
    Object.keys(state.shopping.checked || {}).forEach((k) => {
      if (keys.has(k)) nextChecked[k] = state.shopping.checked[k];
    });
    state.shopping.checked = nextChecked;
    persist();
  }

  function toggleShoppingCheck(key) {
    state.shopping.checked = state.shopping.checked || {};
    state.shopping.checked[key] = !state.shopping.checked[key];
    persist();
  }

  function clearShoppingChecks() {
    state.shopping.checked = {};
    persist();
  }

  function getShopPresets() {
    return SHOP_PRESETS.slice();
  }

  function addShoppingExtra(item) {
    if (!state.shopping.extras) state.shopping.extras = [];
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
    if (!state.shopping.extras) return;
    state.shopping.extras = state.shopping.extras.filter((x) => x.id !== id);
    persist();
  }

  function clearShoppingExtras() {
    state.shopping.extras = [];
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
    saveRecipe,
    deleteRecipe,
    setRating,
    getDay,
    setSlot,
    setSlotServings,
    getSlotRecipeId,
    getSlotServings,
    getRecipeServingsBase,
    normalizeSlot,
    toggleExtraSlot,
    copySlot,
    copyDay,
    buildShoppingList,
    setShoppingDays,
    toggleShoppingCheck,
    clearShoppingChecks,
    getShopPresets,
    addShoppingExtra,
    removeShoppingExtra,
    clearShoppingExtras,
    exportJSON,
    importJSON,
    resetDemo,
    persist,
  };
})(window);
