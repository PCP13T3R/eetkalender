/* global MealStore, MealSync, MEAL_CONFIG */
(function () {
  "use strict";

  const DOW = ["zo", "ma", "di", "wo", "do", "vr", "za"];
  const DOW_LONG = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
  const MONTHS = [
    "januari",
    "februari",
    "maart",
    "april",
    "mei",
    "juni",
    "juli",
    "augustus",
    "september",
    "oktober",
    "november",
    "december",
  ];

  const SLOT_LABEL = { breakfast: "Ontbijt", lunch: "Lunch", dinner: "Avond" };

  let weekStart = MealStore.startOfWeekISO(MealStore.todayISO());
  let monthCursor = startOfMonthISO(MealStore.todayISO());
  let calMode = "week"; // week | month
  let pinBuffer = "";
  let currentTab = "calendar";
  let recipeQuery = "";
  let editingRecipeId = null;
  let sheetContext = null;

  function startOfMonthISO(iso) {
    const [y, m] = iso.split("-").map(Number);
    return y + "-" + String(m).padStart(2, "0") + "-01";
  }

  function daysInMonth(year, month1to12) {
    return new Date(year, month1to12, 0).getDate();
  }

  function addMonthsISO(iso, delta) {
    const [y, m] = iso.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-01";
  }

  function monthTitle(iso) {
    const [y, m] = iso.split("-").map(Number);
    return capitalize(MONTHS[m - 1]) + " " + y;
  }

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function formatDayHeader(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return {
      dow: DOW_LONG[dt.getDay()],
      short: DOW[dt.getDay()],
      label: `${d} ${MONTHS[m - 1]}`,
      isToday: iso === MealStore.todayISO(),
    };
  }

  function weekLabel(startIso) {
    const end = MealStore.addDaysISO(startIso, 6);
    const a = formatDayHeader(startIso);
    const b = formatDayHeader(end);
    const [y1, m1] = startIso.split("-").map(Number);
    const [y2, m2] = end.split("-").map(Number);
    if (m1 === m2) return `${parseInt(startIso.slice(8), 10)}–${parseInt(end.slice(8), 10)} ${MONTHS[m1 - 1]}`;
    return `${a.label} – ${b.label}`;
  }

  function starsHtml(rating, max) {
    const r = Number(rating) || 0;
    let html = '<span class="stars" aria-label="' + r + " van 5 sterren\">";
    for (let i = 1; i <= (max || 5); i++) {
      html += '<span class="' + (i <= r ? "on" : "") + '">★</span>';
    }
    html += "</span>";
    return html;
  }

  function recipeName(id) {
    const r = MealStore.getRecipe(id);
    return r ? r.name : null;
  }

  function slotRecipeName(day, slot) {
    return recipeName(MealStore.getSlotRecipeId(day, slot));
  }

  /** Kcal/p for a slot — per person, NOT × servings */
  function slotKcal(day, slot) {
    const rid = MealStore.getSlotRecipeId(day, slot);
    if (!rid) return null;
    return MealStore.getRecipeKcalPerPerson(MealStore.getRecipe(rid));
  }

  /** Sum of kcal/p of breakfast+lunch+dinner for the day (still per person totals) */
  function dayTotalKcal(day) {
    let total = 0;
    let any = false;
    ["breakfast", "lunch", "dinner"].forEach((slot) => {
      if (slot === "breakfast" && !day.showBreakfast) return;
      if (slot === "lunch" && !day.showLunch) return;
      const k = slotKcal(day, slot);
      if (k != null) {
        total += k;
        any = true;
      }
    });
    return any ? total : null;
  }

  function kcalPillHtml(kcal, kind) {
    if (kcal == null) return "";
    const cls = kind === "day" ? "kcal-pill day" : "kcal-pill meal";
    // Day total = sum of per-person meal kcals; meal pill = per person
    // Overal "Kcal" (per persoon op gerecht; dagtotaal = som per persoon)
    const label = kcal + " Kcal";
    return '<span class="' + cls + '" aria-label="' + label + '">' + label + "</span>";
  }

  /* ---------- navigation ---------- */
  function showApp(unlocked) {
    $("#screen-pin").classList.toggle("active", !unlocked);
    $("#app-shell").classList.toggle("hidden", !unlocked);
    $(".bottom-nav").classList.toggle("visible", unlocked);
    if (unlocked) {
      renderAll();
    }
  }

  function switchTab(tab) {
    currentTab = tab;
    $$(".screen[data-tab]").forEach((s) => s.classList.toggle("active", s.dataset.tab === tab));
    $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.tab === tab));
    if (tab === "calendar") renderCalendar();
    if (tab === "recipes") renderRecipes();
    if (tab === "prep") renderPrep();
    if (tab === "cart") renderCart();
    if (tab === "settings") renderSettings();
  }

  /* ---------- PIN ---------- */
  function renderPinDots() {
    $$(".pin-dot").forEach((d, i) => d.classList.toggle("filled", i < pinBuffer.length));
  }

  async function onPinKey(key) {
    $("#pin-error").textContent = "";
    if (key === "del") {
      pinBuffer = pinBuffer.slice(0, -1);
      renderPinDots();
      return;
    }
    if (key === "ok") {
      await tryUnlock();
      return;
    }
    if (!/^\d$/.test(key)) return;
    if (pinBuffer.length >= 8) return;
    pinBuffer += key;
    renderPinDots();
    const expectedLen = String((window.MEAL_CONFIG && window.MEAL_CONFIG.defaultPin) || "1234").length;
    const tryLen = Math.max(4, expectedLen || 4);
    if (pinBuffer.length >= tryLen) {
      const ok = await MealStore.verifyPin(pinBuffer);
      if (ok) {
        pinBuffer = "";
        renderPinDots();
        showApp(true);
        toast("Welkom 👋");
      } else if (pinBuffer.length >= 12) {
        $("#pin-error").textContent = "Pincode onjuist";
        pinBuffer = "";
        renderPinDots();
      }
    }
  }

  async function tryUnlock() {
    const ok = await MealStore.verifyPin(pinBuffer);
    if (ok) {
      pinBuffer = "";
      renderPinDots();
      showApp(true);
    } else {
      $("#pin-error").textContent = "Pincode onjuist";
      pinBuffer = "";
      renderPinDots();
    }
  }

  /* ---------- Calendar ---------- */
  function setCalMode(mode) {
    calMode = mode === "month" ? "month" : "week";
    const chipWeek = $("#chip-week");
    const chipMonth = $("#chip-month");
    if (chipWeek) chipWeek.classList.toggle("active", calMode === "week");
    if (chipMonth) chipMonth.classList.toggle("active", calMode === "month");
    const dayList = $("#day-list");
    const monthList = $("#month-list");
    if (dayList) dayList.classList.toggle("hidden", calMode !== "week");
    if (monthList) monthList.classList.toggle("hidden", calMode !== "month");
    renderCalendar();
  }

  function renderCalendar() {
    if (calMode === "month") {
      renderMonth();
      return;
    }
    $("#week-label").textContent = weekLabel(weekStart);
    const host = $("#day-list");
    if (!host) return;
    host.innerHTML = "";
    const shopSelected = new Set((MealStore.get().shopping.selectedDays || []));

    for (let i = 0; i < 7; i++) {
      const iso = MealStore.addDaysISO(weekStart, i);
      const meta = formatDayHeader(iso);
      const day = MealStore.getDay(iso);
      const card = document.createElement("article");
      card.className = "day-card" + (meta.isToday ? " today" : "") + (shopSelected.has(iso) ? " selected" : "");
      card.dataset.day = iso;

      let mealsHtml = "";
      if (day.showBreakfast) {
        mealsHtml += mealRowHtml(day, "breakfast");
      }
      if (day.showLunch) {
        mealsHtml += mealRowHtml(day, "lunch");
      }
      mealsHtml += mealRowHtml(day, "dinner");

      const extras = [];
      if (!day.showBreakfast) extras.push('<button type="button" class="btn btn-sm btn-secondary" data-act="add-slot" data-slot="breakfast">+ Ontbijt</button>');
      if (!day.showLunch) extras.push('<button type="button" class="btn btn-sm btn-secondary" data-act="add-slot" data-slot="lunch">+ Lunch</button>');

      const dayKcal = dayTotalKcal(day);
      // Layout: [Datum + groen dagtotaal-kcal] ........ [VANDAAG]
      card.innerHTML =
        '<div class="day-top">' +
        '<div class="day-top-left">' +
        '<div class="date-block"><div class="dow">' +
        capitalize(meta.dow) +
        '</div><div class="dom">' +
        meta.label +
        "</div></div>" +
        kcalPillHtml(dayKcal, "day") +
        "</div>" +
        (meta.isToday ? '<span class="badge-today">Vandaag</span>' : "") +
        "</div>" +
        mealsHtml +
        '<div class="btn-row">' +
        '<button type="button" class="btn btn-sm btn-primary" data-act="open-day">Open</button>' +
        '<button type="button" class="btn btn-sm btn-secondary" data-act="copy-day">Kopieer dag</button>' +
        extras.join("") +
        "</div>";

      host.appendChild(card);
    }
  }

  function renderMonth() {
    $("#week-label").textContent = monthTitle(monthCursor);
    const host = $("#month-list");
    if (!host) return;
    host.innerHTML = "";

    const [y, m] = monthCursor.split("-").map(Number);
    const nDays = daysInMonth(y, m);
    let planned = 0;
    const frags = [];

    for (let d = 1; d <= nDays; d++) {
      const iso = y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
      const meta = formatDayHeader(iso);
      const day = MealStore.getDay(iso);
      const dinnerId = MealStore.getSlotRecipeId(day, "dinner");
      const dinner = dinnerId ? recipeName(dinnerId) : null;
      const dinnerServ = dinnerId ? MealStore.getSlotServings(day, "dinner") : null;
      const dinnerRec = dinnerId ? MealStore.getRecipe(dinnerId) : null;
      const dinnerKcal = dinnerRec ? MealStore.getRecipeKcalPerPerson(dinnerRec) : null;
      if (dinner) planned++;

      const extras = [];
      if (day.showBreakfast && MealStore.getSlotRecipeId(day, "breakfast")) {
        const n = slotRecipeName(day, "breakfast");
        const s = MealStore.getSlotServings(day, "breakfast");
        const kr = MealStore.getRecipe(MealStore.getSlotRecipeId(day, "breakfast"));
        const k = kr ? MealStore.getRecipeKcalPerPerson(kr) : null;
        if (n) extras.push("Ontbijt: " + n + (s ? " (" + s + "p)" : "") + (k != null ? " · " + k + " Kcal" : ""));
      }
      if (day.showLunch && MealStore.getSlotRecipeId(day, "lunch")) {
        const n = slotRecipeName(day, "lunch");
        const s = MealStore.getSlotServings(day, "lunch");
        const kr = MealStore.getRecipe(MealStore.getSlotRecipeId(day, "lunch"));
        const k = kr ? MealStore.getRecipeKcalPerPerson(kr) : null;
        if (n) extras.push("Lunch: " + n + (s ? " (" + s + "p)" : "") + (k != null ? " · " + k + " Kcal" : ""));
      }

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "month-row" + (meta.isToday ? " today" : "") + (dinner ? "" : " empty-dinner");
      btn.dataset.day = iso;
      btn.innerHTML =
        '<div class="m-date"><div class="m-daynum">' +
        d +
        '</div><div class="m-dow">' +
        meta.short +
        "</div></div>" +
        '<div class="m-body">' +
        '<div class="m-dinner' +
        (dinner ? "" : " none") +
        '">' +
        escapeHtml(dinner ? dinner + (dinnerServ ? " · " + dinnerServ + "p" : "") : "— nog open —") +
        "</div>" +
        (dinnerKcal != null ? kcalPillHtml(dinnerKcal, "meal") : "") +
        (extras.length
          ? '<div class="m-meta">' + escapeHtml(extras.join(" · ")) + "</div>"
          : meta.isToday
            ? '<div class="m-meta">Vandaag</div>'
            : "") +
        "</div>" +
        (dayTotalKcal(day) != null ? kcalPillHtml(dayTotalKcal(day), "day") : "");
      frags.push(btn);
    }

    const summary = document.createElement("div");
    summary.className = "month-summary";
    summary.textContent =
      planned +
      " van " +
      nDays +
      " avonden gepland" +
      (planned < nDays ? " · " + (nDays - planned) + " open" : " · vol!");
    host.appendChild(summary);
    frags.forEach((el) => host.appendChild(el));
  }

  function mealRowHtml(day, slot) {
    const recipeId = MealStore.getSlotRecipeId(day, slot);
    const name = recipeName(recipeId);
    const recipe = recipeId ? MealStore.getRecipe(recipeId) : null;
    const servings = recipeId ? MealStore.getSlotServings(day, slot) : null;
    const kcal = recipe ? MealStore.getRecipeKcalPerPerson(recipe) : null;
    // Layout: [AVOND + groen kcal eronder] | [naam · 2p + sterren]
    return (
      '<div class="meal-row" data-slot="' +
      slot +
      '">' +
      '<div class="slot-col">' +
      '<div class="slot-label">' +
      SLOT_LABEL[slot] +
      "</div>" +
      (kcal != null ? kcalPillHtml(kcal, "meal") : "") +
      "</div>" +
      '<div class="meal-main">' +
      '<div class="meal-name' +
      (name ? "" : " empty") +
      '">' +
      (name || "Nog niets gepland") +
      (name && servings ? " · " + servings + "p" : "") +
      "</div>" +
      (recipe && recipe.rating ? starsHtml(recipe.rating) : "") +
      "</div></div>"
    );
  }

  function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  function openDaySheet(iso) {
    const day = MealStore.getDay(iso);
    const meta = formatDayHeader(iso);
    sheetContext = { type: "day", day: iso };

    const body = buildDaySheetBody(iso, day);
    openSheet(capitalize(meta.dow) + " " + meta.label, body, [
      { label: "Sluiten", className: "btn-secondary", action: closeSheet },
    ]);
  }

  function buildDaySheetBody(iso, day) {
    const wrap = document.createElement("div");

    function slotBlock(slot, visible) {
      if (!visible && slot !== "dinner") return null;
      const rid = MealStore.getSlotRecipeId(day, slot);
      const r = rid ? MealStore.getRecipe(rid) : null;
      const serv = rid ? MealStore.getSlotServings(day, slot) : null;
      const base = r ? MealStore.getRecipeServingsBase(r) : 2;
      const kcal = r ? MealStore.getRecipeKcalPerPerson(r) : null;
      const box = document.createElement("div");
      box.className = "settings-card";
      box.innerHTML =
        "<h3>" +
        SLOT_LABEL[slot] +
        "</h3>" +
        "<p>" +
        (r ? escapeHtml(r.name) : "Nog geen gerecht") +
        (r && r.rating ? " · " + "★".repeat(r.rating) : "") +
        (kcal != null ? " · " + kcal + " Kcal" : "") +
        "</p>" +
        (r
          ? '<div class="field" style="margin-top:8px"><label>Aantal personen (recept basis: ' +
            base +
            "p)</label>" +
            '<div class="btn-row" style="align-items:center">' +
            '<button type="button" class="btn btn-sm btn-secondary" data-day-act="serv-minus" data-slot="' +
            slot +
            '">−</button>' +
            '<span style="min-width:3rem;text-align:center;font-weight:700" data-serv-label="' +
            slot +
            '">' +
            serv +
            "p</span>" +
            '<button type="button" class="btn btn-sm btn-secondary" data-day-act="serv-plus" data-slot="' +
            slot +
            '">+</button>' +
            '<input type="number" min="1" max="99" value="' +
            serv +
            '" data-serv-input="' +
            slot +
            '" style="width:4.5rem;min-height:36px;border-radius:12px;border:1px solid var(--line);padding:0 8px" />' +
            "</div></div>"
          : "") +
        '<div class="btn-row">' +
        '<button type="button" class="btn btn-sm btn-primary" data-day-act="pick" data-slot="' +
        slot +
        '">Kies recept</button>' +
        (r
          ? '<button type="button" class="btn btn-sm btn-secondary" data-day-act="rate" data-slot="' +
            slot +
            '">Score</button>' +
            '<button type="button" class="btn btn-sm btn-secondary" data-day-act="copy-slot" data-slot="' +
            slot +
            '">Kopieer</button>' +
            '<button type="button" class="btn btn-sm btn-ghost" data-day-act="clear" data-slot="' +
            slot +
            '">Wis</button>'
          : "") +
        (slot !== "dinner"
          ? '<button type="button" class="btn btn-sm btn-danger" data-day-act="hide-slot" data-slot="' +
            slot +
            '">Verberg</button>'
          : "") +
        "</div>";
      return box;
    }

    ["breakfast", "lunch", "dinner"].forEach((slot) => {
      const visible = slot === "dinner" || (slot === "breakfast" ? day.showBreakfast : day.showLunch);
      const el = slotBlock(slot, visible);
      if (el) wrap.appendChild(el);
    });

    if (!day.showBreakfast || !day.showLunch) {
      const extra = document.createElement("div");
      extra.className = "btn-row";
      if (!day.showBreakfast) {
        extra.innerHTML +=
          '<button type="button" class="btn btn-secondary" data-day-act="show-slot" data-slot="breakfast">+ Ontbijt toevoegen</button>';
      }
      if (!day.showLunch) {
        extra.innerHTML +=
          '<button type="button" class="btn btn-secondary" data-day-act="show-slot" data-slot="lunch">+ Lunch toevoegen</button>';
      }
      wrap.appendChild(extra);
    }

    wrap.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-day-act]");
      if (!btn) return;
      const act = btn.dataset.dayAct;
      const slot = btn.dataset.slot;
      if (act === "pick") openRecipePicker(iso, slot);
      if (act === "clear") {
        MealStore.setSlot(iso, slot, null);
        openDaySheet(iso);
        toast("Gewist");
      }
      if (act === "show-slot") {
        MealStore.toggleExtraSlot(iso, slot, true);
        openDaySheet(iso);
      }
      if (act === "hide-slot") {
        MealStore.toggleExtraSlot(iso, slot, false);
        openDaySheet(iso);
      }
      if (act === "rate") {
        const rid = MealStore.getSlotRecipeId(MealStore.getDay(iso), slot);
        if (rid) openRating(rid, () => openDaySheet(iso));
      }
      if (act === "copy-slot") openCopySlot(iso, slot);
      if (act === "serv-minus" || act === "serv-plus") {
        const d = MealStore.getDay(iso);
        let s = MealStore.getSlotServings(d, slot) || 2;
        s = act === "serv-minus" ? Math.max(1, s - 1) : Math.min(99, s + 1);
        MealStore.setSlotServings(iso, slot, s);
        openDaySheet(iso);
        renderCalendar();
      }
    });

    wrap.addEventListener("change", (e) => {
      const inp = e.target.closest("[data-serv-input]");
      if (!inp) return;
      const slot = inp.getAttribute("data-serv-input");
      let s = Number(inp.value);
      if (!(s > 0)) s = 1;
      MealStore.setSlotServings(iso, slot, s);
      openDaySheet(iso);
      renderCalendar();
    });

    return wrap;
  }

  function openRecipePicker(dayIso, slot) {
    const wrap = document.createElement("div");
    wrap.innerHTML =
      '<div class="search-bar"><input type="search" id="pick-search" placeholder="Zoek recept…" /></div>' +
      '<div class="settings-card" style="margin:10px 0;padding:10px">' +
      '<div style="font-weight:700;font-size:0.85rem;margin-bottom:6px">Filters</div>' +
      '<div class="filter-grid">' +
      '<div class="field" style="margin:0"><label>Kcal min</label><input id="pick-kcal-min" type="number" min="0" placeholder="—" inputmode="numeric" /></div>' +
      '<div class="field" style="margin:0"><label>Kcal max</label><input id="pick-kcal-max" type="number" min="0" placeholder="—" inputmode="numeric" /></div>' +
      '<div class="field" style="margin:0"><label>Min. sterren</label><select id="pick-stars"><option value="">Alle</option><option value="1">★+</option><option value="2">★★+</option><option value="3">★★★+</option><option value="4">★★★★+</option><option value="5">★★★★★</option></select></div>' +
      '<div class="field" style="margin:0"><label>Laatst gepland</label><select id="pick-planned"><option value="any">Alle</option><option value="never">Nog nooit</option><option value="7">≥ 7 d</option><option value="14">≥ 14 d</option><option value="30">≥ 30 d</option><option value="90">≥ 90 d</option></select></div>' +
      "</div>" +
      '<button type="button" class="btn btn-secondary btn-sm" id="pick-clear-flt" style="margin-top:8px">Filters wissen</button>' +
      "</div>" +
      '<div class="pick-list" id="pick-list"></div>' +
      '<button type="button" class="btn btn-primary btn-block" id="pick-new" style="margin-top:10px">+ Nieuw recept</button>';

    function pickFilters() {
      return {
        minKcal: (wrap.querySelector("#pick-kcal-min") && wrap.querySelector("#pick-kcal-min").value) || "",
        maxKcal: (wrap.querySelector("#pick-kcal-max") && wrap.querySelector("#pick-kcal-max").value) || "",
        minStars: (wrap.querySelector("#pick-stars") && wrap.querySelector("#pick-stars").value) || "",
        lastPlanned: (wrap.querySelector("#pick-planned") && wrap.querySelector("#pick-planned").value) || "any",
      };
    }

    function chooseRecipe(r) {
      const base = MealStore.getRecipeServingsBase(r);
      const body = document.createElement("div");
      body.innerHTML =
        "<p style=\"margin:0 0 10px\">Voor hoeveel personen plan je <strong>" +
        escapeHtml(r.name) +
        "</strong>?<br/><span style=\"color:var(--muted);font-size:0.88rem\">Recept-basis: " +
        base +
        " personen (boodschappen worden geschaald)</span></p>" +
        '<div class="field"><label>Personen</label>' +
        '<input id="pick-serv" type="number" min="1" max="99" value="' +
        base +
        '" /></div>' +
        '<div class="btn-row">' +
        [1, 2, 3, 4, 5, 6]
          .map(
            (n) =>
              '<button type="button" class="btn btn-sm btn-secondary" data-quick-serv="' +
              n +
              '">' +
              n +
              "p</button>"
          )
          .join("") +
        "</div>";
      body.querySelectorAll("[data-quick-serv]").forEach((b) => {
        b.addEventListener("click", () => {
          body.querySelector("#pick-serv").value = b.getAttribute("data-quick-serv");
        });
      });
      openSheet("Aantal personen", body, [
        {
          label: "Bevestigen",
          className: "btn-primary",
          action: () => {
            let s = Number(body.querySelector("#pick-serv").value);
            if (!(s > 0)) s = base;
            MealStore.setSlot(dayIso, slot, r.id, s);
            toast(r.name + " · " + s + "p");
            openDaySheet(dayIso);
            renderCalendar();
          },
        },
        { label: "Terug", className: "btn-secondary", action: () => openRecipePicker(dayIso, slot) },
      ]);
    }

    function fill(q) {
      const list = $("#pick-list", wrap);
      const items = MealStore.listRecipes(q, pickFilters());
      list.innerHTML = "";
      if (!items.length) {
        list.innerHTML = '<div class="empty-state">Geen recepten voor deze filters</div>';
        return;
      }
      items.forEach((r) => {
        const b = document.createElement("button");
        b.type = "button";
        const base = MealStore.getRecipeServingsBase(r);
        const daysAgo = MealStore.daysSinceLastPlanned(r.id);
        let ago = "nooit";
        if (daysAgo === 0) ago = "vandaag";
        else if (daysAgo === 1) ago = "gisteren";
        else if (daysAgo != null) ago = daysAgo + "d geleden";
        const kcal = MealStore.getRecipeKcalPerPerson(r);
        b.innerHTML =
          escapeHtml(r.name) +
          (r.rating ? " " + starsHtml(r.rating) : "") +
          ' <span style="color:var(--muted);font-weight:500">· ' +
          base +
          "p" +
          (kcal != null ? " · " + kcal + " kcal" : "") +
          " · " +
          ago +
          "</span>";
        b.addEventListener("click", () => chooseRecipe(r));
        list.appendChild(b);
      });
    }

    fill("");
    wrap.querySelector("#pick-search").addEventListener("input", (e) => fill(e.target.value));
    ["pick-kcal-min", "pick-kcal-max", "pick-stars", "pick-planned"].forEach((id) => {
      const el = wrap.querySelector("#" + id);
      if (!el) return;
      el.addEventListener("change", () => fill(wrap.querySelector("#pick-search").value));
      el.addEventListener("input", () => fill(wrap.querySelector("#pick-search").value));
    });
    wrap.querySelector("#pick-clear-flt").addEventListener("click", () => {
      wrap.querySelector("#pick-kcal-min").value = "";
      wrap.querySelector("#pick-kcal-max").value = "";
      wrap.querySelector("#pick-stars").value = "";
      wrap.querySelector("#pick-planned").value = "any";
      fill(wrap.querySelector("#pick-search").value);
    });
    wrap.querySelector("#pick-new").addEventListener("click", () => {
      openRecipeEditor(null, (savedId) => {
        if (savedId) {
          const r = MealStore.getRecipe(savedId);
          if (r) chooseRecipe(r);
          else {
            MealStore.setSlot(dayIso, slot, savedId);
            openDaySheet(dayIso);
            renderCalendar();
          }
        }
      });
    });

    openSheet("Kies recept · " + SLOT_LABEL[slot], wrap, [
      { label: "Terug", className: "btn-secondary", action: () => openDaySheet(dayIso) },
    ]);
  }

  function openCopySlot(fromDay, fromSlot) {
    const wrap = document.createElement("div");
    wrap.innerHTML =
      "<p style=\"color:var(--muted);margin:0 0 12px\">Kopieer dit gerecht naar andere dagen. Standaard zelfde moment van de dag.</p>" +
      '<div class="day-pick" id="copy-days"></div>' +
      '<label class="field"><span>Naar welk moment?</span>' +
      '<select id="copy-slot">' +
      '<option value="breakfast">Ontbijt</option>' +
      '<option value="lunch">Lunch</option>' +
      '<option value="dinner">Avondeten</option>' +
      "</select></label>";

    const host = $("#copy-days", wrap);
    const start = weekStart;
    for (let i = 0; i < 14; i++) {
      const iso = MealStore.addDaysISO(start, i);
      const meta = formatDayHeader(iso);
      const lab = document.createElement("label");
      lab.innerHTML =
        '<input type="checkbox" value="' +
        iso +
        '" ' +
        (iso === fromDay ? "" : "") +
        " /> " +
        capitalize(meta.short) +
        " " +
        meta.label;
      host.appendChild(lab);
    }
    $("#copy-slot", wrap).value = fromSlot;

    openSheet("Gerecht kopiëren", wrap, [
      {
        label: "Kopiëren",
        className: "btn-primary",
        action: () => {
          const days = $$("#copy-days input:checked", wrap).map((x) => x.value);
          const slot = $("#copy-slot", wrap).value;
          if (!days.length) {
            toast("Selecteer minstens één dag");
            return;
          }
          MealStore.copySlot(
            fromDay,
            fromSlot,
            days.map((d) => ({ day: d, slot }))
          );
          toast("Gekopieerd naar " + days.length + " dag(en)");
          closeSheet();
          renderCalendar();
        },
      },
      { label: "Annuleer", className: "btn-secondary", action: () => openDaySheet(fromDay) },
    ]);
  }

  function openCopyDay(fromDay) {
    const wrap = document.createElement("div");
    wrap.innerHTML =
      "<p style=\"color:var(--muted);margin:0 0 12px\">Kopieer alle maaltijden van deze dag.</p>" +
      '<div class="day-pick" id="copy-day-targets"></div>';
    const host = $("#copy-day-targets", wrap);
    for (let i = 0; i < 14; i++) {
      const iso = MealStore.addDaysISO(weekStart, i);
      if (iso === fromDay) continue;
      const meta = formatDayHeader(iso);
      const lab = document.createElement("label");
      lab.innerHTML =
        '<input type="checkbox" value="' + iso + '" /> ' + capitalize(meta.short) + " " + meta.label;
      host.appendChild(lab);
    }
    openSheet("Dag kopiëren", wrap, [
      {
        label: "Kopiëren",
        className: "btn-primary",
        action: () => {
          const days = $$("#copy-day-targets input:checked", wrap).map((x) => x.value);
          if (!days.length) {
            toast("Selecteer doel-dag(en)");
            return;
          }
          MealStore.copyDay(fromDay, days);
          toast("Dag gekopieerd");
          closeSheet();
          renderCalendar();
        },
      },
      { label: "Annuleer", className: "btn-secondary", action: closeSheet },
    ]);
  }

  function openRating(recipeId, onDone) {
    const r = MealStore.getRecipe(recipeId);
    if (!r) return;
    let value = r.rating || 0;
    const wrap = document.createElement("div");
    wrap.innerHTML =
      "<p style=\"margin:0 0 8px\">Score voor <strong>" +
      escapeHtml(r.name) +
      "</strong></p>" +
      '<div class="rating-picker" id="rate-stars"></div>' +
      '<p id="rate-label" style="color:var(--muted)"></p>';

    const host = $("#rate-stars", wrap);
    const label = $("#rate-label", wrap);

    function paint() {
      host.innerHTML = "";
      for (let i = 1; i <= 5; i++) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = "★";
        b.className = i <= value ? "on" : "";
        b.addEventListener("click", () => {
          value = i;
          paint();
        });
        host.appendChild(b);
      }
      label.textContent = value ? value + " / 5 sterren" : "Tik op een ster";
    }
    paint();

    openSheet("Score geven", wrap, [
      {
        label: "Opslaan",
        className: "btn-primary",
        action: () => {
          MealStore.setRating(recipeId, value);
          toast("Score opgeslagen");
          if (onDone) onDone();
          else closeSheet();
          renderAll();
        },
      },
      { label: "Annuleer", className: "btn-secondary", action: () => (onDone ? onDone() : closeSheet()) },
    ]);
  }

  /* ---------- Recipes ---------- */
  let recipeFilters = { minKcal: "", maxKcal: "", minStars: "", lastPlanned: "any" };

  function getRecipeFiltersFromDom() {
    return {
      minKcal: ($("#flt-kcal-min") && $("#flt-kcal-min").value) || "",
      maxKcal: ($("#flt-kcal-max") && $("#flt-kcal-max").value) || "",
      minStars: ($("#flt-stars") && $("#flt-stars").value) || "",
      lastPlanned: ($("#flt-planned") && $("#flt-planned").value) || "any",
    };
  }

  function renderRecipes() {
    const host = $("#recipe-list");
    if (!host) return;
    recipeFilters = getRecipeFiltersFromDom();
    const list = MealStore.listRecipes(recipeQuery, recipeFilters);
    host.innerHTML = "";
    if (!list.length) {
      host.innerHTML =
        '<div class="empty-state"><div class="big">🍲</div>Geen recepten voor deze filters.<br/>Pas filters aan of voeg een recept toe.</div>';
      return;
    }
    list.forEach((r) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "list-card";
      const ingCount = (r.ingredients || []).length;
      const kcal = MealStore.getRecipeKcalPerPerson(r);
      const daysAgo = MealStore.daysSinceLastPlanned(r.id);
      let plannedTxt = "Nog niet gepland";
      if (daysAgo === 0) plannedTxt = "Vandaag gepland";
      else if (daysAgo === 1) plannedTxt = "Gisteren gepland";
      else if (daysAgo != null) plannedTxt = daysAgo + " dagen geleden";

      btn.innerHTML =
        '<div class="recipe-title-row">' +
        "<h3>" +
        escapeHtml(r.name) +
        "</h3>" +
        (kcal != null ? kcalPillHtml(kcal, "meal") : "") +
        "</div>" +
        '<div class="meta">' +
        starsHtml(r.rating) +
        (r.timeMinutes ? " · " + r.timeMinutes + " min" : "") +
        " · " +
        (r.servingsBase || 2) +
        "p" +
        " · " +
        ingCount +
        " ingrediënten</div>" +
        '<div class="meta" style="margin-top:4px">' +
        escapeHtml(plannedTxt) +
        "</div>" +
        (r.notes ? '<div class="meta" style="margin-top:4px">' + escapeHtml(r.notes) + "</div>" : "");
      btn.addEventListener("click", () => openRecipeEditor(r.id));
      host.appendChild(btn);
    });
  }

  function openRecipeEditor(id, onSaved) {
    editingRecipeId = id || null;
    const r = id ? MealStore.getRecipe(id) : null;
    const wrap = document.createElement("div");
    wrap.innerHTML =
      '<div class="field"><label>Naam</label><input id="r-name" value="' +
      escapeAttr(r ? r.name : "") +
      '" placeholder="bv. Lasagne" /></div>' +
      '<div class="field"><label>Notities</label><textarea id="r-notes" placeholder="Tips, variaties…">' +
      escapeHtml(r ? r.notes || "" : "") +
      "</textarea></div>" +
      '<div class="field"><label>Bereidingstijd (min)</label><input id="r-time" type="number" min="0" inputmode="numeric" value="' +
      (r && r.timeMinutes != null ? r.timeMinutes : "") +
      '" /></div>' +
      '<div class="field"><label>Hoeveelheden voor (personen)</label><input id="r-servings" type="number" min="1" max="99" inputmode="numeric" value="' +
      (r && r.servingsBase != null ? r.servingsBase : 2) +
      '" /><p style="margin:6px 0 0;color:var(--muted);font-size:0.8rem">Basisportie van dit recept. Op een avond kies je hoeveel personen je kookt; boodschappen schalen mee.</p></div>' +
      '<div class="field"><label>Kcal</label><input id="r-kcal" type="number" min="0" max="5000" inputmode="numeric" placeholder="bv. 650" value="' +
      (r && r.kcalPerPerson != null ? r.kcalPerPerson : "") +
      '" /><p style="margin:6px 0 0;color:var(--muted);font-size:0.8rem">Per 1 persoon — niet vermenigvuldigd bij meer personen. Zichtbaar in week/maand als <strong>Kcal</strong>.</p></div>' +
      '<div class="field"><label>Score</label><div class="rating-picker" id="r-rating"></div></div>' +
      '<div class="section-title">Ingrediënten</div>' +
      '<div id="r-ings"></div>' +
      '<button type="button" class="btn btn-secondary btn-block" id="r-add-ing">+ Ingrediënt</button>';

    let rating = r ? r.rating || 0 : 0;
    const rateHost = $("#r-rating", wrap);
    function paintRate() {
      rateHost.innerHTML = "";
      for (let i = 1; i <= 5; i++) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = "★";
        b.className = i <= rating ? "on" : "";
        b.addEventListener("click", () => {
          rating = rating === i ? 0 : i;
          paintRate();
        });
        rateHost.appendChild(b);
      }
    }
    paintRate();

    const ingsHost = $("#r-ings", wrap);
    const ingredients = (r && r.ingredients ? r.ingredients.map((x) => ({ ...x })) : []).slice();
    if (!ingredients.length) ingredients.push({ name: "", qty: "", unit: "" });

    function renderIngs() {
      ingsHost.innerHTML = "";
      ingredients.forEach((ing, idx) => {
        const row = document.createElement("div");
        row.className = "ing-row";
        row.innerHTML =
          '<input data-f="name" placeholder="naam" value="' +
          escapeAttr(ing.name || "") +
          '" />' +
          '<input data-f="qty" placeholder="hoev." inputmode="decimal" value="' +
          escapeAttr(ing.qty == null ? "" : String(ing.qty)) +
          '" />' +
          '<input data-f="unit" placeholder="eenheid" value="' +
          escapeAttr(ing.unit || "") +
          '" />' +
          '<button type="button" class="icon-btn" data-del title="Verwijder">✕</button>';
        row.querySelectorAll("input").forEach((inp) => {
          inp.addEventListener("input", () => {
            const f = inp.dataset.f;
            ingredients[idx][f] = inp.value;
          });
        });
        row.querySelector("[data-del]").addEventListener("click", () => {
          ingredients.splice(idx, 1);
          if (!ingredients.length) ingredients.push({ name: "", qty: "", unit: "" });
          renderIngs();
        });
        ingsHost.appendChild(row);
      });
    }
    renderIngs();
    $("#r-add-ing", wrap).addEventListener("click", () => {
      ingredients.push({ name: "", qty: "", unit: "" });
      renderIngs();
    });

    const actions = [
      {
        label: "Opslaan",
        className: "btn-primary",
        action: () => {
          const name = $("#r-name", wrap).value.trim();
          if (!name) {
            toast("Geef een naam");
            return;
          }
          const savedId = MealStore.saveRecipe({
            id: editingRecipeId,
            name,
            notes: $("#r-notes", wrap).value,
            timeMinutes: $("#r-time", wrap).value,
            servingsBase: $("#r-servings", wrap).value,
            kcalPerPerson: $("#r-kcal", wrap).value,
            rating,
            ingredients,
          });
          toast("Recept opgeslagen");
          closeSheet();
          renderRecipes();
          renderCalendar();
          if (onSaved) onSaved(savedId);
        },
      },
      { label: "Annuleer", className: "btn-secondary", action: closeSheet },
    ];

    if (editingRecipeId) {
      actions.splice(1, 0, {
        label: "Verwijder",
        className: "btn-danger",
        action: () => {
          if (confirm("Recept verwijderen?")) {
            MealStore.deleteRecipe(editingRecipeId);
            toast("Verwijderd");
            closeSheet();
            renderRecipes();
            renderCalendar();
          }
        },
      });
    }

    openSheet(editingRecipeId ? "Recept bewerken" : "Nieuw recept", wrap, actions);
  }

  /* ---------- Prep + Cart (shopping) ---------- */
  function shoppingDayRange() {
    const start = MealStore.todayISO();
    const days = [];
    for (let i = 0; i <= 7; i++) days.push(MealStore.addDaysISO(start, i));
    return days;
  }

  function prettyQty(n) {
    if (n == null || Number.isNaN(n)) return "";
    if (Number.isInteger(n)) return String(n);
    return (Math.round(n * 100) / 100).toString();
  }

  function itemQtyText(item) {
    if (item.qty != null && !Number.isNaN(Number(item.qty))) {
      return prettyQty(Number(item.qty)) + (item.unit ? " " + item.unit : "");
    }
    return item.unit || "";
  }

  /** Dubbele bevestiging voor harde deletes */
  function confirmTwice(msg1, msg2) {
    if (!confirm(msg1)) return false;
    return confirm(msg2 || "Echt zeker? Dit kan niet ongedaan.");
  }

  function renderPrep() {
    const state = MealStore.get();
    const windowDays = shoppingDayRange();
    const windowSet = new Set(windowDays);
    const prevSelected = state.shopping.selectedDays || [];
    const pruned = prevSelected.filter((d) => windowSet.has(d));
    if (pruned.length !== prevSelected.length) MealStore.setShoppingDays(pruned);
    const selected = new Set((MealStore.get().shopping.selectedDays || []).filter((d) => windowSet.has(d)));

    const pick = $("#shop-day-pick");
    if (pick) {
      pick.innerHTML = "";
      windowDays.forEach((iso) => {
        const meta = formatDayHeader(iso);
        const day = MealStore.getDay(iso);
        const hasMeal = !!(
          MealStore.getSlotRecipeId(day, "dinner") ||
          (day.showBreakfast && MealStore.getSlotRecipeId(day, "breakfast")) ||
          (day.showLunch && MealStore.getSlotRecipeId(day, "lunch"))
        );
        const lab = document.createElement("label");
        lab.innerHTML =
          '<input type="checkbox" value="' +
          iso +
          '"' +
          (selected.has(iso) ? " checked" : "") +
          (hasMeal ? "" : " disabled") +
          " /> " +
          capitalize(meta.short) +
          " " +
          meta.label +
          (meta.isToday ? " · vandaag" : "") +
          (hasMeal ? "" : " (leeg)");
        lab.querySelector("input").addEventListener("change", () => {
          const days = $$("#shop-day-pick input:checked").map((x) => x.value);
          MealStore.setShoppingDays(days);
          renderPrepList();
        });
        pick.appendChild(lab);
      });
    }

    const sel = $("#shop-preset-select");
    if (sel) {
      const cur = sel.value;
      sel.innerHTML = '<option value="">Kies een item…</option>';
      MealStore.getShopPresets().forEach((p, idx) => {
        const opt = document.createElement("option");
        opt.value = String(idx);
        opt.textContent = p.name + (p.unit ? " (" + p.unit + ")" : "");
        sel.appendChild(opt);
      });
      if (cur) sel.value = cur;
      if (!sel.dataset.bound) {
        sel.dataset.bound = "1";
        sel.addEventListener("change", () => {
          const i = sel.value;
          if (i === "") return;
          const p = MealStore.getShopPresets()[Number(i)];
          if (!p) return;
          MealStore.addShoppingExtra({ name: p.name, qty: 1, unit: p.unit || "" });
          toast(p.name + " toegevoegd");
          sel.value = "";
          renderPrepList();
        });
      }
    }

    renderPrepList();
    renderHomeList();
  }

  function renderPrepList() {
    const items = MealStore.getPrepList();
    const host = $("#prep-list");
    const summary = $("#prep-summary");
    if (!host) return;
    host.innerHTML = "";
    const days = (MealStore.get().shopping.selectedDays || []).length;
    const backlog = MealStore.getBacklog().length;
    const cartN = MealStore.getCart().length;

    if (summary) {
      summary.textContent =
        items.length +
        " te regelen" +
        (days ? " · " + days + " dagen" : "") +
        (backlog ? " · " + backlog + " openstaand vorige trip" : "") +
        (cartN ? " · " + cartN + " al in winkelmandje" : "") +
        " · tik = markeer thuis";
    }

    if (!items.length) {
      host.innerHTML =
        '<div class="empty-state"><div class="big">📋</div>Niets open. Kies dagen, voeg extra’s toe, of alles staat al thuis / in het mandje.</div>';
      return;
    }

    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "check-item";
      row.style.cursor = "pointer";
      const badge =
        item.kind === "extra"
          ? ' <span style="color:var(--accent);font-size:0.72rem">EXTRA</span>'
          : item.kind === "backlog" || (item.sources || []).includes("Niet meegenomen")
            ? ' <span style="color:var(--warn,#c45);font-size:0.72rem">OPEN</span>'
            : "";
      row.innerHTML =
        '<div class="check-box" title="Markeer thuis">🏠</div>' +
        '<div style="flex:1;min-width:0"><div class="name">' +
        escapeHtml(item.name) +
        badge +
        '</div><div class="qty">' +
        escapeHtml(itemQtyText(item)) +
        (item.sources && item.sources.length ? " · " + escapeHtml(item.sources.slice(0, 3).join(", ")) : "") +
        "</div></div>";
      row.addEventListener("click", () => {
        if (
          !confirm(
            "“" +
              item.name +
              "” markeren als thuis?\n\nJa = niet kopen (ligt al in huis).\nNee = annuleer."
          )
        ) {
          return;
        }
        MealStore.markPrepItemHome(item.key, { name: item.name, unit: item.unit, qty: item.qty });
        toast(item.name + " → thuis");
        renderPrepList();
        renderHomeList();
      });
      host.appendChild(row);
    });
  }

  function renderHomeList() {
    const host = $("#home-list");
    if (!host) return;
    const home = MealStore.getHomeList();
    host.innerHTML = "";
    if (!home.length) {
      host.innerHTML = '<p style="color:var(--muted);font-size:0.85rem;margin:0">Nog geen voorraad gemarkeerd.</p>';
      return;
    }
    home.forEach((h) => {
      const row = document.createElement("div");
      row.className = "check-item done";
      const until =
        h.stickyHome
          ? "manueel thuis"
          : h.coveredUntilDays && h.coveredUntilDays.length
            ? "tot dagen: " + h.coveredUntilDays.join(", ")
            : "thuis";
      row.innerHTML =
        '<div class="check-box">✓</div><div style="flex:1"><div class="name">' +
        escapeHtml(h.name) +
        '</div><div class="qty">' +
        escapeHtml(until) +
        "</div></div>";
      host.appendChild(row);
    });
  }

  function renderCart() {
    const items = MealStore.getCart();
    const host = $("#cart-list");
    const summary = $("#cart-summary");
    if (!host) return;
    host.innerHTML = "";
    const done = items.filter((i) => i.checked).length;
    if (summary) {
      summary.textContent = items.length
        ? items.length + " in mandje · " + done + " in de kar · " + (items.length - done) + " nog te pakken"
        : "Mandje leeg — ga naar Prep en transfer.";
    }
    if (!items.length) {
      host.innerHTML =
        '<div class="empty-state"><div class="big">🛒</div>Nog geen boodschappenlijst.<br/>Tab <strong>Prep</strong> → dagen kiezen → “Naar boodschappenlijst”.</div>';
      return;
    }
    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "check-item" + (item.checked ? " done" : "");
      row.innerHTML =
        '<div class="check-box" data-toggle="' +
        item.id +
        '">' +
        (item.checked ? "✓" : "") +
        '</div><div style="flex:1;min-width:0" data-toggle="' +
        item.id +
        '"><div class="name">' +
        escapeHtml(item.name) +
        '</div><div class="qty">' +
        escapeHtml(itemQtyText(item)) +
        (item.sources && item.sources.length ? " · " + escapeHtml(item.sources.slice(0, 2).join(", ")) : "") +
        '</div></div><button type="button" class="btn btn-sm btn-ghost" data-del="' +
        item.id +
        '" title="Verwijderen">🗑</button>';
      row.querySelectorAll("[data-toggle]").forEach((el) => {
        el.style.cursor = "pointer";
        el.addEventListener("click", () => {
          MealStore.cartToggleCheck(item.id);
          renderCart();
        });
      });
      const del = row.querySelector("[data-del]");
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        if (
          !confirmTwice(
            "“" + item.name + "” definitief van de boodschappenlijst verwijderen?\n\nJa = verder · Nee = annuleer",
            "Laatste bevestiging: “" + item.name + "” echt verwijderen?"
          )
        ) {
          return;
        }
        MealStore.cartDeleteItem(item.id);
        toast(item.name + " verwijderd");
        renderCart();
      });
      host.appendChild(row);
    });
  }

  // legacy name used elsewhere
  function renderShopping() {
    renderPrep();
  }
  function renderShoppingList() {
    renderPrepList();
  }

  /* ---------- Settings ---------- */
  function renderSettings() {
    const st = MealSync.getStatus();
    const pill = $("#sync-status");
    pill.textContent = st.message || st.mode;
    pill.className = "status-pill" + (st.mode === "local" ? " warn" : "");

    const ver = $("#app-version-label");
    if (ver) {
      ver.textContent =
        "App-versie: " +
        (window.MEAL_APP_VERSION || "?") +
        " · Data: " +
        (st.mode === "cloud" ? "Supabase (gedeeld)" : "alleen dit toestel");
    }

    const cloud = MealSync.getCloudConfig();
    const urlEl = $("#sb-url");
    const keyEl = $("#sb-key");
    const enEl = $("#sb-enabled");
    if (urlEl && document.activeElement !== urlEl) urlEl.value = cloud.url || "";
    if (keyEl && document.activeElement !== keyEl) keyEl.value = cloud.anonKey || "";
    if (enEl && document.activeElement !== enEl) enEl.checked = cloud.enabled !== false;

    const pub = $("#public-app-url");
    if (pub && document.activeElement !== pub) {
      pub.value = localStorage.getItem(PUBLIC_URL_KEY) || "";
    }
  }

  const SCHEMA_SQL = `-- Eetkalender — plak in Supabase → SQL Editor → Run
create table if not exists public.meal_calendar_state (
  id int primary key check (id = 1),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.meal_calendar_state (id, payload)
values (1, '{}'::jsonb)
on conflict (id) do nothing;
alter table public.meal_calendar_state enable row level security;
drop policy if exists "meal_calendar_read" on public.meal_calendar_state;
drop policy if exists "meal_calendar_write" on public.meal_calendar_state;
create policy "meal_calendar_read"
  on public.meal_calendar_state for select to anon, authenticated using (true);
create policy "meal_calendar_write"
  on public.meal_calendar_state for all to anon, authenticated using (true) with check (true);
`;

  /* ---------- Sheet helpers ---------- */
  function openSheet(title, bodyEl, actions) {
    $("#sheet-title").textContent = title;
    const body = $("#sheet-body");
    body.innerHTML = "";
    if (typeof bodyEl === "string") body.innerHTML = bodyEl;
    else body.appendChild(bodyEl);

    const actHost = $("#sheet-actions");
    actHost.innerHTML = "";
    (actions || []).forEach((a) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn " + (a.className || "btn-secondary");
      if ((actions || []).length === 1 || a.className === "btn-primary") b.classList.add("btn-block");
      b.style.flex = "1";
      b.textContent = a.label;
      b.addEventListener("click", a.action);
      actHost.appendChild(b);
    });
    actHost.style.display = "flex";
    actHost.style.gap = "8px";
    actHost.style.flexWrap = "wrap";
    actHost.style.marginTop = "12px";

    $("#overlay").classList.add("open");
  }

  function closeSheet() {
    $("#overlay").classList.remove("open");
    sheetContext = null;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  function renderAll() {
    renderCalendar();
    renderRecipes();
    renderPrep();
    renderCart();
    renderSettings();
  }

  /* ---------- events ---------- */
  function bind() {
    $$(".pin-key").forEach((k) => {
      k.addEventListener("click", () => onPinKey(k.dataset.key));
    });

    $$(".nav-item").forEach((n) => {
      n.addEventListener("click", () => switchTab(n.dataset.tab));
    });

    $("#btn-prev-week").addEventListener("click", () => {
      if (calMode === "month") {
        monthCursor = addMonthsISO(monthCursor, -1);
      } else {
        weekStart = MealStore.addDaysISO(weekStart, -7);
      }
      renderCalendar();
    });
    $("#btn-next-week").addEventListener("click", () => {
      if (calMode === "month") {
        monthCursor = addMonthsISO(monthCursor, 1);
      } else {
        weekStart = MealStore.addDaysISO(weekStart, 7);
      }
      renderCalendar();
    });
    $("#btn-this-week").addEventListener("click", () => {
      const today = MealStore.todayISO();
      weekStart = MealStore.startOfWeekISO(today);
      monthCursor = startOfMonthISO(today);
      renderCalendar();
    });

    const chipWeek = $("#chip-week");
    const chipMonth = $("#chip-month");
    if (chipWeek) chipWeek.addEventListener("click", () => setCalMode("week"));
    if (chipMonth) chipMonth.addEventListener("click", () => setCalMode("month"));

    $("#day-list").addEventListener("click", (e) => {
      const card = e.target.closest(".day-card");
      if (!card) return;
      const iso = card.dataset.day;
      const actBtn = e.target.closest("[data-act]");
      if (actBtn) {
        const act = actBtn.dataset.act;
        if (act === "open-day") openDaySheet(iso);
        if (act === "copy-day") openCopyDay(iso);
        if (act === "add-slot") {
          MealStore.toggleExtraSlot(iso, actBtn.dataset.slot, true);
          openDaySheet(iso);
          renderCalendar();
        }
        return;
      }
      const meal = e.target.closest(".meal-row");
      if (meal) {
        openDaySheet(iso);
        return;
      }
      openDaySheet(iso);
    });

    const monthList = $("#month-list");
    if (monthList) {
      monthList.addEventListener("click", (e) => {
        const row = e.target.closest(".month-row");
        if (!row || !row.dataset.day) return;
        openDaySheet(row.dataset.day);
      });
    }

    $("#recipe-search").addEventListener("input", (e) => {
      recipeQuery = e.target.value;
      renderRecipes();
    });
    $("#btn-new-recipe").addEventListener("click", () => openRecipeEditor(null));

    ["flt-kcal-min", "flt-kcal-max", "flt-stars", "flt-planned"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", () => renderRecipes());
      el.addEventListener("input", () => renderRecipes());
    });
    const btnClrFlt = $("#btn-clear-recipe-filters");
    if (btnClrFlt) {
      btnClrFlt.addEventListener("click", () => {
        if ($("#flt-kcal-min")) $("#flt-kcal-min").value = "";
        if ($("#flt-kcal-max")) $("#flt-kcal-max").value = "";
        if ($("#flt-stars")) $("#flt-stars").value = "";
        if ($("#flt-planned")) $("#flt-planned").value = "any";
        renderRecipes();
        toast("Filters gewist");
      });
    }

    const btnClearDays = $("#btn-clear-days");
    if (btnClearDays) {
      btnClearDays.addEventListener("click", () => {
        MealStore.setShoppingDays([]);
        renderPrep();
        toast("Dagen gewist");
      });
    }

    const btnClearExtras = $("#btn-clear-extras");
    if (btnClearExtras) {
      btnClearExtras.addEventListener("click", () => {
        if (!confirm("Alle extra boodschappen wissen?")) return;
        MealStore.clearShoppingExtras();
        renderPrepList();
        toast("Extra’s gewist");
      });
    }

    const btnAddExtra = $("#btn-add-extra");
    if (btnAddExtra) {
      btnAddExtra.addEventListener("click", () => {
        const name = ($("#extra-name") && $("#extra-name").value) || "";
        const qty = ($("#extra-qty") && $("#extra-qty").value) || "";
        const unit = ($("#extra-unit") && $("#extra-unit").value) || "";
        if (!String(name).trim()) {
          toast("Geef een item-naam");
          return;
        }
        MealStore.addShoppingExtra({ name, qty, unit });
        if ($("#extra-name")) $("#extra-name").value = "";
        if ($("#extra-qty")) $("#extra-qty").value = "";
        if ($("#extra-unit")) $("#extra-unit").value = "";
        toast("Toegevoegd");
        renderPrepList();
      });
    }

    const btnTransfer = $("#btn-transfer-cart");
    if (btnTransfer) {
      btnTransfer.addEventListener("click", () => {
        const prep = MealStore.getPrepList();
        if (!prep.length) {
          toast("Niets om over te zetten");
          return;
        }
        const cartN = MealStore.getCart().length;
        let mode = "merge";
        if (cartN > 0) {
          const choice = confirm(
            "Mandje heeft al " +
              cartN +
              " items.\n\nOK = aanvullen (samenvoegen)\nAnnuleren = stop\n\n(Wil je vervangen? Wis eerst de hele lijst in Winkel.)"
          );
          if (!choice) return;
          mode = "merge";
        }
        const n = MealStore.transferPrepToCart(mode);
        toast(n + " items in boodschappenlijst");
        renderPrep();
        renderCart();
        switchTab("cart");
      });
    }

    const btnClearHome = $("#btn-clear-home");
    if (btnClearHome) {
      btnClearHome.addEventListener("click", () => {
        if (!confirmTwice("Alle thuis-voorraad wissen?", "Echt alle voorraad-markeringen wissen?")) return;
        MealStore.clearHomeStock();
        renderPrep();
        toast("Voorraad gewist");
      });
    }

    const btnComplete = $("#btn-complete-trip");
    if (btnComplete) {
      btnComplete.addEventListener("click", () => {
        const cart = MealStore.getCart();
        if (!cart.length) {
          toast("Mandje is leeg");
          return;
        }
        const checked = cart.filter((c) => c.checked).length;
        const left = cart.length - checked;
        if (
          !confirm(
            "Winkel afronden?\n\n" +
              checked +
              " meegenomen → thuis\n" +
              left +
              " niet meegenomen → terug naar Prep\n\nOK = afronden · Annuleren = stop"
          )
        ) {
          return;
        }
        const res = MealStore.completeShoppingTrip();
        toast(res.taken + " thuis · " + res.left + " openstaand");
        renderCart();
        renderPrep();
        if (res.left > 0) switchTab("prep");
      });
    }

    const btnCartClear = $("#btn-cart-clear-all");
    if (btnCartClear) {
      btnCartClear.addEventListener("click", () => {
        if (!MealStore.getCart().length) {
          toast("Mandje is al leeg");
          return;
        }
        if (
          !confirmTwice(
            "Hele boodschappenlijst definitief verwijderen?\n\n(Dit is géén afronden — items gaan niet naar Prep.)",
            "Laatste bevestiging: hele lijst echt wissen?"
          )
        ) {
          return;
        }
        MealStore.cartClearAll();
        renderCart();
        toast("Lijst verwijderd");
      });
    }

    $("#btn-change-pin").addEventListener("click", () => {
      const wrap = document.createElement("div");
      wrap.innerHTML =
        '<div class="field"><label>Huidige pincode</label><input id="pin-old" type="password" inputmode="numeric" /></div>' +
        '<div class="field"><label>Nieuwe pincode (4–8 cijfers)</label><input id="pin-new" type="password" inputmode="numeric" /></div>' +
        '<div class="field"><label>Bevestig nieuwe</label><input id="pin-new2" type="password" inputmode="numeric" /></div>';
      openSheet("Pincode wijzigen", wrap, [
        {
          label: "Opslaan",
          className: "btn-primary",
          action: async () => {
            const a = $("#pin-old", wrap).value;
            const b = $("#pin-new", wrap).value;
            const c = $("#pin-new2", wrap).value;
            if (b !== c) {
              toast("Nieuwe codes komen niet overeen");
              return;
            }
            const res = await MealStore.changePin(a, b);
            if (!res.ok) {
              toast(res.error || "Mislukt");
              return;
            }
            toast("Pincode gewijzigd");
            closeSheet();
          },
        },
        { label: "Annuleer", className: "btn-secondary", action: closeSheet },
      ]);
    });

    $("#btn-export").addEventListener("click", () => {
      const blob = new Blob([MealStore.exportJSON()], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "eetkalender-backup.json";
      a.click();
      URL.revokeObjectURL(a.href);
      toast("Backup gedownload");
    });

    $("#btn-import").addEventListener("click", () => $("#import-file").click());
    $("#import-file").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        MealStore.importJSON(text);
        toast("Backup geïmporteerd");
        renderAll();
      } catch (err) {
        toast("Import mislukt");
        console.error(err);
      }
      e.target.value = "";
    });

    $("#btn-demo").addEventListener("click", () => {
      if (confirm("Voorbeeldrecepten en weekplanning laden? Huidige lokale data wordt overschreven.")) {
        MealStore.resetDemo();
        weekStart = MealStore.startOfWeekISO(MealStore.todayISO());
        renderAll();
        toast("Demo geladen");
      }
    });

    $("#btn-lock").addEventListener("click", () => {
      MealStore.lock();
      showApp(false);
      pinBuffer = "";
      renderPinDots();
    });

    $("#btn-open-supabase").addEventListener("click", () => {
      window.open("https://supabase.com/dashboard", "_blank", "noopener");
    });

    $("#btn-copy-sql").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(SCHEMA_SQL);
        toast("SQL gekopieerd — plak in SQL Editor");
        $("#sb-help").textContent = "Geplakt? In Supabase: SQL Editor → New query → plak → Run.";
      } catch (_) {
        // fallback
        const ta = document.createElement("textarea");
        ta.value = SCHEMA_SQL;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        toast("SQL gekopieerd");
      }
    });

    $("#btn-sb-test").addEventListener("click", async () => {
      let url = $("#sb-url").value.trim().replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, "");
      $("#sb-url").value = url;
      const anonKey = $("#sb-key").value.trim();
      $("#sb-help").textContent = "Testen…";
      const res = await MealSync.testConnection(url, anonKey);
      $("#sb-help").textContent = res.ok ? "✅ " + res.message : "❌ " + (res.error || "Mislukt");
      toast(res.ok ? "Verbinding OK" : "Test mislukt");
      // Bij geslaagde test meteen opslaan + verbinden (handiger op telefoon)
      if (res.ok && url && anonKey) {
        $("#sb-enabled").checked = true;
        MealSync.saveCloudConfig({ enabled: true, url, anonKey });
        const conn = await MealSync.connect();
        renderSettings();
        if (conn.ok) {
          toast("Cloud verbonden");
          $("#sb-help").textContent = "✅ Getest én verbonden. Andere telefoons: zelfde URL + key.";
        }
      }
    });

    $("#btn-sb-save").addEventListener("click", async () => {
      let url = $("#sb-url").value.trim();
      // Normalize REST path if user pasted /rest/v1/
      url = url.replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, "");
      $("#sb-url").value = url;
      const anonKey = $("#sb-key").value.trim();
      // Als URL+key ingevuld zijn, sync standaard AAN (checkbox mag uit om uit te zetten)
      let enabled = $("#sb-enabled").checked;
      if (url && anonKey && !enabled) {
        // Gebruiker klikte Opslaan met keys → intentie is verbinden
        enabled = true;
        $("#sb-enabled").checked = true;
      }
      if (enabled && (!url || !anonKey)) {
        toast("Vul URL en key in");
        $("#sb-help").textContent =
          "Nog nodig: de anon public key (Settings → API → anon public). URL alleen is niet genoeg.";
        return;
      }
      MealSync.saveCloudConfig({ enabled, url, anonKey });
      $("#sb-help").textContent = "Opslaan… verbinden…";
      const res = await MealSync.connect();
      renderSettings();
      if (res.ok) {
        toast("Cloud verbonden");
        $("#sb-help").textContent =
          "✅ Verbonden. Zet dezelfde URL+key op andere telefoons (of deel via backup na eerste sync).";
      } else {
        toast("Verbinden mislukt");
        $("#sb-help").textContent = "❌ " + (res.error || "Controleer SQL + keys");
      }
    });

    $("#btn-sync-now").addEventListener("click", async () => {
      const res = await MealSync.forceSyncNow();
      renderSettings();
      toast(res.ok ? "Sync klaar" : res.error || "Sync mislukt");
    });

    $("#btn-check-update").addEventListener("click", async () => {
      toast("Zoeken naar update…");
      try {
        if (!("serviceWorker" in navigator)) {
          location.reload();
          return;
        }
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) await reg.update();
        // Force network reload of app shell
        location.reload();
      } catch (_) {
        location.reload();
      }
    });

    window.addEventListener("meal-app-update", () => {
      toast("Nieuwe app-versie klaar — herladen…");
      // Activeer nieuwe SW
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg && reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
        else location.reload();
      });
    });

    $("#btn-save-public-url").addEventListener("click", () => {
      let v = ($("#public-app-url").value || "").trim().replace(/\/+$/, "");
      if (v && !/^https:\/\//i.test(v)) {
        toast("Gebruik een https:// URL (bv. Netlify)");
        return;
      }
      if (v) {
        try {
          const host = new URL(v).hostname;
          if (isUnsafeHost(host)) {
            toast("Geen localhost/bedrijfs-IP — gebruik publieke hosting");
            return;
          }
        } catch (_) {
          toast("Ongeldige URL");
          return;
        }
        localStorage.setItem(PUBLIC_URL_KEY, v);
        toast("Publieke URL opgeslagen");
      } else {
        localStorage.removeItem(PUBLIC_URL_KEY);
        toast("Publieke URL gewist");
      }
    });

    $("#btn-share-partner").addEventListener("click", async () => {
      const res = buildPartnerShareLink();
      if (!res.ok) {
        toast(res.error);
        $("#sb-help").textContent = res.error;
        return;
      }
      showShareResult(res.link, res.isLocal);
      if (res.isLocal) {
        toast("Eerst publiek hosten — zie waarschuwing");
        return;
      }
      const copied = await copyText(res.link);
      toast(copied ? "Deellink gekopieerd" : "Deellink klaar — kopieer manueel");
    });

    $("#btn-share-copy").addEventListener("click", async () => {
      const link = $("#share-link").value;
      if (!link) return;
      const ok = await copyText(link);
      toast(ok ? "Link gekopieerd" : "Kopiëren mislukt — selecteer manueel");
    });

    $("#btn-share-native").addEventListener("click", async () => {
      const link = $("#share-link").value;
      if (!link) {
        toast("Maak eerst een deellink");
        return;
      }
      if (navigator.share) {
        try {
          await navigator.share({
            title: "Eetkalender",
            text: "Open deze link om mee te plannen wat we eten (daarna pincode intoetsen).",
            url: link,
          });
        } catch (e) {
          if (e && e.name !== "AbortError") {
            await copyText(link);
            toast("Link gekopieerd (delen geannuleerd/niet gelukt)");
          }
        }
      } else {
        await copyText(link);
        toast("Link gekopieerd — plak in WhatsApp/iMessage");
      }
    });

    $("#overlay").addEventListener("click", (e) => {
      if (e.target.id === "overlay") closeSheet();
    });
    $("#sheet-close").addEventListener("click", closeSheet);

    MealStore.subscribe(() => {
      if (MealStore.get().unlocked) {
        if (currentTab === "calendar") renderCalendar();
        if (currentTab === "recipes") renderRecipes();
        if (currentTab === "prep") renderPrep();
        if (currentTab === "cart") renderCart();
        if (currentTab === "settings") renderSettings();
      }
    });

    MealSync.subscribe(() => {
      if (MealStore.get().unlocked) renderSettings();
    });
  }

  /* ---------- Partner share link ---------- */
  function toBase64Url(str) {
    const b64 = btoa(unescape(encodeURIComponent(str)));
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function fromBase64Url(str) {
    let s = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return decodeURIComponent(escape(atob(s)));
  }

  const PUBLIC_URL_KEY = "meal-calendar-public-url";

  function getPublicAppBase() {
    let saved = (localStorage.getItem(PUBLIC_URL_KEY) || "").trim().replace(/\/+$/, "");
    // Allow pasting .../index.html
    if (saved.toLowerCase().endsWith("/index.html")) {
      saved = saved.slice(0, -"/index.html".length);
    }
    if (saved) return saved + "/";
    return window.location.origin + window.location.pathname.replace(/\/?$/, "/");
  }

  function isUnsafeHost(hostname) {
    const h = String(hostname || "").toLowerCase();
    if (!h || h === "localhost" || h === "127.0.0.1") return true;
    // Private / corporate ranges (incl. typical Tesla 10.x)
    if (/^10\./.test(h)) return true;
    if (/^192\.168\./.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
    return false;
  }

  function buildPartnerShareLink() {
    const cloud = MealSync.getCloudConfig();
    const url = (cloud.url || $("#sb-url")?.value || "").trim();
    const anonKey = (cloud.anonKey || $("#sb-key")?.value || "").trim();
    if (!url || !anonKey) {
      return { ok: false, error: "Eerst cloud verbinden (URL + key), daarna deellink maken." };
    }
    const payload = {
      v: 1,
      u: url.replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, ""),
      k: anonKey,
    };
    const token = toBase64Url(JSON.stringify(payload));
    const base = getPublicAppBase();
    // hash fragment: keys gaan niet mee in server-logs van de host
    const link = base.replace(/\/?$/, "/") + "#join=" + token;
    let host = "";
    try {
      host = new URL(base).hostname;
    } catch (_) {
      host = window.location.hostname;
    }
    const unsafe = isUnsafeHost(host);
    return { ok: true, link, isLocal: unsafe, base, host };
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    }
  }

  function showShareResult(link, isLocal) {
    const box = $("#share-result");
    const ta = $("#share-link");
    const hint = $("#share-hint");
    box.classList.remove("hidden");
    ta.value = link;
    if (isLocal) {
      hint.innerHTML =
        "<strong>Niet delen zo:</strong> deze link hangt aan localhost of een privé/bedrijfsnetwerk (bv. 10.x). " +
        "Dat is <em>niet</em> onafhankelijk van je PC en kan sporen op het werknetwerk laten. " +
        "Host de app gratis op <strong>Netlify Drop</strong> (zie HOSTING.md), vul hierboven de <strong>publieke https-URL</strong> in, en maak opnieuw een deellink.";
    } else {
      hint.textContent =
        "Partner opent de link (wifi of 4G) → pincode → cloud gekoppeld. Jouw PC mag uit. Deel de link alleen privé (bevat cloud-toegang).";
    }
  }

  async function consumeJoinLink() {
    const hash = window.location.hash || "";
    const m = hash.match(/[#&]join=([^&]+)/);
    if (!m) return { applied: false };

    let parsed;
    try {
      parsed = JSON.parse(fromBase64Url(decodeURIComponent(m[1])));
    } catch (e) {
      console.error(e);
      return { applied: false, error: "Ongeldige deellink" };
    }
    if (!parsed || !parsed.u || !parsed.k) {
      return { applied: false, error: "Deellink mist cloud-gegevens" };
    }

    MealSync.saveCloudConfig({
      enabled: true,
      url: String(parsed.u).trim(),
      anonKey: String(parsed.k).trim(),
    });

    // Clean URL so key doesn't stay in the address bar after setup
    try {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    } catch (_) {
      window.location.hash = "";
    }

    const conn = await MealSync.connect();
    return {
      applied: true,
      ok: !!conn.ok,
      error: conn.ok ? null : conn.error || "Verbinden mislukt",
      message: conn.ok
        ? "Cloud gekoppeld via deellink — voer de pincode in."
        : "Deellink gelezen, maar verbinden mislukt: " + (conn.error || ""),
    };
  }

  async function boot() {
    MealStore.load();
    await MealStore.ensurePinInitialized();
    bind();
    renderPinDots();
    showApp(false);

    // Partner join-link verwerken vóór/met sync-init
    const join = await consumeJoinLink();
    if (join.applied) {
      // sync already connected in consumeJoinLink
      if (join.ok) {
        // show toast after a tick so DOM is ready
        setTimeout(() => toast(join.message || "Cloud gekoppeld"), 300);
      } else {
        setTimeout(() => toast(join.error || join.message || "Deellink mislukt"), 300);
      }
    } else {
      await MealSync.init();
    }

    // If already unlocked in memory (shouldn't), show app
    if (MealStore.get().unlocked) showApp(true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
