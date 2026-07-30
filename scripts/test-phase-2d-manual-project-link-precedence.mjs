import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const FOUNDATION_MIGRATION_URL = new URL(
  '../supabase/migrations/20260729170041_canonical_project_link_schema_foundation.sql',
  import.meta.url
);
const PRECEDENCE_MIGRATION_URL = new URL(
  '../supabase/migrations/20260730210335_enforce_manual_project_link_precedence.sql',
  import.meta.url
);

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_ORG_ID = '00000000-0000-4000-8000-000000000002';
const PROJECT_A_ID = '20000000-0000-4000-8000-000000000001';
const PROJECT_B_ID = '20000000-0000-4000-8000-000000000002';
const OTHER_PROJECT_ID = '20000000-0000-4000-8000-000000000003';
const T0 = '2026-07-30T08:00:00.000Z';
const T1 = '2026-07-30T09:00:00.000Z';
const T2 = '2026-07-30T10:00:00.000Z';

let idCounter = 1;

function nextId(namespace) {
  const head = String(namespace).padStart(8, '0');
  const tail = String(idCounter++).padStart(12, '0');
  return `${head}-0000-4000-8000-${tail}`;
}

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

async function forceDeferredChecks(db) {
  await db.exec('SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;');
}

async function expectRejectedInSavepoint(db, label, operation, {
  code,
  messagePattern
}) {
  const savepoint = `sp_${label.replaceAll(/[^a-z0-9_]/gi, '_')}`;
  await db.exec(`SAVEPOINT ${savepoint}`);

  let error = null;
  try {
    await operation();
    await forceDeferredChecks(db);
  } catch (caught) {
    error = caught;
  }

  assert.ok(error, `${label}: expected rejection`);
  if (code) assert.equal(error.code, code, `${label}: SQLSTATE`);
  if (messagePattern) assert.match(String(error.message), messagePattern, `${label}: message`);

  await db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  await db.exec(`RELEASE SAVEPOINT ${savepoint}`);
  await db.exec('SET CONSTRAINTS ALL DEFERRED');
  assert.equal(await scalar(db, 'SELECT 1'), 1, `${label}: transaction remains usable`);

  return error;
}

async function insertDecision(db, origin, organizationId = ORG_ID) {
  const id = nextId(4);
  await db.query(
    `INSERT INTO public.project_link_decisions
       (id, organization_id, decision_origin, decided_at, created_at)
     VALUES ($1, $2, $3, $4, $4)`,
    [id, organizationId, origin, T0]
  );
  return id;
}

function relationConfig(level) {
  if (level === 'order') {
    return {
      table: 'order_project_links',
      subjectColumn: 'order_id',
      idNamespace: 5,
      messagePattern: /order project-link manual precedence violation/
    };
  }

  return {
    table: 'line_project_links',
    subjectColumn: 'line_id',
    idNamespace: 6,
    messagePattern: /line project-link manual precedence violation/
  };
}

async function insertActiveLink(db, level, subjectId, projectId, decisionId, validFrom = T0) {
  const config = relationConfig(level);
  const id = nextId(config.idNamespace);
  await db.query(
    `INSERT INTO public.${config.table}
       (id, organization_id, ${config.subjectColumn}, project_id, decision_id, valid_from, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [id, ORG_ID, subjectId, projectId, decisionId, validFrom]
  );
  return id;
}

async function replaceLink(
  db,
  level,
  { activeLinkId, subjectId, projectId, replacementDecisionId }
) {
  const config = relationConfig(level);
  const replacementId = nextId(config.idNamespace);

  await db.query(
    `UPDATE public.${config.table}
     SET superseded_at = $1,
         superseded_by_id = $2
     WHERE id = $3`,
    [T1, replacementId, activeLinkId]
  );

  await db.query(
    `INSERT INTO public.${config.table}
       (id, organization_id, ${config.subjectColumn}, project_id, decision_id, valid_from, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [replacementId, ORG_ID, subjectId, projectId, replacementDecisionId, T1]
  );

  return replacementId;
}

async function terminallyEndLink(db, level, activeLinkId, endingDecisionId) {
  const config = relationConfig(level);
  await db.query(
    `UPDATE public.${config.table}
     SET superseded_at = $1,
         ended_by_decision_id = $2
     WHERE id = $3`,
    [T1, endingDecisionId, activeLinkId]
  );
}

async function assertRejectedLinkUnchanged(db, level, activeLinkId, replacementId = null) {
  const config = relationConfig(level);
  const result = await db.query(
    `SELECT superseded_at, superseded_by_id, ended_by_decision_id
     FROM public.${config.table}
     WHERE id = $1`,
    [activeLinkId]
  );

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].superseded_at, null);
  assert.equal(result.rows[0].superseded_by_id, null);
  assert.equal(result.rows[0].ended_by_decision_id, null);

  if (replacementId) {
    assert.equal(
      await scalar(db, `SELECT count(*)::int FROM public.${config.table} WHERE id = $1`, [replacementId]),
      0
    );
  }
}

async function createSubjects(db, count) {
  const subjects = [];

  for (let index = 1; index <= count; index += 1) {
    const orderId = nextId(1);
    const lineId = nextId(3);
    await db.query(
      `INSERT INTO public.orders (id, organization_id, order_code)
       VALUES ($1, $2, $3)`,
      [orderId, ORG_ID, `ORDER-${index}`]
    );
    await db.query(
      `INSERT INTO public.purchase_order_lines
         (id, organization_id, order_id, line_number)
       VALUES ($1, $2, $3, 1)`,
      [lineId, ORG_ID, orderId]
    );
    subjects.push({ orderId, lineId });
  }

  return subjects;
}

async function runMatrix(db, level, subjects) {
  const key = level === 'order' ? 'orderId' : 'lineId';
  const config = relationConfig(level);

  // Automatic -> automatic replacement.
  {
    const opening = await insertDecision(db, 'SOURCE_NATIVE_STRUCTURED');
    const ending = await insertDecision(db, 'EXACT_TRUSTED_REFERENCE');
    const active = await insertActiveLink(db, level, subjects[0][key], PROJECT_A_ID, opening);
    const replacement = await replaceLink(db, level, {
      activeLinkId: active,
      subjectId: subjects[0][key],
      projectId: PROJECT_B_ID,
      replacementDecisionId: ending
    });
    await forceDeferredChecks(db);
    assert.equal(
      await scalar(
        db,
        `SELECT count(*)::int FROM public.${config.table}
         WHERE organization_id = $1
           AND ${config.subjectColumn} = $2
           AND superseded_at IS NULL`,
        [ORG_ID, subjects[0][key]]
      ),
      1
    );
    assert.equal(
      await scalar(db, `SELECT (superseded_by_id = $1)::int FROM public.${config.table} WHERE id = $2`, [
        replacement,
        active
      ]),
      1
    );
  }

  // Automatic -> manual replacement.
  {
    const opening = await insertDecision(db, 'IMPORTED_HISTORICAL');
    const ending = await insertDecision(db, 'MANUAL_CONFIRMATION');
    const active = await insertActiveLink(db, level, subjects[1][key], PROJECT_A_ID, opening);
    await replaceLink(db, level, {
      activeLinkId: active,
      subjectId: subjects[1][key],
      projectId: PROJECT_B_ID,
      replacementDecisionId: ending
    });
    await forceDeferredChecks(db);
  }

  // Manual -> manual replacement.
  {
    const opening = await insertDecision(db, 'MANUAL_CONFIRMATION');
    const ending = await insertDecision(db, 'MANUAL_CONFIRMATION');
    const active = await insertActiveLink(db, level, subjects[2][key], PROJECT_A_ID, opening);
    await replaceLink(db, level, {
      activeLinkId: active,
      subjectId: subjects[2][key],
      projectId: PROJECT_B_ID,
      replacementDecisionId: ending
    });
    await forceDeferredChecks(db);
  }

  // Manual -> automatic replacement is rejected.
  {
    const opening = await insertDecision(db, 'MANUAL_CONFIRMATION');
    const ending = await insertDecision(db, 'SOURCE_NATIVE_STRUCTURED');
    const active = await insertActiveLink(db, level, subjects[3][key], PROJECT_A_ID, opening);
    let attemptedReplacementId = null;
    await expectRejectedInSavepoint(
      db,
      `${level}_manual_to_automatic_replacement`,
      async () => {
        attemptedReplacementId = await replaceLink(db, level, {
          activeLinkId: active,
          subjectId: subjects[3][key],
          projectId: PROJECT_B_ID,
          replacementDecisionId: ending
        });
      },
      { code: '23514', messagePattern: config.messagePattern }
    );
    await assertRejectedLinkUnchanged(db, level, active, attemptedReplacementId);
  }

  // Manual -> automatic terminal withdrawal is rejected.
  {
    const opening = await insertDecision(db, 'MANUAL_CONFIRMATION');
    const ending = await insertDecision(db, 'EXACT_TRUSTED_REFERENCE');
    const active = await insertActiveLink(db, level, subjects[4][key], PROJECT_A_ID, opening);
    await expectRejectedInSavepoint(
      db,
      `${level}_manual_to_automatic_terminal`,
      () => terminallyEndLink(db, level, active, ending),
      { code: '23514', messagePattern: config.messagePattern }
    );
    await assertRejectedLinkUnchanged(db, level, active);
  }

  // Manual -> imported historical terminal withdrawal is rejected.
  {
    const opening = await insertDecision(db, 'MANUAL_CONFIRMATION');
    const ending = await insertDecision(db, 'IMPORTED_HISTORICAL');
    const active = await insertActiveLink(db, level, subjects[5][key], PROJECT_A_ID, opening);
    await expectRejectedInSavepoint(
      db,
      `${level}_manual_to_imported_terminal`,
      () => terminallyEndLink(db, level, active, ending),
      { code: '23514', messagePattern: config.messagePattern }
    );
    await assertRejectedLinkUnchanged(db, level, active);
  }

  // Manual terminal closure followed by a later manual reactivation remains valid.
  {
    const opening = await insertDecision(db, 'MANUAL_CONFIRMATION');
    const ending = await insertDecision(db, 'MANUAL_CONFIRMATION');
    const reactivation = await insertDecision(db, 'MANUAL_CONFIRMATION');
    const active = await insertActiveLink(db, level, subjects[6][key], PROJECT_A_ID, opening);
    await terminallyEndLink(db, level, active, ending);
    await forceDeferredChecks(db);

    const reactivated = await insertActiveLink(
      db,
      level,
      subjects[6][key],
      PROJECT_B_ID,
      reactivation,
      T2
    );
    await forceDeferredChecks(db);

    assert.equal(
      await scalar(db, `SELECT (ended_by_decision_id = $1)::int FROM public.${config.table} WHERE id = $2`, [
        ending,
        active
      ]),
      1
    );
    assert.equal(
      await scalar(db, `SELECT (superseded_at IS NULL)::int FROM public.${config.table} WHERE id = $1`, [
        reactivated
      ]),
      1
    );

    await expectRejectedInSavepoint(
      db,
      `${level}_closed_history_immutable`,
      () => db.query(`UPDATE public.${config.table} SET superseded_at = $1 WHERE id = $2`, [T2, active]),
      { code: '55000', messagePattern: new RegExp(`closed ${config.table} are immutable`) }
    );
  }
}

async function main() {
  const db = new PGlite();

  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;

    CREATE TABLE public.organizations (
      id uuid PRIMARY KEY
    );

    CREATE TABLE public.orders (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES public.organizations(id),
      order_code text NOT NULL,
      CONSTRAINT test_orders_org_id UNIQUE (organization_id, id)
    );

    CREATE TABLE public.projects (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES public.organizations(id),
      project_code text NOT NULL,
      CONSTRAINT test_projects_org_id UNIQUE (organization_id, id)
    );

    CREATE TABLE public.purchase_order_lines (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES public.organizations(id),
      order_id uuid NOT NULL,
      line_number integer NOT NULL,
      CONSTRAINT test_purchase_order_lines_order_tenant
        FOREIGN KEY (organization_id, order_id)
        REFERENCES public.orders(organization_id, id),
      CONSTRAINT test_purchase_order_lines_org_id UNIQUE (organization_id, id)
    );
  `);

  const foundationSql = await readFile(FOUNDATION_MIGRATION_URL, 'utf8');
  const precedenceSql = await readFile(PRECEDENCE_MIGRATION_URL, 'utf8');
  await db.exec(foundationSql);
  await db.exec(precedenceSql);

  await db.exec('BEGIN');
  try {
    await db.query('INSERT INTO public.organizations (id) VALUES ($1), ($2)', [
      ORG_ID,
      OTHER_ORG_ID
    ]);
    await db.query(
      `INSERT INTO public.projects (id, organization_id, project_code)
       VALUES ($1, $2, 'PROJECT-A'), ($3, $2, 'PROJECT-B'), ($4, $5, 'OTHER-PROJECT')`,
      [PROJECT_A_ID, ORG_ID, PROJECT_B_ID, OTHER_PROJECT_ID, OTHER_ORG_ID]
    );

    const subjects = await createSubjects(db, 7);
    await runMatrix(db, 'order', subjects);
    await runMatrix(db, 'line', subjects);

    // Original decision and active-link protections remain in force.
    const immutableDecision = await insertDecision(db, 'MANUAL_CONFIRMATION');
    await expectRejectedInSavepoint(
      db,
      'decision_history_immutable',
      () =>
        db.query(
          `UPDATE public.project_link_decisions
           SET decision_origin = 'SOURCE_NATIVE_STRUCTURED'
           WHERE id = $1`,
          [immutableDecision]
        ),
      { code: '55000', messagePattern: /project_link_decisions are immutable/ }
    );

    const extraDecision = await insertDecision(db, 'SOURCE_NATIVE_STRUCTURED');
    const activeOrderLink = await insertActiveLink(
      db,
      'order',
      subjects[0].orderId,
      PROJECT_A_ID,
      extraDecision,
      T2
    ).catch((error) => error);
    assert.ok(activeOrderLink instanceof Error, 'unique active order-link index must remain enforced');
  } finally {
    await db.exec('ROLLBACK');
  }

  for (const table of ['line_project_links', 'order_project_links', 'project_link_decisions']) {
    assert.equal(
      await scalar(db, `SELECT count(*)::int FROM public.${table}`),
      0,
      `${table}: synthetic rows must be removed by rollback`
    );
  }

  const newObjects = await db.query(
    `SELECT proname
     FROM pg_proc
     WHERE proname LIKE '%manual_precedence'
     ORDER BY proname`
  );
  assert.deepEqual(
    newObjects.rows.map((row) => row.proname),
    [
      'assert_line_project_link_manual_precedence',
      'assert_order_project_link_manual_precedence'
    ]
  );

  await db.close();
  console.log('Phase 2D.1B.1 manual project-link precedence tests: PASS');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
