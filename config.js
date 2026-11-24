// Collegamento al database (Supabase → Project Settings → API Keys).
// La chiave "publishable" è pensata per stare nel codice di un sito: i dati sono protetti
// dalle regole del database (supabase/schema.sql), che fanno entrare solo le email della famiglia.
window.SPESE_CONFIG = {
  supabaseUrl: 'https://saxcmbxhqbfcjrvefrsv.supabase.co',
  supabaseAnonKey: 'sb_publishable_IwChQhPpAYLLxridhFS0VQ_ZTVeQmVK',
};
