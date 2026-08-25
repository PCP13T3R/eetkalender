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
      if (!state.shopping) state.shopping = { selectedDays: [], checked: {}, generatedAt: null };
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
    if (!state.shopping) state.shopping = { selectedDays: [], checked: {}, generatedAt: null };
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
    if (state.pinHash) return;
    const pin = (cfg().defaultPin || "1234").toString();
    state.pinHash = await sha256(pin);
    persist();
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
    if (!/^\d{4,8}$/.test(n)) {
      return { ok: false, error: "Nieuwe pincode: 4–8 cijfers." };
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
        ingredients: cleanIngredients,
        updatedAt: now,
      });
    }
    persist();
    return savedId;
  }

  function deleteRecipe(id) {
    state.recipes = state.recipes.filter((r) => r.id !== id);
    // Ontkoppel van plan
    Object.keys(state.plan).forEach((day) => {
      const p = state.plan[day];
      ["breakfast", "lunch", "dinner"].forEach((slot) => {
        if (p[slot] === id) p[slot] = null;
      });
    });
    persist();
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

  function setSlot(iso, slot, recipeId) {
    const day = getDay(iso);
    if (!["breakfast", "lunch", "dinner"].includes(slot)) return;
    day[slot] = recipeId || null;
    if (slot === "breakfast" && recipeId) day.showBreakfast = true;
    if (slot === "lunch" && recipeId) day.showLunch = true;
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
    // targets: [{ day, slot }]
    const src = getDay(fromDay);
    const recipeId = src[fromSlot];
    targets.forEach(({ day, slot }) => {
      const d = getDay(day);
      d[slot] = recipeId;
      if (slot === "breakfast") d.showBreakfast = true;
      if (slot === "lunch") d.showLunch = true;
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

  function buildShoppingList(days) {
    const map = new Map();
    (days || []).forEach((iso) => {
      const day = state.plan[iso] || emptyDay();
      const slots = [];
      if (day.showBreakfast && day.breakfast) slots.push(day.breakfast);
      if (day.showLunch && day.lunch) slots.push(day.lunch);
      if (day.dinner) slots.push(day.dinner);
      slots.forEach((rid) => {
        const recipe = getRecipe(rid);
        if (!recipe) return;
        (recipe.ingredients || []).forEach((ing) => {
          const nameKey = normalizeIngredientName(ing.name);
          const unitKey = String(ing.unit || "").trim().toLowerCase();
          const key = nameKey + "||" + unitKey;
          if (!map.has(key)) {
            map.set(key, {
              key,
              name: String(ing.name || "").trim(),
              unit: String(ing.unit || "").trim(),
              qty: null,
              sources: [],
            });
          }
          const row = map.get(key);
          const q = ing.qty == null || ing.qty === "" ? null : Number(ing.qty);
          if (q != null && !Number.isNaN(q)) {
            row.qty = (row.qty == null ? 0 : row.qty) + q;
          }
          if (!row.sources.includes(recipe.name)) row.sources.push(recipe.name);
        });
      });
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "nl"));
  }

  function setShoppingDays(days) {
    state.shopping.selectedDays = (days || []).slice().sort();
    state.shopping.generatedAt = new Date().toISOString();
    // Reset checks that no longer exist
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
    day[slot] = recipeId;
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
    toggleExtraSlot,
    copySlot,
    copyDay,
    buildShoppingList,
    setShoppingDays,
    toggleShoppingCheck,
    clearShoppingChecks,
    exportJSON,
    importJSON,
    resetDemo,
    persist,
  };
})(window);
