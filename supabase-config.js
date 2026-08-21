/* ARROWS ESPORTS - Supabase configuration */
window.ARROWS_SUPABASE = {
  url: "https://fvcavhcpprzxcbnixtta.supabase.co",
  publishableKey: "sb_publishable_5Ec83iiQuqs52Bg2z1z9jg_ksAgh626"
};

window.SUPABASE_URL = window.ARROWS_SUPABASE.url;
window.SUPABASE_ANON_KEY = window.ARROWS_SUPABASE.publishableKey;

if (!window.supabase) {
  console.error("Supabase JS library has not loaded.");
} else {
  window.supabaseClient = window.supabase.createClient(
    window.SUPABASE_URL,
    window.SUPABASE_ANON_KEY
  );
}
