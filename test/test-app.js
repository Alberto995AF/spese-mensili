// Test automatici di Spese Mensili.
// Uso:  node test/test-app.js
// Importazione degli estratti (i casi che in passato hanno dato errori), salvadanai e salvataggio su Supabase (simulato).
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const PAGES = ['index.html'];

// un DOM finto che accetta qualunque chiamata: la pagina si carica senza browser
function fakeEl() {
  return new Proxy(function () {}, {
    get: (t, k) => k === Symbol.iterator ? function* () {} : k === Symbol.toPrimitive ? () => '' :
      k === 'value' || k === 'innerHTML' || k === 'textContent' ? '' : k === 'files' ? [] : fakeEl(),
    set: () => true, apply: () => fakeEl(),
  });
}
function loadPage(file) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const js = html.split('<script>')[1].split('</script>')[0]; // lo script dell'app (gli altri hanno src)
  const doc = { querySelector: () => fakeEl(), querySelectorAll: () => [], getElementById: () => fakeEl(),
    addEventListener() {}, createElement: () => fakeEl(), head: fakeEl(), body: fakeEl(), activeElement: null, documentElement: fakeEl() };
  const store = {};
  const ctx = { document: doc, console: { log: console.log, warn() {}, error() {} }, setTimeout, clearTimeout, setInterval: () => 0, Intl, Date, Math, JSON, Promise, Map, Set,
    TextDecoder, Uint8Array, Blob: class {}, URL: { createObjectURL: () => '' }, addEventListener() {}, scrollTo() {}, innerWidth: 1000,
    confirm: () => true, alert() {}, location: { protocol: 'file:', origin: '', pathname: '/' }, localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v } } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(js + '\n;globalThis.__t={get S(){return S},set S(v){S=v},get IMP(){return IMP},set IMP(v){IMP=v},buildItems,reconcile,parseCSV,guessHeader,guessMap,scanFigures,impCheck,mergeSigns,PDF_AMT,parseNum,spendByAccount,stmtMonth,yearData,merchantKey,doImport,catBreakdown,jarBalance,savedIn,jarForecast,viewJar,guessCat,DB,setRemote,resetRemote,applyRemote,save,parseTRHoldings,invRows,invTotals,defaultNewsQuery,guessKind,parseTRTrade,posStats,tradeStatus,syncPositions};', ctx);
  return ctx.__t;
}

// prepara un'importazione da CSV come farebbe la pagina
function importa(t, csv, account) {
  const rows = t.parseCSV(csv), hdr = t.guessHeader(rows), map = t.guessMap(rows, hdr);
  t.IMP = { figs: t.scanFigures(rows, hdr, map), file: 'test.csv', rows, hdr, map, invert: false, fmt: 'dmy', account };
  t.buildItems();
  return t.IMP.items;
}
const mov = (id, date, desc, amount, account, extra = {}) => ({ id, date, desc, amount, type: 'uscita', cat: '', account, note: '', ...extra });
const ALB = 'Carta Nexi ****1111', CIN = 'Carta Nexi ****2222';

// client Supabase finto: registra upsert e delete, risponde con le righe date
function fakeSb({ rows = [], fail = null } = {}) {
  const sb = { calls: [], rows };
  const res = v => Promise.resolve(fail ? { error: fail } : { data: v, error: null });
  sb.from = () => ({
    select: () => { const q = { order: () => q, range: () => { sb.calls.push(['load']); return Promise.resolve({ data: sb.rows, error: null }) } }; return q },
    upsert: r => { sb.calls.push(['upsert', r]); return res(null) },
    delete: () => { const q = { kind: null, eq: (c, v) => (q.kind = v, q), in: (c, ids) => { sb.calls.push(['delete', q.kind, ids]); return res(null) } }; return q },
  });
  return sb;
}
function connect(t, sb, rows = []) {
  Object.assign(t.DB, { sb, user: { email: 'a@b.it' }, state: 'ok', ready: true, ro: false, pending: 0 });
  t.resetRemote(); rows.forEach(r => t.setRemote(r.kind, r.id, r.data)); t.applyRemote();
}

const CASES = [
  ['stesso giorno e importo su UN\'ALTRA CARTA non è un doppione', t => {
    t.S.movements = [mov('c1', '2026-08-07', 'Farmacia Comunale', 20, CIN)];
    const it = importa(t, 'Data;Descrizione;Importo\n07/08/2026;Distributore Beyfin Firenze;-20,00', ALB);
    return it[0].dup === '' && it[0].sel;
  }],
  ['stesso giorno e importo SUL CONTO non è un doppione della carta', t => {
    t.S.movements = [mov('k1', '2026-09-22', 'Trade republic PAC', 30, '')];
    const it = importa(t, 'Data;Descrizione;Importo\n22/09/2026;Distributore Beyfin Firenze;-30,00', ALB);
    return it[0].dup === '' && it[0].sel;
  }],
  ['reimportare lo stesso estratto non crea doppioni', t => {
    t.S.movements = [mov('a1', '2026-08-01', 'Miho Sushi Prato', 73.8, ALB), mov('a2', '2026-08-02', 'Quaglia Selene Prato', 11.5, ALB)];
    const it = importa(t, 'Data;Descrizione;Importo\n01/08/2026;Miho Sushi Prato;-73,80\n02/08/2026;Quaglia Selene Prato;-11,50', ALB);
    return it.every(x => x.dup === 'si' && !x.sel);
  }],
  ['due spese identiche nello stesso giorno: se una c\'è già, l\'altra entra', t => {
    t.S.movements = [mov('a1', '2026-08-19', 'Esso Firenze', 20, ALB)];
    const it = importa(t, 'Data;Descrizione;Importo\n19/08/2026;Esso Firenze;-20,00\n19/08/2026;Esso Firenze;-20,00', ALB);
    return it.filter(x => x.dup === 'si').length === 1 && it.filter(x => x.sel).length === 1;
  }],
  ['un "forse doppione" sulla stessa carta resta selezionato', t => {
    t.S.movements = [mov('a1', '2026-08-10', 'Tecnomat Pisa', 3.6, ALB)];
    const it = importa(t, 'Data;Descrizione;Importo\n10/08/2026;Bricoman Italia Srl Pisa;-3,60', ALB);
    return it[0].dup === 'forse' && it[0].sel;
  }],
  ['la riconciliazione torna quando il totale coincide', t => {
    t.S.movements = [];
    importa(t, 'Data;Descrizione;Importo\n01/09/2026;A;-10,00\n02/09/2026;B;-5,50\nTOTALE SPESE;;15,50', ALB);
    return t.reconcile().status === 'ok';
  }],
  ['la riconciliazione segnala una riga mancante', t => {
    t.S.movements = [];
    importa(t, 'Data;Descrizione;Importo\n01/09/2026;A;-10,00\nTOTALE SPESE;;15,50', ALB);
    return t.reconcile().status === 'diff';
  }],
  ['saldo finale − saldo iniziale = entrate − uscite', t => {
    t.S.movements = [];
    importa(t, 'Saldo iniziale;;2.000,00\nData;Descrizione;Importo\n02/09/2026;ADDEBITO NEXI;-1.498,71\n10/09/2026;STIPENDIO;2.150,00\nSaldo finale;;2.651,29', '');
    return t.reconcile().status === 'ok';
  }],
  ['dopo l\'importazione, un movimento cancellato fa scattare l\'avviso', t => {
    t.S.movements = [mov('x1', '2026-09-01', 'A', 10, ALB, { imp: 'i1' })];
    const i = { id: 'i1', account: ALB, stmt: { label: 'TOTALE SPESE', value: 15.5, what: 'somma delle uscite' } };
    const c = t.impCheck(i);
    return !c.ok && c.diff === -5.5;
  }],
  ['PDF: il meno staccato dal numero ("- 12,99") è uno storno', t => {
    const it = t.mergeSigns([{ s: 'Amazon Luxembourg', x: 100, w: 120 }, { s: '-', x: 400, w: 4 }, { s: '12,99', x: 408, w: 25 }]);
    return it.length === 2 && t.PDF_AMT.test(it[1].s) && t.parseNum(it[1].s) === -12.99 && t.parseNum('- 2,99') === -2.99 && t.parseNum('\u221212,99') === -12.99;
  }],
  ['gli storni riducono la spesa della carta (totale = estratto conto)', t => {
    t.S.movements = [mov('a', '2026-09-01', 'Unicoop', 100, CIN), mov('b', '2026-09-11', 'Amazon storno', 12.99, CIN, { type: 'entrata' }),
      mov('c', '2026-09-05', 'Stipendio', 2000, '', { type: 'entrata' }), mov('d', '2026-09-06', 'Affitto', 700, '')];
    const r = t.spendByAccount('2026-09-01', '2026-09-30');
    return r.cards[0].t === 87.01 && r.conti.t === 700;
  }],
  ['estratto carta di ottobre con spese del 30/09: tutto conta a ottobre', async t => {
    t.S.movements = [];
    const csv = 'Data;Descrizione;Importo\n30/09/2026;Deichmann Calzature;-87,08\n30/09/2026;Iper Prato;-4,13\n01/10/2026;Booking.Com;-80,10\n14/10/2026;Unicoop - Firenze;-93,42\n21/10/2026;D176 Empoli;19,95';
    importa(t, csv, ALB);
    if (t.stmtMonth(t.IMP.items) !== '2026-10' || t.IMP.mese !== '2026-10') return false;
    await t.doImport();
    const y = t.yearData(2026), sp = t.spendByAccount('2026-10-01', '2026-10-31');
    // a settembre non resta niente della carta, a ottobre c'è tutto (storno sottratto) e le date restano quelle vere
    return y[8].outR === 0 && Math.round(y[9].outR * 100) === 26473 && sp.cards[0].t === 244.78
      && t.S.movements.filter(m => m.date === '2026-09-30').every(m => m.mese === '2026-10')
      && t.S.movements.filter(m => m.date.startsWith('2026-10')).every(m => !m.mese);
  }],
  ['un estratto del conto di più mesi NON viene spostato in un mese solo', t => {
    t.S.movements = [];
    importa(t, 'Data;Descrizione;Importo\n02/08/2026;A;-10,00\n15/09/2026;B;-10,00\n20/10/2026;C;-10,00', '');
    return t.IMP.mese === '' && t.stmtMonth(t.IMP.items) === '';
  }],
  ['prospetto per esercente: nomi raggruppati', t =>
    t.merchantKey('Unicoop - Firenze Firenze') === 'UNICOOP FIRENZE' && t.merchantKey('Paypal Spotify P484de 35314369001 S') === 'SPOTIFY'
      && t.merchantKey('Mc.Donald S Empoli Empoli') === 'MC DONALD' && t.merchantKey('Pam Panorama Fornacett Empoli') === 'PAM PANORAMA'],
  ['salvadanaio: mettere da parte non è una spesa, e il saldo si aggiorna', t => {
    t.S.jars = [{ id: 'v', name: 'Vacanze', goal: 3000, start: 500, color: '#d97706' }];
    t.S.movements = [mov('a', '2026-11-02', 'Salvadanaio Vacanze', 200, '', { cat: 'jar:v' }),
      mov('b', '2026-11-20', 'Prelievo dal salvadanaio Vacanze', 50, '', { cat: 'jar:v', type: 'entrata' }),
      mov('c', '2026-11-05', 'Unicoop', 80, '')];
    const y = t.yearData(2026), sp = t.spendByAccount('2026-11-01', '2026-11-30'), s = t.savedIn('2026-11-01', '2026-11-30');
    return y[10].outR === 80 && y[10].inR === 0 && sp.conti.t === 80 && t.jarBalance(t.S.jars[0]) === 650 && s.r === 150
      && t.viewJar().includes('Vacanze');
  }],
  ['salvadanaio: il versamento ricorrente fa crescere la previsione', t => {
    t.S.jars = [{ id: 'e', name: 'Emergenze', goal: 0, start: 0, color: '#0891b2' }];
    t.S.movements = [];
    const today = new Date(), y = today.getFullYear(), pad = n => String(n).padStart(2, '0');
    const start = `${y}-${pad(today.getMonth() + 1)}-28`;
    t.S.recurring = [{ id: 'r', name: 'Salvadanaio Emergenze', type: 'uscita', amount: 100, freq: 'm', start, end: '', cat: 'jar:e', account: '', paused: false, skip: [] }];
    const months = 12 - today.getMonth(); // da questo mese a dicembre compresi
    return t.jarForecast(t.S.jars[0], `${y}-12-31`) === 100 * (today.getDate() > 28 ? months - 1 : months) && t.yearData(y).every(b => b.outF === 0);
  }],
  ['salvadanaio imparato: la stessa descrizione torna nel salvadanaio', t => {
    t.S.jars = [{ id: 'v', name: 'Vacanze', goal: 0, start: 0, color: '#d97706' }];
    t.S.learn = { 'GIROCONTO DEPOSITO': 'jar:v' };
    return t.guessCat('Giroconto deposito risparmi', 'uscita') === 'jar:v';
  }],
  // ---------- salvataggio su Supabase (client finto che registra le chiamate) ----------
  ['Supabase: un movimento nuovo diventa una riga, le categorie si salvano la prima volta', async t => {
    const sb = fakeSb(); connect(t, sb);
    t.S.movements.push(mov('m1', '2026-11-03', 'Unicoop', 42.5, ''));
    t.save(); await t.DB.q;
    const ups = sb.calls.filter(c => c[0] === 'upsert').flatMap(c => c[1]);
    return ups.some(u => u.kind === 'mov' && u.id === 'm1' && u.data.amount === 42.5) && ups.some(u => u.kind === 'cfg' && u.id === 'categories')
      && sb.calls.every(c => c[0] !== 'delete');
  }],
  ['Supabase: modificare un movimento manda solo quella riga', async t => {
    const sb = fakeSb(); connect(t, sb, [{ kind: 'mov', id: 'm1', data: mov('m1', '2026-11-03', 'Unicoop', 42.5, '') }, { kind: 'mov', id: 'm2', data: mov('m2', '2026-11-04', 'Pam', 10, '') }, { kind: 'cfg', id: 'categories', data: { list: t.S.categories, catVer: 2 } }]);
    t.S.movements.find(m => m.id === 'm1').amount = 45; t.save(); await t.DB.q;
    const ups = sb.calls.filter(c => c[0] === 'upsert').flatMap(c => c[1]);
    return ups.length === 1 && ups[0].id === 'm1' && ups[0].data.amount === 45;
  }],
  ['Supabase: eliminare un movimento cancella la sua riga', async t => {
    const sb = fakeSb(); connect(t, sb, [{ kind: 'mov', id: 'm1', data: mov('m1', '2026-11-03', 'Unicoop', 42.5, '') }, { kind: 'cfg', id: 'categories', data: { list: t.S.categories, catVer: 2 } }]);
    t.S.movements = []; t.save(); await t.DB.q;
    return sb.calls.length === 1 && sb.calls[0][0] === 'delete' && sb.calls[0][1] === 'mov' && sb.calls[0][2].join() === 'm1';
  }],
  ['Supabase: una modifica arrivata dall\'altro telefono non viene rimandata indietro', async t => {
    const sb = fakeSb(); connect(t, sb, [{ kind: 'cfg', id: 'categories', data: { list: t.S.categories, catVer: 2 } }]);
    t.setRemote('mov', 'x9', mov('x9', '2026-11-05', 'Bolletta', 80, '')); t.applyRemote();
    t.S.movements.push(mov('m3', '2026-11-06', 'Pizzeria', 30, '')); t.save(); await t.DB.q;
    const ups = sb.calls.filter(c => c[0] === 'upsert').flatMap(c => c[1]);
    return t.S.movements.length === 2 && ups.length === 1 && ups[0].id === 'm3';
  }],
  ['Supabase: senza permesso la pagina passa in sola lettura e ricarica i dati', async t => {
    const sb = fakeSb({ fail: { code: '42501', message: 'new row violates row-level security policy' } }); connect(t, sb, [{ kind: 'cfg', id: 'categories', data: { list: t.S.categories, catVer: 2 } }]);
    t.S.movements.push(mov('m4', '2026-11-06', 'Pizzeria', 30, '')); t.save(); await t.DB.q;
    await new Promise(r => setTimeout(r, 20));
    return t.DB.ro === true && sb.calls.some(c => c[0] === 'load');
  }],
  // ---------- investimenti (numeri inventati) ----------
  ['Trade Republic: legge le posizioni dell\'estratto del patrimonio e i conti tornano', t => {
    const lines = ['ESTRATTO DEL PATRIMONIO', 'al giorno 02.03.2026', 'PZ / NOMINALE NOME DEL TITOLO PREZZO AL PEZZO VALORE IN EUR',
      '10 pezzi Esempio S.p.A. 5,00 50,00', 'Azioni nom. EO 1 02.03.2026', 'ISIN: IT0000000001', 'Luogo di custodia: Italia',
      '0,5 pezzi World Index USD (Acc) 1.200,00 600,00', 'ISIN: IE0000000002 02.03.2026',
      '2,25 pezzi Example Corp. 100,00 225,00', 'Registered Shares DL-,001 02.03.2026', 'ISIN: US0000000003',
      'NUMERO DI POSIZIONI: 3 875,00 EUR'];
    const r = t.parseTRHoldings(lines);
    return r.date === '2026-03-02' && r.positions.length === 3 && r.total === 875 && r.sum === 875
      && r.positions[1].qty === 0.5 && r.positions[1].price === 1200 && r.positions[1].isin === 'IE0000000002'
      && t.guessKind(r.positions[1].name) === 'etf' && t.guessKind(r.positions[0].name) === 'azione';
  }],
  ['investimenti: valore, guadagno e variazione del giorno', t => {
    t.resetRemote();
    t.S.positions = [{ id: 'IT0000000001', isin: 'IT0000000001', name: 'Esempio', kind: 'azione', qty: 10, avg: 4, refPrice: 5 },
      { id: 'IE0000000002', isin: 'IE0000000002', name: 'World', kind: 'etf', qty: 2, avg: null, refPrice: 100 }];
    t.setRemote('mkt', 'IT0000000001', { price: 6, changePct: 20 }); // ieri 5, oggi 6
    const x = t.invTotals();
    return x.value === 260 && x.cost === 40 && x.pl === 20 && x.missingAvg === 1 && x.day === 10;
  }],
  ['investimenti: il titolo si salva come riga "inv" su Supabase', async t => {
    const sb = fakeSb(); connect(t, sb, [{ kind: 'cfg', id: 'categories', data: { list: t.S.categories, catVer: 2 } }]);
    t.S.positions = [{ id: 'IE0000000002', isin: 'IE0000000002', name: 'World', kind: 'etf', qty: 2, avg: 90 }];
    t.save(); await t.DB.q;
    const ups = sb.calls.filter(c => c[0] === 'upsert').flatMap(c => c[1]);
    return ups.length === 1 && ups[0].kind === 'inv' && ups[0].data.qty === 2 && ups[0].data.avg === 90;
  }],
  ['notizie: ricerca proposta dal nome del titolo', t =>
    t.defaultNewsQuery('Example Corp.', 'azione') === 'Example azioni' && t.defaultNewsQuery('Esempio S.p.A.', 'azione') === 'Esempio azioni'
      && t.defaultNewsQuery('Core MSCI World USD (Acc)', 'etf') === 'MSCI World'],
  // ---------- registro delle operazioni (numeri inventati) ----------
  ['conferma d\'esecuzione: piano d\'accumulo letto come acquisto (anche col piè di pagina sulle "vendite")', t => {
    const r = t.parseTRTrade(['DATA 10.03.2026', 'ESECUZIONE ab12-cd34', 'PIANO DI ACCUMULO 1111-2222',
      "Esecuzione del piano d'accumulo il 10.03.2026 su Lang und Schwarz Exchange.",
      'POSIZIONE QUANTITÀ PREZZO MEDIO IMPORTO', 'World Index USD (Acc) 0,5 Pz. 40,00 EUR 20,00 EUR', 'ISIN: IE0000000002', 'TOTALE 20,00 EUR',
      "Se non viene mostrata l'IVA, si tratta di un servizio esente da imposte sulle vendite in conformità con la regolamentazione UStG § 4 n. 8."]);
    return r.ok && r.type === 'buy' && r.date === '2026-03-10' && r.ref === 'ab12-cd34' && r.qty === 0.5 && r.price === 40 && r.amount === 20 && r.isin === 'IE0000000002';
  }],
  ['conferma d\'esecuzione: vendita con commissione e tasse', t => {
    const r = t.parseTRTrade(['DATA 05.06.2026', 'ESECUZIONE ee11-ff22', "Esecuzione dell'ordine di vendita il 05.06.2026.",
      'Example Corp. 2 Pz. 150,00 EUR 300,00 EUR', 'ISIN: US0000000003', 'Commissione esterna -1,00 EUR', 'Imposta sostitutiva -13,00 EUR', 'TOTALE 286,00 EUR']);
    return r.ok && r.type === 'sell' && r.fees === 1 && r.taxes === 13 && r.total === 286;
  }],
  ['prezzo medio ponderato, vendita e dividendo', t => {
    t.S.trades = [
      { id: 'a', pos: 'X', date: '2026-01-01', type: 'open', qty: 10, price: 100, fees: 0, taxes: 0 },
      { id: 'b', pos: 'X', date: '2026-02-01', type: 'buy', qty: 10, price: 120, fees: 1, taxes: 0 },   // costo 1000 + 1201 = 2201 su 20 quote
      { id: 'c', pos: 'X', date: '2026-03-01', type: 'sell', qty: 5, price: 130, fees: 1, taxes: 10 },  // costo medio 110,05
      { id: 'd', pos: 'X', date: '2026-04-01', type: 'div', qty: 0, price: null, amount: 20, fees: 0, taxes: 5.2 }];
    const s = t.posStats('X');
    return s.qty === 15 && s.avg === 110.05 && s.realized === 88.75 && s.divs === 14.8;
  }],
  ['import: operazione già importata o già compresa nella situazione iniziale', t => {
    t.S.trades = [{ id: 'o', pos: 'IE0000000002', date: '2026-03-10', type: 'open', qty: 3, price: null, fees: 0, taxes: 0 },
      { id: 'p', pos: 'IE0000000002', date: '2026-03-20', type: 'buy', qty: 1, price: 40, fees: 0, taxes: 0, ref: 'aa11-bb22' }];
    const base = { ok: true, isin: 'IE0000000002', type: 'buy', qty: 1, price: 40, amount: 40 };
    return t.tradeStatus({ ...base, date: '2026-03-09', ref: 'zz99-yy88' }).key === 'before'
      && t.tradeStatus({ ...base, date: '2026-03-20', ref: 'aa11-bb22' }).key === 'dup'
      && t.tradeStatus({ ...base, date: '2026-03-25', ref: 'cc33-dd44' }).key === 'new';
  }],
  ['le quantità del titolo seguono le operazioni', t => {
    t.S.positions = [{ id: 'X', isin: 'X', name: 'X', kind: 'etf', qty: 99, avg: 1 }];
    t.S.trades = [{ id: 'a', pos: 'X', date: '2026-01-01', type: 'open', qty: 2, price: 50, fees: 0, taxes: 0 },
      { id: 'b', pos: 'X', date: '2026-02-01', type: 'buy', qty: 2, price: 70, fees: 0, taxes: 0 }];
    t.syncPositions();
    return t.S.positions[0].qty === 4 && t.S.positions[0].avg === 60;
  }],
];

let failed = 0;
(async () => {
  for (const page of PAGES) {
    console.log(`\n${page}`);
    for (const [name, fn] of CASES) {
      let ok = false, err = '';
      try { const t = loadPage(page); await new Promise(r => setTimeout(r, 20)); /* lascia finire l'avvio della pagina */ ok = await fn(t) } catch (e) { err = ' — ' + e.message }
      console.log(`  ${ok ? '✔' : '✖'} ${name}${err}`);
      if (!ok) failed++;
    }
  }
  console.log(failed ? `\n${failed} test falliti` : '\nTutti i test superati');
  process.exit(failed ? 1 : 0);
})();
