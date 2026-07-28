# Fase 2C.1A — Azioni operative suggerite, sola lettura (specifica funzionale approvata)

Stato: **approvata, non implementata**. Nessun codice sorgente, test, endpoint o adapter è stato
modificato per produrre questo documento — solo questo file è stato creato.

Questo documento sostituisce integralmente la bozza conversazionale di Fase 2C discussa in
precedenza. Rispetto a quella bozza, questa versione: restringe l'ambito immediato alla sola Fase
2C.1A (nessuna azione diagnostica, nessuna nuova richiesta, nessuna persistenza); sostituisce
`VERIFY_COMMITMENT_WITHOUT_OBSERVATION` (vietata) con `VERIFY_EXPIRED_LINE_COMMITMENT`, provata
esclusivamente su `remainingQuantity`; corregge il conteggio della tassonomia precedente (5 codici,
non 6); e riconferma con dati live aggiornati la copertura reale su tutti e tre gli ordini Graphic
Center Group.

Questa versione risolve inoltre, in modo definitivo e non più aperto, l'ambiguità tra
`ATTENTION_OVERDUE` e `VERIFY_EXPIRED_LINE_COMMITMENT` sullo stesso ordine (§7): quando l'ordine è
`OVERDUE`, l'azione riga viene sempre soppressa, mai raggruppata o mostrata in un dettaglio
annidato.

Questo documento non modifica `OrderOperationalView.jsx`, `getOrderOperationalView`,
`statusRules.js`, `dataQualityContract.mjs`, `pilot-quality-contract.js`, né alcun altro file
sorgente o di documentazione già esistente. Descrive solo cosa dovrà essere costruito.

---

## 1. Perimetro di Fase 2C.1A

Riguarda esclusivamente ordini di acquisto verso fornitori (mai ordini cliente). Produce
**suggerimenti operativi derivati, ricalcolati a ogni apertura**, mai eventi, mai stato, mai
segnalazioni diagnostiche, mai attività eseguite automaticamente, mai prova che qualcuno abbia
completato qualcosa.

Fase 2C.1A usa **esclusivamente** la risposta già caricata di `getOrderOperationalView` — nessuna
nuova richiesta di rete, nessun nuovo endpoint, nessuna chiamata a `pilot-quality-contract`.

---

## 2. Suddivisione di fase (confermata)

| Fase | Contenuto | Stato in questo documento |
|---|---|---|
| **2C.1A** | Azioni operative sola lettura da `OrderOperationalView`, visibili a tutti i 5 ruoli | **Specificata qui, pronta per implementazione** |
| **2C.1B** | Consolidare le azioni diagnostiche già mostrate da Fase 2A (`finding.recommendedAction`) nel nuovo layer di azioni; copia fissa in italiano per tipo di segnalazione; un'unica richiesta quality-contract condivisa; nessun duplicato; visibilità Owner/Admin/IT invariata | **Rinviata, non specificata in dettaglio qui** |
| **2C.2** | Task persistiti (assegnazione, completamento, scadenza, snooze, audit) e integrazione con la coda "Oggi" esistente | **Rinviata** — deve valutare il riuso di `operational_actions` e di `buildOperationalQueue`/`operationalQueue`, non progettare un secondo schema o una seconda coda parallela |

---

## 3. Tassonomia chiusa di Fase 2C.1A — quattro codici

Nessuna azione diagnostica è inclusa in 2C.1A. `REVIEW_DATA_QUALITY_FINDING` (proposta
precedentemente) è esplicitamente rinviata a 2C.1B, perché richiederebbe montare il componente
diagnostico e la relativa richiesta `pilot-quality-contract` — vietato in questa fase.

| # | Codice | Titolo fisso | Copia fissa |
|---|---|---|---|
| 1 | `VERIFY_ORDER_STATUS` | "Verifica ordine" | "Lo stato operativo di questo ordine richiede una verifica manuale." |
| 2 | `ATTENTION_OVERDUE` | "Ordine in ritardo" | "L'ordine è oltre la data prevista. Verifica lo stato aggiornato dell'ordine e valuta il canale operativo più appropriato." |
| 3 | `ATTENTION_APPROACHING_DEADLINE` | "Ordine in scadenza" | "L'ordine si avvicina alla data prevista. Verifica che le informazioni operative disponibili siano aggiornate." |
| 4 | `VERIFY_EXPIRED_LINE_COMMITMENT` | "Verifica riga oltre la data prevista" | "La data prevista per questa riga è trascorsa e nei dati correnti risulta ancora una quantità residua. Verifica lo stato della riga." |

---

## 4. Decisione tecnica sul codice 4 — verificata contro il contratto reale

Il vincolo posto era: approvare `VERIFY_EXPIRED_LINE_COMMITMENT` **solo se** il contratto
`OrderOperationalView` può provare, in modo deterministico, tutte e quattro le condizioni
richieste. Ho verificato ciascuna direttamente nel codice sorgente vivo:

1. **Esiste una `dueDate`/`requiredDate` di riga** — confermato:
   [server/routes/order-operational-view.js:302-303](server/routes/order-operational-view.js:302)
   popola `requiredDate: r.required_date || null` e `dueDate: r.due_date || null` per ogni riga di
   `canonicalMaterialLines`, letti direttamente da `canonical_operational_lines.required_date` /
   `.due_date`.
2. **La data è oggi o nel passato** — riuso esatto, senza reimplementazione, di
   `daysFromToday()`/`parseDate()` ([src/utils/dateUtils.js](src/utils/dateUtils.js)), la stessa
   funzione già usata da `getOrderStatus()` in
   [src/utils/statusRules.js:27](src/utils/statusRules.js:27). Nessuna nuova regola di fuso orario
   o di "oggi" viene introdotta: il confronto usa `today.setHours(0,0,0,0)` esattamente come già
   fa `daysFromToday`. Un impegno (`dueDate` o `requiredDate`) qualifica se e solo se
   `daysFromToday(value, referenceDate) <= 0`, con lo stesso `referenceDate` già usato da
   `getOrderStatus()` per l'intera risposta — mai un "oggi" calcolato separatamente per la riga.
3. **La riga è ancora aperta tramite una regola di stato corrente documentata** — qui la richiesta
   originale suggeriva due possibili prove: una quantità residua numerica, oppure uno stato
   "aperto" esplicitamente approvato. Ho verificato che **solo la prima è utilizzabile in modo
   sicuro**: `remainingQuantity` ([order-operational-view.js:300](server/routes/order-operational-view.js:300),
   da `r.remaining_quantity`) è un campo numerico con semantica chiara (quantità ordinata meno
   quantità consegnata). Il campo `status` di riga (`r.status`, es. osservato live come
   `"Confermato"` o `"Da verificare"`) **non ha invece un contratto enum documentato altrove nel
   codice** — non esiste alcuna lista chiusa di valori validi né una definizione di quali stati
   contano come "aperto". Usarlo per provare che una riga è ancora aperta significherebbe inventare
   una regola non garantita dal contratto attuale. **Decisione: il trigger usa esclusivamente
   `remainingQuantity > 0`, mai il campo `status` di riga.** Il controllo è vincolato al tipo e
   fail-closed su qualunque valore ambiguo:

   ```
   if (typeof value === "number"):
     Number.isFinite(value) && value > 0

   else if (typeof value === "string"):
     trim
     reject empty
     validate ordinary decimal/scientific numeric syntax
     parse
     Number.isFinite(parsed) && parsed > 0

   else:
     false
   ```

   Restano supportati numeri positivi e stringhe numeriche decimali/scientifiche positive, per
   esempio `1`, `1.5`, `"1"`, `" 1.5 "` e `"1e2"`. Sono rifiutati `null`, `undefined`, stringhe
   vuote, valori zero o negativi, `NaN`, `Infinity`, stringhe non numeriche o esadecimali, booleani,
   array, oggetti, funzioni, simboli e bigint. È vietata la coercizione JavaScript di valori come
   `true`, `[1]` o `["1"]`: il tipo deve essere verificato prima di qualunque parsing.
4. **L'ordine non è CLOSED** — confermato leggibile da `businessStatus` (via `getOrderStatus`),
   stesso campo già usato dagli altri tre codici.

Poiché tutte e quattro le condizioni sono provabili con dati già presenti nella risposta esistente
di `OrderOperationalView`, **il codice è approvato**, con il trigger per-riga ristretto a:

```
(dueDate o requiredDate di riga esiste)
  AND daysFromToday(quella data, referenceDate) <= 0 (stesso referenceDate di getOrderStatus)
  AND remainingQuantity è un numero finito positivo
      OR una stringa non vuota con sintassi decimale/scientifica valida
         che produce un numero finito positivo
  AND businessStatus dell'ordine !== 'CLOSED'
```

**Questo trigger per-riga non è però l'ultima parola sulla generazione dell'azione**: quando
`businessStatus === 'OVERDUE'`, l'azione riga viene sempre soppressa a livello di ordine, come
regola autoritativa e non più aperta — vedi §7 per la regola esatta e la motivazione.

Se in futuro emergesse la necessità di usare anche il campo `status` di riga, questo richiederebbe
prima di definire un contratto enum esplicito per quel campo altrove nel codice — fuori
dall'ambito di questa fase.

---

## 5. Tabella decisionale completa

| Proprietà | `VERIFY_ORDER_STATUS` | `ATTENTION_OVERDUE` | `ATTENTION_APPROACHING_DEADLINE` | `VERIFY_EXPIRED_LINE_COMMITMENT` |
|---|---|---|---|---|
| Trigger esatto | `businessStatus === 'TO_VERIFY'` | `businessStatus === 'OVERDUE'` | `businessStatus === 'CRITICAL'` | vedi §4, **soppressa quando `businessStatus === 'OVERDUE'`** (vedi §7) |
| Livello | Ordine | Ordine | Ordine | Riga |
| Ruoli | Owner, Admin, IT, Buyer, ReadOnly | stessi | stessi | stessi |
| Fonte | `OrderOperationalView` (già caricato) | stessa | stessa | stessa |
| Nuova richiesta | No | No | No | No |
| Navigazione evidenza | Nessuna (lo stato non ha un riferimento esatto) | Nessuna | Nessuna | Nessuna (le righe non portano un riferimento di evidenza — coerente con Fase 2B.1) |
| Bucket priorità | Priorità operativa | Priorità operativa | Da verificare | Da verificare |
| Chiave di deduplica | `orderId:VERIFY_ORDER_STATUS` | `orderId:ATTENTION_OVERDUE` | `orderId:ATTENTION_APPROACHING_DEADLINE` | `orderId:VERIFY_EXPIRED_LINE_COMMITMENT:lineId` (identità per riga, **non** per campo — vedi §7) |
| Scompare quando | `businessStatus` cambia | `businessStatus` cambia | `businessStatus` cambia | la data non è più scaduta, `remainingQuantity` non è più un numero finito positivo o una stringa decimale/scientifica valida e positiva, la riga/l'ordine viene chiuso, **oppure l'ordine diventa `OVERDUE`** (soppressione, non scomparsa del trigger sottostante — §7) |
| Copertura live oggi | Sì (ordine `228751`) | Sì (ordine `13542272`) | **Solo fixture** (nessun ordine è oggi `CRITICAL`) | Sì (ordine `0013545497`; su `13542272` il trigger di riga è soddisfatto ma l'azione è soppressa dalla regola di §7 — vedi §13) |
| Implementabile senza backend | Sì | Sì | Sì | Sì |

`orderId`/`lineId` sono usati solo per identità/ordinamento interni e **non devono mai essere
resi visibili** nel testo o nell'interfaccia.

---

## 6. Modello di priorità

Tre bucket deterministici, senza punteggi, senza "critico" non definito, senza scadenza inventata:

| Bucket | Etichetta italiana | Trigger | Precedenza |
|---|---|---|---|
| `OPERATIONAL_PRIORITY` | "Priorità operativa" | `TO_VERIFY` o `OVERDUE` | Più alta |
| `TO_REVIEW` | "Da verificare" | `CRITICAL`, o un'azione riga approvata (`VERIFY_EXPIRED_LINE_COMMITMENT`) | Media |
| `TO_MONITOR` | "Da monitorare" | Riservato a futuri trigger operativi supportati | Più bassa — **Fase 2C.1A può legittimamente non produrre mai un'azione in questo bucket** |

Non vengono usate le etichette "Attenzione immediata" o "Da verificare oggi". Nessuna azione
implica una scadenza per l'azione stessa: `ATTENTION_OVERDUE` non istruisce mai a contattare il
fornitore, si limita a chiedere una verifica e a lasciare aperta la scelta del canale.

---

## 7. Deduplica e precedenza

Questa sezione è **autoritativa e non più una decisione aperta**: la regola seguente sostituisce
integralmente il precedente comportamento di "raggruppamento in dettaglio annidato" descritto in
una versione precedente di questo documento.

### 7.1 `ATTENTION_OVERDUE` sopprime sempre le azioni riga sullo stesso ordine

- **Quando `businessStatus === 'OVERDUE'`**: viene generata `ATTENTION_OVERDUE` e **ogni**
  `VERIFY_EXPIRED_LINE_COMMITMENT` per quell'ordine viene **soppressa** — non generata, non
  mostrata, non raggruppata in un dettaglio annidato. Non esiste alcuna presentazione compatta
  delle righe scadute quando l'ordine è `OVERDUE`.
  - **Motivo**: l'azione ordine-livello comunica già la condizione operativa; le azioni riga
    duplicherebbero la stessa informazione senza aggiungere un fatto verificabile diverso.
  - La soppressione riguarda **solo la generazione dell'azione**, non il trigger di riga
    sottostante (§4), che resta vero e verrà rivalutato a ogni apertura — se l'ordine smette di
    essere `OVERDUE` mentre la riga resta scaduta e con quantità residua, l'azione riga torna a
    essere generata normalmente.
- **Quando `businessStatus !== 'OVERDUE'`** (inclusi `TO_VERIFY`, `CRITICAL`, `WARNING`, `OK`, ma
  mai `CLOSED`): ogni riga che soddisfa il trigger di §4 genera la propria
  `VERIFY_EXPIRED_LINE_COMMITMENT`, come voce autonoma — non esiste alcuna azione ordine-livello
  con cui raggrupparla in questo stato (`ATTENTION_APPROACHING_DEADLINE`/`VERIFY_ORDER_STATUS` non
  parlano di righe, quindi non sono in competizione con l'azione riga).

### 7.2 Un'azione per riga, anche con più impegni scaduti sulla stessa riga

- Ogni riga genera **al massimo un'azione** `VERIFY_EXPIRED_LINE_COMMITMENT`, indipendentemente da
  quanti campi data qualificano.
- Se sia `dueDate` sia `requiredDate` della stessa riga sono oggi o nel passato (entrambe
  verificate con `daysFromToday(value, referenceDate) <= 0`), **entrambe restano come dettagli di
  supporto distinti all'interno della stessa azione riga** — mai scelte l'una a scapito dell'altra,
  mai selezionata una data come "autoritativa" tra le due, e mai generate due azioni separate per
  la stessa riga solo perché entrambi i campi qualificano.
- La chiave di deduplica riflette questo: `orderId:VERIFY_EXPIRED_LINE_COMMITMENT:lineId` identifica
  la riga, non il singolo campo data — vedi §5.

### 7.3 Più righe qualificanti sullo stesso ordine

- Ogni riga che soddisfa il trigger genera una voce separata (mai unita in un conteggio
  aggregato).
- L'ordinamento tra le voci è deterministico (per `lineId`, stesso criterio di stabilità già usato
  altrove in questo documento e nelle fasi precedenti).
- Vengono mostrate al massimo **3 azioni** inizialmente (coerente con il limite generale di §9); le
  rimanenti sono esposte tramite "+N altre azioni", mai omesse silenziosamente.

### 7.4 Altre regole di deduplica

- **Azioni ordine-livello e riga-livello con copia visibile identica**: non vengono mai
  deduplicate per testo — la chiave include sempre il livello e l'id del target.
- **Ordine CLOSED**: nessuna azione operativa viene generata (tutti i trigger richiedono
  `businessStatus !== 'CLOSED'`, esplicitamente per il codice 4, e implicitamente per gli altri tre
  poiché nessuno di essi può essere vero se `businessStatus === 'CLOSED'`).
- **Nessun valore "vincente"**: non applicabile in questa fase, poiché nessuna delle quattro azioni
  legge campi in conflitto tra loro; il caso più vicino (due impegni di riga scaduti
  contemporaneamente, §7.2) è risolto tenendoli entrambi come dettagli distinti, mai scegliendone
  uno come autoritativo.

---

## 8. Visibilità per ruolo e comportamento di richiesta

Tutti i 5 ruoli già autorizzati su `OrderOperationalView` (Owner, Admin, IT, Buyer, ReadOnly)
vedono le azioni operative di Fase 2C.1A, per informazione — ReadOnly le vede senza poter agire,
coerentemente con come già vede oggi la Fase 2A e la Fase 2B.1 sullo stesso pannello.

Vincoli tecnici obbligatori:
- nessuna nuova richiesta di rete;
- nessun componente diagnostico viene montato;
- `pilot-quality-contract` non viene mai chiamato da questa fase;
- nessun permesso viene ampliato, silenziosamente o esplicitamente.

---

## 9. Architettura informativa in UI

Sezione "Azioni suggerite", posizionata sotto la sintesi di Fase 2A e la cronologia di Fase 2B.1
(puramente additiva — nessuna modifica a `OrderDetailPanel`).

- Massimo **3 azioni operative** visibili inizialmente, ordinamento deterministico (per bucket di
  priorità, poi per `orderId`/`lineId` interni — mai visibili); espansione tramite "+N altre
  azioni". Ogni riga qualificante genera al massimo una voce nell'elenco (§7.2/§7.3); nessuna
  azione riga compare quando l'ordine è `OVERDUE` (§7.1).
- Ogni azione mostra: titolo fisso, motivazione fissa, etichetta di priorità deterministica,
  descrizione della riga interessata quando applicabile (con entrambi gli impegni scaduti elencati
  come dettagli distinti se sia `dueDate` sia `requiredDate` qualificano, §7.2), navigazione solo
  quando esiste già un target esatto (nessuna azione di questa fase ne ha uno, vedi §5 — questo
  campo resta quindi vuoto in 2C.1A e diventerà rilevante solo con le azioni diagnostiche di
  2C.1B).
- Nessun controllo di completamento, assegnazione, dismissione, snooze o scadenza.
- Stato vuoto: "Nessuna azione suggerita per questo ordine."
- Ordini CLOSED: nessuna azione operativa mostrata.

---

## 10. Infrastruttura "Oggi" e Task esistente — presa d'atto esplicita

- `buildOperationalQueue()` / `buildOperationalSuggestions()`
  ([src/adapters/supabaseServerAdapter.js](src/adapters/supabaseServerAdapter.js)) e la coda
  "Oggi" del `DashboardView` **esistono già** e sono attive (live: 26 elementi in
  `operationalQueue`, 4 in `operationalSuggestions`), ma appartengono a un dominio più vecchio e
  non correlato (linee materiali, preventivi, bolle, dispacci fornitore) — non agli ordini di
  acquisto né alla qualità dati.
- La tabella `operational_actions` **esiste già**, generica e multi-tenant (colonne: `id`,
  `action_type`, `status`, `title`, `detail`, `entity_type`, `entity_id`, `project_id`,
  `due_date`, `assigned_membership_id`, `created_by_membership_id`, `completed_at`, `metadata`,
  `deduplication_key`, `organization_id`, `created_at`, `updated_at`), usata oggi esclusivamente
  da ContractWatch SAL billing; **0 righe** per questo tenant.
- **Fase 2C.1A non modifica né usa nessuna delle due.**
- **Fase 2C.2**, se mai approvata, dovrà valutare il riuso di `operational_actions` (struttura già
  compatibile con "task": assegnatario, scadenza, completamento) e l'integrazione con
  `buildOperationalQueue`/`operationalQueue`, **non progettare un secondo schema o una seconda coda
  parallela**.

---

## 11. Correzioni rispetto alla proposta precedente

- **Conteggio tassonomia**: la proposta precedente elencava, nel testo, "sei codici" nella
  tabella §5, ma la tabella conteneva in realtà **5 codici azione veri** (`VERIFY_ORDER_STATUS`,
  `ATTENTION_OVERDUE`, `ATTENTION_APPROACHING_DEADLINE`, `VERIFY_COMMITMENT_WITHOUT_OBSERVATION`,
  `REVIEW_DATA_QUALITY_FINDING`) più una riga di nota (assenza di azione per
  `SECTION_NOT_EVALUATED`) erroneamente conteggiata come sesto codice. **Il conteggio corretto era
  5, non 6.**
- Di quei 5, **4 avevano un esempio live** (`VERIFY_ORDER_STATUS`, `ATTENTION_OVERDUE`,
  `VERIFY_COMMITMENT_WITHOUT_OBSERVATION`, `REVIEW_DATA_QUALITY_FINDING`) e **1 era solo fixture**
  (`ATTENTION_APPROACHING_DEADLINE`).
- Dopo la sostituzione di `VERIFY_COMMITMENT_WITHOUT_OBSERVATION` (vietata, vedi §12) con
  `VERIFY_EXPIRED_LINE_COMMITMENT`, e il rinvio di `REVIEW_DATA_QUALITY_FINDING` a Fase 2C.1B, la
  tassonomia di **Fase 2C.1A conta esattamente 4 codici**, di cui **3 con esempio live oggi**
  (`VERIFY_ORDER_STATUS`, `ATTENTION_OVERDUE`, `VERIFY_EXPIRED_LINE_COMMITMENT`) e **1 solo
  fixture** (`ATTENTION_APPROACHING_DEADLINE`).
- **Problema preesistente registrato, non risolto qui**: Fase 2A mostra oggi
  `finding.recommendedAction` verbatim, in inglese, nella sezione "Azioni già indicate dalle
  segnalazioni". Fase 2C.1A non lo corregge né lo duplica. **Fase 2C.1B dovrà risolverlo** nel
  momento in cui consolida le azioni diagnostiche nel nuovo layer, sostituendo quel testo con una
  copia fissa in italiano indicizzata per tipo di segnalazione.

---

## 12. Regola vietata — promemoria esplicito

`VERIFY_COMMITMENT_WITHOUT_OBSERVATION` **non viene implementata**. Un evento generico
`DOCUMENT_OBSERVED` non prova mai che un impegno sia stato confermato, aggiornato o soddisfatto:
nessuna azione di questa fase sopprime un trigger basandosi sull'osservazione di un documento
generico non correlato, e nessun impegno futuro genera un'azione prematura (`VERIFY_EXPIRED_LINE_COMMITMENT`
richiede esplicitamente che la data sia già oggi o nel passato).

---

## 13. Copertura live — Graphic Center Group (verificata in questa sessione)

Verifica effettuata in sola lettura tramite server di sviluppo temporaneo
(`ALLOW_LEGACY_AUTH=true`), poi arrestato; nessun file modificato.

| Ordine | `businessStatus` | Azioni ordine-livello prodotte | Azioni riga prodotte |
|---|---|---|---|
| `13542272` (OVERDUE, `daysRemaining: -10`) | OVERDUE | `ATTENTION_OVERDUE` | **Nessuna** — il trigger di riga è soddisfatto (`dueDate: 2026-07-17`, `remainingQuantity: 101`), ma l'azione è **soppressa** dalla regola di §7.1 perché l'ordine è `OVERDUE`; non viene mostrato alcun dettaglio annidato |
| `0013545497` (`daysRemaining: 3`, non OVERDUE/CRITICAL/TO_VERIFY) | OK/WARNING | Nessuna | `VERIFY_EXPIRED_LINE_COMMITMENT` su 1 riga (`dueDate: 2026-07-20`, `remainingQuantity: 3`) — mostrata come voce autonoma, non soppressa perché l'ordine non è `OVERDUE`; le altre 2 righe dello stesso ordine non hanno `dueDate`/`requiredDate` valorizzata e non generano azione |
| `228751` (`needsReview: true`) | TO_VERIFY | `VERIFY_ORDER_STATUS` | Nessuna (l'unica riga non ha `dueDate`/`requiredDate`) |

Nessun ordine è oggi `CRITICAL`: `ATTENTION_APPROACHING_DEADLINE` resta verificabile solo tramite
fixture.

---

## 14. Limiti aperti

1. **Risolto in questa revisione, non più aperto**: la relazione tra `ATTENTION_OVERDUE` e
   `VERIFY_EXPIRED_LINE_COMMITMENT` sullo stesso ordine è ora una regola autoritativa e
   deterministica (soppressione totale delle azioni riga quando l'ordine è `OVERDUE`, §7.1) —
   non esiste più alcun comportamento di raggruppamento in dettaglio annidato né alcuna soglia da
   decidere in fase di implementazione per quel caso.
2. Il campo `status` di riga (`r.status`) resta un valore opaco senza contratto enum documentato:
   se in futuro si volesse un'azione basata su di esso, serve prima definire quel contratto altrove
   nel codice.
3. Le stringhe numeriche restano supportate per compatibilità con il contratto corrente, ma solo
   dopo validazione della sintassi decimale/scientifica ordinaria. Non è ammessa la coercizione
   JavaScript di booleani, array, oggetti o altri tipi non numerici/non stringa.
4. Fase 2C.1B (consolidamento diagnostico) e Fase 2C.2 (persistenza) restano entrambe da
   specificare in dettaglio quando verranno approvate.

---

## 15. Conferma di stato

- File creato in questo turno: **`docs/product/PILOT_PHASE_2C_OPERATIONAL_SUGGESTIONS_PROPOSAL.md`**
  (questo documento).
- Nessun altro file è stato modificato, creato o rimosso.
- Nessun commit, push o deploy è stato eseguito.
