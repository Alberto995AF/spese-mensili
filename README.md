# 💶 Spese Mensili

Entrate e uscite di famiglia, da PC e da iPhone, con i dati in un database condiviso.
Si installa sulla schermata Home come un'app (PWA), come Cantina.

## Cosa fa

- **Riepilogo**: entrate, uscite e saldo del mese e dell'anno, anche previsti (dalle voci ricorrenti), andamento annuale, spese per categoria, **dove avete speso** (per esercente) e **spese per carta e conto**.
- **Importa estratti**: CSV, Excel e PDF (estratti Nexi compresi). Riconosce carta e titolare, propone le categorie e fa la **riconciliazione** con i totali del documento. Le spese della carta contano nel mese dell'estratto.
- **Ricorrenti**: stipendio, affitto, bollette… con le previsioni dei mesi futuri.
- **Salvadanai**: soldi messi da parte, con obiettivo e versamenti ricorrenti. Non contano come spesa.
- **Dati**: backup JSON, esportazione CSV per Excel.
- **Investimenti**: titoli in portafoglio (import dell'*Estratto del patrimonio* di Trade Republic), valore, guadagno sul prezzo medio, ripartizione, andamento e notizie in italiano su ogni titolo. Prezzi da Tradegate (euro, per ISIN) e CoinGecko, notizie da Google News: li aggiorna ogni sera la funzione `supabase/functions/aggiorna-mercati` (Cron di Supabase) e il pulsante *Aggiorna ora*.

## Dove sono i dati

In un progetto **Supabase** (database Postgres gratuito). Leggono e scrivono solo gli account con l'email nella tabella `members`: lo impongono le regole del database (`supabase/schema.sql`), non l'app.
Ogni dispositivo tiene anche una copia: l'app si apre subito e si consulta senza rete (in sola lettura).

`config.js` contiene l'indirizzo del progetto e la chiave **publishable**: è fatta per stare nel codice di un sito pubblico, quindi può finire su GitHub. Non mettere mai qui una chiave *secret* o `service_role`.

## Prima configurazione

Già fatta per il progetto `spese-mensili` (organizzazione *Famiglia*). I passaggi restano qui per riferimento.

### 1. Supabase
1. Crea un account su [supabase.com](https://supabase.com) e un progetto nuovo (regione **Frankfurt**, piano Free). Conserva la password del database.
2. **SQL Editor → New query**: incolla `supabase/schema.sql` e premi **Run**.
3. **Authentication → Users → Add user → Create new user**: crea un utente per persona, con email e password, spuntando **Auto Confirm User**. Poi aggiungi le loro email a `members` con la riga in fondo a `schema.sql`.
4. **Authentication → Sign In / Providers**: disattiva **Allow new users to sign up**. Così nessun altro può crearsi un account.
5. **Authentication → URL Configuration**: in *Site URL* metti l'indirizzo dell'app su GitHub Pages (serve per l'email di "Password dimenticata").
6. **Project Settings → API Keys**: copia l'indirizzo del progetto e la chiave *publishable* in `config.js`.

### 2. GitHub Pages
1. Carica i file in un repository GitHub.
2. *Settings → Pages → Build and deployment*: Source "Deploy from a branch", branch `main`, cartella `/ (root)`.
3. Dopo un minuto l'app è su `https://<utente>.github.io/<repo>/`.

## Installazione su iPhone

1. Apri l'indirizzo in **Safari** e accedi.
2. **Condividi → Aggiungi alla schermata Home**.
3. Aprila dall'icona: parte a tutto schermo.

## Portare i dati dalla versione su claude.ai

Nella vecchia pagina: *Dati e salvataggio → Esporta tutto (JSON)*. Qui: *Dati e salvataggio → Importa da JSON*.

## Sviluppo

- Dopo ogni modifica: `node test/test-app.js` (importazione, riconciliazione, salvadanai, salvataggio su Supabase simulato).
- Prima di pubblicare una nuova versione, aumenta `VERSION` in `sw.js`: così i telefoni scaricano l'aggiornamento.
- Icone: `node tools/make-icons.js`.

## Struttura

```
index.html            l'app (interfaccia, logica, accesso, salvataggio su Supabase)
config.js             indirizzo e chiave pubblica del progetto Supabase
manifest.webmanifest  manifest PWA
sw.js                 service worker (apertura senza rete)
vendor/supabase.js    supabase-js 2.119.2
supabase/schema.sql   tabelle e regole di accesso del database
icons/                icone dell'app
test/test-app.js      test automatici
tools/make-icons.js   disegna le icone
```
