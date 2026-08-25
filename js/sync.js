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
      const ms = (global.MEAL_CONFIG && global.MEAL_CONFIG.syncIntervalMs) || 8000;
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

  async function pull() {
    if (!client) return;
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
    const remoteUpdated = data.updated_at ? new Date(data.updated_at).getTime() : 0;
    const localUpdated = local.meta && local.meta.updatedAt ? new Date(local.meta.updatedAt).getTime() : 0;

    if (remoteUpdated >= localUpdated) {
      MealStore.replaceState(data.payload, { unlock: local.unlocked });
      // Re-apply configured family PIN after cloud pull (pinVersion / forceDefaultPin)
      if (MealStore.ensurePinInitialized) {
        await MealStore.ensurePinInitialized();
      }
      setStatus({ mode: "cloud", message: "Gesynchroniseerd", lastSync: new Date().toISOString() });
    } else {
      if (MealStore.ensurePinInitialized) {
        await MealStore.ensurePinInitialized();
      }
      await push(MealStore.get(), true);
      setStatus({
        mode: "cloud",
        message: "Lokaal → cloud geüpload",
        lastSync: new Date().toISOString(),
      });
    }
  }

  async function push(state, force) {
    if (!client) return;
    const now = Date.now();
    if (!force && now - lastPush < 500) return;
    lastPush = now;

    const payload = { ...state, unlocked: false };
    const { error } = await client.from("meal_calendar_state").upsert({
      id: 1,
      payload,
      updated_at: new Date().toISOString(),
    });

    if (error) {
      setStatus({ mode: "cloud", message: "Upload fout: " + error.message });
    } else {
      setStatus({ mode: "cloud", message: "Opgeslagen in cloud", lastSync: new Date().toISOString() });
    }
  }

  function queuePush(state) {
    if (!client) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      push(state, true).catch((e) => console.error(e));
    }, 400);
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
