import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION_URLS = [
  new URL(
    '../supabase/migrations/20260729170041_canonical_project_link_schema_foundation.sql',
    import.meta.url
  ),
  new URL(
    '../supabase/migrations/20260730210335_enforce_manual_project_link_precedence.sql',
    import.meta.url
  ),
  new URL(
    '../supabase/migrations/20260731102910_canonical_project_link_operation_ledger.sql',
    import.meta.url
  )
];

const ID = Object.freeze({
  orgA: '00000000-0000-4000-8000-000000000001',
  orgB: '00000000-0000-4000-8000-000000000002',
  orderA: '10000000-0000-4000-8000-000000000001',
  orderB: '10000000-0000-4000-8000-000000000002',
  projectA1: '20000000-0000-4000-8000-000000000001',
  projectA2: '20000000-0000-4000-8000-000000000002',
  projectB: '20000000-0000-4000-8000-000000000003',
  lineA: '30000000-0000-4000-8000-000000000001',
  lineB: '30000000-0000-4000-8000-000000000002',
  decisionA: '40000000-0000-4000-8000-000000000001',
  decisionB: '40000000-0000-4000-8000-000000000002',
  orderLinkA: '50000000-0000-4000-8000-000000000001',
  lineLinkA: '60000000-0000-4000-8000-000000000001',
  operationCompleted: '70000000-0000-4000-8000-000000000001',
  operationAmbiguous: '70000000-0000-4000-8000-000000000002',
  operationFailed: '70000000-0000-4000-8000-000000000003',
  operationOtherTenant: '70000000-0000-4000-8000-000000000004'
});

const FINGERPRINT_A = 'a'.repeat(64);
const FINGERPRINT_B = 'b'.repeat(64);
const T0 = '2026-07-31T10:00:00.000Z';
const T1 = '2026-07-31T10:01:00.000Z';

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

async function expectRejected(operation, { code, messagePattern, label }) {
  let error = null;
  try {
    await operation();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, `${label}: expected rejection`);
  assert.equal(error.code, code, `${label}: SQLSTATE`);
  assert.match(String(error.message), messagePattern, `${label}: message`);
  return error;
}

async function insertClaimedOperation(db, {
  id,
  organizationId = ID.orgA,
  operationKey,
  fingerprint = FINGERPRINT_A,
  subjectType = 'ORDER',
  subjectId = ID.orderA,
  operationType = 'CREATE_INITIAL_LINK',
  lifecycleOperation = operationType,
  decisionOrigin = 'SOURCE_NATIVE_STRUCTURED',
  intendedProjectId = ID.projectA1,
  expectedActiveLinkId = null
}) {
  return db.query(
    `INSERT INTO public.project_link_operations (
       id,
       organization_id,
       operation_key,
       request_fingerprint,
       subject_type,
       subject_id,
       operation_type,
       lifecycle_operation,
       decision_origin,
       intended_project_id,
       expected_active_link_id,
       created_at,
       started_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
     RETURNING *`,
    [
      id,
      organizationId,
      operationKey,
      fingerprint,
      subjectType,
      subjectId,
      operationType,
      lifecycleOperation,
      decisionOrigin,
      intendedProjectId,
      expectedActiveLinkId,
      T0
    ]
  );
}

async function main() {
  const db = new PGlite();

  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role;

      CREATE TABLE public.organizations (id uuid PRIMARY KEY);

      CREATE TABLE public.orders (
        id uuid PRIMARY KEY,
        organization_id uuid NOT NULL REFERENCES public.organizations(id),
        order_code text NOT NULL,
        CONSTRAINT test_ledger_orders_org_id UNIQUE (organization_id, id)
      );

      CREATE TABLE public.projects (
        id uuid PRIMARY KEY,
        organization_id uuid NOT NULL REFERENCES public.organizations(id),
        project_code text NOT NULL,
        CONSTRAINT test_ledger_projects_org_id UNIQUE (organization_id, id)
      );

      CREATE TABLE public.purchase_order_lines (
        id uuid PRIMARY KEY,
        organization_id uuid NOT NULL REFERENCES public.organizations(id),
        order_id uuid NOT NULL,
        line_number integer NOT NULL,
        CONSTRAINT test_ledger_lines_order_tenant
          FOREIGN KEY (organization_id, order_id)
          REFERENCES public.orders(organization_id, id),
        CONSTRAINT test_ledger_lines_org_id UNIQUE (organization_id, id)
      );

      INSERT INTO public.organizations (id) VALUES ('${ID.orgA}'), ('${ID.orgB}');
      INSERT INTO public.orders (id, organization_id, order_code) VALUES
        ('${ID.orderA}', '${ID.orgA}', 'ORDER-A'),
        ('${ID.orderB}', '${ID.orgB}', 'ORDER-B');
      INSERT INTO public.projects (id, organization_id, project_code) VALUES
        ('${ID.projectA1}', '${ID.orgA}', 'PROJECT-A1'),
        ('${ID.projectA2}', '${ID.orgA}', 'PROJECT-A2'),
        ('${ID.projectB}', '${ID.orgB}', 'PROJECT-B');
      INSERT INTO public.purchase_order_lines
        (id, organization_id, order_id, line_number)
      VALUES
        ('${ID.lineA}', '${ID.orgA}', '${ID.orderA}', 1),
        ('${ID.lineB}', '${ID.orgB}', '${ID.orderB}', 1);
    `);

    for (const migrationUrl of MIGRATION_URLS) {
      await db.exec(await readFile(migrationUrl, 'utf8'));
    }

    await db.exec(`
      INSERT INTO public.project_link_decisions
        (id, organization_id, decision_origin, decided_at, created_at)
      VALUES
        ('${ID.decisionA}', '${ID.orgA}', 'SOURCE_NATIVE_STRUCTURED', '${T0}', '${T0}'),
        ('${ID.decisionB}', '${ID.orgB}', 'SOURCE_NATIVE_STRUCTURED', '${T0}', '${T0}');

      INSERT INTO public.order_project_links
        (id, organization_id, order_id, project_id, decision_id, valid_from, created_at)
      VALUES
        ('${ID.orderLinkA}', '${ID.orgA}', '${ID.orderA}', '${ID.projectA1}',
         '${ID.decisionA}', '${T0}', '${T0}');

      INSERT INTO public.line_project_links
        (id, organization_id, line_id, project_id, decision_id, valid_from, created_at)
      VALUES
        ('${ID.lineLinkA}', '${ID.orgA}', '${ID.lineA}', '${ID.projectA1}',
         '${ID.decisionA}', '${T0}', '${T0}');
    `);

    console.log('Phase 2D.1B.1 ledger: migrations apply in approved order');
    assert.equal(
      await scalar(db, `SELECT count(*)::int FROM public.project_link_operations`),
      0
    );

    console.log('Phase 2D.1B.1 ledger: operation creation and same-request lookup');
    await insertClaimedOperation(db, {
      id: ID.operationCompleted,
      operationKey: 'manual-submit:operation-001'
    });
    await db.query(
      `INSERT INTO public.project_link_operations (
         organization_id, operation_key, request_fingerprint, subject_type, subject_id,
         operation_type, lifecycle_operation, decision_origin, intended_project_id,
         created_at, started_at
       ) VALUES ($1, $2, $3, 'ORDER', $4, 'CREATE_INITIAL_LINK',
                 'CREATE_INITIAL_LINK', 'SOURCE_NATIVE_STRUCTURED', $5, $6, $6)
       ON CONFLICT (organization_id, operation_key) DO NOTHING`,
      [ID.orgA, 'manual-submit:operation-001', FINGERPRINT_A, ID.orderA, ID.projectA1, T0]
    );
    assert.equal(
      await scalar(
        db,
        `SELECT count(*)::int
         FROM public.project_link_operations
         WHERE organization_id = $1
           AND operation_key = $2
           AND request_fingerprint = $3`,
        [ID.orgA, 'manual-submit:operation-001', FINGERPRINT_A]
      ),
      1
    );

    console.log('Phase 2D.1B.1 ledger: same key with another fingerprint is rejected');
    await expectRejected(
      () => insertClaimedOperation(db, {
        id: '70000000-0000-4000-8000-000000000099',
        operationKey: 'manual-submit:operation-001',
        fingerprint: FINGERPRINT_B
      }),
      {
        code: '23505',
        messagePattern: /uniq_project_link_operations_org_key/,
        label: 'fingerprint mismatch'
      }
    );
    assert.equal(
      await scalar(
        db,
        `SELECT request_fingerprint
         FROM public.project_link_operations
         WHERE organization_id = $1 AND operation_key = $2`,
        [ID.orgA, 'manual-submit:operation-001']
      ),
      FINGERPRINT_A
    );

    console.log('Phase 2D.1B.1 ledger: operation keys are organization-scoped');
    await insertClaimedOperation(db, {
      id: ID.operationOtherTenant,
      organizationId: ID.orgB,
      operationKey: 'manual-submit:operation-001',
      subjectId: ID.orderB,
      intendedProjectId: ID.projectB
    });
    assert.equal(
      await scalar(
        db,
        `SELECT count(*)::int
         FROM public.project_link_operations
         WHERE operation_key = 'manual-submit:operation-001'`
      ),
      2
    );

    console.log('Phase 2D.1B.1 ledger: wrapper commands retain the lifecycle operation');
    await insertClaimedOperation(db, {
      id: '70000000-0000-4000-8000-000000000005',
      operationKey: 'manual-submit:terminal-operation',
      subjectType: 'LINE',
      subjectId: ID.lineA,
      operationType: 'CONFIRM_PROJECT_MANUALLY',
      lifecycleOperation: 'TERMINALLY_END_ACTIVE_LINK',
      decisionOrigin: 'MANUAL_CONFIRMATION',
      intendedProjectId: null,
      expectedActiveLinkId: ID.lineLinkA
    });
    assert.deepEqual(
      (
        await db.query(
          `SELECT operation_type, lifecycle_operation
           FROM public.project_link_operations
           WHERE id = $1`,
          ['70000000-0000-4000-8000-000000000005']
        )
      ).rows[0],
      {
        operation_type: 'CONFIRM_PROJECT_MANUALLY',
        lifecycle_operation: 'TERMINALLY_END_ACTIVE_LINK'
      }
    );

    console.log('Phase 2D.1B.1 ledger: claimed operations complete with stable result IDs');
    await db.query(
      `UPDATE public.project_link_operations
       SET status = 'COMPLETED',
           final_outcome = 'SUCCESS_ALREADY_CURRENT',
           decision_id = $2,
           result_link_id = $3,
           completed_at = $4
       WHERE id = $1`,
      [ID.operationCompleted, ID.decisionA, ID.orderLinkA, T1]
    );
    assert.equal(
      await scalar(
        db,
        `SELECT status FROM public.project_link_operations WHERE id = $1`,
        [ID.operationCompleted]
      ),
      'COMPLETED'
    );

    console.log('Phase 2D.1B.1 ledger: ambiguous operations can be reconciled once');
    await insertClaimedOperation(db, {
      id: ID.operationAmbiguous,
      operationKey: 'automatic-job:operation-002',
      operationType: 'REPLACE_ACTIVE_LINK',
      decisionOrigin: 'EXACT_TRUSTED_REFERENCE',
      intendedProjectId: ID.projectA2,
      expectedActiveLinkId: ID.orderLinkA
    });
    await db.query(
      `UPDATE public.project_link_operations
       SET status = 'AMBIGUOUS',
           prior_link_id = $2,
           result_link_id = $2,
           last_error_class = 'AMBIGUOUS_COMMIT'
       WHERE id = $1`,
      [ID.operationAmbiguous, ID.orderLinkA]
    );
    await db.query(
      `UPDATE public.project_link_operations
       SET status = 'COMPLETED',
           final_outcome = 'SUCCESS_ALREADY_CURRENT',
           decision_id = $2,
           completed_at = $3,
           last_error_class = NULL
       WHERE id = $1`,
      [ID.operationAmbiguous, ID.decisionA, T1]
    );

    console.log('Phase 2D.1B.1 ledger: definitive failure is terminal');
    await insertClaimedOperation(db, {
      id: ID.operationFailed,
      operationKey: 'manual-submit:operation-003',
      subjectType: 'LINE',
      subjectId: ID.lineA,
      operationType: 'TERMINALLY_END_ACTIVE_LINK',
      decisionOrigin: 'MANUAL_CONFIRMATION',
      intendedProjectId: null,
      expectedActiveLinkId: ID.lineLinkA
    });
    await db.query(
      `UPDATE public.project_link_operations
       SET status = 'FAILED',
           final_outcome = 'CONFLICT_STALE_STATE',
           prior_link_id = $2,
           completed_at = $3,
           last_error_class = 'STALE_ACTIVE_LINK'
       WHERE id = $1`,
      [ID.operationFailed, ID.lineLinkA, T1]
    );

    console.log('Phase 2D.1B.1 ledger: illegal and terminal transitions are rejected');
    await expectRejected(
      () => db.query(
        `UPDATE public.project_link_operations
         SET status = 'CLAIMED'
         WHERE id = $1`,
        [ID.operationAmbiguous]
      ),
      {
        code: '55000',
        messagePattern: /terminal project_link_operations are immutable/,
        label: 'completed to claimed'
      }
    );
    await expectRejected(
      () => db.query(
        `UPDATE public.project_link_operations
         SET final_outcome = 'INTERNAL_FAILURE'
         WHERE id = $1`,
        [ID.operationFailed]
      ),
      {
        code: '55000',
        messagePattern: /terminal project_link_operations are immutable/,
        label: 'failed outcome mutation'
      }
    );
    await expectRejected(
      () => db.query(
        `UPDATE public.project_link_operations
         SET result_link_id = $2
         WHERE id = $1`,
        [ID.operationCompleted, '50000000-0000-4000-8000-000000000099']
      ),
      {
        code: '55000',
        messagePattern: /terminal project_link_operations are immutable/,
        label: 'completed result mutation'
      }
    );
    await expectRejected(
      () => db.query(
        `DELETE FROM public.project_link_operations WHERE id = $1`,
        [ID.operationCompleted]
      ),
      {
        code: '55000',
        messagePattern: /history cannot be deleted/,
        label: 'operation deletion'
      }
    );

    console.log('Phase 2D.1B.1 ledger: tenant-unsafe polymorphic references are rejected');
    await expectRejected(
      () => insertClaimedOperation(db, {
        id: '70000000-0000-4000-8000-000000000090',
        operationKey: 'cross-tenant-subject',
        subjectId: ID.orderB
      }),
      {
        code: '23503',
        messagePattern: /subject is not tenant-safe/,
        label: 'cross-tenant subject'
      }
    );
    await expectRejected(
      () => insertClaimedOperation(db, {
        id: '70000000-0000-4000-8000-000000000091',
        operationKey: 'cross-tenant-project',
        intendedProjectId: ID.projectB
      }),
      {
        code: '23503',
        messagePattern: /fk_project_link_operations_intended_project_tenant/,
        label: 'cross-tenant project'
      }
    );
    await expectRejected(
      () => insertClaimedOperation(db, {
        id: '70000000-0000-4000-8000-000000000092',
        operationKey: 'cross-subject-link',
        operationType: 'REPLACE_ACTIVE_LINK',
        intendedProjectId: ID.projectA2,
        expectedActiveLinkId: ID.lineLinkA
      }),
      {
        code: '23503',
        messagePattern: /expected link is not tenant-safe/,
        label: 'wrong subject link'
      }
    );

    console.log('Phase 2D.1B.1 ledger: request facts and set result IDs are immutable');
    await expectRejected(
      () => db.query(
        `UPDATE public.project_link_operations
         SET request_fingerprint = $2
         WHERE id = $1`,
        [ID.operationCompleted, FINGERPRINT_B]
      ),
      {
        code: '55000',
        messagePattern: /request facts are immutable/,
        label: 'fingerprint mutation'
      }
    );
    await expectRejected(
      () => db.query(
        `UPDATE public.project_link_operations
         SET result_link_id = NULL
         WHERE id = $1`,
        [ID.operationAmbiguous]
      ),
      {
        code: '55000',
        messagePattern: /terminal project_link_operations are immutable/,
        label: 'stable result ID mutation'
      }
    );

    console.log('Phase 2D.1B.1 ledger: RLS and least-privilege posture match B.1');
    assert.equal(
      await scalar(
        db,
        `SELECT relrowsecurity
         FROM pg_class
         WHERE oid = 'public.project_link_operations'::regclass`
      ),
      true
    );
    assert.equal(
      await scalar(
        db,
        `SELECT count(*)::int
         FROM pg_policy
         WHERE polrelid = 'public.project_link_operations'::regclass`
      ),
      0
    );
    assert.equal(
      await scalar(
        db,
        `SELECT has_table_privilege('service_role', 'public.project_link_operations', 'SELECT')`
      ),
      true
    );
    assert.equal(
      await scalar(
        db,
        `SELECT has_table_privilege('service_role', 'public.project_link_operations', 'DELETE')`
      ),
      false
    );
    assert.equal(
      await scalar(
        db,
        `SELECT has_table_privilege('authenticated', 'public.project_link_operations', 'SELECT')`
      ),
      false
    );

    console.log('Phase 2D.1B.1 ledger: rolled-back operations leave no residual rows');
    const beforeRollback = await scalar(
      db,
      `SELECT count(*)::int FROM public.project_link_operations`
    );
    await db.exec('BEGIN');
    await insertClaimedOperation(db, {
      id: '70000000-0000-4000-8000-000000000093',
      operationKey: 'rolled-back-operation'
    });
    await db.exec('ROLLBACK');
    assert.equal(
      await scalar(db, `SELECT count(*)::int FROM public.project_link_operations`),
      beforeRollback
    );

    console.log('Phase 2D.1B.1 operation-ledger tests: PASS');
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
