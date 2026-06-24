# OrderWatch — Note di implementazione per Graphic Center Group Srl

Compilato a partire dal form di onboarding (giugno 2026). Questo documento integra,
per questo cliente specifico, le sezioni 4-10 di `ORDERWATCH_BASE_KIT.md` del kit
base. Dove un'informazione non era disponibile nel form e' stata fatta un'ipotesi
ragionevole, sempre segnalata come **DA CONFERMARE**.

## 1. Anagrafica

- Azienda: Graphic Center Group Srl — stampa offset e digitale, grafica, materiali
  per display e segnaletica.
- Sedi: Via Casteldefino 19/F, Torino (amministrativa) — Via Lungo Dora Voghera 34,
  Torino (produttiva).
- Utenti previsti: responsabile commerciale/operativo (titolare, ruolo admin),
  addetto acquisti (ruolo buyer), pianificazione produzione (ruolo viewer).
- **DA CONFERMARE**: nome ed email del referente, logo, palette colori.

## 2. Terminologia applicata (`src/config/customer.config.js`)

| Concetto kit | Etichetta Graphic Center |
|---|---|
| Commesse/Projects | Lavori (LAV-XXX) |
| Ordini fornitori | Ordini materiali (GCG-XXX interno + numero fornitore) |
| Materiale | Materiale (carta, cartoncino, pannelli, inchiostri, lastre, vinile, forex) |
| Data consegna promessa | Data partenza prevista |
| Scadenza lavoro | Data richiesta (campo `requiredDate`, es. apertura fiera/evento) |

Codici ordine: GCG-XXX e' l'identificativo interno Graphic Center; il numero
ordine del fornitore (es. 13974707 Fedrigoni, 399863 Sunclear) va salvato nel
campo Airtable `Supplier Order Ref` e mostrato nel pannello dettaglio ordine
(gia' implementato in `OrderDetailPanel.jsx`, riga "Rif. fornitore").

## 3. Mapping Airtable

Rispetto al modello dati standard del kit (`ORDERWATCH_BASE_KIT.md`, sezione 3-4),
per Graphic Center Group:

- **Orders**: aggiungere il campo `Supplier Order Ref` (single line text) per il
  numero ordine assegnato dal fornitore — non sostituisce `Order ID` (GCG-XXX),
  lo affianca.
- **Orders.Promised Date**: attenzione, non tutti i fornitori indicano una data
  certa — spesso "entro fine settimana" o "disponibilita' prevista". Quando il
  testo e' ambiguo, l'estrazione deve restituire la data piu' probabile **e**
  forzare `needs_human_review = true` (vedi sezione 5).
- **Projects**: il campo `Required Date` qui rappresenta una scadenza spesso
  fissa e non negoziabile (fiera, evento, apertura punto vendita) — a differenza
  di molti settori manifatturieri dove puo' slittare, qui va trattato come hard
  deadline nei messaggi di alert/escalation.
- **Suppliers**: nessuno storico di puntualita' disponibile a oggi. Lasciare
  `On Time Rate` e `Risk Level` vuoti finche' `SupplierScorecard` non avra'
  calcolato almeno un periodo di dati reali (evitare di pre-popolare con stime).
- **Documents**: la confidence di estrazione varia molto per fornitore per il
  layout del PDF — Fedrigoni (tabellare professionale) e' risultato ~97%+,
  Sunclear (layout piu' semplice) ~93%+ sui 2 campioni analizzati. Da
  confermare su un campione piu' ampio durante il pilota.

## 4. Make.com — adattamenti per Graphic Center

### Scenario 1 — Acquisizione documenti

- Trigger: **IMAP Watch Emails** (non Gmail/Outlook). Configurazione:
  - Host: `imap.hostinger.com`
  - Porta: `993`
  - Sicurezza: SSL
  - Cartella dedicata da creare per le conferme ordine (azione concordata col
    cliente, sezione 10.4 onboarding — non toccare la gestione email esistente).
- Nessuna integrazione ERP: il gestionale contabile interno resta consultato
  solo occasionalmente, OrderWatch lavora in parallelo senza scrivere su di
  esso.
- Router per confidence: data la differenza di layout tra fornitori, impostare
  la soglia standard del kit (`< 0.85` -> revisione umana) ma monitorare nel
  pilota se Sunclear (93%+ sui campioni visti) scende sotto soglia su documenti
  reali diversi dai 2 campioni analizzati.

### Scenario 2 — Controllo scadenze giornaliero

- Soglie applicate (vedi `alertRules` in `customer.config.js`):
  - Attenzione: 5 giorni prima della data partenza prevista.
  - Critico: 2 giorni prima.
  - Scaduto: data partenza superata.
- Soglie ipotizzate per il settore stampa (scadenze molto ravvicinate) —
  **DA CONFERMARE** con il cliente durante il pilota, in particolare se 5 giorni
  risultano troppo "rumorosi" con 20-50 ordini/mese stimati.

### Scenario 3 — Sollecito fornitore

- **Human-in-the-loop obbligatorio**: il responsabile ha rapporti diretti e
  personali con i fornitori storici. Nessun sollecito automatico esce senza
  approvazione esplicita — Make deve creare la bozza (Reminder con
  `Status = draft`, da aggiungere come stato extra rispetto a
  `sent/failed/replied` del kit base) e notificare il responsabile, che approva
  o modifica il testo prima dell'invio.
- Primo sollecito: 3 giorni prima della data partenza prevista.
- Canale: email (Hostinger). WhatsApp Business indicato come canale secondario
  gradito dal settore — **non incluso in questa V1**, da valutare come modulo
  successivo se il pilota va bene.
- Teams non utilizzato: tutte le notifiche interne via email.
- Storico solleciti: mantenere sempre il log in `Activities`/`Reminders` per
  tracciabilita' verso il cliente finale.

### Scenario 4 — Report

- Destinatario unico nella V1: il responsabile commerciale/operativo (che e'
  anche il titolare). Nessuna distribuzione a piu' ruoli per ora.

## 5. Prompt AI — note specifiche

Il prompt di sistema e lo schema JSON del kit base restano validi senza
modifiche. Punti di attenzione per Graphic Center:

- Layout fornitori molto diversi (Fedrigoni tabellare vs Sunclear semplice):
  testare il prompt su entrambi i formati nel campione dei 5 documenti reali
  previsto dalla checklist di onboarding, non solo su uno dei due.
- Campo `Vs/Rif` nei documenti fornitore corrisponde al riferimento lavoro
  interno (`project_code` / LAV-XXX) — va mappato esplicitamente nel prompt se
  i fornitori lo usano in modo riconoscibile.
- Date scritte come "entro fine settimana" o "disponibilita' prevista" sono il
  caso ambiguo piu' frequente segnalato dal cliente: vanno sempre estratte con
  `warnings` popolato e `needs_human_review = true`, mai assunte come certe.
- Soglia di confidence per revisione automatica: 0.85 (default del kit),
  confermata come adeguata dal cliente.

## 6. Ruoli e permessi

| Ruolo Graphic Center | Ruolo kit (`permissions.js`) | Vede | Modifica |
|---|---|---|---|
| Responsabile commerciale/operativo | `admin` | Tutto | Tutto |
| Addetto acquisti | `buyer` | Ordini, lavori, azioni | Stato ordini, ricezione materiale, solleciti |
| Produzione | `viewer` | Stato lavori (sola lettura) | Nessuna |

Il titolare coincide con la vista direzione: non e' previsto un ruolo separato.

## 7. Piano pilota

- Durata: 30 giorni, gratuito (accordo informale per validare il prodotto).
- Perimetro: tutti gli ordini attivi al go-live (stima 20-40), fornitori
  principali (Fedrigoni, Sunclear, Cartaria Subalpina, Burgo, Antalis, Sun
  Chemical, Litohelio).
- Obiettivo dichiarato dal titolare: *"Ogni mattina apro una schermata e so
  subito cosa e' a rischio per i lavori in corso."*
- KPI di successo: percentuale ordini tracciati automaticamente vs totale,
  solleciti inviati puntualmente, materiali ricevuti registrati, tempo
  risparmiato sulla gestione a memoria.
- Rischio principale da evitare: solleciti automatici non approvati che
  danneggiano rapporti storici con i fornitori — per questo l'approvazione
  umana sul testo dei solleciti non e' negoziabile in questa fase.
- Decisione di proseguimento: titolare/amministratore unico.
- Budget post-pilota target: 149-249 EUR/mese (piano Base o Standard).

## 8. Dati ancora da raccogliere prima del go-live

- Nome ed email del referente progetto.
- Logo (palette colori "Ink & Paper" confermata e applicata in
  `customer.config.js` — vedi sezione 11).
- Liste reali: fornitori con email ordini, ordini aperti correnti, lavori
  attivi (oggi nel frontend ci sono solo i 3 scenari demo + 1 generico).
- Conferma soglie alert (5/2/0 giorni) e giorni di sollecito (3) con il
  responsabile.
- Verifica export CSV/Excel dal gestionale contabile, se utile per
  l'importazione iniziale ordini/fornitori in Airtable.
- Vincoli privacy: dati fornitori non sensibili GDPR, ma l'email del
  responsabile e' un dato personale — verificare se serve un DPA con chi
  gestira' Airtable/Make per conto del cliente.

## 9. Stato del frontend in questa cartella

Il frontend in questa cartella usa dati mock (`src/data/*`) che riproducono i 3
esempi reali indicati per la demo (Fedrigoni/fiera concluso, Sunclear/evento "To
Be" critico senza risposta, carta/catalogo Florim con sollecito in attesa di
approvazione). Non e' ancora collegato ad Airtable: il passaggio si fa
sostituendo l'adapter mock con `src/adapters/airtableAdapter.js` in `App.jsx`,
una volta raccolti i dati della sezione 8.

## 10. Base Airtable reale (creata)

La base e' stata creata nel workspace Airtable dell'utente:

- Nome: **OrderWatch - Graphic Center Group**
- Base ID: `appDoRPzXLmmwc6Zp`
- Workspace: "My First Workspace" (`wspSFhuXv5Muglstp`)

Tabelle create, con gli stessi 4 ordini / 4 lavori / 9 fornitori / 4 documenti /
6 attivita' / 2 reminder gia' presenti nei mock data, cosi' la demo e la base
sono identiche:

| Tabella | Contenuto |
|---|---|
| Suppliers | 9 fornitori, categoria e ordini aperti compilati. Email, On Time Rate, Risk Level e Score lasciati vuoti/"N/D" - nessun dato storico reale disponibile. |
| Projects | 4 lavori (LAV-012, LAV-018, LAV-030, LAV-034) con stato e data partenza prevista. |
| Orders | 4 ordini (GCG-101, GCG-118, GCG-124, GCG-130) con tutti i campi del modello standard, incluso il campo aggiuntivo "Supplier Order Ref". "Days Remaining" e' una formula (`DATETIME_DIFF` su Due Date). |
| Documents | 4 documenti con confidence AI e flag di revisione. |
| Activities | 6 voci di log identiche a `mockActivities.js`. |
| Reminders | Nuova tabella per Graphic Center: 1 sollecito "sent" (GCG-118) e 1 "draft" in attesa di approvazione (GCG-124), per supportare il flusso human-in-the-loop richiesto. |
| Settings | Soglie alert correnti (warningDays 5, criticalDays 2, overdueDays 0, reminderDaysBeforeDue 3, escalationDaysBeforeDue 1, aiConfidenceThreshold 0.85) - le stesse di `customer.config.js`, cosi' restano un'unica fonte di verita' da confermare col cliente. |

**Nota tecnica sui nomi campo**: in Airtable i campi sono in "Title Case"
leggibile (es. "Order Code", "Due Date") per facilita' d'uso lato cliente/Make,
mentre il frontend si aspetta chiavi camelCase (es. `orderCode`, `dueDate`).
`src/adapters/airtableAdapter.js` ora include una mappa di traduzione per ogni
tabella (`fieldMaps`) cosi' lo scambio resta un cambio di una riga in `App.jsx`,
senza dover rinominare nulla in Airtable.

**Cosa manca per andare live**: generare un Personal Access Token Airtable con
scope `data.records:read`/`data.records:write` sulla base, passarlo
all'adapter (`createAirtableAdapter({ baseId: "appDoRPzXLmmwc6Zp", apiKey, tableNames })`)
e sostituire l'import in `App.jsx`. Gli scenari Make (acquisizione documenti,
controllo scadenze, sollecito, report) restano da creare in un secondo
passaggio, quando saranno disponibili le credenziali IMAP Hostinger e la chiave
dell'API AI (vedi sezione 4).

## 11. Palette colori "Ink & Paper" (confermata)

Applicata in `src/config/customer.config.js` (chiave `theme`), ispirata alla
stampa offset:

| Token | Colore | Uso |
|---|---|---|
| `primary` | `#1B2B4B` | blu inchiostro — sidebar attiva, bottoni primari |
| `accent` | `#E8401C` | rosso tipografico — evidenze, CTA secondarie |
| `success` | `#2D8653` | stato OK / ricevuto |
| `warning` | `#F0A500` | attenzione (5 giorni) |
| `critical` | `#D6531D` | critico (2 giorni) — derivato, non specificato dal cliente |
| `danger` | `#D32F2F` | scaduto / errori |
| `background` | `#F7F5F2` | carta avorio |
| `card` / `sidebar` | `#FFFFFF` | sfondo pannelli |
| `text` | `#1A1A2E` | testo principale |
| `textMuted` | `#6B6B7D` | testo secondario — derivato, non specificato dal cliente |
| `border` | `#E3DFD8` | bordi — derivato, non specificato dal cliente |
| `muted` | `#EFEAE3` | sfondi badge/tag leggeri — derivato, non specificato dal cliente |

I tre token derivati (`critical`, `textMuted`, `border`, `muted`) non erano
nella lista fornita dal cliente: scelti per coerenza con la palette,
**DA CONFERMARE** con un controllo visivo nel pilota. Manca ancora il logo
(sezione 8).
