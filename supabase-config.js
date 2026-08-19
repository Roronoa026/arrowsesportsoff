const SUPABASE_URL = "https://fvcavhcpprzxcbnixtta.supabase.co/rest/v1/";

const SUPABASE_ANON_KEY = "sb_publishable_5Ec83iiQuqs52Bg2z1z9jg_ksAgh626";

window.supabaseClient = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);