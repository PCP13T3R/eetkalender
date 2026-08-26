/* global MEAL_CONFIG, MealStore, supabase */
(function (global) {
  "use strict";

  const CLOUD_KEY = "meal-calendar-cloud-v1";

  let client = null;
  let pushTimer = null;
  let pullTimer = null;
  let lastPush = 0;
  let status = { mode: "local", message: "Lokale modus", online: navigator.onLine };

  const listeners = new Set();

  function fileCfg() {
    return (global.MEAL_CONFIG && global.MEAL_CONFIG.supabase) || {};
  }

  function loadSavedCloud() {
    try {
      const raw = localStorage.getItem(CLOUD_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function cfg() {
    const saved = loadSavedCloud() || {};
    const file = fileCfg();
    // Merge: localStorage overrides, but fall back to config.js defaults
    // so a published build can ship URL+publishable key (partner only needs PIN).
    const url = String(saved.url || file.url || "").trim();
    const anonKey = String(saved.anonKey || file.anonKey || "").trim();
    let enabled;
    if (Object.prototype.hasOwnProperty.call(saved, "enabled")) {
      enabled = saved.enabled !== false;
    } else {
      enabled = !!file.enabled;
    }
    // If build defaults include full cloud config, treat as enabled
    if (file.enabled && file.url && file.anonKey && !saved.anonKey && saved.enabled !== false) {
      enabled = true;
    }
    return { enabled: !!enabled && !!(url && anonKey), url, anonKey };
  }

  function getCloudConfig() {
    return cfg();
  }

  function normalizeProjectUrl(url) {
    let u = String(url || "").trim();
    // Accept dashboard or REST URLs and reduce to project root
    u = u.replace(/\/rest\/v1\/?$/i, "");
    u = u.replace(/\/+$/, "");
    // https://supabase.com/dashboard/project/REF → https://REF.supabase.co
    const dash = u.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i);
    if (dash) u = "https://" + dash[1] + ".supabase.co";
    return u;
  }

  function saveCloudConfig({ enabled, url, anonKey }) {
    const payload = {
      enabled: !!enabled,
      url: normalizeProjectUrl(url),
      anonKey: String(anonKey || "").trim(),
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(CLOUD_KEY, JSON.stringify(payload));
    return payload;
  }

  function clearCloudConfig() {
    localStorage.removeItem(CLOUD_KEY);
  }

  function setStatus(partial) {
    status = { ...status, ...partial };
    listeners.forEach((fn) => {
      try {
        fn(status);
      } catch (e) {
        console.error(e);
      }
    });
  }

  function subscribe(fn) {
    listeners.add(fn);
    fn(status);
    return () => listeners.delete(fn);
  }

  function getStatus() {
    return status;
  }

  function isEnabled() {
    const c = cfg();
    return !!(c.enabled && c.url && c.anonKey && global.supabase);
  }

  function stopTimers() {
    if (pullTimer) {
      clearInterval(pullTimer);
      pullTimer = null;
    }
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }
    client = null;
  }

  async function init() {
    window.addEventListener("online", () => setStatus({ online: true }));
    window.addEventListener("offline", () =>
      setStatus({ online: false, message: "Offline — lokaal opgeslagen" })
    );
    await connect();
  }

  async function connect() {
    stopTimers();

    if (!isEnabled()) {
      setStatus({ mode: "local", message: "Lokale modus (geen cloud)" });
      return { ok: false, error: "Cloud niet geconfigureerd" };
    }

    if (!global.supabase || typeof global.supabase.createClient !== "function") {
      setStatus({ mode: "local", message: "Supabase-library niet geladen" });
      return { ok: false, error: "Supabase JS niet geladen — herlaad de pagina" };
    }

    try {
      const c = cfg();
      // Persist merged config so Settings UI + deellink always have the key
      if (c.url && c.anonKey) {
        saveCloudConfig({ enabled: true, url: c.url, anonKey: c.anonKey });
      }
      client = global.supabase.createClient(c.url, c.anonKey);
      setStatus({ mode: "cloud", message: "Cloud verbinden…" });

      // Quick connectivity + table check
      const probe = await client.from("meal_calendar_state").select("id").eq("id", 1).maybeSingle();
      if (probe.error) {
        client = null;
        const msg = probe.error.message || "Onbekende fout";
        let hint = msg;
        if (/relation|does not exist|schema cache/i.test(msg)) {
          hint = "Tabel ontbreekt — run schema.sql in Supabase SQL Editor";
        } else if (/JWT|Invalid API|API key/i.test(msg)) {
          hint = "API-key of URL onjuist";
        } else if (/Failed to fetch|NetworkError|CORS/i.test(msg)) {
          hint = "Netwerk/URL fout — check Project URL";
        }
        setStatus({ mode: "local", message: "Cloud fout: " + hint });
        return { ok: false, error: hint, detail: msg };
      }

      await pull();
      // Default 3s pull + realtime channel (if enabled in Supabase)
      const ms = (global.MEAL_CONFIG && global.MEAL_CONFIG.syncIntervalMs) || 3000;
      pullTimer = setInterval(() => {
        if (navigator.onLine) pull().catch(() => {});
      }, ms);

      try {
        client
          .channel("meal-calendar")
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "meal_calendar_state" },
            () => {
              pull().catch(() => {});
            }
          )
          .subscribe();
      } catch (_) {
        /* realtime optional */
      }

      setStatus({
        mode: "cloud",
        message: "Cloud verbonden",
        lastSync: new Date().toISOString(),
      });
      return { ok: true };
    } catch (e) {
      console.error(e);
      client = null;
      setStatus({ mode: "local", message: "Cloud mislukt — lokale modus" });
      return { ok: false, error: e.message || String(e) };
    }
  }

  async function testConnection(url, anonKey) {
    if (!global.supabase) {
      return { ok: false, error: "Supabase JS niet geladen" };
    }
    const u = normalizeProjectUrl(url);
    const k = String(anonKey || "").trim();
    if (!u || !k) return { ok: false, error: "Vul URL en anon key in" };
    try {
      const testClient = global.supabase.createClient(u, k);
      const { data, error } = await testClient
        .from("meal_calendar_state")
        .select("id, updated_at")
        .eq("id", 1)
        .maybeSingle();
      if (error) {
        let hint = error.message;
        if (/relation|does not exist|schema cache/i.test(error.message || "")) {
          hint = "Tabel ontbreekt. Plak en run supabase/schema.sql in de SQL Editor.";
        }
        return { ok: false, error: hint, detail: error.message };
      }
      return {
        ok: true,
        message: data ? "Verbinding OK — tabel gevonden" : "Verbinding OK — lege state (wordt bij sync gevuld)",
      };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  function ts(iso) {
    if (!iso) return 0;
    const t = new Date(iso).getTime();
    return Number.isFinite(t) ? t : 0;
  }

  function arrById(list) {
    const m = new Map();
    (list || []).forEach((item) => {
      if (!item || !item.id) return;
      const prev = m.get(item.id);
      if (!prev || ts(item.updatedAt) >= ts(prev.updatedAt)) m.set(item.id, item);
    });
    return m;
  }

  /**
   * Merge local + remote so partner edits are not wiped (last-write-wins per recipe / day / shopping piece).
   */
  function mergeStates(local, remote, remoteUpdatedAt, localUpdatedAt) {
    const remoteNewer = ts(remoteUpdatedAt) >= ts(localUpdatedAt);
    const base = remoteNewer ? remote : local;
    const other = remoteNewer ? local : remote;

    // Recipes: union by id, keep newer updatedAt
    const recipesMap = arrById([].concat((base && base.recipes) || [], (other && other.recipes) || []));
    // also keep recipes without colliding ids from both
    const recipes = Array.from(recipesMap.values()).sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""), "nl")
    );

    // Plan: per day — merge meals[] by id; fallback legacy slots
    const plan = {};
    const days = new Set([
      ...Object.keys((local && local.plan) || {}),
      ...Object.keys((remote && remote.plan) || {}),
    ]);
    days.forEach((day) => {
      const L = (local.plan && local.plan[day]) || {};
      const R = (remote.plan && remote.plan[day]) || {};
      const mealMap = new Map();
      [].concat(L.meals || [], R.meals || []).forEach((m) => {
        if (!m) return;
        const id = m.id || m.slot + ":" + (m.label || "") + ":" + (m.recipeId || "");
        const prev = mealMap.get(id);
        if (!prev) mealMap.set(id, Object.assign({}, m));
        else {
          // prefer entry with recipe
          if (!prev.recipeId && m.recipeId) mealMap.set(id, Object.assign({}, m));
          else if (remoteNewer && m.recipeId) mealMap.set(id, Object.assign({}, m));
        }
      });
      let meals = Array.from(mealMap.values());
      if (!meals.length) {
        // legacy merge
        const pick = (slot) => {
          const lv = L[slot];
          const rv = R[slot];
          if (lv == null || lv === "") return rv != null ? rv : null;
          if (rv == null || rv === "") return lv;
          return remoteNewer ? rv : lv;
        };
        plan[day] = {
          dinner: pick("dinner"),
          breakfast: pick("breakfast"),
          lunch: pick("lunch"),
          showBreakfast: !!(L.showBreakfast || R.showBreakfast || pick("breakfast")),
          showLunch: !!(L.showLunch || R.showLunch || pick("lunch")),
        };
      } else {
        if (!meals.some((m) => m.slot === "dinner")) {
          meals.push({
            id: "d-" + day,
            slot: "dinner",
            label: "",
            recipeId: null,
            servings: null,
          });
        }
        plan[day] = {
          meals,
          dinner: null,
          breakfast: null,
          lunch: null,
          showBreakfast: meals.some((m) => m.slot === "breakfast"),
          showLunch: meals.some((m) => m.slot === "lunch"),
        };
      }
    });

    // Shopping: merge arrays by id where possible; prefer newer doc for selectedDays if conflict
    const Ls = (local && local.shopping) || {};
    const Rs = (remote && remote.shopping) || {};
    const mergeIdList = (a, b) => {
      const m = new Map();
      [].concat(a || [], b || []).forEach((x) => {
        if (!x) return;
        const id = x.id || x.key || JSON.stringify(x);
        if (!m.has(id)) m.set(id, x);
      });
      return Array.from(m.values());
    };
    const shopping = {
      selectedDays: remoteNewer
        ? Rs.selectedDays || Ls.selectedDays || []
        : Ls.selectedDays || Rs.selectedDays || [],
      extras: mergeIdList(Ls.extras, Rs.extras),
      backlog: mergeIdList(Ls.backlog, Rs.backlog),
      cart: mergeIdList(Ls.cart, Rs.cart),
      home: mergeIdList(Ls.home, Rs.home),
      shopPresets:
        Array.isArray(Rs.shopPresets) || Array.isArray(Ls.shopPresets)
          ? mergeIdList(Ls.shopPresets, Rs.shopPresets)
          : null,
      checked: { ...(Ls.checked || {}), ...(Rs.checked || {}) },
      generatedAt: remoteNewer ? Rs.generatedAt || Ls.generatedAt : Ls.generatedAt || Rs.generatedAt,
    };

    const meta = {
      createdAt:
        (local.meta && local.meta.createdAt) ||
        (remote.meta && remote.meta.createdAt) ||
        new Date().toISOString(),
      updatedAt: new Date(
        Math.max(ts(localUpdatedAt), ts(remoteUpdatedAt), Date.now())
      ).toISOString(),
    };

    return {
      version: Math.max(local.version || 1, remote.version || 1),
      pinHash: local.pinHash || remote.pinHash || null,
      unlocked: !!(local && local.unlocked),
      recipes,
      plan,
      shopping,
      meta,
    };
  }

  let pulling = false;
  let pushInFlight = false;
  let pushAgain = false;

  async function pull() {
    if (!client || pulling) return;
    pulling = true;
    try {
      const { data, error } = await client
        .from("meal_calendar_state")
        .select("payload, updated_at")
        .eq("id", 1)
        .maybeSingle();

      if (error) {
        setStatus({ mode: "cloud", message: "Sync fout: " + error.message });
        return;
      }

      if (!data || !data.payload || (typeof data.payload === "object" && !Object.keys(data.payload).length)) {
        await push(MealStore.get(), true);
        setStatus({ mode: "cloud", message: "Cloud klaargezet met lokale data", lastSync: new Date().toISOString() });
        return;
      }

      const local = MealStore.get();
      const remote = data.payload;
      const remoteUpdated = data.updated_at || (remote.meta && remote.meta.updatedAt);
      const localUpdated = local.meta && local.meta.updatedAt;

      // Always merge so partner recipes/plan are not lost
      const merged = mergeStates(local, remote, remoteUpdated, localUpdated);
      const before = JSON.stringify({
        r: (local.recipes || []).map((x) => x.id + ":" + (x.updatedAt || "")),
        p: Object.keys(local.plan || {}).sort(),
        s: local.shopping,
      });
      const after = JSON.stringify({
        r: (merged.recipes || []).map((x) => x.id + ":" + (x.updatedAt || "")),
        p: Object.keys(merged.plan || {}).sort(),
        s: merged.shopping,
      });

      if (before !== after) {
        MealStore.replaceState(merged, { unlock: local.unlocked, silent: false });
        if (MealStore.ensurePinInitialized) await MealStore.ensurePinInitialized();
        // Write merge back so both sides converge
        await push(MealStore.get(), true);
        setStatus({ mode: "cloud", message: "Gesynchroniseerd (samenvoegen)", lastSync: new Date().toISOString() });
      } else {
        if (MealStore.ensurePinInitialized) await MealStore.ensurePinInitialized();
        setStatus({ mode: "cloud", message: "Cloud up-to-date", lastSync: new Date().toISOString() });
      }
    } finally {
      pulling = false;
    }
  }

  async function push(state, force) {
    if (!client) return;
    if (pushInFlight) {
      pushAgain = true;
      return;
    }
    const now = Date.now();
    if (!force && now - lastPush < 200) return;
    lastPush = now;
    pushInFlight = true;
    try {
      const payload = { ...state, unlocked: false };
      // bump meta so peers see change
      if (!payload.meta) payload.meta = {};
      payload.meta.updatedAt = new Date().toISOString();
      const { error } = await client.from("meal_calendar_state").upsert({
        id: 1,
        payload,
        updated_at: payload.meta.updatedAt,
      });

      if (error) {
        setStatus({ mode: "cloud", message: "Upload fout: " + error.message });
      } else {
        setStatus({ mode: "cloud", message: "Opgeslagen in cloud", lastSync: new Date().toISOString() });
      }
    } finally {
      pushInFlight = false;
      if (pushAgain) {
        pushAgain = false;
        push(MealStore.get(), true).catch(() => {});
      }
    }
  }

  function queuePush(state) {
    if (!client) return;
    clearTimeout(pushTimer);
    // Snel na elke wijziging (recept opslaan, planning, …)
    pushTimer = setTimeout(() => {
      push(state || MealStore.get(), true).catch((e) => console.error(e));
    }, 150);
  }

  async function forceSyncNow() {
    if (!client) {
      const res = await connect();
      if (!res.ok) return res;
    }
    await pull();
    await push(MealStore.get(), true);
    return { ok: true, message: getStatus().message };
  }

  global.MealSync = {
    init,
    connect,
    pull,
    push,
    queuePush,
    subscribe,
    getStatus,
    isEnabled,
    getCloudConfig,
    saveCloudConfig,
    clearCloudConfig,
    testConnection,
    forceSyncNow,
  };
})(window);
