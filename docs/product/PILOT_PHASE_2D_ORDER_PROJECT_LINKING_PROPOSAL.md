# Fase 2D.1 — Collegamento deterministico ordine di acquisto ↔ progetto/commessa (analisi, sola documentazione)

Stato: **proposta, non implementata**. Nessun codice sorgente, test, endpoint, adapter, schema
database, file di pacchetto o configurazione è stato modificato per produrre questo documento.
Nessun dato live è stato modificato. Solo questo file è stato creato.

Ogni affermazione in questo documento è etichettata come una delle quattro categorie seguenti:

- **[CONFERMATO]** — verificato direttamente nel codice sorgente, nello schema o nei dati live in
  questa sessione;
- **[PROPOSTO]** — una raccomandazione di design, non ancora approvata né implementata;
- **[RINVIATO]** — esplicitamente fuori perimetro per questa fase;
- **[DECISIONE APERTA]** — richiede un'approvazione di prodotto prima di poter procedere.

---

## 1. Stato e scopo

**[CONFERMATO]** Fasi completate: 1, 1B, 2A, 2B.1, 2C.1A, 2C.1B (tutte committate in HEAD,
`1d09008`). Fase 2B.2 rinviata. Pianificate dopo questa fase: 2E, 2D.2, 2C.2, 3, 4, 5.

**[PROPOSTO]** Fase 2D.1 stabilisce se un ordine di acquisto — o una o più delle sue righe —
appartiene a: un progetto/commessa; più progetti/commesse; magazzino generale; spese generali/
overhead; un contesto non ancora confermato. Riguarda esclusivamente ordini di acquisto verso
fornitori (mai ordini cliente). La relazione può esistere a livello di intero ordine, a livello di
singola riga, o a entrambi i livelli (con la riga che affina un default d'ordine). **Non si assume
che ogni ordine di acquisto appartenga necessariamente a un progetto.**

---

## 2. Riscontri attuali nel repository — la scoperta centrale di questa fase

**[CONFERMATO]** Contrariamente a un'ipotesi "si parte da zero", il repository contiene già
un'infrastruttura di collegamento progetto sostanziale, ma **costruita per il lato domanda cliente
(preventivi/richieste cliente), non per il lato ordine di acquisto verso fornitore**. Questa è la
scoperta più importante di questa analisi e determina l'intero perimetro tecnico della fase.

### 2.1 Entità canonica `projects` — già esistente

Tabella `projects` (`supabase/migrations/20260707181816_initial_orderwatch_schema.sql:17-26`):
`id UUID PK`, `project_code TEXT` (originariamente `UNIQUE` globale), `customer`, `owner`,
`status DEFAULT 'Aperto'`, `due_date`, `open_orders_count`, `notes`, `created_at`, `updated_at`.

**[CONFERMATO]** Con `20260712101136_tenant_isolation_gate2.sql:119-120`, il vincolo globale
`projects_project_code_key` è stato **rimosso** e sostituito da
`UNIQUE (organization_id, project_code)` — il codice progetto è correttamente **isolato per
tenant** già oggi, non un problema aperto.

**[CONFERMATO]** L'adapter (`src/adapters/supabaseServerAdapter.js:182-202`) espone già un mapper
`projects` completo, con campi aggiuntivi non presenti nella migrazione originale (evidentemente
aggiunti da migrazioni successive, non lette una per una in questa sessione ma confermate dalla
forma del mapper): `contractStatus`, `contractWatchEnabled`, `responsibleMembershipId`,
`createdByMembershipId`, `startDate`, `expectedEndDate`, `archivedAt`. **`responsibleMembershipId`
è già, di fatto, un embrione di "responsabile di progetto"** — rilevante per la sezione ruoli (§20).

### 2.2 `orders.project_id` — una foreign key reale, mai esposta al frontend

**[CONFERMATO]** `supabase/migrations/20260707181816_initial_orderwatch_schema.sql:47-63` mostra
che la tabella `orders` ha **entrambi**:
```
project_id UUID REFERENCES projects(id)
project_code TEXT
```
**[CONFERMATO]** Il mapper `orders` dell'adapter (`supabaseServerAdapter.js:163-181`) espone
**solo** `projectCode: row.project_code` — **`project_id` non viene mai letto né esposto al
frontend in nessun punto del codice ispezionato.** Lo stesso vale per l'endpoint
`order-operational-view.js:75` (la query seleziona `project_code`, non `project_id`) e per il suo
output (`projectCode: order.project_code || null`, riga 341).

Questo significa: **esiste già uno schema pronto per un collegamento ordine→progetto tramite FK**,
ma oggi l'intera pipeline di lettura (adapter, endpoint, Fase 2A/2B.1/2C.1A/2C.1B) dipende
esclusivamente dal testo denormalizzato `project_code`, mai dalla FK. Un disallineamento tra
`orders.project_id` e `orders.project_code` (se mai introdotto da un processo di scrittura futuro)
non sarebbe oggi rilevabile da nessun livello applicativo.

### 2.3 `material_lines`/`canonical_operational_lines` — stesso doppio campo, stessa asimmetria

**[CONFERMATO]** `supabase/migrations/20260710235555_add_material_lines.sql:6-7,32`:
`project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL`, `project_code TEXT`, con un
indice su `project_code` (non su `project_id`). Il mapper `materialLines` dell'adapter
(`supabaseServerAdapter.js:258-288`) espone **entrambi** `projectId` e `projectCode`.

**[CONFERMATO]** Tuttavia, la query di `canonicalMaterialLines` dentro
`server/routes/order-operational-view.js:128` — cioè l'unica fonte di righe che Fase
2A/2B.1/2C.1A/2C.1B leggono — **non seleziona né `project_id` né `project_code`**. Il livello di
riga del contratto `OrderOperationalView` è oggi **completamente cieco** rispetto al progetto,
anche se il dato esistesse nel database.

### 2.4 `quotes.project_id`/`project_code` — un precedente diretto e già documentato nel codice

**[CONFERMATO]**, commento verificato live in `order-operational-view.js:159-172`: `quotes` porta
`project_id`/`project_code` ma **nessuna colonna che la identifichi a un ordine specifico** — il
commento nota esplicitamente che il riferimento progetto su una quota "è condiviso da ogni ordine
dello stesso progetto e rappresenterebbe erroneamente preventivi a livello di
organizzazione/progetto come documenti appartenenti a questo singolo ordine." Il commento conferma
anche, via query live contro `information_schema`: **0/34 righe `quote_line` hanno `order_id`**;
**0/5 righe `purchase_order_line` hanno `quote_id`** — nessuna relazione quota↔ordine deterministica
esiste oggi. Le quote sono quindi **omesse** da `linkedDocuments` finché non esista un
`order_id` reale, seguendo la regola già stabilita nel contratto: "segna non disponibile o ometti
per collegamenti non provati."

**Questo è un precedente diretto, già in produzione, per esattamente il principio che Fase 2D.1
deve applicare**: un riferimento progetto condiviso a livello più ampio (qui: quota; nel caso di
Fase 2D.1: potenzialmente organizzazione) non deve mai essere presentato come se appartenesse a
un'entità più specifica senza una relazione dimostrabile.

### 2.5 `entity_aliases` — un meccanismo di alias generico, che supporta `project`, mai utilizzato

**[CONFERMATO]** `supabase/migrations/20260711080611_backend_v2_product_schema.sql:162-176`:
tabella `entity_aliases` con `entity_type CHECK (... IN ('supplier','customer','project','order',
'material','sender'))`, `entity_id`, `canonical_name`, `alias`, `normalized_alias`,
`source CHECK (... IN ('ai','buyer','system','import'))`, `confidence NUMERIC(3,2)`, `active`,
`UNIQUE (entity_type, normalized_alias)` (poi ristretto per tenant in
`20260712101136_tenant_isolation_gate2.sql:135` a `UNIQUE (organization_id, entity_type,
normalized_alias)`).

**[CONFERMATO]** `entity_type = 'project'` è un valore schema-valido, ma **grep esaustivo su
`scripts/`, `server/`, `src/` non trova alcun riferimento a `entity_aliases` in nessun codice
applicativo.** Questa tabella è **schema-presente, wiring-assente** — un'infrastruttura di alias
pronta ma inutilizzata per i progetti, e inutilizzata in generale in tutto il codebase ispezionato.
Non deve essere presentata come "già funzionante". **Correzione**: `entity_aliases` è un
**candidato per il riuso, non ancora approvato**, in attesa di validazione di schema e
comportamento (§9.2/§10bis) — non un meccanismo pronto all'uso per il collegamento progetto.

### 2.6 Nessuna logica di estrazione/matching progetto in questo repository

**[CONFERMATO]** Non esiste, in questo repository, alcun file `email-processor`, `worker`, o
logica di classificazione email/matching fornitore-ordine (questi file non sono presenti in questa
checkout, a differenza di quanto suggerito da riferimenti storici a un "worker" separato deployato
su Railway). **Non è quindi possibile confermare da questo repository come/se `orders.project_code`
o `material_lines.project_id`/`project_code` vengano oggi popolati per gli ordini di acquisto** —
questa è una lacuna di visibilità dichiarata esplicitamente, non un'assunzione silenziosa.

### 2.7 UI di collegamento manuale esistente — solo lato domanda cliente

**[CONFERMATO]** `src/views/DashboardView.jsx` (righe ~128, 293, 312, 733-740, 837-1000) e
`src/views/SuppliersView.jsx` (righe ~295-599) implementano già un pattern `linkDraft` con
`projectCode`/`orderCode` per collegare manualmente elementi della coda operativa "Oggi"
(`buildOperationalQueue`, righe materiali/preventivi non collegati) a un progetto o a un ordine
tramite una select popolata da `openProjects`. **Questo meccanismo opera sul lato domanda/materiale
generico esistente (Fase pre-2C), non sull'entità ordine-di-acquisto-fornitore di
`OrderOperationalView`**, e non produce oggi alcun record di provenienza formale (chi ha
confermato, quando, con quale motivazione) oltre a scrivere direttamente `project_code` sul record.
Questo è un precedente UI utile da riusare concettualmente per §14, ma **non** è il meccanismo di
conferma manuale con audit che Fase 2D.1 richiede.

### 2.8 Data Quality Contract — nessuna dimensione progetto oggi

**[CONFERMATO]** `scripts/lib/dataQualityContract.mjs` e `scripts/lib/pilotControlCheck.mjs`: grep
esaustivo per "project" non trova alcun riferimento. **Nessuna delle 8 categorie diagnostiche
esistenti (Fase 1B/2C.1B) riguarda il collegamento progetto.** Questa è una lacuna, non un gap da
colmare implicitamente in questa fase — vedi §15.

### 2.9 Tabella riassuntiva dei campi candidati

| Campo | Fonte | Entità | Tipo | Opzionale | Popolato live (GCG) | Semantica apparente | Semantica confermata o inferita | Supporta linking deterministico | Provenienza oggi | Rischi tenant-specifici |
|---|---|---|---|---|---|---|---|---|---|---|
| `orders.project_id` | DB | ordine | UUID FK | sì | **No** (mai esposto) | Collegamento diretto a progetto | Confermata dallo schema, mai esercitata | Sì, in teoria — mai popolata/letta oggi | Nessuna | Nessuno noto |
| `orders.project_code` | DB/API | ordine | TEXT | sì | **No** (null sui 3 ordini noti) | Codice commessa denormalizzato | Confermata (letta/esposta ovunque) | Solo se popolato e coerente con `projects.project_code` | Nessuna | Divergenza silenziosa da `project_id` mai rilevata |
| `material_lines.project_id`/`project_code` | DB/API | riga | UUID/TEXT | sì | **Sì**, ma solo per righe `quote`/`customer_request` (mai `supplier_order`) | Collegamento riga↔progetto | Confermata | Sì, per il lato domanda; non ancora per righe ordine-fornitore | Nessuna | Nessuno |
| `quotes.project_id`/`project_code` | DB | quota | UUID/TEXT | sì | Non ispezionato in dettaglio (fuori scopo ordine-fornitore) | Riferimento progetto condiviso da più ordini | Confermata (commento nel codice, verificato live) | **No** — condiviso, mai attribuibile a un ordine | N/A | Attribuzione errata se mai esposto per-ordine |
| `entity_aliases` (`entity_type='project'`) | DB | alias | tabella | sì | Non popolata (nessun query-path) | Alias tenant-configurato → progetto canonico | Schema-confermata, wiring assente | Sì, se implementata (§9 regola 3) | Il campo `source` già distingue ai/buyer/system/import | Nessuno, già scoped per organization_id |
| `processed_emails.linked_project_code` | DB/API | email | TEXT | sì | Non ispezionato per i 3 ordini (nessun processo di estrazione visibile in questo repo) | Collegamento email→progetto | Schema-confermata, popolamento non verificabile da questo repo | Solo come riferimento derivato, non come fonte primaria | Nessuna esplicita | Non verificabile da qui |
| `linkDraft.projectCode` (UI) | Frontend | riga/ordine generico | stringa da select | — | Manuale, per righe generiche | Assegnazione manuale utente | Confermata (codice UI) | Sì, ma senza record di provenienza/audit | Nessuna oltre alla scrittura diretta | Nessun ruolo o motivazione registrati oggi |
| `documents`/email subject text | DB | documento | testo libero | sì | Sì, testo libero presente | Possibile menzione progetto/cliente | **Mai confermata semanticamente** — solo testo | **No** — richiederebbe interpretazione | N/A | Falsi positivi da somiglianza testuale (vedi §3) |

---

## 3. Riscontri live su Graphic Center

**[CONFERMATO]**, verificato in sola lettura tramite un server di sviluppo temporaneo
(`ALLOW_LEGACY_AUTH=true`), poi arrestato; nessun dato modificato.

### 3.1 I tre ordini noti

| Ordine | `orders.projectCode` | Righe canoniche — `projectId`/`projectCode` | Documenti collegati — riferimenti strutturati | Testo libero |
|---|---|---|---|---|
| `13542272` | `null` | `null`/`null` sull'unica riga (`sourceType: supplier_order`) | Nessuno | Oggetto email: *"Progettazione dell'ordine 0013542272 - ARC'S"* |
| `0013545497` | `null` | `null`/`null` su entrambe le righe (`sourceType: supplier_order`) | Nessuno | Nessuno rilevante |
| `228751` | `null` | `null`/`null` sull'unica riga (`sourceType: supplier_order`) | Nessuno | Nessuno rilevante |

**Riferimenti strutturati esatti**: **nessuno**, su nessuno dei tre ordini, a nessun livello
(ordine o riga).

**Riferimenti ripetuti tra entità/documenti**: **nessuno** rilevato.

**Suggerimenti testuali non strutturati**: **uno solo**, sull'ordine `13542272` — l'oggetto di
un'email menziona "ARC'S". Nel tenant esiste realmente un progetto `LAV-40` con cliente "Arc's"
(`dc2d8825-1bb5-437a-96f2-5223c484f02d`, verificato live). **Questa è esattamente il tipo di
coincidenza testuale che questa fase vieta di trattare come collegamento**: non è un riferimento
strutturato, non è un codice progetto, è una somiglianza di nome cliente in un oggetto email. **Non
viene proposto alcun collegamento da questa coincidenza.**

**Dati mancanti**: `project_id`/`project_code` sono `null` su tutti e tre gli ordini e su tutte le
loro righe canoniche.

**Riferimenti ambigui**: nessuno (l'assenza totale di dati non genera ambiguità, genera solo
assenza).

**Può essere fatto oggi un collegamento deterministico?** **No, per nessuno dei tre ordini.**

### 3.2 Il contesto più ampio del tenant (per comprendere, non per collegare)

**[CONFERMATO]** Il tenant ha **12 progetti reali e attivi** (`LAV-37`…`LAV-48` più uno chiamato
"DIAGEO // TANQUERAY IDAYS"), con collegamenti `project_id`/`project_code` popolati **solo** su
righe materiali con `sourceType` in `{quote, customer_request}` — cioè il lato **domanda cliente**,
mai su righe con `sourceType: supplier_order`. **Questo conferma che l'infrastruttura di
collegamento progetto già in uso in questo tenant riguarda una relazione diversa (progetto↔domanda
cliente) da quella che questa fase deve costruire (ordine di acquisto↔progetto).** Non deve essere
scambiata per una prova che il collegamento ordine-fornitore↔progetto funzioni già.

**Se Graphic Center non contiene oggi alcuna fonte progetto utilizzabile per i suoi ordini di
acquisto: questo è esattamente lo stato osservato, dichiarato qui chiaramente.**

---

## 4. Capacità attuali confermate

- Isolamento tenant su `project_code` già corretto (`UNIQUE(organization_id, project_code)`).
- Entità canonica `projects` già esistente, con campo di responsabile progetto
  (`responsible_membership_id`) già presente nello schema.
- FK `orders.project_id → projects.id` già esistente nello schema.
- Meccanismo di alias generico (`entity_aliases`) già esistente e già scoped per tenant, pronto per
  essere riutilizzato (non ancora cablato).
- Precedente di design già in produzione per "non attribuire un riferimento condiviso a
  un'entità più specifica" (il caso `quotes` in `order-operational-view.js`).
- UI di collegamento manuale già esistente per il lato domanda (pattern riutilizzabile
  concettualmente).

## 5. Lacune attuali confermate

- `orders.project_id` non è mai letto né esposto da nessun adapter o endpoint.
- `canonicalMaterialLines` in `OrderOperationalView` non seleziona alcun campo progetto — il
  livello di riga è cieco al progetto in tutta la pipeline Fase 2A→2C.1B.
- Nessuna tabella di provenienza per il collegamento progetto (nessun equivalente di
  `findingId`/`evidenceRefs` per questo dominio).
- Nessuna dimensione progetto nel Data Quality Contract.
- Nessun processo di matching o estrazione ispezionabile in questo repository.
- Nessun ruolo PM.
- Nessun ordine di acquisto Graphic Center ha oggi un riferimento progetto utilizzabile.

---

## 6. Entità canonica progetto

**[PROPOSTO]** Riusare l'entità `projects` **esistente**, non crearne una seconda. Campi
genuinamente necessari ora rispetto a quelli rinviabili:

| Campo | Richiesto ora (2D.1) | Rinviato |
|---|---|---|
| `id`, `organization_id`, `project_code` | Sì (già esistenti) | — |
| `project_name`/`name` | Sì (già esistente) | — |
| `status` | Sì (già esistente, valori attuali osservati: "Aperto", "Preventivo") | Storico di stato dettagliato → 2D.2 |
| `responsible_membership_id` | Sì (già esistente — base per §20) | Ruolo PM formale → decisione aperta |
| `external_source`/`external_id` | **Proposto come nuovo**, per import futuri multipli | — |
| `metadata` | No, non necessario ora | Sì, se import futuri richiedono campi arbitrari |
| Pianificazione, budget, milestone | No | 2D.2/Fase 4 |

**Non è necessaria una seconda tabella "progetti per il modulo Procurement"** — lo stesso
`projects.id` deve essere l'identità unica riferita da ordini, righe, e in futuro dal modulo
Progetti.

---

## 7. Modello di relazione ordine-livello e riga-livello

### 7.1 Fonte unica di verità — modello di transizione esplicito (correzione architetturale)

**[PROPOSTO]** Il documento non deve lasciare le colonne esistenti `project_id`/`project_code` (su
`orders` e `material_lines`, §2.2/§2.3) e le nuove tabelle di collegamento provenienza-aware come
due fonti di scrittura indipendenti. Viene definito un modello di transizione a due fasi:

**Fase di compatibilità iniziale (2D.1A)**:
- le colonne esistenti `orders.project_id`/`project_code` e i loro equivalenti di riga possono
  essere esposte **in sola lettura**;
- `project_id` e `project_code` devono essere valutati per coerenza reciproca (§2.9/§27 — rischio
  di divergenza silenziosa già identificato);
- il loro meccanismo di popolamento attuale e la loro semantica **restano non confermati** (§2.6);
- **nessun nuovo percorso di scrittura viene introdotto** in questa fase di compatibilità.

**Fase di provenienza definitiva (2D.1B in poi)**:
- la relazione provenienza-aware (`order_project_links`/`line_project_links`, §21) diventa la
  **fonte canonica**;
- le colonne esistenti `project_id`/`project_code` diventano, a scelta implementativa da definire:
  - **proiezioni di compatibilità derivate** (calcolate/sincronizzate dalla relazione canonica,
    mai scritte indipendentemente), oppure
  - **campi deprecati, di sola lettura**, mantenuti solo per compatibilità con letture esistenti;
- in nessun caso restano **modificabili indipendentemente** in parallelo ai collegamenti canonici.

**L'implementazione finale deve scegliere un solo modello di scrittura autoritativo.** Questo è
aggiunto come criterio di accettazione esplicito (§28).

### 7.2 Architetture di collegamento valutate

**[PROPOSTO]** Valutate tre architetture:

1. **Tabelle separate `order_project_links` e `line_project_links`** — Raccomandata. Ogni tabella
   ha una sola riga *attiva* per (ordine|riga), più righe storiche superate (§8). Separazione netta
   di responsabilità, indici semplici, nessuna colonna polimorfica ambigua.
2. **Tabella unica polimorfica** (`entity_type`, `entity_id`) — scartata: mescola vincoli di
   unicità e query di stato tra due entità con cicli di vita diversi (un ordine può chiudersi
   mentre le sue righe restano aperte), complicando gli indici di unicità "una sola voce attiva."
3. **Default d'ordine + override di riga senza tabelle separate** (un solo campo `project_id` su
   `orders` e uno su `material_lines`, senza tabella di collegamento dedicata) — scartata: non
   fornisce provenienza, stato o storicità; è esattamente la situazione oggi presente (§2.2/§2.3)
   e è già insufficiente.

### 7.3 Regola ordine-default / riga-override

**[PROPOSTO]** Modello iniziale adottato: un ordine può avere zero o un progetto di default
esplicito; una riga può avere zero o un progetto esplicito; un'assegnazione esplicita a livello di
riga è **autoritativa per quella riga**; un'assegnazione a livello di ordine può essere ereditata
**solo** dalle righe senza un'assegnazione di riga esplicita; l'ereditarietà deve restare
distinguibile da un collegamento esplicito (campo di provenienza, §8, mai un valore identico
indistinguibile); collegamenti espliciti in conflitto tra ordine e riga **non vengono riconciliati
silenziosamente** (diventano un caso di conflitto visibile, §12); un ordine i cui righe effettive
appartengono a più di un progetto è derivato deterministicamente come ordine multi-progetto
(proiezione, mai uno stato scritto direttamente — §10).

**Questa regola è validata contro lo schema attuale**: poiché `material_lines.project_id` e
`orders.project_id` sono oggi colonne indipendenti senza vincolo di coerenza reciproca, la
precedenza deve essere applicata a livello applicativo/di vista, mai assunta implicitamente dal
database.

**[RINVIATO]** Una singola riga d'ordine allocata quantitativamente o proporzionalmente a più
progetti **non è supportata nella prima implementazione**. Questo scenario (split di riga con
percentuali/quantità per progetto) è classificato come rinviato a una futura sottofase di
allocazione (§25, "sottofase di allocazione futura"). **Nessuna percentuale o quantità di
allocazione viene inventata in questa fase.**

---

## 8. Provenienza del collegamento

**[PROPOSTO]** Modello di provenienza chiuso, per ogni collegamento (ordine o riga):

| Campo | Scopo |
|---|---|
| `source_kind` | Uno tra: `source_native_structured` (campo strutturato dalla fonte), `exact_reference_match` (regola deterministica #2/#3, §9), `manual_confirmation`, `inherited_order_level`, `imported_historical` |
| `source_field` | Quale campo di quale fonte ha stabilito il collegamento |
| `evidence_ref` | Riferimento esatto al documento/evidenza di supporto, riusando il meccanismo esistente (`evidenceRefs`) — mai un nuovo meccanismo |
| `observed_at` | Quando osservato |
| `is_explicit` | Booleano — distingue esplicito da ereditato, mai dedotto dal solo valore |
| `confirmed_by_membership_id`/`confirmed_at`/`confirmation_reason` | Solo per `manual_confirmation` |
| `superseded_by_link_id`/`superseded_at` | Storicizzazione — mai cancellazione (§16) |
| `active` | Se il collegamento è quello operativo corrente |

**Nessuna percentuale di confidenza. Nessuna certezza generata da IA.** Il campo `confidence` già
presente in `entity_aliases`/`documents` **non viene riutilizzato per lo stato del collegamento
progetto** — è un artefatto di un altro dominio (aliasing supplier/customer, revisione documento),
non un ground truth per l'assegnazione progetto.

---

## 9. Gerarchia di matching deterministico

### 9.1 Requisito di fonte strutturata fidata (correzione architetturale)

**[PROPOSTO]** Una corrispondenza esatta di codice progetto **può creare un collegamento
confermato solo quando**: il campo sorgente è strutturato (non testo libero); il campo sorgente è
esplicitamente registrato come portatore di identità progetto; la sua semantica è confermata per
quel sistema sorgente/tenant; il valore normalizzato risolve in modo univoco dentro la stessa
organizzazione; non esiste alcun identificatore esplicito in conflitto. **L'uguaglianza testuale
esatta da un campo non verificato o testo libero non è sufficiente.**

**[CONFERMATO]** Poiché il repository non mostra come vengano popolati i campi `project_code` degli
ordini di acquisto (§2.6), la loro semantica **è oggi non confermata**. Di conseguenza:

| Caso | Trattamento |
|---|---|
| `project_id` FK valida, stesso tenant | Collegamento strutturato potenzialmente autoritativo, soggetto a verifica di provenienza e coerenza |
| `project_id` e `project_code` presenti e risolvono allo stesso progetto | Riferimento strutturato coerente |
| `project_id` e `project_code` presenti ma incoerenti | Segnalazione di conflitto (`PROJECT_LINK_CONFLICT`, §14), nessun vincitore scelto silenziosamente |
| `project_code` presente **senza** un contratto di campo sorgente verificato | Candidato/riferimento osservato solo — **non confermato automaticamente** |
| `project_code` presente da una fonte registrata come fidata e che risolve in modo univoco | La regola "corrispondenza esatta di riferimento" (sotto, #2) può renderlo confermato |
| `project_id` sconosciuto o riferimento progetto cross-tenant | Fail-closed, genera la segnalazione appropriata (`PROJECT_REFERENCE_UNKNOWN`/`PROJECT_LINK_CROSS_TENANT_INVALID`, §14) |

**Nessun valore diventa confermato solo perché somiglia a un codice progetto.**

### 9.2 Gerarchia, in ordine di precedenza

**[PROPOSTO]**:

1. **Identificatore esplicito dalla fonte** — l'ordine/riga porta già un `project_id` FK valido
   nello stesso tenant, soggetto alla verifica di §9.1.
2. **Corrispondenza esatta di riferimento da fonte fidata registrata** — un campo strutturato,
   registrato esplicitamente come portatore di identità progetto per quella fonte/tenant, eguaglia
   esattamente un `project_code` canonico dopo **sola** normalizzazione approvata (§9.3), e risolve
   in modo univoco.
3. **Corrispondenza esatta di alias configurato dal tenant** — candidato per il riuso di
   `entity_aliases` (`entity_type='project'`), **non ancora approvato** (§10bis/§6 correzione); un
   alias risolve **un solo** progetto canonico, mai una lista.
4. **Conferma manuale** — un utente autorizzato conferma esplicitamente (§13).
5. **Collegamento ereditato a livello ordine** — una riga eredita il progetto dell'ordine solo in
   assenza di collegamento di riga esplicito (§7.3).

**Qualunque cosa fuori da questa gerarchia chiusa non diventa mai un collegamento confermato.** Una
corrispondenza esatta da un campo non registrato/non verificato (§9.1) resta un candidato/
riferimento osservato, mai un collegamento confermato, indipendentemente da quanto sembri esatta.

### 9.3 Normalizzazione permessa (corretta — default sicuro)

**[PROPOSTO]** Normalizzazione di default sicura:
- taglio degli spazi solo in fase di ingestione, **conservando sempre il valore grezzo come
  evidenza**;
- normalizzazione Unicode verso una forma canonica documentata (es. NFC);
- **conservazione obbligatoria degli zeri iniziali**;
- **conservazione della punteggiatura interna**;
- **conservazione dei separatori** originali;
- **nessuna rimozione generica di prefissi**;
- **nessuna rimozione generica di punteggiatura**;
- **nessun collasso generico di separatori** (es. `-` ↔ `_` non è mai equivalente di default);
- **nessuna coercizione numerica**.

**La normalizzazione di maiuscole/minuscole è permessa solo quando la fonte specifica o la
configurazione del tenant dichiara esplicitamente i codici progetto case-insensitive** — mai per
default globale. Gli alias configurati dal tenant devono risolvere in modo esatto e univoco.
**Qualunque normalizzazione capace di far collassare due codici progetto oggi distinti deve
fallire in modo chiuso** (fail-closed) — non viene applicata finché non esplicitamente configurata
e verificata per quel tenant.

**Esplicitamente vietato**: fuzzy matching, distanza di edit, embedding semantico, collegamento
generato da LLM, estrazione regex non configurata esplicitamente per il tenant e che non produca un
unico risultato esatto. L'IA può in futuro suggerire candidati, ma un candidato non diventa mai un
collegamento canonico senza passare da una delle 5 regole sopra (§9.2), e un alias con
`source='ai'` (o comunque generato da IA) **può produrre solo candidati**, mai direttamente un
collegamento canonico confermato — la conferma dell'utente deve sempre creare un fatto di conferma
manuale separato e verificabile (§6/§13).

---

## 10. Modello di stato — classificazione di procurement separata dalla valutazione del collegamento

### 10.1 Correzione architetturale: due concetti distinti, non un solo elenco di stati

**[PROPOSTO]** La versione precedente di questo documento mescolava in un solo elenco due concetti
concettualmente diversi. Vengono ora separati:

**A. Classificazione del contesto di procurement** (cosa *è* l'ordine/riga, indipendentemente dal
fatto che un progetto specifico sia risolto):

| Classificazione | Applicabile a | Fatto o derivato | Note |
|---|---|---|---|
| `PROCUREMENT_CONTEXT_PROJECT` | Ordine e riga | Fatto/classificazione esplicita | L'ordine/riga appartiene a un progetto (il *quale* progetto è materia della valutazione B) |
| `PROCUREMENT_CONTEXT_GENERAL_STOCK` | Ordine e riga | Fatto/classificazione esplicita | Rifornimento scorte — **resta distinta**, non fusa con `OVERHEAD` |
| `PROCUREMENT_CONTEXT_OVERHEAD` | Ordine e riga | Fatto/classificazione esplicita | Spese generali — **resta distinta**, non fusa con `GENERAL_STOCK` |
| `PROCUREMENT_CONTEXT_SHARED` | Ordine e riga | Fatto/classificazione esplicita | Approvvigionamento condiviso tra più progetti, la cui allocazione esatta è intenzionalmente non disponibile (§11) |
| `PROCUREMENT_CONTEXT_UNCLASSIFIED` | Ordine e riga | Derivato/fatto negativo | Una valutazione è stata eseguita ma non ha determinato una classificazione — **non genera automaticamente una segnalazione** |
| `PROCUREMENT_CONTEXT_NOT_EVALUATED` | Ordine e riga | Fatto — nessuna valutazione ancora eseguita | **Non è un errore né un'azione** — precedenza assoluta durante il rollout (§22) |

`MULTI_PROJECT_ORDER` **non è una classificazione memorizzata**: è una **proiezione derivata a
livello ordine**, calcolata quando le righe effettive dell'ordine risolvono a più di un progetto
tramite la valutazione B (§7.3). Non viene mai scritta come classificazione a sé.

**B. Valutazione del collegamento progetto** (quale progetto specifico, e con quale certezza,
solo quando la classificazione A è `PROJECT` o `SHARED`):

| Stato | Applicabile a | Fatto o derivato | Genuinamente distinto |
|---|---|---|---|
| `PROJECT_LINK_CONFIRMED` | Ordine e riga | Fatto (collegamento attivo da una delle regole 1-4, §9.2) | Sì |
| `PROJECT_LINK_INHERITED` | Solo riga | Derivato (nessun collegamento di riga esplicito, l'ordine ne ha uno) | Sì — mai fuso con `CONFIRMED` |
| `PROJECT_LINK_MISSING_REQUIRED` | Ordine e riga | Derivato — esiste solo quando una policy/contratto sorgente/tenant richiede esplicitamente una classificazione progetto | Sì, ma **mai** per default — richiede un requisito esplicito (§14) |
| `PROJECT_LINK_AMBIGUOUS` | Ordine e riga | Derivato — più candidati esatti risolvono, nessuna regola li distingue | Sì |
| `PROJECT_LINK_CONFLICT` | Ordine (vs riga), riga (vs riga), o `project_id` (vs `project_code`) | Derivato — due riferimenti espliciti disaccordano | Sì — non collassare con `AMBIGUOUS` (candidati multipli vs valori espliciti in conflitto sono situazioni diverse) |
| `PROJECT_LINK_UNKNOWN_PROJECT` | Ordine e riga | Derivato — un `project_id`/riferimento esiste ma non risolve nel tenant corrente (o risolve fuori tenant) | Sì — fail-closed, mai un collegamento indovinato |

**Una classificazione `GENERAL_STOCK`/`OVERHEAD` non genera mai una valutazione B di tipo
"collegamento mancante"** — la valutazione B si applica solo quando la classificazione A lo
richiede. Questo previene esattamente i falsi allarmi ripetuti richiesti come requisito (§11).

### 10.2 Regole di distinzione

`PROCUREMENT_CONTEXT_UNCLASSIFIED` non deve mai generare automaticamente una segnalazione genuina
(è una conclusione neutra, non un problema). `PROCUREMENT_CONTEXT_NOT_EVALUATED` non è mai un
errore né un'azione. `PROJECT_LINK_MISSING_REQUIRED` esiste **solo** quando una policy o un
contratto sorgente/tenant esplicito richiede una classificazione progetto per quell'ordine/riga —
mai come default silenzioso. **Nessuno di questi stati richiede conferma utente per esistere** (sono
tutti derivati o osservati); solo il passaggio da uno stato all'altro tramite conferma manuale
richiede la conferma stessa (§13).

### 10.bis Validazione richiesta prima di poter riusare `entity_aliases` (correzione)

**[DECISIONE APERTA]** Prima che `entity_aliases` possa essere usata per il collegamento progetto
confermato (§9.2, regola 3), è richiesta la verifica esplicita di: isolamento tenant; integrità
referenziale verso il progetto target; regole di unicità; comportamento per alias duplicati;
semantica del campo `source`; supersessione/audit; protezione cross-tenant; risoluzione
deterministica (un alias → un solo progetto, mai una lista). **Se `entity_aliases` non soddisfa
questo contratto, viene proposta in alternativa una struttura dedicata**
`project_external_identifiers`/`project_aliases`. **La scelta finale della tabella resta una
decisione di implementazione aperta** (§27).

**Regola esplicita, non negoziabile indipendentemente dalla tabella scelta**: un alias con
`source='ai'`, o comunque generato da intelligenza artificiale, **può produrre solo candidati**;
non può mai creare direttamente un collegamento canonico progetto confermato; la conferma
dell'utente deve sempre creare un fatto di conferma manuale separato e verificabile (§13),
distinto dal candidato stesso.

---

## 11. Magazzino generale e acquisti non-progetto

**[PROPOSTO]** Trattato come caso di prima classe, non un'eccezione. Classificazioni distinte
(§10.1, gruppo A): `PROJECT`; `GENERAL_STOCK`; `OVERHEAD`; `SHARED`; `UNCLASSIFIED`;
`NOT_EVALUATED`. **`GENERAL_STOCK` e `OVERHEAD` restano due classificazioni distinte** (una
riguarda scorte fisiche, l'altra spese generali/amministrative) — non vengono fuse. Un'eventuale
etichetta "non-project" **esiste solo come ombrello derivato per la presentazione** (es. per
filtrare in UI "tutto ciò che non è `PROJECT`"), mai come sostituto memorizzato di queste due
classificazioni.

**Un collegamento progetto mancante non è automaticamente un errore** — solo
`PROJECT_LINK_MISSING_REQUIRED` (quando la classificazione lo richiede esplicitamente, §10.1) lo
è; `GENERAL_STOCK`/`OVERHEAD` sono **conclusioni positive**, non l'assenza di un dato, e **non
generano mai** una segnalazione di collegamento mancante. Questo previene falsi allarmi ripetuti
per ordini legittimamente non di progetto.

**`SHARED`** classifica un ordine/riga la cui allocazione esatta tra più progetti è
intenzionalmente non disponibile — **non fabbrica mai un'assegnazione progetto**; non viene
generata alcuna allocazione di quantità o costo per progetto senza una fonte esplicita di
allocazione (§12.8).

La classificazione stessa richiede: provenienza propria (chi/cosa l'ha stabilita, come in §8); può
essere confermata manualmente; può avere valori nativi dalla fonte (es. un campo "tipo ordine" già
presente nel sistema sorgente, se esiste — non confermato in questo repository); **non richiede
scadenza automatica**, ma dovrebbe permettere una rivalutazione se la fonte cambia; nessuna
restrizione di ruolo aggiuntiva oltre a quelle già proposte per il collegamento progetto (§19).

---

## 12. Ambiguità e conflitto

**[PROPOSTO]**, per ciascuno scenario richiesto:

1. **Un campo fonte risolve più progetti**: mai una scelta silenziosa; stato `AMBIGUOUS`, tutti i
   candidati restano visibili con la propria evidenza, nessun collegamento operativo attivo finché
   non risolto manualmente.
2. **Header e riga in disaccordo**: `CONFLICT`; entrambi i valori restano visibili con la propria
   provenienza; nessuna riconciliazione automatica.
3. **Documenti diversi con riferimenti diversi**: ogni riferimento resta associato al proprio
   documento/evidenza; il collegamento operativo attivo (se esiste) è quello stabilito dalla
   gerarchia (§9), gli altri restano visibili come evidenza scartata, non eliminata.
4. **Codice progetto riutilizzato erroneamente tra sistemi sorgente**: la corrispondenza esatta
   (§9, regola 2) opera solo dentro il perimetro tenant-organizzazione; un riutilizzo tra sistemi
   sorgente diversi della stessa organizzazione è un problema di qualità dati che genera una
   segnalazione, non una fusione silenziosa.
5. **Collegamento confermato manualmente in conflitto con un successivo collegamento nativo dalla
   fonte**: la conferma manuale resta autoritativa finché non esplicitamente sovrascritta da un
   utente autorizzato — un nuovo valore nativo dalla fonte non sovrascrive mai silenziosamente una
   conferma manuale (§14); il nuovo valore diventa un candidato/segnalazione, non un'azione
   automatica.
6. **Un progetto diventa inattivo/chiuso**: i collegamenti storici restano intatti e visibili
   (mai cancellati); nuovi collegamenti a un progetto chiuso generano una segnalazione
   (`linked project not available`, §15), non un blocco silenzioso.
7. **Un documento sorgente viene eliminato o diventa non disponibile**: il collegamento derivato da
   quel documento non viene automaticamente invalidato, ma la sua evidenza diventa "non
   disponibile" (stesso pattern già usato per `resolveExistingEvidenceRefs`, mai un link rotto
   mostrato come valido).
8. **Un ordine serve intenzionalmente più progetti**: modellato a livello di riga
   (`MULTI_PROJECT_ORDER` come proiezione, §10.1), mai forzato in un singolo valore d'ordine. Se
   l'allocazione esatta tra progetti non è disponibile, la classificazione `SHARED` (§11) si
   applica invece di inventare una ripartizione.
9. **`project_id` e `project_code` sulla stessa entità risolvono a progetti diversi** (§9.1):
   `PROJECT_LINK_CONFLICT`; entrambi i valori restano visibili con la propria provenienza; nessun
   vincitore scelto automaticamente in base a quale colonna "sembra più affidabile".

**Nessuna vittoria silenziosa in nessuno scenario.** Ruoli abilitati a risolvere: Owner/Admin (e PM
tramite permesso scoped, se introdotto — §19); IT solo per errori tecnici di mappatura, mai per
decisioni di business (§13). Storico di audit: mai cancellazione, sempre supersessione (§8).

---

## 13. Contratto di conferma manuale futuro (nessuna UI implementata)

**[PROPOSTO — decisioni rese autoritative per questa proposta]**:

- **Nessun nuovo ruolo globale PM viene introdotto in Fase 2D.1** (chiuso, §19).
- La responsabilità di progetto futura deve usare permessi scoped e/o
  `projects.responsible_membership_id` già esistente, non un ruolo globale nuovo.
- **Buyer** può confermare associazioni progetto ordinarie entro lo scope concesso (per l'uso
  quotidiano).
- **Owner/Admin** possono risolvere conflitti, sovrascrivere e riclassificare.
- **IT** può riparare mappature tecniche (es. un `project_id` orfano, un riferimento rotto) ma
  **non può prendere decisioni di classificazione di business non supportate**.
- **ReadOnly** può solo visualizzare.
- **Motivazione obbligatoria** per: sovrascritture; risoluzione di conflitti; riclassificazione;
  reversal/supersessione. **Motivazione opzionale** per una prima conferma ordinaria (chiuso, non
  più decisione aperta).
- **L'implementazione della conferma manuale è rinviata alla Fase 2D.1D** (§25).
- Ogni modifica usa supersessione/audit, **mai cancellazione distruttiva** —
  `superseded_by_link_id`/`superseded_at`, coerente con §8.

**Non viene implementata alcuna scrittura manuale in questa fase** — questo è solo il contratto
futuro.

---

## 14. Integrazione con il Data Quality Contract

### 14.1 Confine di responsabilità dei dati (correzione architetturale)

**[PROPOSTO]** Viene rimossa qualunque assunzione che il **contesto progetto** di Fase 2D.1 debba
riusare la richiesta `pilot-quality-contract` o l'hook condiviso di Fase 2C.1B. Confine esplicito:

- il **contesto progetto canonico corrente** (quale progetto, quale stato di collegamento, a
  livello ordine e riga) appartiene al contratto dati operativo dell'ordine di acquisto —
  verosimilmente `OrderOperationalView` o un futuro contratto condiviso di dettaglio ordine —
  **mai** al Data Quality Contract come fonte di verità della sua identità;
- le valutazioni di ambiguità, conflitto e collegamento-mancante-richiesto (§10.1, gruppo B)
  appartengono al **Data Quality Contract**, coerentemente con come Fase 1B/2C.1B già trattano le
  anomalie;
- i suggerimenti diagnostici futuri possono consumare queste segnalazioni attraverso
  l'architettura qualità già esistente (hook condiviso di Fase 2C.1B), ma **solo per le
  segnalazioni**, mai come fonte dell'identità progetto canonica;
- **nessuna richiesta di contesto progetto duplicata per widget**;
- **l'identità progetto canonica non viene mai messa dentro il contratto qualità come sua fonte di
  verità.**

L'estensione esatta dell'endpoint resta una decisione di implementazione (§20), ma il design
"un endpoint per ogni widget" è vietato.

### 14.2 Segnalazioni candidate

**[PROPOSTO]**, segnalazioni definite solo dove deterministiche (non finalizzate a priori):

| Segnalazione | Ambito | Trigger | Esclusioni | Genuina? | Organization-wide? |
|---|---|---|---|---|---|
| `PROJECT_LINK_MISSING_REQUIRED` | Ordine/riga | Una policy/contratto sorgente/tenant richiede esplicitamente una classificazione progetto (§10.1) e nessun collegamento attivo esiste | Classificazione `GENERAL_STOCK`/`OVERHEAD`/`SHARED` (mai richiedono un collegamento) | Sì, per-ordine | No |
| `PROJECT_LINK_AMBIGUOUS` | Ordine/riga | Più candidati esatti risolvono (§9.2, regole 2/3) | — | Sì | No |
| `PROJECT_LINK_CONFLICT` | Ordine/riga | Header vs riga, riga vs riga, o `project_id` vs `project_code` (§9.1/§12.9) | — | Sì | No |
| `PROJECT_REFERENCE_UNKNOWN` | Ordine/riga | Un riferimento progetto esiste ma non risolve ad alcun progetto noto nel tenant | — | Sì | No |
| `PROJECT_LINK_CROSS_TENANT_INVALID` | Ordine/riga | Un `project_id` risolve, ma a un progetto di un'altra organizzazione | — | Sì | No |
| `PROJECT_SOURCE_UNAVAILABLE` | **Organizzazione** | La fonte dati che alimenta il matching progetto è essa stessa non disponibile/incompleta a livello di sistema | — | **No — mai attribuita a un ordine specifico** | **Sì**, esattamente come `SOURCE_INCOMPLETE` oggi in `organizationFindings` |

**Regole**: `PROCUREMENT_CONTEXT_NOT_EVALUATED` non crea mai una segnalazione genuina;
`PROCUREMENT_CONTEXT_UNCLASSIFIED` non crea automaticamente una segnalazione genuina;
`GENERAL_STOCK`/`OVERHEAD` non creano mai segnalazioni di collegamento mancante;
`PROJECT_LINK_MISSING_REQUIRED` richiede sempre un requisito esplicito di tenant/fonte/policy, mai
un default; le segnalazioni organization-wide non vengono mai attribuite a un ordine individuale
(stessa regola già in vigore per `organizationFindings` in Fase 1B/2C.1B); le descrizioni delle
segnalazioni non diventano mai istruzioni di azione in linguaggio libero — copia fissa per tipo,
come già richiesto per la tassonomia diagnostica di Fase 2C.1B; **le segnalazioni di collegamento
progetto non alterano mai lo stato di consegna** (`OVERDUE`/`WARNING`/`CRITICAL`/`TO_VERIFY`/
`CLOSED`, §15). Ogni segnalazione genuina può in futuro generare un suggerimento diagnostico (stile
Fase 2C.1B), ma questo non viene implementato qui.

---

## 15. Impatto sulla situazione attuale dell'ordine (Fase 2A)

**[PROPOSTO — sfidando l'assunzione di default come richiesto]**: **la separazione deve restare.**
La qualità del collegamento progetto **non deve mai** cambiare lo stato business di consegna
(`OVERDUE`/`WARNING`/`CRITICAL`/`CLOSED`/`TO_VERIFY`), che deriva esclusivamente da date e soglie
(`getOrderStatus()`, invariato). Un ordine perfettamente in orario ma senza classificazione
progetto non deve mai apparire come "in ritardo"; un ordine in ritardo ma correttamente classificato
non diventa "sotto controllo" per questo. Il collegamento progetto può aggiungere **contesto** (es.
mostrare a quale commessa appartiene, quando noto) o generare **segnalazioni diagnostiche
separate** (§14), mai alterare la situazione operativa di Fase 2A. Non si mescola mai la
classificazione progetto con conclusioni sulla consegna del fornitore.

## 16. Impatto sulla cronologia osservata (Fase 2B.1)

**[PROPOSTO]** Eventi futuri potenzialmente validi, **solo se e quando esiste una storia reale**:
riferimento progetto strutturato osservato nella fonte; assegnazione progetto confermata
dall'utente; assegnazione superata; classificazione cambiata. **Nessun evento storico viene
inventato dalle tabelle di stato corrente** — se la cronologia (supersessioni con timestamp reali)
non esiste ancora quando questa fase viene implementata, **la presentazione in timeline viene
rinviata**, esattamente come richiesto. Il modello di provenienza (§8) è progettato in modo da
poter *alimentare* futuri eventi di timeline senza richiedere una riprogettazione.

## 17. Integrazione con azioni future e "Oggi" (senza implementare task)

**[PROPOSTO]** Azioni future potenziali (non implementate qui): classificare il contesto
dell'ordine; risolvere un progetto ambiguo; verificare un conflitto di assegnazione a livello riga;
confermare una suddivisione multi-progetto. **Nessuna scadenza d'azione viene inventata. Nessuna
azione viene persistita in questa fase. Non viene creata una seconda coda o tabella di azioni.**
L'integrazione futura deve riusare `operational_actions` e l'infrastruttura esistente
`buildOperationalQueue`/coda "Oggi" — esattamente come già stabilito per Fase 2C.2 nella
documentazione precedente — mai una struttura parallela.

---

## 18. Confine dell'architettura modulare

**[PROPOSTO]** Dati canonici condivisi (mai duplicati): `projects`, identità progetto, collegamenti
ordine-progetto, collegamenti riga-progetto, provenienza, segnalazioni. Modulo Progetti opzionale
(rinviato a 2D.2): elenco progetti, dettaglio progetto, viste orientate al PM, filtri progetto,
dashboard operative di progetto, azioni specifiche di progetto. **La relazione canonica non viene
mai duplicata quando il modulo Progetti è attivato** — l'entitlement del tenant controlla
visibilità e workflow, non l'esistenza di un secondo modello dati. Dipendenze concettuali (tutte
rinviate a Fase 2E, non implementate qui): PROJECTS richiede PROCUREMENT; ACTIONS può consumare
azioni sia da PROCUREMENT sia da PROJECTS; COST_CONTROL potrà richiedere PROJECTS più dati
finanziari; ANALYTICS legge solo dati dei moduli attivi; ALTERA opera solo sui dati visibili
all'utente e ai moduli attivi. **Nessuna tabella di entitlement viene implementata qui.**

## 19. Ruoli e permessi

**[CONFERMATO]** Ruoli attuali: esattamente `Owner`, `Admin`, `IT`, `Buyer`, `ReadOnly` — **nessun
ruolo PM esiste oggi**, confermato dall'assenza di "PM" in ogni controllo di ruolo ispezionato in
questa sessione e nelle sessioni precedenti di questo stesso progetto documentale.

**[PROPOSTO — decisione chiusa]: nessun nuovo ruolo globale PM viene introdotto in Fase 2D.1.**

| Ruolo | Vede collegamento progetto | Può confermare | Può risolvere conflitti/sovrascrivere/riclassificare | Note |
|---|---|---|---|---|
| Owner | Sì | Sì | Sì | Come oggi per le altre decisioni business |
| Admin | Sì | Sì | Sì | — |
| IT | Sì | Solo riparazioni tecniche (es. `project_id` orfano) | No, mai decisioni di classificazione di business non supportate | Coerente con l'accesso IT esistente a `pilot-quality-contract` (diagnostica, non business) |
| Buyer | Sì | Sì, associazioni ordinarie entro lo scope concesso | No | Coerente con l'operatività quotidiana Buyer già esistente |
| PM (permesso scoped, non ruolo) | Sì | Sì, solo sui progetti dove è `responsible_membership_id` | No (a meno di ownership esplicita) | Vedi sotto |
| ReadOnly | Sì (solo visualizzazione) | No | No | Coerente con il pattern già stabilito in Fase 2C.1A/2C.1B |

**Aggiungere PM — riportato esplicitamente**: **non un nuovo ruolo globale.** Dato che
`projects.responsible_membership_id` **già esiste** (§2.1), la via adottata è: **un permesso
scoped al progetto assegnato** (una capacità di "conferma collegamento progetto" ristretta ai
progetti dove l'utente è `responsible_membership_id`), non un ruolo globale aggiuntivo. Permessi e
scope di assegnazione sono preferiti rispetto a una proliferazione di ruoli globali. **Decisione
aperta residua**: se il prodotto vuole comunque un'etichetta "PM" esplicita per ragioni di
UI/comunicazione (es. un menu diverso), questo è un problema di presentazione, non un requisito
tecnico di questa fase (§27).

---

## 20. Contratto API e query

**[PROPOSTO]** Coerente con il confine di responsabilità dati definito in §14.1: il contesto
progetto canonico e le segnalazioni di qualità restano due contratti separati, mai una fonte unica
mescolata. Estendere i contratti esistenti piuttosto che creare un endpoint per widget:
- `OrderOperationalView` (o un futuro contratto condiviso di dettaglio ordine): aggiungere il
  collegamento progetto canonico (attivo, con stato) a livello ordine **e** riga, riusando la
  stessa risposta già caricata — nessun nuovo fetch per Fase 2D.1 stesso (stessa disciplina già
  applicata a Fase 2C.1A). **Questo, non il Data Quality Contract, è la fonte di verità per
  l'identità progetto corrente.**
- Elenco ordini di acquisto: il campo `projectCode` già esposto oggi si arricchisce di uno stato
  (`CONFIRMED`/`INHERITED`/`MISSING`/...), non un nuovo endpoint.
- Dettaglio progetto (Fase 2D.2): fuori perimetro qui, ma deve leggere dagli stessi collegamenti
  canonici, mai una copia.
- Coda operativa/Analytics/Altera: leggono solo dati già canonici e già visibili al ruolo/modulo
  attivo dell'utente — nessun fetch duplicato, nessuna logica di autorizzazione parallela.

**Nessun UUID grezzo esposto nei contratti visibili** dove esiste già un identificatore sicuro
(`project_code`, mai `project_id`), esattamente come già applicato per `orderId`/`lineId`/
`findingId` in Fase 2C.1A/2C.1B.

---

## 21. Proposta minima di modello dati (concettuale, nessun SQL)

**Richiesto per Fase 2D.1** (fase di provenienza definitiva, §7.1):
```
projects (già esistente — riusata, non duplicata)
  id, organization_id, project_code, name, status, responsible_membership_id

order_project_links                       -- fonte canonica per il collegamento ordine
  id, organization_id, order_id, project_id,
  source_kind, source_field, evidence_ref, observed_at,
  is_explicit, confirmed_by_membership_id, confirmed_at, confirmation_reason,
  superseded_by_link_id, superseded_at, active,
  created_at, updated_at
  UNIQUE (organization_id, order_id) WHERE active   -- una sola voce attiva per ordine

line_project_links                        -- fonte canonica per il collegamento riga
  id, organization_id, order_line_id, project_id,
  [stessi campi di provenienza di order_project_links]
  UNIQUE (organization_id, order_line_id) WHERE active

order_procurement_classification
  id, organization_id, order_id,
  classification (
    'project' | 'general_stock' | 'overhead' | 'shared' |
    'unclassified' | 'not_evaluated'
  ),
  [stessi campi di provenienza]

-- orders.project_id/project_code e material_lines.project_id/project_code (§2.2/§2.3):
-- durante la fase di compatibilità (2D.1A) restano campi in sola lettura, letti ma mai
-- scritti da questo livello. Nella fase di provenienza definitiva (2D.1B+) diventano o
-- proiezioni derivate sincronizzate dalla fonte canonica sopra, o campi deprecati di sola
-- lettura — mai una seconda fonte scrivibile indipendente (§7.1, criterio di accettazione §28).
```

**Alternativa per il riuso alias (§10.bis, in attesa di validazione)**:
```
project_external_identifiers / project_aliases  -- se entity_aliases non supera la validazione
  id, organization_id, project_id, alias, normalized_alias, source, active,
  [stessi campi di audit già visti sopra]
```

**Opzionale per Fase 2D.2**: viste materializzate per dashboard di progetto, campi di
pianificazione/budget su `projects`.

**Rinviato a fasi successive**: tabelle di entitlement (2E), integrazione costo (Fase 4/5),
persistenza task (2C.2 — riusa `operational_actions`, non una tabella nuova), modello di
allocazione per riga singola multi-progetto (§7.3/§25).

Vincoli concettuali: `UNIQUE (organization_id, order_id) WHERE active` (una sola voce attiva);
indice su `project_id` per entrambe le tabelle di collegamento (oggi assente anche su
`material_lines.project_id` — vedi §2.3); nessuna cancellazione fisica di un collegamento
confermato manualmente, solo `superseded_at`; isolamento tenant tramite `organization_id` su ogni
tabella, coerente con il pattern già stabilito da Cancello 2; **una sola fonte di scrittura
autoritativa** per il collegamento canonico (§7.1).

---

## 22. Migrazione e backfill

**[PROPOSTO]**:
1. Ordini esistenti senza dato progetto → classificazione iniziale
   **`PROCUREMENT_CONTEXT_NOT_EVALUATED`**, mai `PROJECT_LINK_MISSING_REQUIRED` — per evitare di
   generare segnalazioni per ogni ordine storico prima che la valutazione sia completa, esattamente
   come richiesto.
2. Riferimenti progetto esatti già presenti (se mai popolati da un processo esterno) → promossi a
   `source_native_structured`, mai a `manual_confirmation`.
3. Riferimenti ambigui → `AMBIGUOUS`, mai risolti automaticamente durante il backfill.
4. Ordini stock/generali → richiedono una classificazione esplicita separata (§11), non dedotta dal
   solo fatto che manchi un progetto.
5. Conferma manuale → nessuna scrittura in questa fase; il contratto (§13) deve solo essere
   compatibile con un futuro processo di backfill che rispetti la stessa struttura di audit.
6. Import futuri da più fonti → `source_kind`/`external_source` devono già distinguere l'origine
   fin dal primo import.
7. **Re-elaborazione idempotente**: rieseguire la valutazione deterministica sullo stesso ordine
   con gli stessi dati sorgente deve produrre lo stesso collegamento attivo — mai un nuovo record
   duplicato per lo stesso fatto.
8. Nuova evidenza sorgente può **superare** ma mai cancellare una conferma manuale precedente
   (§8/§12.5).
9. Configurazione di mappatura tenant-specifica (alias, prefissi normalizzati) vive in dati di
   configurazione per organizzazione (riusando il pattern `settings`/`entity_aliases` già scoped
   per tenant), **mai in un fork di codice tenant-specifico**.
10. `PROCUREMENT_CONTEXT_NOT_EVALUATED` è la classificazione di default per ogni ordine storico
    finché la valutazione deterministica non viene eseguita — esattamente il pattern già impiegato
    con successo per `SECTION_NOT_EVALUATED` in Fase 1B.

---

## 23. Validazione su Graphic Center

**[CONFERMATO]** Nessuno dei tre ordini noti ha oggi dati sufficienti per una validazione positiva
end-to-end del matching deterministico (§3). La validazione dovrà quindi avvenire principalmente su
fixture (§24); su Graphic Center oggi è possibile validare solo: (a) che tutti e tre gli ordini
ricevano correttamente `PROCUREMENT_CONTEXT_NOT_EVALUATED` o `GENERAL_STOCK`/`OVERHEAD` (se il
buyer li classifica manualmente) — mai `PROJECT_LINK_MISSING_REQUIRED` per errore né un
collegamento inventato;
(b) che il progetto reale del tenant (es. `LAV-40`, cliente "Arc's") non venga mai collegato
automaticamente all'ordine `13542272` sulla sola base della coincidenza testuale nell'oggetto email
osservata in §3.1.

---

## 24. Requisiti di test basati su fixture

**[PROPOSTO]** Fixture richieste (non implementate qui), separate dalla validazione live mutabile
di Graphic Center:

- `project_id` valido, stesso tenant, letto correttamente;
- `project_id`/`project_code` coerenti tra loro (risolvono allo stesso progetto);
- `project_id`/`project_code` in conflitto tra loro (`PROJECT_LINK_CONFLICT`, nessun vincitore
  silenzioso);
- `project_code` senza registrazione di fonte fidata → resta candidato/riferimento osservato, mai
  confermato automaticamente (§9.1);
- `project_code` da fonte strutturata registrata come fidata, che risolve in modo esatto e univoco
  → confermato (`exact_reference_match`);
- nessuna risoluzione progetto cross-tenant (fail-closed);
- override di riga sul default d'ordine (riga esplicita autoritativa);
- collegamento ereditato a livello ordine che resta visibilmente distinto da un collegamento
  esplicito;
- ordine multi-progetto derivato correttamente dalle assegnazioni di riga;
- `GENERAL_STOCK` non genera una segnalazione di collegamento mancante;
- `OVERHEAD` non genera una segnalazione di collegamento mancante;
- `PROCUREMENT_CONTEXT_NOT_EVALUATED` non genera mai una segnalazione genuina;
- `PROCUREMENT_CONTEXT_UNCLASSIFIED` non genera automaticamente una segnalazione;
- `PROJECT_LINK_MISSING_REQUIRED` generata **solo** sotto un requisito esplicito di policy;
- allocazione di una riga singola su più progetti: rinviata, mai inventata (§7.3);
- un alias generato da IA non conferma mai un progetto da solo;
- un alias esatto configurato dal tenant risolve solo quando univoco;
- la normalizzazione preserva zeri iniziali e punteggiatura;
- il case-folding si applica solo quando configurato esplicitamente;
- conflitto header/riga; conflitto di riferimento tra documenti; riferimento progetto sconosciuto
  (`PROJECT_REFERENCE_UNKNOWN`); progetto inattivo; conferma manuale; conferma manuale superata da
  evidenza sorgente successiva; isolamento tenant; comportamento deterministico indipendente
  dall'ordine dell'array sorgente; nessun fuzzy match; nessun UUID grezzo mostrato; problema di
  fonte organization-wide (`PROJECT_SOURCE_UNAVAILABLE`) mai attribuito a un ordine; stato
  `PROCUREMENT_CONTEXT_NOT_EVALUATED` di migrazione; ri-elaborazione idempotente;
- **il contesto progetto canonico e le segnalazioni di qualità restano due contratti separati**
  (§14.1);
- **lo stato di consegna resta invariato dalla qualità del collegamento progetto** (§15).

**I dati live mutabili di Graphic Center non devono mai essere codificati in un'asserzione di test
permanente** — esattamente la disciplina già applicata in Fase 2C.1A/2C.1B.

---

## 25. Fasi di implementazione proposte

**[PROPOSTO]**, valutando la sequenza suggerita contro la realtà del repository:

- **2D.1A — Contesto progetto esistente, sola lettura**: esporre in modo sicuro i campi progetto
  esistenti su ordine e riga (§7.1, fase di compatibilità); validare i riferimenti `project_id`
  stesso-tenant; rilevare la coerenza `project_id`/`project_code`; rappresentare esplicitamente
  `PROCUREMENT_CONTEXT_NOT_EVALUATED`; **nessun nuovo matching; nessuna nuova scrittura; nessuna
  tabella di provenienza ancora**. **Prerequisito naturale**, poiché oggi la FK esiste ma non è mai
  letta — il rischio più basso possibile.
- **2D.1B — Collegamenti canonici provenienza-aware**: selezionare il modello di fonte di verità
  definitiva (§7.1); introdurre provenienza e supersessione (§8, §21); definire la proiezione di
  compatibilità per le colonne legacy; aggiungere le regole di fonte fidata e corrispondenza esatta
  (§9); validare se `entity_aliases` può essere riusata (§10.bis).
- **2D.1C — Segnalazioni di qualità e contesto d'ordine in sola lettura**: integrare le
  segnalazioni progetto deterministiche (§14.2); esporre il contesto progetto in
  `OrderOperationalView` o nel contratto condiviso scelto (§14.1/§20); aggiungere suggerimenti
  diagnostici solo per le segnalazioni genuine approvate; preservare la separazione dallo stato di
  consegna (§15).
- **2D.1D — Conferma manuale e audit**: conferma scoped; sovrascrittura; risoluzione conflitti;
  supersessione; storico di audit (§13).
- **2D.2 — Modulo operativo Progetti**: elenco progetti; dettaglio progetto; viste PM/responsabile
  di progetto; filtri progetto; dashboard operative specifiche di progetto.
- **Sottofase di allocazione futura** (oltre 2D.2, non stimata qui): una singola riga d'ordine
  ripartita tra più progetti; quantità/percentuali/allocazioni di costo — **solo dopo che una fonte
  reale e un'esigenza di business siano confermate** (§7.3).

**Questa sequenza è raccomandata come la più sicura**, perché: (a) 2D.1A da sola non richiede
alcuna nuova logica di matching, solo esporre dati già presenti nello schema; (b) separare 2D.1B da
2D.1A permette di validare il contratto di lettura e scegliere il modello di fonte di verità prima
di introdurre qualunque regola di matching che tocchi dati storici; (c) 2D.1C mantiene il contesto
progetto canonico e le segnalazioni di qualità come due contratti separati (§14.1), riducendo il
rischio di richieste duplicate e di confondere identità con diagnostica; (d) 2D.1D (scrittura) è
isolata per ultima, dopo che lettura e diagnostica sono stabili. **Questa suddivisione non è
assunta come corretta a priori** — è la raccomandazione di questa analisi, non una decisione già
approvata.

---

## 26. Non-goal

Non vengono implementati o specificati in dettaglio eseguibile in questa fase: fuzzy matching;
collegamento confermato basato su LLM; pianificazione di progetto; conclusioni di impatto su
milestone; dipendenza materiale-attività; budget di progetto; controllo costi; task "Oggi"
persistiti; performance fornitore; tabelle di entitlement; navigazione modulare; redesign finale
dell'UI; ordini cliente. Le dipendenze concettuali verso queste aree future sono identificate
sopra ma non incluse silenziosamente nel perimetro di Fase 2D.1.

## 27. Rischi e decisioni aperte

### 27.1 Decisioni chiuse in questa revisione

- `GENERAL_STOCK` e `OVERHEAD` restano due classificazioni distinte (§10.1/§11).
- `NON_PROJECT`/"non-progetto" esiste solo come ombrello derivato per la presentazione, mai come
  classificazione memorizzata (§11).
- **Nessun nuovo ruolo globale PM in Fase 2D.1** (§13/§19).
- Motivazione **opzionale** per una prima conferma ordinaria (§13).
- Motivazione **obbligatoria** per sovrascrittura/risoluzione conflitto/riclassificazione/reversal
  (§13).
- La conferma manuale appartiene alla Fase 2D.1D (§13/§25).
- Un'uguaglianza esatta da un campo non verificato **non è sufficiente** per confermare un
  collegamento (§9.1).

### 27.2 Decisioni genuinamente aperte

**[DECISIONE APERTA]**
1. Forma definitiva della tabella provenienza-aware (§7.1/§21) — i nomi di campo qui proposti sono
   un punto di partenza, non finali.
2. Strategia di compatibilità/deprecazione per le colonne esistenti `project_id`/`project_code`
   (proiezione derivata sincronizzata, oppure campo deprecato di sola lettura — §7.1).
3. Se `entity_aliases` supera la validazione richiesta (§10.bis) o se è necessaria una tabella
   di alias dedicata al progetto.
4. Forma esatta del registro/configurazione delle fonti fidate (quali campi, di quali sistemi
   sorgente, sono registrati come portatori di identità progetto — §9.1).
5. Modello di allocazione futuro per una singola riga d'ordine servita da più progetti (§7.3/§25).
6. Estensione esatta del contratto endpoint/query (§20) — il principio "no endpoint per widget" è
   deciso, la forma esatta non lo è.
7. Se il prodotto vuole comunque un'etichetta "PM" esplicita per ragioni di UI/comunicazione, oltre
   al permesso scoped già sufficiente tecnicamente (§19).
8. Come/se popolare `orders.project_id`/`material_lines.project_id` per gli ordini di acquisto reali
   in produzione oggi dipende da un processo (probabilmente nel worker, non in questo repository)
   non ispezionabile da questa sessione — deve essere chiarito prima di 2D.1B.

**Rischi**: la doppia colonna `project_id`/`project_code` già esistente su `orders` e
`material_lines`, mai vincolata a coerenza reciproca, è un rischio di divergenza silenziosa se un
futuro processo di scrittura popola l'una senza l'altra — Fase 2D.1A deve trattare questo
esplicitamente (leggere entrambe, segnalare disaccordo, mai assumerne una come sempre corretta).

## 28. Criteri di accettazione

La proposta è accettabile solo se, come qui verificato: è fondata sul repository e sui dati del
tenant attuali (§2-3); distingue collegamenti a livello ordine da quelli a livello riga (§7);
tratta le procure di stock/overhead/non-progetto come casi di prima classe, distinti l'uno
dall'altro (§10.1/§11); mantiene provenienza esatta (§8); definisce matching deterministico e
comportamento fail-closed, incluso il requisito di fonte strutturata fidata (§9); previene
corrispondenze cross-tenant (già garantito dallo schema esistente, §2.1, e rinforzato da
`PROJECT_LINK_CROSS_TENANT_INVALID`, §14.2); previene collegamenti confermati fuzzy o generati da
IA (§9.3/§10.bis); distingue classificazione di procurement da valutazione del collegamento, e
dentro quest'ultima gli stati confermato/ereditato/ambiguo/mancante-richiesto/non valutato (§10);
definisce il comportamento di conflitto senza selezionare silenziosamente un vincitore, inclusa la
coerenza `project_id`/`project_code` (§9.1/§12); supporta una futura conferma manuale con audit
(§13); mantiene separata la qualità del collegamento progetto dallo stato di consegna del fornitore
(§15); evita di duplicare i dati canonici per il modulo Progetti (§18); si integra concettualmente
con segnalazioni e azioni esistenti mantenendo il contesto progetto canonico e le segnalazioni di
qualità come contratti separati (§14.1/§17); propone una sequenza di implementazione incrementale
sicura (§25); non ha modificato codice o dati (§29).

**Criteri aggiuntivi (correzione di questa revisione)**:
- **una sola fonte di scrittura canonica** per il collegamento progetto — le colonne legacy
  `project_id`/`project_code` non restano scrivibili indipendentemente dai collegamenti canonici
  una volta raggiunta la fase di provenienza definitiva (§7.1);
- **nessuna mutazione indipendente** tra colonne legacy e record di collegamento canonico;
- **nessun modello progetto canonico duplicato** per il modulo Progetti (§18, invariato);
- **nessuna identità progetto canonica proveniente dal `pilot-quality-contract`** come sua fonte di
  verità (§14.1);
- **nessun collegamento progetto creato da un'uguaglianza testuale non verificata** (§9.1).

## 29. Conferma che non è stata eseguita alcuna implementazione

Nessun file sorgente, test, endpoint, adapter, schema database, file di pacchetto o configurazione
è stato modificato. Nessun dato live di Graphic Center è stato modificato — ogni verifica live è
stata eseguita in sola lettura tramite un server di sviluppo temporaneo, arrestato subito dopo.
Nessuna informazione mutabile del tenant è stata codificata come asserzione di test permanente in
questo documento. È stato creato esattamente un file:
`docs/product/PILOT_PHASE_2D_ORDER_PROJECT_LINKING_PROPOSAL.md`.
