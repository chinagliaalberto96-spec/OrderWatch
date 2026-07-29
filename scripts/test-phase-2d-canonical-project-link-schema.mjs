import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION_URL = new URL(
  '../supabase/migrations/20260729170041_canonical_project_link_schema_foundation.sql',
  import.meta.url
);

const ID = Object.freeze({
  orgA: '00000000-0000-4000-8000-000000000001',
  orgB: '00000000-0000-4000-8000-000000000002',
  orderA1: '10000000-0000-4000-8000-000000000001',
  orderA2: '10000000-0000-4000-8000-000000000002',
  orderA3: '10000000-0000-4000-8000-000000000004',
  orderB1: '10000000-0000-4000-8000-000000000003',
  projectA1: '20000000-0000-4000-8000-000000000001',
  projectA2: '20000000-0000-4000-8000-000000000002',
  projectB1: '20000000-0000-4000-8000-000000000003',
  lineA1: '30000000-0000-4000-8000-000000000001',
  lineA2: '30000000-0000-4000-8000-000000000002',
  lineA3: '30000000-0000-4000-8000-000000000004',
  lineB1: '30000000-0000-4000-8000-000000000003',
  decisionA1: '40000000-0000-4000-8000-000000000001',
  decisionA2: '40000000-0000-4000-8000-000000000002',
  decisionA3: '40000000-0000-4000-8000-000000000003',
  decisionA4: '40000000-0000-4000-8000-000000000004',
  decisionA5: '40000000-0000-4000-8000-000000000005',
  decisionA6: '40000000-0000-4000-8000-000000000006',
  decisionB1: '40000000-0000-4000-8000-000000000007',
  decisionA7: '40000000-0000-4000-8000-000000000008',
  decisionA8: '40000000-0000-4000-8000-000000000009',
  decisionA9: '40000000-0000-4000-8000-000000000010',
  decisionA10: '40000000-0000-4000-8000-000000000011',
  decisionA11: '40000000-0000-4000-8000-000000000012',
  decisionA12: '40000000-0000-4000-8000-000000000013',
  decisionA13: '40000000-0000-4000-8000-000000000014',
  decisionA14: '40000000-0000-4000-8000-000000000015',
  orderLinkA1: '50000000-0000-4000-8000-000000000001',
  orderLinkA2: '50000000-0000-4000-8000-000000000002',
  orderLinkB1: '50000000-0000-4000-8000-000000000003',
  orderLinkA3: '50000000-0000-4000-8000-000000000004',
  orderLinkA4: '50000000-0000-4000-8000-000000000005',
  orderLinkA5: '50000000-0000-4000-8000-000000000006',
  lineLinkA1: '60000000-0000-4000-8000-000000000001',
  lineLinkA2: '60000000-0000-4000-8000-000000000002',
  lineLinkB1: '60000000-0000-4000-8000-000000000003',
  lineLinkA3: '60000000-0000-4000-8000-000000000004',
  lineLinkA4: '60000000-0000-4000-8000-000000000005',
  lineLinkA5: '60000000-0000-4000-8000-000000000006'
});

const T0 = '2026-07-29T10:00:00.000Z';
const T1 = '2026-07-29T11:00:00.000Z';
const T2 = '2026-07-29T12:00:00.000Z';
let activeDatabase = null;

async function expectRejected(operation, messagePattern) {
  let error = null;
  try {
    await operation();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, 'Expected the database operation to be rejected');
  if (messagePattern) assert.match(String(error.message), messagePattern);
  return error;
}

async function expectTransactionRejected(db, sql, messagePattern) {
  let error = null;
  try {
    await db.exec(sql);
  } catch (caught) {
    error = caught;
    try {
      await db.exec('ROLLBACK');
    } catch {
      // PGlite may already have rolled the failed transaction back.
    }
  }
  assert.ok(error, 'Expected the transaction to be rejected');
  if (messagePattern) assert.match(String(error.message), messagePattern);
  return error;
}

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

async function insertDecision(db, id, organizationId, origin = 'SOURCE_NATIVE_STRUCTURED') {
  await db.query(
    `INSERT INTO public.project_link_decisions
       (id, organization_id, decision_origin, decided_at, created_at)
     VALUES ($1, $2, $3, $4, $4)`,
    [id, organizationId, origin, T0]
  );
}

async function main() {
  const db = new PGlite();
  activeDatabase = db;

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

    INSERT INTO public.organizations (id) VALUES
      ('${ID.orgA}'), ('${ID.orgB}');

    INSERT INTO public.orders (id, organization_id, order_code) VALUES
      ('${ID.orderA1}', '${ID.orgA}', 'A-1'),
      ('${ID.orderA2}', '${ID.orgA}', 'A-2'),
      ('${ID.orderA3}', '${ID.orgA}', 'A-3'),
      ('${ID.orderB1}', '${ID.orgB}', 'B-1');

    INSERT INTO public.projects (id, organization_id, project_code) VALUES
      ('${ID.projectA1}', '${ID.orgA}', 'PA-1'),
      ('${ID.projectA2}', '${ID.orgA}', 'PA-2'),
      ('${ID.projectB1}', '${ID.orgB}', 'PB-1');

    INSERT INTO public.purchase_order_lines
      (id, organization_id, order_id, line_number)
    VALUES
      ('${ID.lineA1}', '${ID.orgA}', '${ID.orderA1}', 1),
      ('${ID.lineA2}', '${ID.orgA}', '${ID.orderA2}', 1),
      ('${ID.lineA3}', '${ID.orgA}', '${ID.orderA3}', 1),
      ('${ID.lineB1}', '${ID.orgB}', '${ID.orderB1}', 1);
  `);

  const parentOrderCountBefore = await scalar(db, 'SELECT count(*)::int FROM public.orders');
  const migration = await readFile(MIGRATION_URL, 'utf8');
  await db.exec(migration);

  console.log('Phase 2D.1B.1: migration applies and remains additive');
  assert.equal(await scalar(db, 'SELECT count(*)::int FROM public.order_project_links'), 0);
  assert.equal(await scalar(db, 'SELECT count(*)::int FROM public.line_project_links'), 0);
  assert.equal(await scalar(db, 'SELECT count(*)::int FROM public.orders'), parentOrderCountBefore);

  console.log('Phase 2D.1B.1: decision candidate key and RLS metadata');
  assert.equal(
    await scalar(
      db,
      `SELECT count(*)::int
       FROM pg_constraint
       WHERE conrelid = 'public.project_link_decisions'::regclass
         AND conname = 'uniq_project_link_decisions_org_id'
         AND contype = 'u'`
    ),
    1
  );
  const rlsRows = await db.query(
    `SELECT relname, relrowsecurity
     FROM pg_class
     WHERE oid IN (
       'public.project_link_decisions'::regclass,
       'public.order_project_links'::regclass,
       'public.line_project_links'::regclass
     )
     ORDER BY relname`
  );
  assert.deepEqual(
    rlsRows.rows,
    [
      { relname: 'line_project_links', relrowsecurity: true },
      { relname: 'order_project_links', relrowsecurity: true },
      { relname: 'project_link_decisions', relrowsecurity: true }
    ]
  );
  assert.equal(
    await scalar(
      db,
      `SELECT count(*)::int
       FROM pg_policy
       WHERE polrelid IN (
         'public.project_link_decisions'::regclass,
         'public.order_project_links'::regclass,
         'public.line_project_links'::regclass
       )`
    ),
    0,
    'B.1 enables RLS but intentionally defers policy authoring'
  );

  await insertDecision(db, ID.decisionA1, ID.orgA);
  await insertDecision(db, ID.decisionA2, ID.orgA, 'EXACT_TRUSTED_REFERENCE');
  await insertDecision(db, ID.decisionA3, ID.orgA, 'IMPORTED_HISTORICAL');
  await insertDecision(db, ID.decisionA4, ID.orgA, 'MANUAL_CONFIRMATION');
  await insertDecision(db, ID.decisionA5, ID.orgA);
  await insertDecision(db, ID.decisionA6, ID.orgA);
  await insertDecision(db, ID.decisionB1, ID.orgB);
  await insertDecision(db, ID.decisionA7, ID.orgA);
  await insertDecision(db, ID.decisionA8, ID.orgA);
  await insertDecision(db, ID.decisionA9, ID.orgA, 'IMPORTED_HISTORICAL');
  await insertDecision(db, ID.decisionA10, ID.orgA, 'MANUAL_CONFIRMATION');
  await insertDecision(db, ID.decisionA11, ID.orgA, 'MANUAL_CONFIRMATION');
  await insertDecision(db, ID.decisionA12, ID.orgA, 'EXACT_TRUSTED_REFERENCE');
  await insertDecision(db, ID.decisionA13, ID.orgA, 'MANUAL_CONFIRMATION');
  await insertDecision(db, ID.decisionA14, ID.orgA, 'MANUAL_CONFIRMATION');

  console.log('Phase 2D.1B.1: decisions are closed-taxonomy immutable audit facts');
  await expectRejected(
    () => db.query(
      `INSERT INTO public.project_link_decisions
         (organization_id, decision_origin)
       VALUES ($1, 'AI_CONFIRMED')`,
      [ID.orgA]
    ),
    /project_link_decisions_origin_check/
  );
  await expectRejected(
    () => db.query(
      `UPDATE public.project_link_decisions
       SET decision_origin = 'IMPORTED_HISTORICAL'
       WHERE id = $1`,
      [ID.decisionA1]
    ),
    /immutable/
  );
  await expectRejected(
    () => db.query('DELETE FROM public.project_link_decisions WHERE id = $1', [ID.decisionA1]),
    /immutable/
  );

  console.log('Phase 2D.1B.1: valid same-tenant order and line links');
  await db.query(
    `INSERT INTO public.order_project_links
       (id, organization_id, order_id, project_id, decision_id, valid_from, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [ID.orderLinkA1, ID.orgA, ID.orderA1, ID.projectA1, ID.decisionA1, T0]
  );
  await db.query(
    `INSERT INTO public.line_project_links
       (id, organization_id, line_id, project_id, decision_id, valid_from, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [ID.lineLinkA1, ID.orgA, ID.lineA1, ID.projectA1, ID.decisionA1, T0]
  );

  console.log('Phase 2D.1B.1: composite foreign keys reject cross-tenant targets');
  await expectRejected(
    () => db.query(
      `INSERT INTO public.order_project_links
         (organization_id, order_id, project_id, decision_id)
       VALUES ($1, $2, $3, $4)`,
      [ID.orgA, ID.orderA2, ID.projectB1, ID.decisionA2]
    ),
    /fk_order_project_links_project_tenant/
  );
  await expectRejected(
    () => db.query(
      `INSERT INTO public.line_project_links
         (organization_id, line_id, project_id, decision_id)
       VALUES ($1, $2, $3, $4)`,
      [ID.orgA, ID.lineA2, ID.projectB1, ID.decisionA2]
    ),
    /fk_line_project_links_project_tenant/
  );
  await expectRejected(
    () => db.query(
      `INSERT INTO public.order_project_links
         (organization_id, order_id, project_id, decision_id)
       VALUES ($1, $2, $3, $4)`,
      [ID.orgA, ID.orderA2, ID.projectA2, ID.decisionB1]
    ),
    /fk_order_project_links_decision_tenant/
  );
  await expectRejected(
    () => db.query(
      `INSERT INTO public.line_project_links
         (organization_id, line_id, project_id, decision_id)
       VALUES ($1, $2, $3, $4)`,
      [ID.orgA, ID.lineA2, ID.projectA2, ID.decisionB1]
    ),
    /fk_line_project_links_decision_tenant/
  );

  console.log('Phase 2D.1B.1: partial indexes enforce one active link per subject');
  await expectRejected(
    () => db.query(
      `INSERT INTO public.order_project_links
         (organization_id, order_id, project_id, decision_id)
       VALUES ($1, $2, $3, $4)`,
      [ID.orgA, ID.orderA1, ID.projectA2, ID.decisionA2]
    ),
    /uniq_order_project_links_active/
  );
  await expectRejected(
    () => db.query(
      `INSERT INTO public.line_project_links
         (organization_id, line_id, project_id, decision_id)
       VALUES ($1, $2, $3, $4)`,
      [ID.orgA, ID.lineA1, ID.projectA2, ID.decisionA2]
    ),
    /uniq_line_project_links_active/
  );

  console.log('Phase 2D.1B.1: self-supersession is rejected');
  await expectRejected(
    () => db.query(
      `UPDATE public.order_project_links
       SET superseded_at = $2, superseded_by_id = id
       WHERE id = $1`,
      [ID.orderLinkA1, T1]
    ),
    /no_self_supersession/
  );
  await expectRejected(
    () => db.query(
      `UPDATE public.line_project_links
       SET superseded_at = $2, superseded_by_id = id
       WHERE id = $1`,
      [ID.lineLinkA1, T1]
    ),
    /no_self_supersession/
  );

  console.log('Phase 2D.1B.1: atomic append/supersede retains order history');
  await db.exec(`
    BEGIN;
    UPDATE public.order_project_links
    SET superseded_at = '${T1}', superseded_by_id = '${ID.orderLinkA2}'
    WHERE id = '${ID.orderLinkA1}';
    INSERT INTO public.order_project_links
      (id, organization_id, order_id, project_id, decision_id, valid_from, created_at)
    VALUES
      ('${ID.orderLinkA2}', '${ID.orgA}', '${ID.orderA1}',
       '${ID.projectA2}', '${ID.decisionA2}', '${T1}', '${T1}');
    COMMIT;
  `);
  assert.equal(
    await scalar(
      db,
      `SELECT count(*)::int FROM public.order_project_links
       WHERE organization_id = $1 AND order_id = $2`,
      [ID.orgA, ID.orderA1]
    ),
    2
  );
  assert.equal(
    await scalar(
      db,
      `SELECT count(*)::int FROM public.order_project_links
       WHERE organization_id = $1 AND order_id = $2 AND superseded_at IS NULL`,
      [ID.orgA, ID.orderA1]
    ),
    1
  );

  console.log('Phase 2D.1B.1: terminal-closure columns and tenant-safe foreign keys exist');
  assert.equal(
    await scalar(
      db,
      `SELECT count(*)::int
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN ('order_project_links', 'line_project_links')
         AND column_name = 'ended_by_decision_id'`
    ),
    2
  );
  assert.equal(
    await scalar(
      db,
      `SELECT count(*)::int
       FROM pg_constraint
       WHERE conname IN (
         'fk_order_project_links_ending_decision_tenant',
         'fk_line_project_links_ending_decision_tenant'
       )
         AND contype = 'f'`
    ),
    2
  );

  console.log('Phase 2D.1B.1: atomic append/supersede retains line history');
  await db.exec(`
    BEGIN;
    UPDATE public.line_project_links
    SET superseded_at = '${T1}', superseded_by_id = '${ID.lineLinkA2}'
    WHERE id = '${ID.lineLinkA1}';
    INSERT INTO public.line_project_links
      (id, organization_id, line_id, project_id, decision_id, valid_from, created_at)
    VALUES
      ('${ID.lineLinkA2}', '${ID.orgA}', '${ID.lineA1}',
       '${ID.projectA2}', '${ID.decisionA3}', '${T1}', '${T1}');
    COMMIT;
  `);
  assert.equal(
    await scalar(
      db,
      `SELECT count(*)::int FROM public.line_project_links
       WHERE organization_id = $1 AND line_id = $2`,
      [ID.orgA, ID.lineA1]
    ),
    2
  );
  assert.equal(
    await scalar(
      db,
      `SELECT count(*)::int FROM public.line_project_links
       WHERE organization_id = $1 AND line_id = $2 AND superseded_at IS NULL`,
      [ID.orgA, ID.lineA1]
    ),
    1
  );

  console.log('Phase 2D.1B.1: replacement requires a new immutable decision');
  const repeatedDecisionLinkId = '50000000-0000-4000-8000-000000000098';
  await expectTransactionRejected(
    db,
    `BEGIN;
     UPDATE public.order_project_links
     SET superseded_at = '${T2}', superseded_by_id = '${repeatedDecisionLinkId}'
     WHERE id = '${ID.orderLinkA2}';
     INSERT INTO public.order_project_links
       (id, organization_id, order_id, project_id, decision_id, valid_from, created_at)
     VALUES
       ('${repeatedDecisionLinkId}', '${ID.orgA}', '${ID.orderA1}',
        '${ID.projectA1}', '${ID.decisionA2}', '${T2}', '${T2}');
     COMMIT;`,
    /requires a new decision/
  );
  assert.equal(
    await scalar(
      db,
      `SELECT count(*)::int FROM public.order_project_links
       WHERE id = $1 AND superseded_at IS NULL`,
      [ID.orderLinkA2]
    ),
    1
  );

  console.log('Phase 2D.1B.1: failed replacement preserves the previous active row');
  const failedOrderReplacementId = '50000000-0000-4000-8000-000000000099';
  await expectTransactionRejected(
    db,
    `BEGIN;
     UPDATE public.order_project_links
     SET superseded_at = '${T2}', superseded_by_id = '${failedOrderReplacementId}'
     WHERE id = '${ID.orderLinkA2}';
     INSERT INTO public.order_project_links
       (id, organization_id, order_id, project_id, decision_id, valid_from, created_at)
     VALUES
       ('${failedOrderReplacementId}', '${ID.orgA}', '${ID.orderA1}',
        '${ID.projectB1}', '${ID.decisionA4}', '${T2}', '${T2}');
     COMMIT;`,
    /fk_order_project_links_project_tenant/
  );
  assert.equal(
    await scalar(
      db,
      `SELECT count(*)::int FROM public.order_project_links
       WHERE id = $1 AND superseded_at IS NULL`,
      [ID.orderLinkA2]
    ),
    1
  );

  console.log('Phase 2D.1B.1: terminal closure starts from explicit active order and line links');
  await db.query(
    `INSERT INTO public.order_project_links
       (id, organization_id, order_id, project_id, decision_id, valid_from, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [ID.orderLinkA4, ID.orgA, ID.orderA3, ID.projectA1, ID.decisionA9, T0]
  );
  await db.query(
    `INSERT INTO public.line_project_links
       (id, organization_id, line_id, project_id, decision_id, valid_from, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [ID.lineLinkA4, ID.orgA, ID.lineA3, ID.projectA2, ID.decisionA12, T0]
  );

  console.log('Phase 2D.1B.1: malformed terminal states are rejected by the intended guards');
  await expectRejected(
    () => db.query(
      `UPDATE public.order_project_links
       SET superseded_at = $2
       WHERE id = $1`,
      [ID.orderLinkA4, T1]
    ),
    /may only transition once from active to replaced or terminally ended/
  );
  await expectRejected(
    () => db.query(
      `UPDATE public.order_project_links
       SET ended_by_decision_id = $2
       WHERE id = $1`,
      [ID.orderLinkA4, ID.decisionA10]
    ),
    /may only transition once from active to replaced or terminally ended/
  );
  await expectRejected(
    () => db.query(
      `UPDATE public.order_project_links
       SET superseded_at = $2,
           superseded_by_id = $3,
           ended_by_decision_id = $4
       WHERE id = $1`,
      [ID.orderLinkA4, T1, ID.orderLinkA5, ID.decisionA10]
    ),
    /may only transition once from active to replaced or terminally ended/
  );
  await expectRejected(
    () => db.query(
      `UPDATE public.order_project_links
       SET superseded_at = $2, ended_by_decision_id = decision_id
       WHERE id = $1`,
      [ID.orderLinkA4, T1]
    ),
    /order_project_links_ending_decision_differs_check/
  );
  await expectRejected(
    () => db.query(
      `UPDATE public.line_project_links
       SET superseded_at = $2, ended_by_decision_id = decision_id
       WHERE id = $1`,
      [ID.lineLinkA4, T1]
    ),
    /line_project_links_ending_decision_differs_check/
  );

  console.log('Phase 2D.1B.1: ending decisions are tenant-scoped for order and line links');
  await expectRejected(
    () => db.query(
      `UPDATE public.order_project_links
       SET superseded_at = $2, ended_by_decision_id = $3
       WHERE id = $1`,
      [ID.orderLinkA4, T1, ID.decisionB1]
    ),
    /fk_order_project_links_ending_decision_tenant/
  );
  await expectRejected(
    () => db.query(
      `UPDATE public.line_project_links
       SET superseded_at = $2, ended_by_decision_id = $3
       WHERE id = $1`,
      [ID.lineLinkA4, T1, ID.decisionB1]
    ),
    /fk_line_project_links_ending_decision_tenant/
  );
  assert.equal(
    await scalar(
      db,
      `SELECT count(*)::int
       FROM public.order_project_links
       WHERE id = $1 AND superseded_at IS NULL`,
      [ID.orderLinkA4]
    ),
    1,
    'failed terminal closure preserves the active order link'
  );
  assert.equal(
    await scalar(
      db,
      `SELECT count(*)::int
       FROM public.line_project_links
       WHERE id = $1 AND superseded_at IS NULL`,
      [ID.lineLinkA4]
    ),
    1,
    'failed terminal closure preserves the active line link'
  );

  console.log('Phase 2D.1B.1: audited order and line terminal closures allow zero active links');
  await db.query(
    `UPDATE public.order_project_links
     SET superseded_at = $2, ended_by_decision_id = $3
     WHERE id = $1`,
    [ID.orderLinkA4, T1, ID.decisionA10]
  );
  await db.query(
    `UPDATE public.line_project_links
     SET superseded_at = $2, ended_by_decision_id = $3
     WHERE id = $1`,
    [ID.lineLinkA4, T1, ID.decisionA13]
  );
  assert.equal(
    await scalar(
      db,
      `SELECT count(*)::int
       FROM public.order_project_links
       WHERE organization_id = $1 AND order_id = $2 AND superseded_at IS NULL`,
      [ID.orgA, ID.orderA3]
    ),
    0
  );
  assert.equal(
    await scalar(
      db,
      `SELECT count(*)::int
       FROM public.line_project_links
       WHERE organization_id = $1 AND line_id = $2 AND superseded_at IS NULL`,
      [ID.orgA, ID.lineA3]
    ),
    0
  );
  const terminalOrderHistory = await db.query(
    `SELECT project_id, decision_id, superseded_by_id, ended_by_decision_id
     FROM public.order_project_links
     WHERE id = $1`,
    [ID.orderLinkA4]
  );
  assert.deepEqual(terminalOrderHistory.rows[0], {
    project_id: ID.projectA1,
    decision_id: ID.decisionA9,
    superseded_by_id: null,
    ended_by_decision_id: ID.decisionA10
  });
  const terminalLineHistory = await db.query(
    `SELECT project_id, decision_id, superseded_by_id, ended_by_decision_id
     FROM public.line_project_links
     WHERE id = $1`,
    [ID.lineLinkA4]
  );
  assert.deepEqual(terminalLineHistory.rows[0], {
    project_id: ID.projectA2,
    decision_id: ID.decisionA12,
    superseded_by_id: null,
    ended_by_decision_id: ID.decisionA13
  });

  console.log('Phase 2D.1B.1: every closed history kind remains immutable');
  await expectRejected(
    () => db.query(
      `UPDATE public.order_project_links
       SET ended_by_decision_id = $2
       WHERE id = $1`,
      [ID.orderLinkA4, ID.decisionA11]
    ),
    /closed order_project_links are immutable/
  );
  await expectRejected(
    () => db.query(
      `UPDATE public.line_project_links
       SET superseded_by_id = $2, ended_by_decision_id = NULL
       WHERE id = $1`,
      [ID.lineLinkA4, ID.lineLinkA5]
    ),
    /closed line_project_links are immutable/
  );
  await expectRejected(
    () => db.query(
      `UPDATE public.order_project_links
       SET ended_by_decision_id = $2, superseded_by_id = NULL
       WHERE id = $1`,
      [ID.orderLinkA1, ID.decisionA10]
    ),
    /closed order_project_links are immutable/
  );

  console.log('Phase 2D.1B.1: a later assignment may reactivate an order after a zero-active interval');
  await db.query(
    `INSERT INTO public.order_project_links
       (id, organization_id, order_id, project_id, decision_id, valid_from, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [ID.orderLinkA5, ID.orgA, ID.orderA3, ID.projectA2, ID.decisionA11, T2]
  );
  assert.equal(
    await scalar(
      db,
      `SELECT count(*)::int
       FROM public.order_project_links
       WHERE organization_id = $1 AND order_id = $2 AND superseded_at IS NULL`,
      [ID.orgA, ID.orderA3]
    ),
    1
  );
  assert.equal(
    await scalar(
      db,
      `SELECT count(*)::int
       FROM public.line_project_links
       WHERE organization_id = $1 AND line_id = $2 AND superseded_at IS NULL`,
      [ID.orgA, ID.lineA3]
    ),
    0,
    'a withdrawn line override can resume order-level inheritance'
  );
  assert.deepEqual(
    (await db.query(
      `SELECT project_id, decision_id, superseded_by_id, ended_by_decision_id
       FROM public.order_project_links
       WHERE id = $1`,
      [ID.orderLinkA4]
    )).rows[0],
    terminalOrderHistory.rows[0],
    'reactivation does not rewrite the earlier terminal episode'
  );

  console.log('Phase 2D.1B.1: a later assignment may reactivate a line with a new decision');
  await db.query(
    `INSERT INTO public.line_project_links
       (id, organization_id, line_id, project_id, decision_id, valid_from, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [ID.lineLinkA5, ID.orgA, ID.lineA3, ID.projectA1, ID.decisionA14, T2]
  );
  assert.equal(
    await scalar(
      db,
      `SELECT count(*)::int
       FROM public.line_project_links
       WHERE organization_id = $1 AND line_id = $2 AND superseded_at IS NULL`,
      [ID.orgA, ID.lineA3]
    ),
    1
  );
  assert.deepEqual(
    (await db.query(
      `SELECT project_id, decision_id, superseded_by_id, ended_by_decision_id
       FROM public.line_project_links
       WHERE id = $1`,
      [ID.lineLinkA4]
    )).rows[0],
    terminalLineHistory.rows[0],
    'line reactivation does not rewrite the earlier terminal episode'
  );

  console.log('Phase 2D.1B.1: same-subject composite self references are enforced');
  await db.query(
    `INSERT INTO public.order_project_links
       (id, organization_id, order_id, project_id, decision_id, valid_from, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [ID.orderLinkB1, ID.orgB, ID.orderB1, ID.projectB1, ID.decisionB1, T0]
  );
  await db.query(
    `INSERT INTO public.line_project_links
       (id, organization_id, line_id, project_id, decision_id, valid_from, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [ID.lineLinkB1, ID.orgB, ID.lineB1, ID.projectB1, ID.decisionB1, T0]
  );
  await db.query(
    `INSERT INTO public.order_project_links
       (id, organization_id, order_id, project_id, decision_id, valid_from, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [ID.orderLinkA3, ID.orgA, ID.orderA2, ID.projectA2, ID.decisionA7, T0]
  );
  await db.query(
    `INSERT INTO public.line_project_links
       (id, organization_id, line_id, project_id, decision_id, valid_from, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [ID.lineLinkA3, ID.orgA, ID.lineA2, ID.projectA2, ID.decisionA8, T0]
  );

  console.log('Phase 2D.1B.1: same-tenant cross-subject self references are rejected');
  const crossSubjectOrderHistoricalId = '50000000-0000-4000-8000-000000000088';
  await expectTransactionRejected(
    db,
    `BEGIN;
     INSERT INTO public.order_project_links
       (id, organization_id, order_id, project_id, decision_id,
        valid_from, superseded_at, superseded_by_id, created_at)
     VALUES
       ('${crossSubjectOrderHistoricalId}', '${ID.orgA}', '${ID.orderA1}',
        '${ID.projectA1}', '${ID.decisionA5}', '${T0}', '${T1}',
        '${ID.orderLinkA3}', '${T0}');
     COMMIT;`,
    /fk_order_project_links_superseded_by_subject/
  );

  const crossSubjectLineHistoricalId = '60000000-0000-4000-8000-000000000088';
  await expectTransactionRejected(
    db,
    `BEGIN;
     INSERT INTO public.line_project_links
       (id, organization_id, line_id, project_id, decision_id,
        valid_from, superseded_at, superseded_by_id, created_at)
     VALUES
       ('${crossSubjectLineHistoricalId}', '${ID.orgA}', '${ID.lineA1}',
        '${ID.projectA1}', '${ID.decisionA5}', '${T0}', '${T1}',
        '${ID.lineLinkA3}', '${T0}');
     COMMIT;`,
    /fk_line_project_links_superseded_by_subject/
  );

  console.log('Phase 2D.1B.1: cross-organization self references are rejected');
  const crossOrderHistoricalId = '50000000-0000-4000-8000-000000000090';
  await expectTransactionRejected(
    db,
    `BEGIN;
     INSERT INTO public.order_project_links
       (id, organization_id, order_id, project_id, decision_id,
        valid_from, superseded_at, superseded_by_id, created_at)
     VALUES
       ('${crossOrderHistoricalId}', '${ID.orgA}', '${ID.orderA1}',
        '${ID.projectA1}', '${ID.decisionA5}', '${T0}', '${T1}',
        '${ID.orderLinkB1}', '${T0}');
     COMMIT;`,
    /fk_order_project_links_superseded_by_subject/
  );

  const crossLineHistoricalId = '60000000-0000-4000-8000-000000000090';
  await expectTransactionRejected(
    db,
    `BEGIN;
     INSERT INTO public.line_project_links
       (id, organization_id, line_id, project_id, decision_id,
        valid_from, superseded_at, superseded_by_id, created_at)
     VALUES
       ('${crossLineHistoricalId}', '${ID.orgA}', '${ID.lineA1}',
        '${ID.projectA1}', '${ID.decisionA5}', '${T0}', '${T1}',
        '${ID.lineLinkB1}', '${T0}');
     COMMIT;`,
    /fk_line_project_links_superseded_by_subject/
  );

  console.log('Phase 2D.1B.1: cyclic supersession is rejected');
  const cycleOrderA = '50000000-0000-4000-8000-000000000080';
  const cycleOrderB = '50000000-0000-4000-8000-000000000081';
  await expectTransactionRejected(
    db,
    `BEGIN;
     INSERT INTO public.order_project_links
       (id, organization_id, order_id, project_id, decision_id,
        valid_from, superseded_at, superseded_by_id, created_at)
     VALUES
       ('${cycleOrderA}', '${ID.orgA}', '${ID.orderA1}', '${ID.projectA1}',
        '${ID.decisionA5}', '${T0}', '${T0}', '${cycleOrderB}', '${T0}'),
       ('${cycleOrderB}', '${ID.orgA}', '${ID.orderA1}', '${ID.projectA2}',
        '${ID.decisionA6}', '${T0}', '${T0}', '${cycleOrderA}', '${T0}');
     COMMIT;`,
    /cyclic order project-link supersession/
  );

  const cycleLineA = '60000000-0000-4000-8000-000000000080';
  const cycleLineB = '60000000-0000-4000-8000-000000000081';
  await expectTransactionRejected(
    db,
    `BEGIN;
     INSERT INTO public.line_project_links
       (id, organization_id, line_id, project_id, decision_id,
        valid_from, superseded_at, superseded_by_id, created_at)
     VALUES
       ('${cycleLineA}', '${ID.orgA}', '${ID.lineA1}', '${ID.projectA1}',
        '${ID.decisionA5}', '${T0}', '${T0}', '${cycleLineB}', '${T0}'),
       ('${cycleLineB}', '${ID.orgA}', '${ID.lineA1}', '${ID.projectA2}',
        '${ID.decisionA6}', '${T0}', '${T0}', '${cycleLineA}', '${T0}');
     COMMIT;`,
    /cyclic line project-link supersession/
  );

  console.log('Phase 2D.1B.1: historical rows and parent data cannot be destructively removed');
  await expectRejected(
    () => db.query('DELETE FROM public.order_project_links WHERE id = $1', [ID.orderLinkA1]),
    /history cannot be deleted/
  );
  await expectRejected(
    () => db.query('DELETE FROM public.line_project_links WHERE id = $1', [ID.lineLinkA1]),
    /history cannot be deleted/
  );
  assert.equal(await scalar(db, 'SELECT count(*)::int FROM public.orders'), parentOrderCountBefore);

  await db.close();
  activeDatabase = null;
  console.log('Phase 2D.1B.1 schema tests: PASS');
}

main().catch(async (error) => {
  if (activeDatabase) {
    await activeDatabase.close().catch(() => {});
    activeDatabase = null;
  }
  console.error(error);
  process.exitCode = 1;
});
