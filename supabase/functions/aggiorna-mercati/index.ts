// Aggiorna prezzi e notizie dei titoli in portafoglio.
// Prezzi: Tradegate (in euro, per ISIN) e CoinGecko per le cripto. Notizie: Google News in italiano.
// Gira su Supabase (Edge Function): la chiamano il Cron ogni sera e il pulsante "Aggiorna ora" dell'app.
// Scrive solo righe kind='mkt' (dati di mercato, uno per titolo); non restituisce dati personali.
// Chi può chiamarla: un utente che ha fatto l'accesso all'app ('user') o il Cron con la chiave segreta ('secret').
// Il controllo lo fa withSupabase nel codice: il vecchio "Verify JWT with legacy secret" va spento in Settings.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { withSupabase } from 'jsr:@supabase/server@^1';
const UA = 'Mozilla/5.0 (compatible; SpeseMensili/1.0; +https://alberto995af.github.io/spese-mensili/)';
const MIN_GAP_MS = 10 * 60 * 1000; // al massimo un aggiornamento ogni 10 minuti
const HISTORY_DAYS = 800;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// Tradegate scrive i numeri a volte come 142.32 e a volte come "1 380,20"
function num(v: unknown): number | null {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/[\s  ]/g, '').replace(',', '.'));
  return isFinite(n) ? n : null;
}

async function tradegate(isin: string) {
  const r = await fetch(`https://www.tradegatebsx.com/refresh.php?isin=${encodeURIComponent(isin)}`, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`Tradegate ${r.status}`);
  const d = await r.json();
  const price = num(d.last) ?? num(d.bid);
  if (!price) throw new Error('Tradegate: nessun prezzo');
  return { price, prevClose: num(d.close), changePct: num(d.delta), source: 'Tradegate' };
}

async function coingecko(id: string) {
  const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=eur&include_24hr_change=true`);
  if (!r.ok) throw new Error(`CoinGecko ${r.status}`);
  const x = (await r.json())[id];
  if (!x?.eur) throw new Error('CoinGecko: nessun prezzo');
  return { price: x.eur, prevClose: null, changePct: x.eur_24h_change ?? null, source: 'CoinGecko' };
}

const decode = (s: string) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

async function news(query: string) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query + ' when:7d')}&hl=it&gl=IT&ceid=IT:it`;
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`Google News ${r.status}`);
  const xml = await r.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 8).map(m => {
    const tag = (t: string) => { const x = m[1].match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return x ? decode(x[1]) : '' };
    const source = tag('source'), title = tag('title');
    const d = new Date(tag('pubDate'));
    return { title: source && title.endsWith(' - ' + source) ? title.slice(0, -(source.length + 3)) : title,
      link: tag('link'), source, date: isNaN(+d) ? '' : d.toISOString() };
  });
}

async function run(sb: any) {
  const now = new Date(), today = now.toISOString().slice(0, 10);

  const { data: stato } = await sb.from('items').select('data').eq('kind', 'mkt').eq('id', '_stato').maybeSingle();
  if (stato?.data?.at && now.getTime() - Date.parse(stato.data.at) < MIN_GAP_MS) return { skipped: true, at: stato.data.at };

  const [{ data: inv, error }, { data: old }] = await Promise.all([
    sb.from('items').select('id,data').eq('kind', 'inv'),
    sb.from('items').select('id,data').eq('kind', 'mkt'),
  ]);
  if (error) return { error: error.message };
  const prev = new Map((old ?? []).map((r: any) => [r.id, r.data]));

  const rows: { kind: string; id: string; data: Record<string, unknown> }[] = [];
  for (const { id, data: p } of inv ?? []) {
    if (p.archived || !(p.qty > 0)) continue;
    const o = prev.get(id) ?? {};
    const rec: Record<string, any> = { ...o, id };
    try {
      const q = p.kind === 'cripto' ? (p.cgId ? await coingecko(p.cgId) : null) : (p.isin ? await tradegate(p.isin) : null);
      if (q) {
        const history = { ...(o.history ?? {}), [today]: q.price };
        const keep = Object.keys(history).sort().slice(-HISTORY_DAYS);
        Object.assign(rec, q, { at: now.toISOString(), err: '', history: Object.fromEntries(keep.map(k => [k, history[k]])) });
      }
    } catch (e) { rec.err = String((e as Error).message ?? e); rec.errAt = now.toISOString() }
    try {
      const q = String(p.newsQuery || p.name || '').trim();
      if (q) { rec.news = await news(q); rec.newsAt = now.toISOString(); rec.newsErr = '' }
    } catch (e) { rec.newsErr = String((e as Error).message ?? e) }
    rows.push({ kind: 'mkt', id, data: rec });
  }
  rows.push({ kind: 'mkt', id: '_stato', data: { at: now.toISOString(), titoli: rows.length } });
  const { error: e2 } = await sb.from('items').upsert(rows, { onConflict: 'kind,id' });
  if (e2) return { error: e2.message };
  return { ok: true, aggiornati: rows.length - 1, errori: rows.filter(r => r.data.err).map(r => `${r.id}: ${r.data.err}`) };
}

const handler = withSupabase({ auth: ['user', 'secret'] }, async (_req: Request, ctx: any) => {
  const work = run(ctx.supabaseAdmin);
  if (ctx.authMode === 'secret') { // il Cron aspetta al massimo 5 secondi: risponde subito e lavora in sottofondo
    // @ts-ignore EdgeRuntime è fornito da Supabase
    EdgeRuntime.waitUntil(work);
    return json({ started: true }, 202);
  }
  const r = await work;
  return json(r, r.error ? 500 : 200);
});

export default { fetch: (req: Request) => (req.method === 'OPTIONS' ? json('ok') : handler(req)) };
