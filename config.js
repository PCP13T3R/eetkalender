// Eetkalender configuratie
// Voor multi-user sync: vul Supabase in (zie README) en zet enabled op true.
window.MEAL_CONFIG = {
  appName: "Eetkalender",
  // Standaard pincode bij eerste start (wijzigbaar in Instellingen)
  defaultPin: "1234",
  // Lokale opslag-sleutel
  storageKey: "meal-calendar-v1",
  // Optioneel: Supabase voor delen tussen telefoons
  supabase: {
    enabled: false, // aanzetten in de app (Instellingen) na invullen anon key
    url: "https://vgxrzldimgngqytimvon.supabase.co",
    anonKey: "", // NOOIT hier plakken — alleen in de app (Instellingen)
  },
  // Sync-interval (ms) wanneer Supabase aan staat
  syncIntervalMs: 8000,
};
