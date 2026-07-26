# Fase 2A — Sintesi operativa dell'ordine di acquisto (proposta funzionale, v2)

Stato: **proposta, non implementata**. Nessun codice è stato scritto per questo documento.

Questo documento sostituisce integralmente la v1. Rispetto alla v1 sono stati corretti: il
perimetro (ordini di acquisto verso fornitori, non ordini cliente), la semantica di
`unavailable`, la tassonomia della situazione combinata (nessuna fusione di `not_evaluated` con
"completo"), il linguaggio ("nessuna anomalia rilevata" invece di "dati completi e coerenti"), la
visibilità per ruolo (risolta per il pilota, non solo raccomandata), il canale della richiesta
aggiuntiva (approvato, tramite adapter esistente), il titolo della sezione, e la compattezza del
riepilogo. Il dettaglio di ogni correzione è nella sezione 9 (changelog).

Questo documento non modifica né `OrderOperationalView.jsx`, né `dataQualityContract.mjs`, né
`pilotControlCheck.mjs`, né alcun endpoint. Descrive solo come **comporre** dati che quei moduli
già producono.

---

## 0. Perimetro

**OrderWatch, in questo pilota, gestisce esclusivamente ordini di acquisto**: ordini emessi
dall'organizzazione tenant (es. Graphic Center Group) verso i propri **fornitori** — l'entità
`orders`/`OrdersView`/`OrderDetailPanel`/`OrderOperationalView` così come esiste oggi nel codice.

Questa proposta:
- riguarda solo quell'entità;
- **esclude esplicitamente** ordini cliente/vendita (sales order), preventivi verso il cliente
  finale, e qualunque futuro concetto di "ordine cliente" — anche se dovesse essere introdotto in
  OrderWatch in futuro, non rientra nella Fase 2A;
- non introduce quindi mai linguaggio orientato al cliente finale (es. "rispondere al cliente").
  Il destinatario naturale delle azioni descritte in questo documento è sempre **il fornitore** o
  **uno stakeholder interno** (buyer, produzione, chi ha bisogno del materiale), mai un cliente
  esterno.

Le azioni concrete che questo livello deve poter suggerire (riusando solo testo già esistente in
`CATEGORY_META`, mai testo nuovo generato per questa fase) sono quindi del tipo:
- *verificare con il fornitore*;
- *decidere se sollecitare* (reminder/follow-up sull'ordine di acquisto);
- *aggiornare gli stakeholder interni* (es. chi attende il materiale, chi ha promesso una
  scadenza al cliente finale su un altro livello del prodotto, fuori dal perimetro di questo
  documento).

---

## 1. Perché questo livello esiste

Oggi un operatore che apre un ordine di acquisto vede due cose separate, mai messe in relazione:

1. **Lo stato operativo dell'ordine** (`getOrderStatus()`, `src/utils/statusRules.js`) — se
   l'ordine è in ritardo, in scadenza, sotto controllo, da verificare o chiuso, calcolato dalla
   data di scadenza.
2. **Lo stato di qualità dati** (`dataQualityStatus`, `scripts/lib/dataQualityContract.mjs`) — se
   i dati che OrderWatch possiede su quell'ordine sono tracciabili e internamente coerenti, oggi
   visibile solo nella dashboard "Qualità dati (pilota)", e solo per gli ordini che sono capitati
   nel campione dell'ultimo Pilot Control Check.

Un operatore non ha oggi un modo di vedere, **nello stesso posto in cui apre l'ordine**, se questi
due assi raccontano una storia coerente o in tensione (es. "l'ordine è in ritardo *e* OrderWatch
non ha piena visibilità sui suoi dati" è una situazione qualitativamente diversa da "l'ordine è in
ritardo ma senza anomalie rilevate nei dati").

La Fase 2A introduce un livello, intitolato **"Sintesi operativa dell'ordine di acquisto"**, che:
- mette questi due assi fianco a fianco, **senza fonderli in un unico punteggio**;
- traduce la loro combinazione in una frase fattuale, tramite regole fisse, non tramite giudizio;
- riassume in forma compatta — senza duplicare — le segnalazioni già esistenti per quell'ordine;
- dichiara esplicitamente cosa non è ancora stato verificato.

---

## 2. Domande a cui l'operatore deve poter rispondere

Aprendo un ordine di acquisto qualsiasi (non solo quelli raggiunti da una segnalazione di Data
Quality), l'operatore deve poter rispondere, senza query al database e senza chiedere a uno
sviluppatore:

1. Questo ordine ha un'urgenza **operativa** (di scadenza), un problema di **qualità dei dati**
   (di tracciabilità/coerenza), entrambi, o nessuno dei due?
2. Se c'è un problema di qualità dati, quali righe o documenti sono coinvolti?
3. Che evidenza esiste già per questo ordine, e quanta ne manca?
4. C'è qualche limite noto **dell'intera organizzazione** (non specifico di questo ordine) che
   dovrei tenere presente prima di fidarmi di quello che vedo?
5. Cosa NON è ancora stato verificato per questo ordine — quindi la sua assenza da una
   segnalazione non è prova che sia tutto a posto?
6. Cosa dovrei verificare con il fornitore, o decidere internamente (es. sollecitare), prima di
   considerare risolta la situazione?
7. Questa valutazione di qualità dati è aggiornata a quando? (un'istantanea, non un dato live come
   lo stato operativo)

Domande che questo livello **non** deve promettere di risolvere (vedi §6): se l'ordine è
"corretto" nel merito, se il fornitore ha sbagliato, se la situazione è peggiorata di recente, cosa
succederà in futuro.

---

## 3. Stati necessari

### 3.1 Asse 1 — Stato operativo dell'ordine (esistente, invariato)

Riusato **verbatim** da `getOrderStatus()`. Nessun nuovo valore, nessuna modifica:

`OVERDUE` · `CRITICAL` · `WARNING` · `OK` · `TO_VERIFY` · `CLOSED`

### 3.2 Asse 2 — Stato di qualità dati per questo ordine (esistente, invariato)

Riusato **verbatim** da `ORDER_STATUS` in `dataQualityContract.mjs`. Nessun nuovo valore:

`unavailable` · `not_evaluated` · `incomplete_evidence` · `open_findings` · `complete`

**Correzione di semantica (rispetto alla v1):** `unavailable`, in questo contesto, **non significa
mai "l'ordine non è disponibile"**. Nel momento in cui questo livello viene mostrato, l'ordine è
già stato caricato con successo da `getOrderOperationalView()` — è per questo che `OrderDetailPanel`
è aperto. `unavailable` qui significa solo: **la valutazione di qualità dati per questo ordine non
è ottenibile in questo momento** (per un errore di rete, un rifiuto di permessi, o perché la
richiesta esplicita per singolo ordine non ha prodotto un risultato). L'ordine resta visibile e
consultabile in `OrderOperationalView`; è solo la sintesi qualità-dati a mancare.

Oggi `dataQualityStatus` è calcolato solo per gli ordini presenti nell'ultimo campione del Pilot
Control Check. La Fase 2A richiede che sia calcolabile **per qualsiasi ordine aperto**, on demand —
architettura approvata in §5.

### 3.3 Asse combinato — Situazione (nuovo, solo come tabella di lookup)

Non un punteggio: un'etichetta fissa, scelta da un albero di decisione deterministico a partire
dai due assi esistenti (§4.1). **Nove valori chiusi**, esaustivi:

| Codice | Significato |
|---|---|
| `VALUTAZIONE_QUALITA_NON_DISPONIBILE` | la valutazione di qualità dati non è ottenibile ora per questo ordine (non un giudizio sull'ordine stesso) |
| `CHIUSO` | ordine chiuso; i dati sono mostrati per riferimento |
| `DA_VERIFICARE` | lo stato operativo stesso richiede verifica (`TO_VERIFY`), indipendentemente dai dati |
| `URGENZA_OPERATIVA_DATI_DA_VERIFICARE` | ordine in ritardo o in scadenza **e** dati con evidenza incompleta o segnalazioni aperte |
| `URGENZA_OPERATIVA_DATI_NON_VALUTATI` | ordine in ritardo o in scadenza; verifica strutturale dei dati non ancora eseguita |
| `URGENZA_OPERATIVA_NESSUNA_ANOMALIA_RILEVATA` | ordine in ritardo o in scadenza; nel perimetro valutato non sono state rilevate anomalie strutturali |
| `SOTTO_CONTROLLO_DATI_DA_VERIFICARE` | scadenza sotto controllo, ma dati con evidenza incompleta o segnalazioni aperte |
| `SOTTO_CONTROLLO_DATI_NON_VALUTATI` | scadenza sotto controllo; verifica strutturale dei dati non ancora eseguita |
| `SOTTO_CONTROLLO_NESSUNA_ANOMALIA_RILEVATA` | scadenza sotto controllo; nel perimetro valutato non sono state rilevate anomalie strutturali |

**Correzione rispetto alla v1**: `not_evaluated` ha ora sempre un proprio codice dedicato
(`*_DATI_NON_VALUTATI`), sia sotto urgenza operativa sia sotto controllo. Non condivide mai
etichetta o codice con `complete` (`*_NESSUNA_ANOMALIA_RILEVATA`). "Non ancora valutato" e
"valutato e pulito" non sono mai la stessa cosa, né nel testo né nel codice.

`OVERDUE` e `CRITICAL` condividono il prefisso `URGENZA_OPERATIVA_*` (stesso codice), ma il testo
fisso mostrato deve sempre distinguere se l'ordine è **già in ritardo** (`OVERDUE`) o **in
avvicinamento alla scadenza** (`CRITICAL`) — vedi §4.2. Il codice è più grossolano del testo,
mai il contrario.

---

## 4. Regole deterministiche

### 4.1 Situazione combinata — albero di decisione (valutato in ordine, prima condizione vera vince)

```
1. se la valutazione qualità dati non è ottenibile
   (errore, permesso negato, o risultato assente)         → VALUTAZIONE_QUALITA_NON_DISPONIBILE
2. se businessStatus == 'CLOSED'                          → CHIUSO
3. se businessStatus == 'TO_VERIFY'                       → DA_VERIFICARE
4. se businessStatus in {OVERDUE, CRITICAL}:
   4a. se dataQualityStatus in {incomplete_evidence, open_findings}
                                                           → URGENZA_OPERATIVA_DATI_DA_VERIFICARE
   4b. altrimenti se dataQualityStatus == 'not_evaluated'  → URGENZA_OPERATIVA_DATI_NON_VALUTATI
   4c. altrimenti (dataQualityStatus == 'complete')        → URGENZA_OPERATIVA_NESSUNA_ANOMALIA_RILEVATA
5. altrimenti (businessStatus in {OK, WARNING}):
   5a. se dataQualityStatus in {incomplete_evidence, open_findings}
                                                           → SOTTO_CONTROLLO_DATI_DA_VERIFICARE
   5b. altrimenti se dataQualityStatus == 'not_evaluated'  → SOTTO_CONTROLLO_DATI_NON_VALUTATI
   5c. altrimenti (dataQualityStatus == 'complete')        → SOTTO_CONTROLLO_NESSUNA_ANOMALIA_RILEVATA
```

Nessuna condizione è un giudizio: ogni ramo legge solo i due stati già calcolati altrove.
`CLOSED`/`TO_VERIFY` hanno priorità sull'asse qualità dati perché sono condizioni sull'ordine
stesso. La condizione 1 ha priorità assoluta perché, se la valutazione qualità dati non è
disponibile, i rami 4/5 non sarebbero comunque calcolabili — ma lo stato operativo (badge separato,
§6) resta sempre visibile indipendentemente da questa condizione.

### 4.2 Selezione del testo — variante fissa per urgenza operativa

Il codice `URGENZA_OPERATIVA_*` non distingue `OVERDUE` da `CRITICAL`; il testo sì, tramite due
varianti fisse selezionate dallo stesso `businessStatus` già noto:

| businessStatus | Variante di testo |
|---|---|
| `OVERDUE` | "L'ordine è **già in ritardo** sulla consegna prevista." |
| `CRITICAL` | "L'ordine **si avvicina alla scadenza** prevista." |

Questa frase introduttiva è seguita dalla frase relativa all'asse qualità dati (una per ciascuno
dei tre sotto-casi 4a/4b/4c), mai fusa in un'unica stringa libera.

### 4.3 Riepilogo evidenza

Riuso diretto di `contract.orders[].evidenceCoverage` (`{coveredLines, totalLines}`), stessa
regola null-safe già in uso in `PilotDataQualityView.jsx`: denominatore 0 o non definito →
"Non disponibile", mai "0%". Nessun nuovo calcolo.

### 4.4 Segnalazioni principali per questo ordine (compatte)

- Fonte: `contract.findings` filtrato per `orderId`, **escludendo** `SECTION_NOT_EVALUATED` (che ha
  una propria voce separata, §4.5).
- Ordinamento fisso: severità (`critical` → `warning` → `info`), poi `findingId` crescente come
  criterio di stabilità (nessun ordine casuale).
- **Mostrate al massimo le prime 3** dopo l'ordinamento. Se ce ne sono di più, un indicatore fisso
  "+N altre" rimanda al dettaglio espandibile/collegato (§6.4) — mai un elenco completo inline.
- Nessuna deduplicazione di *contenuto* tra le segnalazioni mostrate: ognuna resta un finding reale
  e distinto.

### 4.5 Sezioni non valutate — solo conteggio nel riepilogo compatto

- Nel riepilogo compatto, `SECTION_NOT_EVALUATED` è rappresentato solo da un **conteggio** ("N
  sezioni non ancora valutate"), non da un elenco dei nomi delle sezioni. L'elenco completo (quali
  sezioni, es. `unresolvedEvidence`/`activeCommitments`) resta disponibile solo nel dettaglio
  espandibile/collegato.
- Non entra **mai** nella sezione "cosa verificare" insieme a segnalazioni genuine (§4.6): tono
  neutro (info), mai mescolato visivamente con severità warning/critical.
- Questa è la stessa regola già codificata in `deriveDataQualityStatus` (Fase 1A): un ordine con
  solo `SECTION_NOT_EVALUATED` è `not_evaluated`, non `open_findings`. Il livello Fase 2A **riusa**
  questo calcolo, non lo riproduce.

### 4.6 "Cosa verificare" — deduplicato

- Lista di `recommendedAction` (testo fisso, per categoria, da `CATEGORY_META`), **deduplicata per
  testo**: se più findings condividono la stessa azione consigliata, compare una sola volta.
- Include solo le azioni delle segnalazioni genuine (mai `SECTION_NOT_EVALUATED`).
- Se non esistono segnalazioni genuine, questa sezione non compare (non uno stato vuoto visibile).

### 4.7 Segnalazioni organizzative

- Fonte: `contract.organizationFindings`, invariato.
- Riferimento breve nel riepilogo compatto ("N limiti noti dell'organizzazione"), con etichetta
  esplicita che non riguardano questo ordine specifico — l'elenco completo resta nella dashboard
  "Qualità dati (pilota)", non duplicato qui.
- Mai contate nel numero di "segnalazioni per questo ordine", mai capaci di generare la situazione
  combinata (§3.3/§4.1), esattamente come oggi non generano mai un'azione "Apri ordine".

### 4.8 Freschezza del dato

- Il riepilogo mostra `generatedAt` del contratto usato, con etichetta esplicita ("Valutazione
  qualità dati aggiornata al: ..."), distinta dallo stato operativo (sempre calcolato live).

---

## 5. Fonte dati e canale della richiesta (approvato)

L'endpoint `GET /api/pilot-quality-contract` **supporta già** un parametro `orderId` esplicito
(bypassa il campionamento, valuta un solo ordine on demand, stesso isolamento tenant, stesso
controllo ruoli, nessuna query nuova — verificato nelle review di Fase 1A/1B).

**Approvato per il pilota**: una richiesta aggiuntiva on-demand per ogni apertura di
`OrderDetailPanel`, con l'`orderId` dell'ordine correntemente aperto, **esclusivamente tramite il
flusso adapter/endpoint autenticato già esistente** — lo stesso pattern già usato da
`onFetchOrderOperationalView`/`adapter.getPilotQualityContract`, propagato da `App.jsx` verso il
basso (`App.jsx` → `OrdersView` → `OrderDetailPanel`), mai una `fetch()` costruita direttamente
dentro un nuovo componente. Nessun nuovo endpoint, nessuna nuova query.

Non è una duplicazione della chiamata a `getOrderOperationalView` (sono due endpoint diversi, con
dati diversi già esistenti); è un costo di rete aggiuntivo accettato consapevolmente, non
introdotto silenziosamente.

Se questa richiesta fallisce o è vietata per il ruolo corrente (§7), il risultato è
`VALUTAZIONE_QUALITA_NON_DISPONIBILE` (§3.3) — mai un errore silenzioso, mai un valore inventato.

---

## 6. Cosa mostrare — riepilogo compatto

Sezione unica intitolata **"Sintesi operativa dell'ordine di acquisto"**, posizionata **sopra**
l'attuale `StatusBadge`/banner d'investigazione, dentro `OrderDetailPanel` (nessuna modifica di
`OrderOperationalView.jsx` in questa fase). Contenuto, in ordine, **tutto compatto**:

1. **Etichetta situazione combinata** (§3.3) con la frase fattuale generata dalle regole §4.1/4.2.
   Una frase per codice/variante, mai libera.
2. **I due badge separati**, entrambi sempre visibili: stato operativo (badge esistente,
   invariato) e stato qualità dati (badge esistente da `PilotDataQualityView.jsx`, riusato).
3. **Copertura evidenza**: "X di Y righe hanno evidenza collegata" (o "Non disponibile").
4. **Fino a 3 segnalazioni principali** (§4.4), con indicatore "+N altre" se necessario.
5. **Conteggio sezioni non valutate** (§4.5) — solo il numero, non l'elenco.
6. **Cosa verificare**: lista deduplicata di azioni consigliate (§4.6), solo se pertinente.
7. **Riferimento ai limiti organizzativi** (§4.7) — solo conteggio/riferimento, non l'elenco.
8. **Data di valutazione** (§4.8).
9. **Diagnostica di dettaglio**: espandibile in loco, oppure link diretto alla dashboard "Qualità
   dati (pilota)" filtrata su questo ordine — mai duplicata per intero dentro `OrderDetailPanel`.
10. Se la valutazione qualità dati non è disponibile (§3.2/§5): stato esplicito, mai un vuoto
    silenzioso, mai un fallback a dati inventati.

**Vincolo esplicito**: questo riepilogo non deve mai diventare una copia della dashboard "Qualità
dati (pilota)" dentro `OrderDetailPanel`. Ogni elenco completo (tutte le segnalazioni, tutte le
sezioni non valutate, tutte le segnalazioni organizzative) vive solo dietro il punto 9.

---

## 7. Visibilità per ruolo

**Pilota (questa fase): risolto, non solo raccomandato.**
- La sintesi Fase 2A completa è visibile solo a **Owner/Admin/IT** — nessuna estensione di permessi
  in questa fase. `Buyer`/`ReadOnly` continuano a vedere `OrderDetailPanel` esattamente come oggi,
  senza questa sezione.
- Nessuna modifica a `canAccessView`/`APP_VIEWS_BY_ROLE` o al controllo ruoli dell'endpoint
  `pilot-quality-contract` (resta Owner/IT/Admin, invariato).

**Versione futura orientata al buyer: fuori perimetro, ma con un principio guida esplicito.**
- Non deve **mai** essere semplicemente "aprire" l'endpoint esistente a `Buyer`: quell'endpoint e
  il suo linguaggio sono stati progettati come strumento di supporto/investigazione, non per l'uso
  quotidiano del buyer.
- Una futura versione per il buyer dovrà essere progettata come un **sottoinsieme operativo
  sicuro** — a titolo di direzione, non di specifica: probabilmente solo l'asse urgenza operativa
  più un segnale generico "verifica aggiuntiva raccomandata" senza il linguaggio/le categorie di
  qualità dati complete, e con una decisione di prodotto separata su formazione e tono. Questa
  proposta non decide quella versione; la esclude esplicitamente dal pilota.

---

## 8. Cosa questo livello NON deve mai inferire

- **Nessun giudizio AI**: ogni frase proviene da un ramo fisso dell'albero §4.1/4.2 o da un testo
  già esistente in `CATEGORY_META`/`FINDING_LABELS`. Nessun testo generato liberamente.
- **Nessun punteggio di confidenza/accuratezza**: nessun numero 0–100, nessuna percentuale che non
  sia un rapporto reale già presente (`coveredLines/totalLines`).
- **Nessuna colpa al fornitore**: nessuna frase che nomini il fornitore come causa. Il linguaggio
  resta quello già validato in Fase 1B (`dataQualityInvestigation.js`); le azioni suggerite sono
  sempre "verificare con il fornitore", mai "il fornitore ha sbagliato".
- **Nessuna scelta di un valore vincente** in un conflitto quantità/data: se esiste un
  `QUANTITY_CONFLICT`/`DATE_CONFLICT`, il livello riporta che il conflitto esiste, mai quale valore
  è "quello giusto".
- **Nessun giudizio su correttezza dell'ordine**: "nel perimetro valutato non sono state rilevate
  anomalie strutturali" (mai "dati completi e coerenti", mai "corretto") descrive solo cosa
  OrderWatch osserva sui propri dati, mai cosa è vero nella realtà.
- **Nessuna inferenza dall'assenza di dati**: l'assenza di una segnalazione in una sezione non
  valutata non è mai presentata come conferma di correttezza (§4.5).
- **Nessuna dimensione temporale implicita**: nessuno storico dei findings è conservato; questo
  livello non deve mai suggerire un cambiamento ("è peggiorato", "è nuovo da ieri") — solo lo stato
  *attuale*, con la data di generazione esplicita (§4.8).
- **Nessuna previsione**: nessuna stima su cosa succederà, solo fatti strutturali già calcolati.
- **Nessun nuovo calcolo su dati grezzi**: questo livello compone output già esistenti
  (`getOrderStatus`, `dataQualityContract.mjs`); non introduce una nuova regola di detection.

---

## 9. Changelog rispetto alla v1

| # | Correzione richiesta | Cosa è cambiato |
|---|---|---|
| 1 | Perimetro esplicito: ordini di acquisto verso fornitori, non ordini cliente | Aggiunta §0; sostituito ogni "rispondere al cliente" con "verificare con il fornitore / decidere se sollecitare / aggiornare gli stakeholder interni"; esclusione esplicita degli ordini cliente |
| 2 | Semantica di `unavailable` | Ridefinita in §3.2: significa solo "valutazione qualità dati non ottenibile ora", mai "ordine non disponibile"; rinominato `VALUTAZIONE_QUALITA_NON_DISPONIBILE` |
| 3 | `not_evaluated` mai classificato come completo | Tassonomia riscritta a 9 stati (§3.3), `*_DATI_NON_VALUTATI` sempre distinto da `*_NESSUNA_ANOMALIA_RILEVATA`; testo separato per `OVERDUE` vs `CRITICAL` (§4.2) |
| 4 | Linguaggio più prudente per "completo" | "Dati completi e coerenti" sostituito ovunque con "Nel perimetro valutato non sono state rilevate anomalie strutturali" |
| 5 | Visibilità per ruolo | §7 riscritta: pilota risolto (solo Owner/Admin/IT, nessuna estensione), versione buyer esplicitamente fuori perimetro con principio guida, non specifica |
| 6 | Canale della richiesta aggiuntiva | §5 riscritta: approvato, ma solo tramite adapter/endpoint autenticato esistente, mai fetch diretta nel componente |
| 7 | Titolo della sezione | Fissato a "Sintesi operativa dell'ordine di acquisto" ovunque |
| 8 | Banner Fase 1B invariato | Confermato, vedi §10 |
| 9 | Riepilogo compatto | §6 riscritta: solo fino a 3 segnalazioni principali, solo conteggio delle sezioni non valutate, dettaglio completo spostato dietro un'espansione/link, nessuna duplicazione della dashboard |

---

## 10. Relazione con il banner di Fase 1B (invariata)

Il banner "Ordine aperto dal controllo qualità" (Fase 1B) resta invariato: è transitorio, appare
solo quando si arriva da un finding specifico, e spiega *perché* si è aperto quell'ordine in quel
momento. La Sintesi operativa (Fase 2A) è invece sempre presente, indipendentemente da come si è
arrivati all'ordine, e descrive lo stato complessivo. Quando entrambi sono presenti, il finding
specifico del banner Fase 1B deve comparire anche tra le segnalazioni principali (§4.4) o, se oltre
la terza, nel dettaglio espandibile — non deve mai esistere una segnalazione visibile in un posto e
assente nell'altro.

---

## 11. Cosa NON cambia in questa fase

- Nessuna modifica a estrazione, matching, schema database, autenticazione.
- Nessuna modifica alle regole di `deriveDataQualityStatus`, `CATEGORY_META`, `ISSUE_CATEGORIES`.
- Nessuna modifica a `getOrderOperationalView()` o al suo endpoint.
- Nessuna modifica a `canAccessView`/`APP_VIEWS_BY_ROLE` o al controllo ruoli dell'endpoint
  `pilot-quality-contract`.
- Nessuna nuova scrittura: il livello è strettamente di lettura.
- Banner e evidenziazione di riga/documento/evidenza di Fase 1B restano invariati e complementari
  (§10).

---

## 12. Tabella decisionale finale

Mappatura esaustiva e definitiva: `businessStatus` × `dataQualityStatus` (o valutazione non
disponibile) → codice situazione + variante di testo.

| businessStatus | dataQualityStatus | Codice | Variante testo urgenza |
|---|---|---|---|
| qualsiasi | valutazione non ottenibile | `VALUTAZIONE_QUALITA_NON_DISPONIBILE` | — |
| `CLOSED` | qualsiasi (valutazione ottenuta) | `CHIUSO` | — |
| `TO_VERIFY` | qualsiasi (valutazione ottenuta) | `DA_VERIFICARE` | — |
| `OVERDUE` | `incomplete_evidence` o `open_findings` | `URGENZA_OPERATIVA_DATI_DA_VERIFICARE` | "già in ritardo" |
| `CRITICAL` | `incomplete_evidence` o `open_findings` | `URGENZA_OPERATIVA_DATI_DA_VERIFICARE` | "in avvicinamento alla scadenza" |
| `OVERDUE` | `not_evaluated` | `URGENZA_OPERATIVA_DATI_NON_VALUTATI` | "già in ritardo" |
| `CRITICAL` | `not_evaluated` | `URGENZA_OPERATIVA_DATI_NON_VALUTATI` | "in avvicinamento alla scadenza" |
| `OVERDUE` | `complete` | `URGENZA_OPERATIVA_NESSUNA_ANOMALIA_RILEVATA` | "già in ritardo" |
| `CRITICAL` | `complete` | `URGENZA_OPERATIVA_NESSUNA_ANOMALIA_RILEVATA` | "in avvicinamento alla scadenza" |
| `OK` o `WARNING` | `incomplete_evidence` o `open_findings` | `SOTTO_CONTROLLO_DATI_DA_VERIFICARE` | — |
| `OK` o `WARNING` | `not_evaluated` | `SOTTO_CONTROLLO_DATI_NON_VALUTATI` | — |
| `OK` o `WARNING` | `complete` | `SOTTO_CONTROLLO_NESSUNA_ANOMALIA_RILEVATA` | — |

Nove codici distinti, nessuna cella priva di copertura, nessuna cella che classifichi
`not_evaluated` come equivalente a `complete`.

---

## 13. Criteri di accettazione per la revisione (prima dell'implementazione)

1. Ogni frase mostrata è riconducibile a una regola in §4 o a un testo già esistente in
   `CATEGORY_META`/`FINDING_LABELS` — nessuna stringa libera.
2. I due assi esistenti (`businessStatus`, `dataQualityStatus`) restano sempre visibili
   separatamente, mai fusi in un numero unico.
3. Le nove situazioni combinate di §3.3/§12 sono esaustive e derivate solo dall'albero §4.1.
4. `not_evaluated` non condivide mai codice o testo con `complete`.
5. `SECTION_NOT_EVALUATED` non genera mai una voce nella sezione "cosa verificare" insieme a
   segnalazioni genuine, ed è mostrato solo come conteggio nel riepilogo compatto.
6. Le segnalazioni organizzative non contribuiscono mai al conteggio "segnalazioni di questo
   ordine" né alla situazione combinata.
7. Nessun linguaggio orientato al cliente finale; ogni azione suggerita riguarda il fornitore o
   uno stakeholder interno.
8. Il riepilogo compatto (§6) non supera mai gli elementi elencati; ogni elenco completo vive
   solo nel dettaglio espandibile/collegato.
9. La richiesta aggiuntiva di dati passa esclusivamente per l'adapter/endpoint autenticato
   esistente, mai per una fetch diretta nel componente.
10. La visibilità per ruolo del pilota (§7) resta Owner/Admin/IT senza estensione, salvo
    approvazione separata futura.
