# Fase 2C.1B — Consolidamento delle azioni diagnostiche (specifica funzionale approvata)

Stato: **approvata, non implementata**. Nessun codice sorgente, test, endpoint o adapter è stato
modificato per produrre questo documento — solo questo file è stato creato.

Questo documento è il seguito diretto di
[PILOT_PHASE_2C_OPERATIONAL_SUGGESTIONS_PROPOSAL.md](PILOT_PHASE_2C_OPERATIONAL_SUGGESTIONS_PROPOSAL.md)
(Fase 2C.1A, già implementata) e si basa sull'analisi di sola lettura già condotta su
`purchaseOrderOperationalSummary.js`/`.jsx`, `purchaseOrderOperationalSuggestions.js`/`.jsx`,
`OrderOperationalView.jsx`, `OrderDetailPanel.jsx`, `dataQualityInvestigation.js`,
`pilot-quality-contract.js`/adapter, e sui dati live dei tre ordini Graphic Center Group. Le
correzioni e decisioni autoritative di questo turno sostituiscono ogni punto aperto lasciato da
quell'analisi.

---

## 1. Perimetro e scopo

Fase 2C.1B **sposta** — non duplica — la presentazione delle azioni diagnostiche oggi mostrate
dentro la Fase 2A, dentro la sezione già esistente **"Azioni suggerite"** (introdotta da Fase
2C.1A). La sezione risultante contiene due domini separati e sempre distinguibili:

- **Operative** — Fase 2C.1A, invariata, visibile a Owner, Admin, IT, Buyer, ReadOnly.
- **Qualità dati** — Fase 2C.1B, nuova, visibile solo a Owner, Admin, IT.

Fase 2C.1B non crea alcun task persistito. Fase 2A continua a descrivere **cosa OrderWatch ha
rilevato**; Fase 2C.1B descrive **cosa l'utente autorizzato può verificare successivamente**.

---

## 2. Architettura del fetch condiviso (approvata)

**Problema attuale**: `PurchaseOrderOperationalSummary` (Fase 2A) è oggi l'unico proprietario della
richiesta `pilot-quality-contract` — un `useReducer` interno, un `tokenRef` per la protezione da
risposte in ritardo, e un coordinatore per-istanza (`createPurchaseOrderQualityRequestCoordinator`)
che assorbe il doppio effetto di React StrictMode. `OrderOperationalView` (che ospita "Azioni
suggerite") è un componente **fratello**, non figlio, montato separatamente in
`OrderDetailPanel` — non ha oggi alcun accesso al risultato di quella richiesta.

**Architettura approvata**:

1. Estrarre il comportamento di caricamento esistente in un unico hook mirato:
   **`usePurchaseOrderQualityContract`**, che incapsula esattamente la logica oggi interna ad
   `AuthorizedPurchaseOrderOperationalSummary` (reducer `idle→loading→loaded|unavailable|error`,
   coordinatore di deduplica, `tokenRef`/`myToken`, `AbortController`) senza reimplementarla.
2. L'hook viene chiamato **esattamente una volta**, dentro `OrderDetailPanel`.
3. Lo stesso oggetto di stato risultante (`{status, qualityContract, error}`) viene passato come
   prop sia a `PurchaseOrderOperationalSummary` (che diventa presentazionale: riceve `state` invece
   di calcolarlo da sé) sia a `OrderOperationalView` (nuova prop, es. `qualityState`), che la
   inoltra al sottogruppo diagnostico dentro "Azioni suggerite".
4. Coordinatore di richiesta, coalescenza StrictMode, `AbortController` e protezione da risposta
   in ritardo (token monotono) sono **preservati esattamente**, spostati solo al livello che ora
   possiede l'effetto.
5. Il gate di ruolo (`canViewPurchaseOrderQualitySummary(role)`) viene valutato **dentro l'hook**,
   prima che il suo effetto possa mai partire — non nei componenti che lo consumano.
6. **Owner/Admin/IT**: al massimo **una** richiesta `pilot-quality-contract` per l'ordine
   selezionato, condivisa da entrambi i consumatori per costruzione (un solo owner, un solo stato).
7. **Buyer/ReadOnly**: **zero** richieste `pilot-quality-contract` e nessun sottogruppo
   diagnostico montato in nessuna parte dell'albero.

Non vengono implementati due fetch indipendenti. Non si fa affidamento su una cache ipotetica.
Non viene introdotto React Context: la condivisione diretta via prop, a due soli livelli di
profondità (`OrderDetailPanel` → `PurchaseOrderOperationalSummary` / `OrderOperationalView`), è
sufficiente e non necessita di indirezione aggiuntiva.

---

## 3. Migrazione da Fase 2A

**Rimosso da Fase 2A**:
- il blocco visibile "Azioni già indicate dalle segnalazioni";
- la visualizzazione di `finding.recommendedAction`;
- il campo `recommendedActions` dal modello di presentazione restituito da
  `buildPurchaseOrderOperationalSummary`;
- `deduplicateRecommendedActions`, se non resta alcun chiamante dopo la rimozione del punto
  precedente.

**Invariato in Fase 2A**:
- `situation`/`situationLabel`/`situationCopy` (situazione attuale);
- `dataQualityStatus`/`dataQualityLabel` (stato qualità);
- `findings`/`remainingFindingCount`/`genuineFindingCount` (riepilogo "Cosa verificare");
- gestione di caricamento/non disponibile/errore della card di sintesi;
- `organizationFindingCount`;
- gestione di `SECTION_NOT_EVALUATED` (`sectionNotEvaluatedCount`, mai trattata come segnalazione
  genuina).

Non viene mai eliminata alcuna segnalazione o evidenza da Fase 1B/2A — si sposta solo la
presentazione dell'azione conseguente.

---

## 4. Tassonomia chiusa delle segnalazioni diagnostiche — otto codici

Derivata esclusivamente dagli otto tipi di segnalazione **per-ordine** genuini che il contratto
può produrre oggi (i tre tipi `SOURCE_UNAVAILABLE`/`SOURCE_UNWATCHED`/`SOURCE_INCOMPLETE` sono
strutturalmente sempre organization-wide, mai per-ordine; `SECTION_NOT_EVALUATED` non è mai
genuina). Confermato contro `CATEGORY_META`/`pilotControlCheck.mjs` e i dati live.

| # | Tipo segnalazione | Codice azione | Titolo fisso | Motivazione fissa | Priorità |
|---|---|---|---|---|---|
| 1 | `ORDER_LINK_MISSING` | `REVIEW_ORDER_LINK_MISSING` | "Verifica collegamento ordine" | "L'ordine collegato alla segnalazione non risulta disponibile nell'organizzazione corrente." | `OPERATIONAL_PRIORITY` |
| 2 | `DANGLING_PROVENANCE` | `REVIEW_DANGLING_PROVENANCE` | "Verifica riferimento evidenza" | "Un riferimento di provenienza non può essere collegato all'evidenza attesa." | `OPERATIONAL_PRIORITY` |
| 3 | `DOCUMENT_LINK_UNPROVEN` | `REVIEW_DOCUMENT_LINK` | "Verifica collegamento documenti" | "Il collegamento tra uno o più documenti e l'ordine non è confermato in modo deterministico." | `OPERATIONAL_PRIORITY` |
| 4 | `OPERATIONAL_STATE_UNEXPLAINED` | `REVIEW_OPERATIONAL_STATE_UNEXPLAINED` | "Verifica stato operativo non spiegato" | "Lo stato operativo corrente non è completamente spiegato dai dati disponibili." | `OPERATIONAL_PRIORITY` |
| 5 | `LINE_WITHOUT_EVIDENCE` | `REVIEW_LINE_WITHOUT_EVIDENCE` | "Verifica righe senza evidenza" | "Una o più righe non hanno una fonte di evidenza collegata." | `TO_REVIEW` |
| 6 | `QUANTITY_CONFLICT` | `REVIEW_QUANTITY_CONFLICT` | "Verifica quantità in conflitto" | "Le fonti disponibili riportano quantità differenti per una o più righe." | `TO_REVIEW` |
| 7 | `DATE_CONFLICT` | `REVIEW_DATE_CONFLICT` | "Verifica date in conflitto" | "Le date disponibili non risultano coerenti tra loro." | `TO_REVIEW` |
| 8 | `DUPLICATE_LINE` | `REVIEW_DUPLICATE_LINE` | "Verifica possibili righe duplicate" | "Una o più righe potrebbero rappresentare lo stesso elemento e richiedono una verifica." | `TO_REVIEW` |

**La priorità è fissa per tipo di segnalazione, mai derivata dinamicamente da `finding.severity`.**
Il campo `severity` può restare disponibile a scopo diagnostico/interno, ma non può mai sovrascrivere
la mappatura chiusa tipo→priorità sopra. Questo è deliberatamente diverso dal modello di Fase
2C.1A (dove la priorità operativa segue lo stato business): qui la priorità è una proprietà fissa
del tipo di segnalazione stesso, decisa una volta per tutte in questa tabella.

**Tipo di segnalazione sconosciuto**: nessuna azione generata. **`findingId` mancante, vuoto o non
valido** (regola esatta in §6): nessuna azione generata — fail-closed, nessuna chiave sostitutiva
viene sintetizzata da tipo+descrizione.

---

## 5. Esclusioni esplicite

Non generano mai un'azione diagnostica:
- `SECTION_NOT_EVALUATED`;
- qualunque voce di `organizationFindings` (mai attribuita a un ordine specifico);
- `SOURCE_UNAVAILABLE`, `SOURCE_UNWATCHED`, `SOURCE_INCOMPLETE` (categorie strutturalmente
  organization-wide, non raggiungono mai `findings[]` per-ordine);
- tipi di segnalazione sconosciuti/non mappati;
- una valutazione qualità non disponibile (nessun contratto caricato → nessuna azione, non un
  placeholder);
- il testo di `recommendedAction`, che non viene mai mostrato verbatim in nessuna azione.

---

## 6. Identità e target

Una segnalazione genuina crea **al massimo un'azione diagnostica**. Chiave interna: **`findingId`**
esatto, mai una chiave sintetizzata. `findingId`, id di riga e id di documento **non sono mai resi
visibili** nel testo o nell'interfaccia — restano identità puramente interne.

**Validazione di `findingId`** — un `findingId` è accettato solo quando, tutte e tre le condizioni:

- `typeof findingId === "string"`;
- `findingId.trim().length > 0`;
- `findingId === findingId.trim()` (nessuno spazio iniziale o finale già nella stringa).

Non viene effettuato alcun parsing né validazione del formato interno
`${orderId}#${indice}#${categoria}` — la stringa è trattata come un identificatore opaco, non come
dato strutturato da decomporre.

**Vengono rifiutati** (nessuna azione generata, nessuna chiave sostitutiva sintetizzata):
- valori mancanti (`null`/`undefined`);
- stringhe vuote;
- stringhe composte solo da spazi;
- stringhe con spazi iniziali o finali;
- numeri;
- booleani;
- array;
- oggetti;
- qualunque altro tipo non stringa.

**Una segnalazione con più righe o documenti collegati resta una sola azione con più target di
supporto** — mai un'azione per riga. Motivazione: il contratto stesso già modella
`DUPLICATE_LINE`/`LINE_WITHOUT_EVIDENCE` come una singola segnalazione che porta un array di righe
affette (`lineIds: groupLines.map(lineSummary)`), non N segnalazioni distinte — frammentarla in N
azioni fabbricherebbe un'identità che la fonte dati non fornisce.

Nessuna deduplica per testo visibile, tipo di segnalazione, posizione nell'array, descrizione di
riga o numero di documento. Nessun accorpamento di segnalazioni non correlate.

---

## 7. Ordinamento delle azioni diagnostiche prima del cap

Prima di applicare il cap iniziale di 3 azioni (§10), l'elenco delle azioni diagnostiche viene
ordinato in modo deterministico, in questo ordine esatto di criteri:

1. **Priorità**: `OPERATIONAL_PRIORITY` → `TO_REVIEW` → `TO_MONITOR`.
2. **Livello del target**: `order` → `line` → `document` → `mixed` → `none`.
3. **`findingId` interno stabile** (usato solo per l'ordinamento, mai reso visibile).
4. **`actionCode`**, come ultimo criterio di spareggio deterministico.

Il cap e l'espansione "+N altre azioni" operano **sempre su questo elenco già ordinato**, mai
sull'ordine con cui le segnalazioni compaiono nell'array sorgente del contratto.

---

## 8. Ordinamento deterministico del target

Il target primario **non** è scelto dalla posizione corrente nell'array sorgente. Normalizzazione e
ordinamento:

1. Riferimenti di evidenza risolti, ordinati per suffisso numerico deterministico del ref (stesso
   criterio già usato da Fase 2B.1's `evidenceSuffix`/`compareEvidenceRefs`).
2. Righe interessate, ordinate per id di riga stabile.
3. Documenti interessati, ordinati per id di documento stabile.

**Precedenza del target**: primo riferimento di evidenza risolto → altrimenti prima riga
interessata (ordinata) → altrimenti primo documento interessato (ordinato) → altrimenti nessun
target di navigazione. Tutti gli altri target esatti restano disponibili come dettagli di supporto
(mai scartati, solo non promossi a primario). Nessun matching fuzzy, per descrizione o per numero
di documento.

---

## 9. Navigazione evidenza

Riuso esclusivo del meccanismo esatto già esistente (Fase 1B / `OrderOperationalView`):

- per i riferimenti di evidenza, si chiama il resolver esatto già esistente
  (`resolveExistingEvidenceRefs`) contro `OrderOperationalView.evidenceReferences` corrente; il
  link viene renderizzato solo per i ref che risolvono realmente; **mai** un link rotto o di
  fallback.
- `DANGLING_PROVENANCE` **non garantisce** che il proprio `evidenceRefs` dichiarato risolva
  (è proprio il tipo di segnalazione che descrive un riferimento non risolvibile) — quando una
  segnalazione dichiara uno o più `evidenceRefs` ma nessuno risolve, viene mostrata la nota fissa:

  **"Collegamento all'evidenza non disponibile."**

- Una segnalazione genuina senza `evidenceRefs` dichiarati e senza alcun target esatto (righe o
  documenti) può comunque restare visibile senza alcuna azione di navigazione — è il caso live di
  `OPERATIONAL_STATE_UNEXPLAINED` su `13542272` (vedi §12, copertura live).

Nessun nuovo meccanismo di navigazione viene introdotto. La semantica di evidenziazione di Fase 1B
(`isExactIdFocused`/`normalizeFocusIds` per righe e documenti) resta invariata.

---

## 10. Architettura informativa in UI

Estensione della sezione esistente "Azioni suggerite" con due sottogruppi separati:

- **"Operative"** — comportamento invariato di Fase 2C.1A, visibile a tutti e 5 i ruoli.
- **"Qualità dati"** — nuovo, visibile solo a Owner/Admin/IT; massimo 3 azioni inizialmente
  visibili, selezionate dall'elenco già ordinato per priorità/livello/`findingId`/`actionCode`
  definito in §7 (mai dall'ordine grezzo del contratto); espansione deterministica "+N altre
  azioni" (stesso pattern di 2C.1A, cap indipendente); stato di caricamento/errore/vuoto
  indipendente dal sottogruppo operativo.

Buyer e ReadOnly non vedono alcuna intestazione, stato di caricamento, stato vuoto o stato non
disponibile relativo al dominio diagnostico — il sottogruppo semplicemente non esiste per loro,
non è nascosto con CSS né reso vuoto.

Il sottogruppo operativo **si renderizza immediatamente** e non attende mai la richiesta qualità
(sono guidati da stati strutturalmente indipendenti: quello operativo è sincrono, da dati
`OrderOperationalView` già caricati; quello diagnostico è asincrono, dall'hook condiviso). Un
fallimento diagnostico non nasconde mai i suggerimenti operativi.

---

## 11. Regole di stato vuoto

Il messaggio complessivo **"Nessuna azione suggerita per questo ordine."** non viene mai mostrato
quando un'azione diagnostica è visibile o il sottogruppo diagnostico autorizzato è ancora in
caricamento.

**Per Owner/Admin/IT**:
- diagnostico caricato senza azioni genuine: **"Nessuna segnalazione di qualità dati per questo
  ordine."**
- diagnostico non disponibile/errore: **"La valutazione qualità non è disponibile per questo
  ordine."**
- diagnostico in caricamento: **"Caricamento valutazione qualità..."**

**Per Buyer/ReadOnly**: il sottogruppo diagnostico non esiste; lo stato vuoto complessivo dipende
solo dai suggerimenti operativi.

Lo stato vuoto complessivo si mostra solo quando nessuna azione è visibile per il ruolo corrente e
nessun sottogruppo visibile è in caricamento.

**Ordini CLOSED**: nessun suggerimento operativo (regola già di Fase 2C.1A); le segnalazioni
diagnostiche genuine possono restare visibili.

---

## 12. Copertura live — Graphic Center Group (confermata, nessuna deviazione)

| Ordine | Operativo (2C.1A) | Segnalazione genuina | Diagnostico (2C.1B) | Target esatto | Owner/Admin/IT | Buyer/ReadOnly |
|---|---|---|---|---|---|---|
| `13542272` | `ATTENTION_OVERDUE` | 1 — `OPERATIONAL_STATE_UNEXPLAINED` | `REVIEW_OPERATIONAL_STATE_UNEXPLAINED` | Nessuno (righe/documenti/evidenceRefs tutti vuoti per costruzione di questo tipo) | vedono entrambi i domini | vedono solo l'operativo |
| `0013545497` | `VERIFY_EXPIRED_LINE_COMMITMENT` | 0 (solo `SECTION_NOT_EVALUATED` ×4) | Nessuna | N/A | sottogruppo diagnostico vuoto | N/A (sottogruppo assente) |
| `228751` | `VERIFY_ORDER_STATUS` | 0 (solo `SECTION_NOT_EVALUATED` ×4) | Nessuna | N/A | sottogruppo diagnostico vuoto | N/A (sottogruppo assente) |

Solo `OPERATIONAL_STATE_UNEXPLAINED` ha copertura diagnostica live oggi. Gli altri sette codici
(`REVIEW_ORDER_LINK_MISSING`, `REVIEW_DANGLING_PROVENANCE`, `REVIEW_DOCUMENT_LINK`,
`REVIEW_LINE_WITHOUT_EVIDENCE`, `REVIEW_QUANTITY_CONFLICT`, `REVIEW_DATE_CONFLICT`,
`REVIEW_DUPLICATE_LINE`) sono **solo fixture** oggi, verificabili solo con dati sintetici.

---

## 13. Requisiti di test

Test comportamentali richiesti (non basati principalmente su asserzioni su stringhe sorgente):

1. Tutti e otto i tipi di segnalazione supportati producono l'azione corretta.
2. Mappatura fissa tipo→priorità.
3. `severity` nel payload non può sovrascrivere la priorità.
4. Tipo di segnalazione sconosciuto → nessuna azione.
5. `findingId` mancante/non valido → nessuna azione.
6. `SECTION_NOT_EVALUATED` → nessuna azione.
7. `organizationFindings` → nessuna azione d'ordine.
8. Il testo di `recommendedAction` non viene mai renderizzato.
9. Una segnalazione con più righe crea una sola azione.
10. Una segnalazione con più documenti crea una sola azione.
11. Più segnalazioni genuine restano separate anche con copia visibile identica.
12. Ordinamento del target (all'interno di una singola azione, §8) deterministico, indipendente
    dall'ordine dell'array in input.
13. Link di evidenza risolto correttamente.
14. Riferimenti di evidenza parzialmente stale (solo quelli risolvibili vengono mostrati).
15. Riferimenti di evidenza tutti stale → mostra "Collegamento all'evidenza non disponibile."
16. Segnalazione senza alcun target si renderizza senza lanciare eccezioni.
17. Una sola richiesta qualità quando sia il consumatore di Fase 2A sia quello di Fase 2C sono
    montati contemporaneamente.
18. Coalescenza della richiesta sotto StrictMode.
19. Protezione da risposta in ritardo durante cambio rapido di ordine.
20. Zero richieste qualità per Buyer e ReadOnly.
21. Il blocco di azione di Fase 2A risulta rimosso.
22. Il comportamento di situazione/segnalazioni di Fase 2A resta altrimenti invariato.
23. Cap di 3 ed espansione indipendenti per sottogruppo.
24. Caricamento/errore diagnostico non blocca i suggerimenti operativi.
25. Lo stato vuoto complessivo non si mostra mentre esistono o sono in caricamento azioni
    diagnostiche.
26. Un ordine CLOSED può mostrare azioni diagnostiche.
27. Nessun `findingId`, UUID, id di riga o id di documento grezzo nell'HTML renderizzato.
28. Le regressioni di Fase 1B, 2A, 2B.1 e 2C.1A passano.
29. L'ordinamento della lista delle azioni diagnostiche (§7 — priorità, poi livello del target,
    poi `findingId` stabile, poi `actionCode`) è deterministico e indipendente dall'ordine con cui
    le segnalazioni compaiono nell'array del contratto; il cap di 3 e "+N altre azioni" operano
    sempre su questo elenco ordinato.
30. La validazione di `findingId` (§6) accetta solo stringhe non vuote, senza spazi iniziali o
    finali, e rifiuta esplicitamente, senza generare eccezioni: valori mancanti, stringhe vuote,
    stringhe di soli spazi, stringhe con spazi iniziali/finali, numeri, booleani, array e oggetti —
    senza mai sintetizzare una chiave sostitutiva.

I test di regressione deterministici devono usare **fixture dalla stessa forma dei dati live**, mai
un test permanente che presuma che i dati live del tenant reale non cambino mai — la validazione
sui dati reali resta sola lettura e riportata separatamente (§12), non codificata come asserzione
di test.

---

## 14. Non-goal

Non vengono implementati in questa fase: task persistiti; completamento, dismissione,
assegnazione o snooze; scadenze per le azioni; scritture su `operational_actions`; integrazione
con la coda "Oggi" della Dashboard; Fase 2C.2; copia generata da IA; decisioni basate su
confidence; azioni su ordini cliente; nuovi endpoint o ampliamenti di permesso.

---

## 15. Limiti aperti

1. Solo 1 degli 8 codici della tassonomia ha copertura live su questo tenant oggi (§12) — gli
   altri 7 richiedono un percorso di test basato su fixture, e la loro resa visiva non è stata
   verificata contro dati reali.
2. `OPERATIONAL_STATE_UNEXPLAINED`, `ORDER_LINK_MISSING`, `DOCUMENT_LINK_UNPROVEN`,
   `LINE_WITHOUT_EVIDENCE`, `DUPLICATE_LINE` non portano mai `evidenceRefs` per costruzione della
   fonte dati (`pilotControlCheck.mjs`) — le loro azioni diagnostiche si baseranno quindi sempre
   solo su target di riga/documento o su nessun target, mai su un link di evidenza diretto; questo
   è un limite della fonte dati, non risolvibile da questa fase senza modificare la logica di
   rilevamento delle segnalazioni.
3. Il nome/forma esatta dell'hook condiviso (`usePurchaseOrderQualityContract`) e la sua esatta
   value di ritorno restano una decisione di implementazione, non irrigidita da questo documento
   oltre al contratto comportamentale descritto in §2.
4. Con un solo genuino finding live oggi (`OPERATIONAL_STATE_UNEXPLAINED` su `13542272`), la
   regola di ordinamento di §7 (che entra in gioco solo con più di 3 azioni diagnostiche
   contemporanee) non è oggi osservabile su dati reali — resta verificabile solo con fixture.

---

## 16. Conferma di stato

- File creato in questo turno: **`docs/product/PILOT_PHASE_2C_DIAGNOSTIC_SUGGESTIONS_PROPOSAL.md`**
  (questo documento).
- Nessun altro file è stato modificato, creato o rimosso.
- Nessun commit, push o deploy è stato eseguito.
