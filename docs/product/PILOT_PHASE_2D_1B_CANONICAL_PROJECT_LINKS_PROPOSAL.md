# Fase 2D.1B — Modello canonico e provenienza per il collegamento ordine di acquisto ↔ progetto

Stato: **specifica approvata; fondamento 2D.1B.1 preparato localmente e non applicato**. La
migrazione e i test comportamentali restano non committati e non sono stati eseguiti contro alcun
database configurato o live. Nessun endpoint, adapter, contratto di lettura, dato cliente o
configurazione live è stato modificato.

Etichette usate in tutto il documento:

- **[CONFERMATO]** — verificato direttamente nel codice sorgente, nelle migrazioni o nei dati live
  in questa sessione;
- **[PROPOSTO]** — raccomandazione di design, non ancora approvata né implementata;
- **[RINVIATO]** — esplicitamente fuori perimetro per questa fase;
- **[DECISIONE APERTA]** — richiede approvazione di prodotto prima di procedere.

Questa revisione **corregge** una versione precedente dello stesso documento sulla base di una
serie di correzioni architetturali autoritative. Le correzioni non indeboliscono nessuno dei fatti
già confermati in precedenza (`projects` unica entità canonica; i campi progetto esistenti su
ordine/riga privi di provenienza sufficiente; i tre ordini noti di Graphic Center Group privi di
riferimenti progetto; `entity_aliases` priva di foreign key enforceable e mai usata
applicativamente; il server usa la service-role key di Supabase; l'isolamento tenant attuale si
basa principalmente su filtri applicativi; Fase 2D.1A resta di sola lettura e legge oggi le colonne
legacy) — le estendono e correggono dove necessario.

---

## 1. Stato e scopo

**[CONFERMATO]** Branch `feature/pilot-control-check`. Il working tree contiene esclusivamente il
fondamento 2D.1B.1 locale non committato descritto in apertura. Documento madre:
[PILOT_PHASE_2D_ORDER_PROJECT_LINKING_PROPOSAL.md](PILOT_PHASE_2D_ORDER_PROJECT_LINKING_PROPOSAL.md).
Implementazione completata rilevante: Fase 2D.1A (contesto progetto esistente, sola lettura).

**[PROPOSTO]** Fase 2D.1B definisce il modello canonico, provenance-aware, definitivo per la
relazione ordine di acquisto↔progetto. Il solo fondamento additivo 2D.1B.1 è tradotto nella
migrazione locale non applicata `20260729170041_canonical_project_link_schema_foundation.sql` e
verificato con PGlite. Resolver, backfill, percorsi di scrittura, API, cutover e flussi UI restano
rinviati agli incrementi successivi.

---

## 2. Schema attuale confermato

**[CONFERMATO]**, verificato direttamente nelle migrazioni Supabase.

### 2.1 `projects`
`id UUID PK`, `organization_id UUID NOT NULL REFERENCES organizations(id)`,
`project_code TEXT` con `UNIQUE(organization_id, project_code)`. **Correzione rispetto a una
versione precedente di questo documento**: esiste già un indice unico
`uniq_projects_org_id ON projects(organization_id, id)` (creato in più migrazioni in modo
idempotente, es. `20260714182835_contractwatch_foundation.sql`,
`20260717135938_canonical_data_quality_guardrails.sql`), **già usato come target di foreign key
composite da altre tabelle** (`contractwatch_sal_billing_vertical.sql`,
`procurement_requirements_v1.sql`). **Non serve quindi aggiungere questo vincolo — esiste già.**
Canonica — unica entità progetto, non duplicata.

### 2.2 `orders.project_id` / `orders.project_code`
`project_id UUID REFERENCES projects(id)`, `project_code TEXT`, nessun vincolo di coerenza
reciproca. **Correzione confermata**: esiste già `uniq_orders_org_id ON orders(organization_id, id)`
(`20260712163117_nova_vision_receiving_v1.sql`), **già usato come target FK composito** da
`purchase_order_lines` (§2.3). **Denormalizzati/legacy** — letti oggi in sola lettura da Fase
2D.1A, mai scritti da alcun percorso applicativo ispezionato.

### 2.3 L'identità di riga persistita reale — correzione sostanziale

**[CONFERMATO — la correzione più importante di questa revisione]**. Una versione precedente di
questo documento assumeva che `material_lines` fosse la tabella persistita di riferimento per le
righe d'ordine di acquisto. **Verifica diretta della vista `canonical_operational_lines`
(`20260717180000_canonical_operational_view.sql`) mostra che questo non è corretto per le righe di
acquisto fornitore**: la vista è un'unione di **quattro tabelle base distinte** —
`project_requirements`, `quote_lines`, `purchase_order_lines`, `delivery_note_lines` — ciascuna
proiettata su un `entity_kind` diverso. Le righe con `entity_kind = 'purchase_order_line'`
(`sourceType: 'supplier_order'` nell'output frontend, confermate live come l'unico tipo presente sui
tre ordini noti) provengono dalla tabella `purchase_order_lines`, **non** da `material_lines`.

**`purchase_order_lines` (verificato in `20260712163117_nova_vision_receiving_v1.sql`)**:
```
id UUID PRIMARY KEY, organization_id UUID NOT NULL REFERENCES organizations(id),
order_id UUID NOT NULL, line_number, internal_item_code, supplier_item_code, description,
ordered_quantity, confirmed_quantity, unit_of_measure, unit_price, total_price, promised_date,
status, source_material_line_id, notes, created_at, updated_at,
CONSTRAINT fk_purchase_order_lines_order_tenant
  FOREIGN KEY (organization_id, order_id) REFERENCES orders(organization_id, id) ON DELETE CASCADE,
CONSTRAINT uniq_purchase_order_lines_org_id UNIQUE (organization_id, id)
```

**Questa è la tabella persistita reale che deve essere il target FK di `line_project_links`** —
possiede già `id` stabile attraverso il rielaborazione, `organization_id`, una FK composita verso
`orders(organization_id, id)`, **e un vincolo `UNIQUE(organization_id, id)` già esistente**
(`uniq_purchase_order_lines_org_id`), pronto per essere referenziato da una futura FK composita
senza bisogno di aggiungerlo.

**Scoperta critica correlata**: `purchase_order_lines` **non ha alcuna colonna `project_id`/
`project_code` propria**. Confermato dall'elenco completo delle colonne sopra. Nella vista
`canonical_operational_lines`, il ramo `purchase_order_line` proietta `o.project_id`/`o.project_code`
(cioè i campi dell'**ordine**, tramite `join public.orders o on o.organization_id = pol.organization_id
and o.id = pol.order_id`), **mai un valore proprio della riga**. Questo significa: **per le righe di
acquisto fornitore, non esiste oggi alcun meccanismo — nemmeno in linea di principio — per cui una
riga abbia un riferimento progetto diverso da quello del proprio ordine**; ciò che Fase 2D.1A mostra
come "contesto progetto di riga" per queste righe è sempre, strutturalmente, identico al contesto
d'ordine, mai un'osservazione di riga indipendente. **Conseguenza diretta per il backfill (§18)**:
non esiste alcun valore legacy di riga da migrare per le righe di acquisto fornitore — solo
`orders.project_id`/`orders.project_code` richiedono backfill; `line_project_links` parte
genuinamente vuota per gli ordini di acquisto esistenti.

(`material_lines` resta la tabella base per il ramo `sourceType: 'quote'`/`'customer_request'` della
vista, cioè il lato domanda cliente — fuori perimetro per questa fase, invariato.)

### 2.4 `entity_aliases` — valutazione concreta di schema e comportamento
**[CONFERMATO]**: `id UUID PK`, `entity_type CHECK (... IN (..., 'project', ...))`, **`entity_id UUID`
senza alcun vincolo di foreign key** (impossibile con un design polimorfico puro), `organization_id`
(aggiunta dalla migrazione di tenant-isolation, `UNIQUE(organization_id, entity_type,
normalized_alias)`). **Lacuna di integrità confermata**: nulla garantisce che, quando
`entity_type='project'`, `entity_id` esista in `projects` **e appartenga alla stessa
`organization_id`** della riga alias. **Grep esaustivo conferma zero query applicative** su questa
tabella in tutto il codebase — schema-presente, mai popolata, mai interrogata.

### 2.5 Isolamento tenant reale — modello a difesa in profondità (corretto)

**[CONFERMATO]**: `ENABLE ROW LEVEL SECURITY` è applicato a molte tabelle applicative (`material_lines`,
`quotes`, `entity_aliases`, `organizations`, `organization_memberships`, ecc.) ma **mai a `projects`
né a `orders`**; **nessuna `CREATE POLICY` esiste per nessuna tabella** in tutto il repository.
`server/lib/_supabaseRest.js` autentica ogni richiesta con `SUPABASE_SERVICE_KEY` — la
**service-role key**, che **bypassa RLS per progettazione** indipendentemente da qualunque policy.

**Correzione architetturale rispetto a una versione precedente di questo documento**: la
conclusione "RLS non serve per le nuove tabelle" era **sbagliata come raccomandazione finale**,
anche se il fatto osservato (RLS oggi inefficace sui percorsi service-role) resta corretto. Il
modello corretto è a **tre livelli complementari, non alternativi**:

1. **Vincoli di integrità a livello database** (foreign key composite) — la difesa **primaria**
   contro relazioni cross-tenant non valide, efficace indipendentemente dal ruolo di connessione.
2. **Row Level Security** — **rimane richiesta o fortemente raccomandata per ogni nuova tabella
   tenant-owned** (`order_project_links`, `line_project_links`, `project_reference_observations`,
   `project_link_candidates`, `project_link_decisions`, `project_external_identifiers`,
   `trusted_project_source_fields`), coerente con il pattern già maggioritario nel repository (la
   maggior parte delle tabelle applicative HA RLS abilitata, anche se senza policy — l'assenza di
   policy è essa stessa la lacuna da registrare, non il modello desiderato). RLS protegge
   qualunque futuro percorso di accesso autenticato/diretto al database che non passi dalla
   service-role key (es. un client con chiave anon+JWT, un tool di BI, un accesso diretto per
   debug) — scenari che oggi non esistono ma che le tabelle non devono lasciare strutturalmente
   indifese.
3. **Filtro esplicito `organization_id` nelle query server**, incluso ogni percorso che usa la
   service-role key — **obbligatorio e non sostituibile da RLS su quei percorsi**, perché la
   service role la bypassa comunque.

**Regole esplicite**: le foreign key composite sono la difesa primaria contro relazioni cross-tenant
non valide; RLS resta richiesta/fortemente raccomandata per ogni nuova tabella tenant-owned; i
percorsi server con service-role key non devono mai fare affidamento su RLS, perché la service role
la bypassa; il filtro applicativo non sostituisce i vincoli database; RLS non sostituisce il filtro
applicativo sui percorsi service-role. **L'assenza attuale di policy RLS su `projects`/`orders` è
registrata come una lacuna di sicurezza/architettura esistente, non come il modello futuro
desiderato** — vedi §15. **Questo documento non retrofitta RLS sulle tabelle esistenti** — fuori
perimetro, richiede una revisione di sicurezza separata.

### 2.6 Pattern di audit/trigger esistenti
**[CONFERMATO]** `set_updated_at()` (trigger `BEFORE UPDATE`, applicato genericamente).
`organization_memberships(id, organization_id, app_user_id, role CHECK (... IN ('Owner','IT',
'Admin','Buyer','ReadOnly')), active, is_default, created_at, updated_at)` — target naturale per
`confirmed_by_membership_id`.

---

## 3. Comportamento confermato di Fase 2D.1A

**[CONFERMATO]**, da `server/lib/purchaseOrderProjectContext.js` e
`server/routes/order-operational-view.js`: query di validazione progetto tenant-scoped a livello
SQL, eseguita solo se esistono `project_id` osservati; stati prodotti:
`PROCUREMENT_CONTEXT_NOT_EVALUATED`, `PROJECT_CODE_OBSERVED_UNVERIFIED`,
`PROJECT_LINK_UNKNOWN_PROJECT`, `PROJECT_LINK_CROSS_TENANT_INVALID`, `PROJECT_LINK_CONFLICT`,
`PROJECT_LINK_CONFIRMED`. Nessuna scrittura. Nessun UUID grezzo esposto. Verificato live: tutti e
tre gli ordini noti di Graphic Center Group restituiscono `PROCUREMENT_CONTEXT_NOT_EVALUATED` a
livello ordine e su ogni riga, senza eccezioni.

---

## 4. Decisioni architetturali preservate da Fase 2D (documento madre)

**[CONFERMATO come vincolo, non rinegoziato qui]**: `projects` unica entità canonica; nessuna
seconda copia per il modulo Progetti; un ordine ha zero o un progetto di default esplicito; una
riga ha zero o un progetto esplicito; l'assegnazione esplicita di riga prevale sul default d'ordine
per quella riga; l'ereditarietà si applica solo alle righe senza riferimento esplicito; ereditato ed
esplicito restano distinguibili; `MULTI_PROJECT_ORDER` è derivato dalle assegnazioni di riga
effettive; l'allocazione quantitativa di una riga singola su più progetti resta rinviata;
`GENERAL_STOCK`/`OVERHEAD` restano classificazioni distinte; `NON_PROJECT` è solo derivato;
un'uguaglianza esatta da un campo non verificato non può confermare un collegamento; gli alias IA
possono produrre solo candidati; nessun ruolo PM globale; Fase 2D.1B non altera lo stato di
consegna né le azioni operative esistenti; il contesto progetto canonico appartiene al contratto
operativo dell'ordine; le segnalazioni di collegamento progetto appartengono al Data Quality
Contract in Fase 2D.1C.

---

## 5. Fonte canonica di verità — raccomandazione

**[PROPOSTO]** Tabelle dedicate `order_project_links` / `line_project_links` (invariato rispetto
alla revisione precedente) — una sola riga *attiva* per (organizzazione, ordine|riga), con
storicizzazione delle righe superate. Scartate: una tabella comune con `order_id`/`line_id`
nullable separati (ambiguità di unicità); riuso delle sole colonne `project_id` esistenti come
fonte di scrittura (nessuna provenienza/stato/storicità nativa). **Nessun design polimorfico
generico `entity_type`/`entity_id`** — la stessa lacuna di integrità osservata su `entity_aliases`
(§2.4) si ripresenterebbe identica.

**Correzione strutturale importante (§7)**: a differenza della revisione precedente, i collegamenti
canonici **non** portano più direttamente tutti i campi di provenienza grezza — questi vivono in
tabelle separate di osservazione/candidato/decisione (§7bis).

---

## 6. Transizione delle colonne legacy

**[PROPOSTO]** Proiezioni di compatibilità derivate durante un periodo di transizione, poi
rimozione pianificata — mai colonne legacy indefinitamente scrivibili in parallelo alla fonte
canonica. Sequenza (corretta e ampliata in §18/§10bis: non un backfill una tantum, ma un periodo di
sincronizzazione continua fino al cutover).

---

## 7. Tabelle di collegamento canoniche — contratto minimo (corretto)

**[PROPOSTO]** Il collegamento canonico riferisce la **decisione/provenienza** che lo ha
giustificato (§7bis), invece di duplicare tutti i dati sorgente grezzi:

| Campo | Classificazione |
|---|---|
| `id` | Richiesto in 2D.1B.1 |
| `organization_id` | Richiesto in 2D.1B.1 |
| `order_id` (su `order_project_links`, riferisce `orders.id`) / `line_id` (su `line_project_links`, riferisce **`purchase_order_lines.id`**, §2.3) | Richiesto in 2D.1B.1 |
| `project_id` | Richiesto in 2D.1B.1 |
| `decision_id` (riferisce `project_link_decisions`, §7bis/§8) | Richiesto in 2D.1B.1 |
| `valid_from` | Richiesto in 2D.1B.1 |
| `superseded_at` | Richiesto in 2D.1B.1 |
| `superseded_by_id` | Richiesto in 2D.1B.1 (self-referencing, con considerazioni di deferrabilità, §12) |
| `ended_by_decision_id` | Richiesto in 2D.1B.1; decisione immutabile che chiude l'associazione senza sostituzione (§8/§12) |
| `created_at` / `updated_at` | Richiesto in 2D.1B.1 |
| `confirmed_by_membership_id` / `confirmation_reason` | **Non più sul collegamento stesso** — spostati su `project_link_decisions` (§7bis), dove appartengono concettualmente |
| un blob `metadata` generico | Evitato — i campi espliciti coprono ogni caso previsto |

---

## 7bis. Separazione osservazione / candidato / collegamento canonico

**[PROPOSTO — correzione strutturale]** Una versione precedente collocava tutta la provenienza
direttamente sulla riga di collegamento canonico. Questo viene corretto in **tre concetti
separati**:

### A. `project_reference_observations`
Rappresenta **ciò che una fonte ha realmente riportato**, mai un'interpretazione:
```
id, organization_id, order_id (nullable), line_id (nullable, riferisce purchase_order_lines.id),
source_system, source_record_id, source_field,
raw_observed_value,       -- valore esattamente come osservato, mai modificato
normalized_value,         -- dopo normalizzazione approvata (§9 del documento madre)
observed_at,
evidence_ref,
trusted_source_registration_id (nullable, riferisce trusted_project_source_fields, §9),
processing_run_id,        -- identità del processo/job che ha prodotto l'osservazione
created_at
```
Un'osservazione è **immutabile** una volta scritta — rappresenta un fatto storico ("la fonte X ha
riportato il valore Y in data Z"), mai un'affermazione corrente.

**[PROPOSTO — principio esplicito, chiarimento finale]**: *"Le osservazioni di riferimento progetto
rappresentano solo ciò che una fonte ha riportato in un momento specifico. Non rappresentano lo
stato corrente dell'ordine, della riga o dell'associazione progetto."* Conseguenze esplicite:

- un'osservazione è un fatto sorgente immutabile, non uno stato di dominio;
- può essere obsoleta, non valida, ambigua o contraddetta da osservazioni successive — questo non
  la invalida retroattivamente, la lascia semplicemente storicamente accurata;
- può produrre zero, uno o più candidati (§7bis-B), mai automaticamente essa stessa un collegamento;
- **non diventa mai canonica per la sua semplice esistenza** — solo una decisione esplicita (§8) può
  promuoverne l'esito a collegamento attivo;
- **non deve mai essere interrogata come l'assegnazione progetto corrente autoritativa** — nessun
  percorso applicativo, operativo o di reportistica legge `project_reference_observations`
  direttamente per determinare il progetto effettivo di un ordine o riga;
- resta preservata anche dopo che un candidato derivato viene rifiutato o un collegamento canonico
  supportato viene superato — non viene mai cancellata da un esito successivo.

**Lo stato corrente autoritativo deve sempre essere derivato esclusivamente dalle tabelle di
collegamento canonico attive** (`order_project_links`/`line_project_links`, §7/§13), mai dalle
osservazioni né dai candidati.

### B. `project_link_candidates`
Rappresenta zero, uno o più progetti candidati derivati da un'osservazione:
```
id, organization_id, observation_id (riferisce project_reference_observations),
candidate_project_id,
rule_applied ('EXACT_TRUSTED_REFERENCE' | 'SOURCE_NATIVE_STRUCTURED' | 'IMPORTED_HISTORICAL'),
candidate_status ('PENDING' | 'PROMOTED' | 'REJECTED' | 'SUPERSEDED_BY_MANUAL'),
resolved_at, resolution_decision_id (nullable, riferisce project_link_decisions se promosso),
created_at, updated_at
```

### C. `order_project_links` / `line_project_links`
Rappresentano **solo** la relazione esplicita canonica e il suo storico (§7) — riferiscono la
decisione che le ha giustificate, mai duplicando i dati grezzi sorgente.

**Regole**: un'osservazione può produrre zero candidati (nessuna corrispondenza); un'osservazione
può produrre più candidati ambigui (nessuno promosso automaticamente); un candidato non diventa mai
automaticamente un collegamento canonico — deve passare per una decisione esplicita (§7bis-D); un
collegamento canonico può essere supportato da più osservazioni/evidenze nel tempo (tramite più
righe in `project_link_decisions`, §8, ciascuna collegata alle proprie osservazioni); l'ambiguità
non viene mai memorizzata come collegamento attivo. **Nessuna percentuale di confidenza in nessuna
delle tre tabelle.**

**Nota di semplificazione implementativa**: il modello concettuale sopra può essere semplificato
nell'implementazione (es. fondendo B in una colonna di stato su A, se la cardinalità osservazione→
candidato è quasi sempre 1:1 in pratica) — ma la **distinzione concettuale tra osservazione,
candidato e collegamento canonico deve restare preservata** in qualunque implementazione scelta.

**Stato di lavorazione mutabile vs. fatto immutabile**: se lo stato di risoluzione di un candidato
(`candidate_status` su `project_link_candidates`) è memorizzato separatamente dall'osservazione,
questo stato è **lavorazione mutabile** (può transitare `PENDING → PROMOTED/REJECTED/
SUPERSEDED_BY_MANUAL`), distinta e non da confondere con il record di decisione immutabile (§8) né
con l'osservazione sorgente immutabile (sopra) — mutare `candidate_status` non riscrive mai
`raw_observed_value`/`normalized_value` sull'osservazione collegata, e non riscrive mai una
`project_link_decisions` già creata.

---

## 8. Modello di provenienza e decisione (nuovo, corretto)

**[PROPOSTO]** Introdotta `project_link_decisions`, in relazione molti-a-uno con il collegamento
canonico che giustifica:

```
project_link_decisions
  id, organization_id,
  decision_kind (
    'IMPORTED_HISTORICAL' | 'EXACT_TRUSTED_REFERENCE' |
    'SOURCE_NATIVE_STRUCTURED' | 'MANUAL_CONFIRMATION'
  ),
  primary_observation_id (riferisce project_reference_observations, nullable per MANUAL_CONFIRMATION
    senza un'osservazione sorgente diretta),
  confirmed_by_membership_id (nullable — solo per MANUAL_CONFIRMATION),
  confirmation_reason (nullable in 2D.1B, obbligatorio per override/conflitto/reversal in 2D.1D),
  decided_at,
  created_at
```

```
project_link_decision_observations   -- tabella ponte molti-a-molti
  decision_id, observation_id
```

Questo supporta: decisione storica importata; decisione da fonte fidata esatta; decisione da campo
strutturato nativo; futura conferma manuale (2D.1D); **più osservazioni/evidenze a supporto della
stessa decisione** (tramite la tabella ponte); attore-membership dove rilevante; timestamp di
decisione; motivazione obbligatoria per override/conflitto/reversal in Fase 2D.1D (il campo esiste
già nello schema 2D.1B per evitare una riprogettazione futura, ma non è popolato/richiesto finché
2D.1D non implementa la scrittura). **Non viene richiesta l'intera UI di conferma manuale in questa
fase** — solo lo schema che la supporterà.

**Perché non un singolo campo `evidence_ref`**: un singolo riferimento evidenza sulla riga di
collegamento (come nella revisione precedente) non può rappresentare "questo collegamento è
supportato da tre osservazioni indipendenti nel tempo" — la tabella ponte risolve questo.

### Vincolo di unicità composita su `project_link_decisions` (chiarimento finale)

**[PROPOSTO]** `project_link_decisions.id` resta l'identificatore primario della tabella (`PRIMARY
KEY`). In aggiunta, la tabella deve esporre un vincolo di unicità composita:

```
ALTER TABLE project_link_decisions
  ADD CONSTRAINT uniq_project_link_decisions_org_id UNIQUE (organization_id, id);
```

Questo vincolo è **richiesto**, non opzionale, perché `order_project_links`/`line_project_links`
referenziano la decisione tramite una FK composita (§16):

```
FOREIGN KEY (organization_id, decision_id)
  REFERENCES project_link_decisions(organization_id, id)
```

e una FK composita richiede una chiave candidata altrettanto composita sulla tabella referenziata —
`id` da solo (per quanto già `PRIMARY KEY`) non è sufficiente a supportarla. Conseguenza diretta:
ogni riferimento a una decisione da un collegamento canonico **deve** includere `organization_id`, e
il vincolo impedisce strutturalmente che un collegamento di un'organizzazione possa referenziare una
decisione posseduta da un'altra organizzazione — lo stesso pattern già usato per `orders`, `projects`
e `purchase_order_lines` (§2.1/§2.2/§2.3), qui applicato in modo identico a `project_link_decisions`.
Questo vincolo va aggiunto già in **2D.1B.1** (fondamento di schema, §21), contestualmente alla
creazione di `project_link_decisions` e delle tabelle di collegamento canoniche.

La tabella ponte `project_link_decision_observations` (§8, sopra) referenzia `decision_id` e
`observation_id`; dove applicabile allo stesso principio di isolamento tenant, anche questi
riferimenti devono essere espressi come FK composite tenant-aware (`(organization_id, decision_id)`
verso `project_link_decisions(organization_id, id)`; `(organization_id, observation_id)` verso
`project_reference_observations(organization_id, id)`), non come FK su `id` da solo — coerentemente
con il fatto che anche `project_reference_observations` necessita dello stesso vincolo
`UNIQUE(organization_id, id)` per essere un target FK composito valido.

### Immutabilità delle decisioni (chiarimento finale)

**[PROPOSTO — regola non negoziabile]** Una riga in `project_link_decisions` è un **fatto di audit
immutabile**: rappresenta "a questa data, con queste evidenze, è stata presa questa decisione" — un
evento storico, non uno stato aggiornabile. Regole esplicite:

- una decisione esistente **non deve mai essere modificata** per rappresentare una conclusione
  successiva — nessun `UPDATE` su `decision_kind`, `primary_observation_id`,
  `confirmed_by_membership_id`, `confirmation_reason` o `decided_at` di una riga già scritta;
- se nuove osservazioni, nuove evidenze, una nuova configurazione di fonte fidata o una revisione
  manuale portano a una conclusione diversa, si **crea una nuova riga** in `project_link_decisions`
  — mai un aggiornamento della riga precedente;
- il collegamento canonico correlato (`order_project_links`/`line_project_links`) viene quindi
  **superato tramite il modello close-then-insert approvato** (§12), puntando alla nuova decisione
  di creazione tramite `decision_id`; se la conclusione è una disassociazione senza progetto
  sostitutivo, la nuova decisione viene invece registrata in `ended_by_decision_id` sulla riga
  storica chiusa e non viene creato alcun collegamento sintetico;
- la decisione precedente e il collegamento canonico precedente **restano disponibili per la
  ricostruzione storica** — nessuna riga di decisione o di collegamento viene mai cancellata a
  seguito di una nuova decisione.

Solo campi esplicitamente definiti come stato di lavorazione mutabile (es. `candidate_status` su
`project_link_candidates`, §7bis nota finale) possono cambiare nel tempo; questi **non sono la
decisione stessa** e non riscrivono mai una decisione già registrata. Se in futuro venisse
introdotto un campo di "stato corrente" o "ultima risoluzione" a livello di collegamento o
candidato, tale campo deve restare distinto dal record di decisione immutabile e non deve mai
essere usato per riscrivere la cronologia.

**Requisiti di test aggiunti** (vedi anche §20): una decisione esistente resta invariata dopo che
viene creata una decisione successiva; una decisione successiva crea una nuova versione del
collegamento canonico (mai un aggiornamento in-place della versione precedente); la ricostruzione
puntuale nel tempo (point-in-time) restituisce la decisione e il collegamento corretti per quel
momento storico; un reversal non sovrascrive mai la decisione originale — crea sempre una nuova
decisione che supera la precedente.

---

## 9. Registro delle fonti fidate

**[PROPOSTO, invariato nella sostanza]**:
```
trusted_project_source_fields
  id, organization_id, source_system, entity_scope ('ORDER'|'LINE'),
  source_field, identifier_type ('project_id_fk'|'project_code_text'),
  normalization_policy, case_sensitive, active,
  effective_from, effective_to, created_at, updated_at
  UNIQUE (organization_id, source_system, entity_scope, source_field) WHERE active
```
Configurazione, non fork di codice tenant-specifico. Disattivare un registro non invalida i
collegamenti già confermati tramite esso. Corrispondenze multiple → candidato ambiguo, mai una
scelta automatica. Non implementato in questa fase.

---

## 10. `entity_aliases` — decisione corretta (esclusione dal percorso iniziale)

**[PROPOSTO — decisione rafforzata]**: **`entity_aliases` resta completamente fuori dal percorso di
risoluzione canonica di Fase 2D.1B.** L'implementazione iniziale **non legge, non modifica e non
dipende da `entity_aliases` in alcun modo**. Al suo posto: **`project_external_identifiers`**,
tabella dedicata per identità esterne confermate e deterministiche (§11). Un futuro uso di
`entity_aliases` per **suggerire** candidati (mai confermare) è **rinviato** e richiede un contratto
approvato separatamente — non fa parte di questa fase né è assunto come deciso.

Motivazione invariata: `entity_id` privo di FK enforceable; nessuna garanzia che
`organization_id` dell'alias corrisponda all'organizzazione reale del progetto referenziato; zero
uso applicativo reale da preservare per compatibilità.

**Regola non negoziabile, indipendentemente dalla tabella**: un alias con `source='ai'` non popola
mai `project_external_identifiers` né un collegamento canonico direttamente.

---

## 11. `project_external_identifiers` — contratto

**[PROPOSTO]**:
```
project_external_identifiers
  id, organization_id,
  project_id,
  -- FK composita: (organization_id, project_id) REFERENCES projects(organization_id, id)
  -- già supportata dall'indice esistente uniq_projects_org_id (§2.1) — nessuna aggiunta necessaria
  source_system,
  identifier_type,
  raw_identifier_value,        -- valore esattamente come registrato
  canonical_identifier_value,  -- dopo normalizzazione secondo la policy del registro fonte (§9)
  case_sensitive,               -- ereditato/copiato dal registro fonte al momento della creazione
  origin ('buyer' | 'system' | 'import'),  -- 'ai' esplicitamente escluso
  confirmed_by_membership_id (nullable),
  active,
  superseded_at, superseded_by_id,
  effective_from, effective_to,
  created_at, updated_at
  UNIQUE (organization_id, source_system, canonical_identifier_value) WHERE active
```

**Comportamenti definiti**: stesso identificatore mappato a due progetti nella stessa
organizzazione → violazione del vincolo di unicità, rifiutato a livello database, mai risolto
automaticamente; identificatore superato → nuova riga attiva più `superseded_at`/`superseded_by_id`
sulla precedente, mai cancellazione; registro fonte disattivato (§9) → gli identificatori già
confermati tramite esso restano validi, nessuna nuova risoluzione futura tramite quel registro;
alias IA che assomiglia a un identificatore confermato → resta un candidato/osservazione separato,
mai promosso automaticamente solo per somiglianza. **Nessuna corrispondenza globale di
identificatore** — ogni risoluzione richiede `organization_id` nel filtro.

---

## 12. Supersessione — integrità transazionale (ampliata)

**[PROPOSTO]** Il contratto database ammette **zero o un solo collegamento esplicito attivo** per
`(organization_id, order_id)` e per `(organization_id, line_id)`. Zero è valido prima della prima
assegnazione oppure dopo una chiusura terminale verificabile. Deve restare impossibile avere più di
un collegamento attivo, superare un collegamento tra tenant o soggetti diversi, auto-superarsi,
creare cicli nella catena di sostituzione o sovrapporre periodi di validità.

Ogni riga appartiene esattamente a uno dei tre stati:

1. **attiva**: `superseded_at`, `superseded_by_id` ed `ended_by_decision_id` sono `NULL`;
2. **sostituita**: `superseded_at` e `superseded_by_id` sono valorizzati,
   `ended_by_decision_id` è `NULL`;
3. **terminata senza sostituzione**: `superseded_at` ed `ended_by_decision_id` sono valorizzati,
   `superseded_by_id` è `NULL`.

`project_id` non diventa mai nullable e non esiste alcun progetto sintetico `NO_PROJECT`. La riga
storica conserva il progetto che era stato assegnato. `decision_id` spiega la creazione
dell'associazione; `ended_by_decision_id`, diverso da `decision_id`, spiega la sua chiusura senza
sostituzione.

### Sostituzione: close-then-insert

La sostituzione deve seguire questo ordine, in una sola transazione:

```
BEGIN
  1. creare la nuova decisione immutabile;
  2. bloccare e validare il collegamento attivo corrente;
  3. generare/riservare l'id della nuova riga;
  4. chiudere prima la riga corrente:
       superseded_at = replacement_timestamp
       superseded_by_id = reserved_new_link_id
       ended_by_decision_id = NULL
  5. inserire la nuova riga attiva con l'id riservato e la nuova decisione;
  6. verificare che resti esattamente una riga attiva;
COMMIT
```

La FK composita same-subject su `superseded_by_id` deve restare **`DEFERRABLE INITIALLY
DEFERRED`**: al passo 4 punta intenzionalmente all'id riservato che verrà inserito al passo 5 nella
stessa transazione. La deferrabilità è richiesta da questa sequenza. La sequenza inversa
insert-then-close non è valida perché l'indice parziale che impone al massimo una riga attiva è
immediato e rifiuta la seconda riga prima che la precedente venga chiusa. Qualunque errore
annulla l'intera transazione e preserva il collegamento attivo precedente.

### Chiusura terminale senza sostituzione

La disassociazione verificabile deve seguire una transazione distinta:

```
BEGIN
  1. creare la decisione immutabile di chiusura;
  2. bloccare e validare il collegamento attivo corrente;
  3. aggiornare la riga corrente:
       superseded_at = ending_timestamp
       superseded_by_id = NULL
       ended_by_decision_id = ending_decision_id
  4. verificare che restino zero righe attive;
COMMIT
```

Questa transizione consente di ritirare un override di riga e ripristinare in futuro
l'ereditarietà dal collegamento d'ordine. Una successiva assegnazione crea una nuova decisione e
una nuova riga attiva; non riscrive e non si aggancia artificialmente all'episodio terminato.

### Confine di scrittura controllato

**[DECISIONE CHIUSA]** Nessun writer di Fase 2D.1B.2–2D.1B.4 può comporre ad hoc le istruzioni
multi-statement di sostituzione o chiusura terminale. Prima di autorizzare il primo percorso di
scrittura deve esistere **un'unica funzione database interna o un servizio transazionale
equivalente sottoposto a review** che possieda: locking della riga, creazione/riferimento della
decisione, close-then-insert, chiusura terminale, validazione same-subject e tenant, gestione della
concorrenza e rollback. Il meccanismo di invocazione resta aperto; l'esistenza di un solo confine
transazionale controllato non è più opzionale. Tale funzione/servizio è rinviata e non viene
implementata in 2D.1B.1.

**Relazione con l'immutabilità delle decisioni (§8)**: una sostituzione crea una nuova decisione
di creazione per la nuova riga; una chiusura terminale crea una nuova decisione di fine e la
registra in `ended_by_decision_id`. Nessuna decisione esistente viene modificata. Decisioni e
collegamenti chiusi restano leggibili per la ricostruzione storica.

---

## 13. Derivazione ordine-default / riga-override

**[PROPOSTO, invariato nella sostanza, con la correzione di §2.3]** Per ogni riga: (1) collegamento
di riga esplicito attivo e valido; (2) altrimenti default d'ordine attivo e valido; (3) altrimenti
nessun progetto effettivo. Un candidato di riga non risolto **blocca** l'ereditarietà — preserva il
comportamento conservativo di Fase 2D.1A. **Nota derivata da §2.3**: per gli ordini di acquisto
fornitore esistenti, poiché non esiste alcun valore di riga legacy indipendente da migrare, ogni
collegamento di riga esplicito futuro nascerà **solo** da un'osservazione/conferma successiva
all'introduzione di questo schema — mai da un backfill storico di riga. Derivazione multi-progetto,
ordinamento deterministico, comportamento con zero righe, progetto inattivo, collegamento superato:
invariati rispetto alla revisione precedente. **Nessuna allocazione di riga singola su più progetti.**
La chiusura terminale di un override esplicito di riga lascia zero collegamenti di riga attivi:
questo è il fondamento strutturale affinché, dopo il cutover 2D.1B.4, la riga possa tornare a
ereditare il default d'ordine senza cancellare la precedente assegnazione storica.

---

## 14. Classificazione del contesto di procurement — perimetro ridotto (corretto)

**[PROPOSTO — correzione di perimetro]** La separazione concettuale tra collegamento progetto e
classificazione di procurement (`PROJECT`/`GENERAL_STOCK`/`OVERHEAD`/`SHARED`/`UNCLASSIFIED`/
`NOT_EVALUATED`) **resta**, ma **`order_procurement_classifications` viene rimossa dal perimetro
obbligatorio della migrazione iniziale di Fase 2D.1B**. Nessuna analisi del repository condotta in
questa sessione dimostra che sia necessaria per preservare la semantica attuale (i tre ordini noti
mostrano oggi solo `PROCUREMENT_CONTEXT_NOT_EVALUATED` derivato dall'assenza di riferimenti, non da
una classificazione memorizzata). Questa tabella diventa un **incremento separato e rinviato**
(§21), documentato concettualmente qui per continuità futura ma non implementato né richiesto per
il fondamento canonico dello schema di collegamento. `GENERAL_STOCK`/`OVERHEAD` non creano mai
collegamenti progetto sintetici, indipendentemente da quando la tabella di classificazione viene
introdotta.

---

## 15. Isolamento tenant

**[PROPOSTO]**, applicando il modello a tre livelli di §2.5: foreign key composite come difesa
primaria (`(organization_id, order_id) REFERENCES orders(organization_id, id)`,
`(organization_id, project_id) REFERENCES projects(organization_id, id)`,
`(organization_id, line_id) REFERENCES purchase_order_lines(organization_id, id)` — **tutti e tre
gli indici unici target già esistono**, §2.1/§2.2/§2.3, nessuna aggiunta di vincolo padre
necessaria); `ENABLE ROW LEVEL SECURITY` abilitata su ogni nuova tabella (coerente con la
maggioranza del repository), con policy da definire in un incremento di sicurezza dedicato se questa
fase decide di introdurle in modo pieno (**decisione aperta**, §25 — questo documento non retrofitta
RLS sulle tabelle esistenti né impone di scrivere le policy ora); ogni query server, incluse quelle
con service-role key, continua a includere esplicitamente `organization_id=eq.<org>` — **RLS non
sostituisce questa disciplina sui percorsi service-role**. Nessuna corrispondenza globale di codice
progetto o identificatore esterno.

---

## 16. Vincoli e indici concettuali

**[IMPLEMENTATO LOCALMENTE, NON APPLICATO]** Contratto strutturale riflesso nella migrazione
2D.1B.1 locale e verificato tramite PGlite:

```
CREATE TABLE order_project_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  order_id UUID NOT NULL,
  project_id UUID NOT NULL,
  decision_id UUID NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_at TIMESTAMPTZ,
  superseded_by_id UUID,
  ended_by_decision_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  FOREIGN KEY (organization_id, order_id) REFERENCES orders(organization_id, id),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects(organization_id, id),
  FOREIGN KEY (organization_id, decision_id) REFERENCES project_link_decisions(organization_id, id),
  FOREIGN KEY (organization_id, ended_by_decision_id)
    REFERENCES project_link_decisions(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, order_id, superseded_by_id)
    REFERENCES order_project_links(organization_id, order_id, id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK (superseded_by_id IS NULL OR superseded_by_id <> id),
  CHECK (ended_by_decision_id IS NULL OR ended_by_decision_id <> decision_id),
  CHECK (
    (superseded_at IS NULL AND superseded_by_id IS NULL AND ended_by_decision_id IS NULL)
    OR
    (superseded_at IS NOT NULL AND superseded_by_id IS NOT NULL
      AND ended_by_decision_id IS NULL AND superseded_at >= valid_from)
    OR
    (superseded_at IS NOT NULL AND superseded_by_id IS NULL
      AND ended_by_decision_id IS NOT NULL AND superseded_at >= valid_from)
  )
);
ALTER TABLE order_project_links ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX uniq_order_project_link_active
  ON order_project_links(organization_id, order_id) WHERE superseded_at IS NULL;
CREATE INDEX idx_order_project_links_project ON order_project_links(organization_id, project_id);
CREATE INDEX idx_order_project_links_order ON order_project_links(organization_id, order_id);

-- line_project_links: stessa struttura, line_id (riferisce purchase_order_lines(organization_id, id))
-- invece di order_id.

-- project_reference_observations, project_link_candidates, project_link_decisions,
-- project_link_decision_observations, project_external_identifiers, trusted_project_source_fields:
-- ciascuna con organization_id NOT NULL, RLS abilitata, FK composite verso le rispettive tabelle
-- padre dove applicabile.
```

Copertura richiesta: unicità scoped per organizzazione; **zero o una** voce attiva per default
d'ordine; **zero o una** voce attiva per collegamento di riga; sostituzione e chiusura terminale
distinte; decisione di fine tenant-safe; stessa-organizzazione garantita dalle FK composite (già
supportate dagli indici esistenti); lookup per progetto attivo, per ordine, per riga
(`purchase_order_lines.id`), per identificatore sorgente; backfill deterministico.

---

## 17. Contratto API operativo

**[PROPOSTO, invariato]** Nessun endpoint per widget. Durante il periodo di compatibilità continua
(§18bis), nessuna nuova richiesta frontend. Il contesto progetto canonico resta nel contratto dati
operativo (`order-operational-view`); l'integrazione con il Data Quality Contract resta rinviata a
Fase 2D.1C.

---

## 18. Migrazione e backfill iniziale

**[PROPOSTO]**:
1. Creare le strutture canoniche (§16) — nessun dato toccato.
2. Preservare il comportamento di Fase 2D.1A.
3. Ispezionare `orders.project_id`/`orders.project_code` esistenti (§2.2). **Non esiste alcuna
   coppia legacy di riga da ispezionare per gli ordini di acquisto fornitore** (§2.3) — solo il
   livello ordine ha dati legacy.
4. Migrare automaticamente solo i riferimenti `project_id` validi, stesso-tenant, verso
   `order_project_links`, tramite una `project_link_decisions` con
   `decision_kind = 'IMPORTED_HISTORICAL'` — **mai `SOURCE_NATIVE_STRUCTURED`**: un valore
   legacy migrato automaticamente non ha, di per sé, alcuna prova che provenga da un campo
   sorgente nativo strutturato; `SOURCE_NATIVE_STRUCTURED` richiede un contratto di fonte
   dimostrato separatamente (§9), non è mai assunto dal solo backfill.
5. I valori solo-`project_code` restano osservazioni/candidati (`project_reference_observations`),
   mai promossi a collegamento confermato durante il backfill.
6. Mettere in quarantena i conflitti `project_id`/`project_code`: nessun collegamento canonico
   attivo creato, un candidato/conflitto visibile generato invece.
7. Preservare `PROCUREMENT_CONTEXT_NOT_EVALUATED` per ogni ordine Graphic Center Group esistente
   privo di riferimento.
8. Nessuna segnalazione progetto prodotta durante il backfill (competenza di Fase 2D.1C).
9. Idempotenza tramite verifica di assenza di una riga attiva equivalente prima di ogni
   inserimento, tracciata da un identificatore di esecuzione (`processing_run_id`, §7bis-A).
10. Rollback supportato: le colonne legacy non vengono mai svuotate durante il backfill.
11. Switch del contratto di lettura solo dopo validazione (§18bis).

---

## 18bis. Periodo di compatibilità continuo (nuovo, corretto)

**[PROPOSTO — correzione: un backfill una tantum è insufficiente]** Se l'ingestione esistente
(fuori da questo repository, non ispezionabile qui) continua a scrivere le colonne legacy dopo il
backfill iniziale, un'unica esecuzione non basta. Transizione completa:

1. backfill iniziale (§18);
2. **sincronizzazione idempotente ripetibile** durante tutto il periodo di compatibilità — la
   stessa logica di §18 punto 4-6 rieseguita periodicamente (o su trigger di modifica) senza mai
   produrre duplicati o divergenze;
3. **monitoraggio delle nuove scritture legacy** — ogni nuova scrittura su `orders.project_id`/
   `project_code` osservata durante il periodo di compatibilità genera una nuova osservazione
   (§7bis-A), rientrando nello stesso ciclo di risoluzione;
4. **cutover** di tutti i percorsi di scrittura approvati verso i collegamenti canonici;
5. i collegamenti canonici diventano l'**unica** fonte di scrittura accettata;
6. le colonne legacy diventano proiezioni derivate a livello database o campi deprecati di sola
   lettura;
7. le scritture dirette alle colonne legacy vengono rifiutate dopo il cutover;
8. il contratto di lettura operativo (Fase 2D.1A) passa alle tabelle canoniche solo dopo che la
   riconciliazione ha avuto successo.

**Condizione di uscita — mai una data di calendario**: zero differenze di coerenza non risolte tra
colonne legacy e collegamenti canonici; tutti gli scrittori noti migrati; esecuzioni idempotenti
ripetute senza produrre cambiamenti inattesi; test di regressione superati; rollback validato in un
ambiente non di produzione.

### La sincronizzazione automatica non deve mai sovrascrivere una decisione manuale (chiarimento finale)

**[PROPOSTO — regola non negoziabile]** Durante il periodo di compatibilità, un job di
sincronizzazione automatica o di backfill **può**:

- creare nuove `project_reference_observations` immutabili;
- generare o aggiornare esiti di lavorazione dei candidati (`candidate_status`);
- creare una decisione `IMPORTED_HISTORICAL` e il relativo collegamento canonico, **solo dove non
  esiste già una decisione attiva più forte** e tutte le condizioni deterministiche di migrazione
  (§18) sono soddisfatte;
- rilevare e mettere in quarantena conflitti (candidato/conflitto, mai collegamento attivo).

**Non deve mai**:

- modificare una decisione `MANUAL_CONFIRMATION` esistente;
- superare automaticamente un collegamento canonico creato da `MANUAL_CONFIRMATION`;
- retrocedere o sostituire un identificatore esterno confermato manualmente
  (`project_external_identifiers` con `confirmed_by_membership_id` valorizzato);
- risolvere un conflitto scegliendo automaticamente il valore sorgente più recente;
- trattare la recency della fonte come autorità superiore a una decisione manuale.

Se un'osservazione automatica successiva è in conflitto con un collegamento attivo confermato
manualmente: il collegamento canonico manuale viene **preservato**; la nuova osservazione viene
**preservata**; viene creato o aggiornato un record di conflitto/candidato; la risoluzione viene
**rinviata** alla futura fase di conferma manuale/risoluzione di business (Fase 2D.1D); il contesto
progetto operativo **non cambia automaticamente**.

**Ordine di autorità deterministico per la lavorazione automatica** (governa solo l'elaborazione
automatica, non impedisce a un essere umano autorizzato di superare una decisione manuale precedente
tramite una nuova decisione manuale controllata in Fase 2D.1D):

1. **decisione `MANUAL_CONFIRMATION` attiva** — protetta da supersessione automatica;
2. decisione canonica deterministica attiva da fonte fidata/dato nativo strutturato
   (`EXACT_TRUSTED_REFERENCE` / `SOURCE_NATIVE_STRUCTURED`);
3. decisione `IMPORTED_HISTORICAL`;
4. osservazioni e candidati non risolti.

Un processo automatico può creare o sostituire un collegamento solo al livello 3 o inferiore, mai
al livello 1, e solo al livello 2 se le regole deterministiche documentate lo consentono
esplicitamente (§9/§11).

**Requisiti di test aggiunti** (vedi anche §20): un nuovo valore legacy non sovrascrive mai un
collegamento manuale; un'osservazione da fonte fidata in conflitto con un collegamento manuale resta
un conflitto, non lo sostituisce; la sincronizzazione ripetuta resta idempotente mentre il
collegamento manuale resta attivo; una nuova decisione manuale autorizzata può superare una
decisione manuale precedente senza cancellare la cronologia; la sincronizzazione automatica può
sostituire un collegamento `IMPORTED_HISTORICAL` solo quando le regole deterministiche documentate
lo consentono esplicitamente; nessun processo automatico può produrre due collegamenti canonici
attivi contemporaneamente.

**[IMPLEMENTATO NEL FONDAMENTO 2D.1B.1 — hardening successivo]** La protezione non dipende
soltanto dai futuri writer: un vincolo database differito impedisce che un collegamento attivo
aperto da `MANUAL_CONFIRMATION`, sia a livello ordine sia a livello riga, venga chiuso,
ritirato o sostituito da una decisione `SOURCE_NATIVE_STRUCTURED`,
`EXACT_TRUSTED_REFERENCE` o `IMPORTED_HISTORICAL`. Una nuova `MANUAL_CONFIRMATION` può invece
chiudere o sostituire una decisione manuale; una decisione manuale può inoltre sostituire una
decisione automatica. Questo hardening protegge esclusivamente `MANUAL_CONFIRMATION` dal
superamento non manuale: non introduce una gerarchia completa tra le altre origini e non
implementa osservazioni, backfill, registri fonte o cutover di 2D.1B.2–2D.1B.4.

---

## 19. Impatto su Graphic Center Group

**[CONFERMATO]**, riverificato in sola lettura in questa sessione: tutti e tre gli ordini noti
(`13542272`, `0013545497`, `228751`) restituiscono `PROCUREMENT_CONTEXT_NOT_EVALUATED`, sia a
livello ordine sia su ogni riga canonica.

**Impatto atteso del backfill (§18), corretto**: nessun collegamento canonico creato per nessuno dei
tre ordini (nessun `project_id`/`project_code` da cui migrare); il contesto resterebbe
`PROCUREMENT_CONTEXT_NOT_EVALUATED`; **nessuna riga di riga da migrare per nessuno dei tre ordini**
(§2.3 — le righe di acquisto fornitore non hanno mai un valore legacy proprio); nessuna
segnalazione progetto; nessuna azione diagnostica progetto; nessuna modifica agli stati di consegna
o alle azioni operative esistenti. **Nessuna eccezione osservata.**

---

## 20. Strategia di test

**[PROPOSTO]**, ampliata: rifiuto cross-tenant tramite FK composita (test di vincolo database);
diniego RLS per accesso autenticato di un tenant estraneo (se le policy vengono implementate in un
incremento futuro); query con service-role key che comunque richiede il filtro applicativo
`organization_id` (test che verifica la disciplina applicativa, non la sola presenza di RLS);
supersessione dello stesso soggetto; rifiuto di supersessione tra soggetti diversi; rifiuto di
auto-supersessione; rifiuto di un secondo collegamento attivo duplicato; rollback che lascia attivo
il collegamento precedente; sostituzione close-then-insert con FK differita; chiusura terminale
ordine e riga con decisione distinta e tenant-safe; zero collegamenti attivi dopo chiusura;
ritiro dell'override di riga mentre il default d'ordine resta attivo; nuova assegnazione dopo un
intervallo zero-active; rifiuto di stati parziali, doppio esito e mutazione di righe chiuse;
rollback di una chiusura fallita che preserva la riga attiva; osservazione con zero candidati;
osservazione con un candidato; osservazione con più candidati; un candidato non è mai trattato come canonico; un collegamento
supportato da più osservazioni; origine di backfill legacy `IMPORTED_HISTORICAL`; sincronizzazione
di compatibilità ripetuta resta idempotente; nuove scritture legacy catturate durante il periodo di
compatibilità; scritture dirette legacy rifiutate dopo il cutover; `entity_aliases` mai consultata
dal resolver canonico; un alias IA non può popolare `project_external_identifiers`; nessun cambio
di API in 2D.1B.1–2D.1B.3; comportamento di Fase 2D.1A preservato fino a 2D.1B.4; nessun UUID
grezzo in UI; output deterministico indipendente dall'ordine dell'array sorgente. Test di vincolo
database separati dai test di utilità pura.

**Requisiti di test aggiunti in questo chiarimento finale**:

*Immutabilità delle decisioni (§8)*: una decisione esistente resta invariata dopo che ne viene
creata una successiva; una decisione successiva crea una nuova versione del collegamento canonico
anziché aggiornare in-place quella precedente; la ricostruzione puntuale nel tempo restituisce la
decisione e il collegamento corretti per quel momento storico; un reversal non sovrascrive mai la
decisione originale.

*Osservazioni non sono stato di dominio (§7bis-A)*: un'osservazione da sola non crea contesto
progetto; un'osservazione resta presente dopo il rifiuto di un candidato derivato; un collegamento
canonico superato non elimina le osservazioni di supporto; l'output dell'API operativa ignora le
osservazioni non risolte, a meno che il contratto non le esponga esplicitamente come contesto
diagnostico non canonico in una fase successiva.

*Protezione automatica delle decisioni manuali (§18bis)*: un nuovo valore legacy non sovrascrive un
collegamento manuale; un'osservazione da fonte fidata in conflitto con un collegamento manuale resta
un conflitto; la sincronizzazione ripetuta resta idempotente mentre il collegamento manuale resta
attivo; una nuova decisione manuale autorizzata può superare una decisione manuale precedente senza
cancellare la cronologia; la sincronizzazione automatica può sostituire un collegamento
`IMPORTED_HISTORICAL` solo quando le regole deterministiche lo consentono esplicitamente; nessun
processo automatico produce due collegamenti canonici attivi.

---

## 21. Incrementi di implementazione proposti (rivisti)

**[PROPOSTO]**:

- **2D.1B.1 — Fondamento di schema**: identità di riga persistita confermata (`purchase_order_lines`,
  §2.3); tabelle di collegamento canoniche (`order_project_links`/`line_project_links`); vincoli
  tenant (FK composite, riusando gli indici già esistenti); vincoli di sostituzione e chiusura
  terminale; cardinalità zero-o-uno; **nessun backfill; nessun resolver; nessun cambio API.**
- **2D.1B.2 — Osservazioni e backfill storico**: modello di osservazione (§7bis-A); import di
  `project_id` legacy validi come `IMPORTED_HISTORICAL`; osservazioni solo-codice; quarantena dei
  conflitti; sincronizzazione idempotente continua (§18bis); introduzione del confine
  transazionale controllato obbligatorio prima di qualunque writer (§12); **nessuno switch di API
  pubblica.**
- **2D.1B.3 — Identificatori esterni confermati e fonti fidate**: `project_external_identifiers`;
  `trusted_project_source_fields`; risoluzione esatta deterministica; generazione di candidati;
  **nessuna conferma IA; nessuno switch di API pubblica.**
- **2D.1B.4 — Cutover del contratto operativo**: proiezione del collegamento canonico corrente;
  default d'ordine e override di riga; derivazione multi-progetto; riconciliazione di
  compatibilità; rimozione della lettura legacy solo dopo il superamento dei criteri di uscita
  (§18bis).

**Incremento separato e rinviato**: storico di classificazione di procurement (§14).

Fase 2D.1C resta responsabile delle segnalazioni. Fase 2D.1D resta responsabile della conferma
manuale e della risoluzione di business.

---

## 22. Fuori perimetro (rinviato)

**[RINVIATO]**: UI di conferma manuale (2D.1D); segnalazioni di qualità dati (2D.1C); modulo
Progetti (2D.2); allocazione di riga singola su più progetti; storico di classificazione di
procurement come incremento separato (§14/§21); tabelle di entitlement (2E); retrofit di RLS sulle
tabelle esistenti; uso di `entity_aliases` per candidati (richiede contratto approvato separato,
§10); integrazione costo/budget; qualunque scrittura di dati live; qualunque migrazione SQL
eseguita; implementazione della funzione/servizio transazionale controllato per sostituzione e
chiusura terminale (§12).

## 23. Rischi

- Le colonne legacy `orders.project_id`/`project_code` restano prive di vincolo di coerenza
  reciproca finché il cutover non è completo.
- La dipendenza dalla service-role key rende RLS inefficace sui percorsi server attuali — un
  cambiamento futuro del modello di connessione richiederebbe una revisione separata.
- Il meccanismo esatto (trigger vs. job) per la sincronizzazione di compatibilità continua non è
  ancora scelto.
- La funzione/servizio transazionale controllato richiesto da §12 non è ancora implementato:
  nessun writer di 2D.1B.2–2D.1B.4 può essere autorizzato prima della sua review.
- La semplificazione implementativa del modello osservazione/candidato/decisione (§7bis, nota
  finale) rischia di essere applicata in modo da perdere la distinzione concettuale se non
  attentamente revisionata in fase di implementazione.

## 24. Decisioni chiuse

- Le nuove tabelle usano vincoli tenant compositi **più** RLS **più** filtri applicativi — tutti e
  tre, non uno al posto dell'altro.
- `entity_aliases` resta fuori dal percorso di risoluzione canonica iniziale.
- Gli identificatori esterni confermati usano una tabella dedicata (`project_external_identifiers`).
- I collegamenti canonici non memorizzano mai l'ambiguità.
- L'origine del backfill di `project_id` legacy è sempre `IMPORTED_HISTORICAL`.
- Lo storico di classificazione di procurement non è obbligatorio per il primo incremento di
  schema.
- La sincronizzazione idempotente continua è richiesta fino al cutover, non un backfill una tantum.
- L'identità di riga persistita per le righe di acquisto fornitore è `purchase_order_lines.id`,
  confermata e già FK-ready.
- `project_link_decisions` sono immutabili: una conclusione successiva crea sempre una nuova
  decisione, mai una modifica di una decisione esistente.
- `project_reference_observations` sono fatti sorgente immutabili, non stato di dominio: non
  rappresentano mai lo stato corrente dell'ordine, della riga o dell'associazione progetto.
- I collegamenti canonici attivi sono l'unica fonte autoritativa per l'assegnazione progetto
  corrente — mai le osservazioni, mai i candidati.
- La sincronizzazione automatica non può mai superare una decisione `MANUAL_CONFIRMATION` —
  protetta strutturalmente dall'ordine di autorità deterministico (§18bis).
- Osservazioni automatiche in conflitto con un collegamento manuale attivo vengono preservate e
  messe in quarantena per una risoluzione successiva, senza mai alterare il contesto progetto
  operativo corrente.
- La cardinalità universale dei collegamenti espliciti è zero-o-uno: una chiusura terminale
  verificabile può lasciare zero righe attive senza cancellare lo storico.
- `superseded_by_id` indica esclusivamente una sostituzione; `ended_by_decision_id` indica
  esclusivamente una chiusura senza sostituzione.
- La sostituzione usa close-then-insert con FK same-subject differita; insert-then-close è
  incompatibile con l'indice parziale immediato.
- Prima di ogni writer deve esistere un unico confine transazionale controllato per locking,
  decisioni, concorrenza e rollback; non sono ammessi flussi SQL multi-statement ad hoc.

## 25. Decisioni aperte residue

**[DECISIONE APERTA]**
1. Esatta cardinalità/riuso di tabella tra osservazione ed evidenza (se semplificare §7bis in
   implementazione, mantenendo la distinzione concettuale).
2. Meccanismo esatto di sincronizzazione delle proiezioni di compatibilità legacy (trigger vs.
   job).
3. Forma e meccanismo di invocazione del confine transazionale controllato obbligatorio
   (funzione database interna o servizio transazionale equivalente, §12).
4. Forma esatta della chiave/identità di esecuzione del backfill (§18, punto 9).
5. Se e quando scrivere le policy RLS complete per le nuove tabelle (oltre alla sola abilitazione),
   e se estendere lo stesso lavoro a `projects`/`orders` (fuori perimetro qui).
6. Forma esatta del campo finale nel contratto operativo (§17).

---

## 26. Criteri di accettazione

Il documento è accettabile solo se, come qui verificato: seleziona una sola fonte canonica di
scrittura (§5); previene la mutazione indipendente delle colonne legacy (§6/§18bis); mantiene lo
storico completo (§12); distingue relazioni esplicite, ereditate, candidate e confermate
(§7bis/§13); definisce l'identità di fonte fidata (§9); impedisce agli alias IA di confermare
collegamenti (§10/§11); applica l'isolamento tenant a più livelli a livello database (§15/§16);
supporta default d'ordine più override di riga (§13); preserva la derivazione multi-progetto (§13);
rinvia l'allocazione di riga singola (§13/§22); fornisce una strategia di migrazione idempotente e
continua (§18/§18bis); preserva `NOT_EVALUATED` per gli ordini esistenti (§19); mantiene la qualità
del collegamento progetto separata dallo stato di consegna (§4/§19); non richiede alcuna entità
progetto duplicata né fork di codice tenant-specifico (§5/§9); raccomanda incrementi
indipendentemente revisionabili (§21); identifica correttamente l'entità riga persistita reale
(§2.3); **non sovrascrive mai la cronologia delle decisioni (§8)**; **non tratta mai
un'osservazione come stato di dominio corrente (§7bis-A)**; **nessuna sincronizzazione automatica
può sostituire un collegamento confermato manualmente (§18bis)**; **i fatti automatici in conflitto
vengono preservati senza alterare il contesto canonico (§18bis)**; **ogni cambio di stato canonico
crea una nuova decisione controllata e una nuova versione di collegamento chiuso (§8/§12)**;
**supporta zero o un collegamento attivo, inclusa la disassociazione terminale verificabile e la
successiva riattivazione (§12)**; **la chiusura di un override di riga prepara il ritorno
all'ereditarietà d'ordine senza cancellare lo storico (§13)**; **la sostituzione usa
close-then-insert con FK differita e rollback preservante (§12)**; **nessun writer futuro può
operare fuori dal confine transazionale controllato (§12/§21)**; **la ricostruzione storica resta
sempre possibile (§8/§12)**.

## 27. Conferma di sicurezza dell'implementazione locale

Il fondamento di schema 2D.1B.1 è preparato esclusivamente come migrazione locale non applicata e
test comportamentale PGlite. Nessuna scrittura è stata eseguita su Supabase configurato o live;
nessun endpoint, adapter, contratto di lettura, dato cliente o configurazione è stato modificato;
nessun backfill o writer applicativo è incluso. La migrazione crea tabelle vuote e additive quando
verrà autorizzata in una fase successiva.
