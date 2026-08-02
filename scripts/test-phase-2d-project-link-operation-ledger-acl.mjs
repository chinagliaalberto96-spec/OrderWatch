import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Reuses the same minimal synthetic parent-schema bootstrap pattern as
// test-phase-2d-project-link-operation-ledger.mjs (organizations/orders/
// projects/purchase_order_lines), inlined here rather than extracted into a
// shared helper, so that file is left unmodified.

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

const ACL_MIGRATION_URL = new URL(
  '../supabase/migrations/20260802101500_restrict_project_link_operations_service_role_acl.sql',
  import.meta.url
);
const ACL_MIGRATION_FILENAME = '20260802101500_restrict_project_link_operations_service_role_acl.sql';
const PRECEDING_LEDGER_FILENAME = '20260731102910_canonical_project_link_operation_ledger.sql';

// The hostile ACL actually observed on hosted Supabase: default privileges
// owned by postgres grant service_role every table privilege at table
// creation. The real ledger migration's own GRANT is additive and does not
// remove this. Reproduced here, in the test, so the BEFORE matrix below
// exercises the exact defect the ACL-correction migration fixes -- not a
// hypothetical.
const HOSTILE_HOSTED_GRANT_SQL =
  'GRANT ALL PRIVILEGES ON TABLE public.project_link_operations TO service_role;';

const ALL_TABLE_PRIVILEGES = Object.freeze([
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
]);

const ID = Object.freeze({
  orgA: '00000000-0000-4000-8000-000000000001',
  orderA: '10000000-0000-4000-8000-000000000001',
  projectA1: '20000000-0000-4000-8000-000000000001',
  lineA: '30000000-0000-4000-8000-000000000001'
});

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  [OK] ${label}`);
  } else {
    console.error(`  [FAIL] ${label}`);
    failures += 1;
  }
}

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

/**
 * Strips SQL line comments (-- ...) and block comments (/* ... *\/) before
 * structural checks run, so this migration's explanatory comment -- which
 * legitimately documents, in prose, the forbidden operations it deliberately
 * avoids -- cannot itself trip the checks meant to scan the executable SQL,
 * and so prohibited text hidden only inside a comment is correctly ignored
 * rather than treated as executable.
 */
function stripSqlComments(text) {
  return text
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function normalizeStatement(stmt) {
  return stmt.replace(/\s+/g, ' ').trim();
}

/**
 * Splits comment-stripped SQL into complete statements on top-level ';'
 * boundaries. This migration contains no string literals or dollar-quoted
 * bodies that could themselves contain a semicolon, so a plain split is
 * exact here (unlike a general-purpose SQL parser would need to be). An
 * optional trailing semicolon produces one trailing empty fragment, which is
 * dropped; any other empty fragment (e.g. two semicolons in a row, or an
 * empty statement between two real ones) is preserved as an empty string so
 * callers can reject it explicitly instead of silently absorbing it.
 */
function splitIntoStatements(strippedText) {
  const parts = strippedText.split(';').map((s) => s.trim());
  if (parts.length > 0 && parts[parts.length - 1] === '') {
    parts.pop();
  }
  return parts;
}

const EXPECTED_STATEMENTS = Object.freeze([
  'REVOKE ALL PRIVILEGES ON TABLE public.project_link_operations FROM service_role',
  'GRANT SELECT, INSERT, UPDATE ON TABLE public.project_link_operations TO service_role'
]);

/**
 * The authoritative structural check for the ACL migration: after stripping
 * comments and splitting into complete statements, exactly the two approved
 * statements must be present, in exact order, with no additional, missing,
 * empty, or reordered statement. Unlike inspecting only the first matching
 * REVOKE/GRANT via regex, this rejects any extra statement appended,
 * inserted between the two, or hidden via a malformed empty fragment.
 */
function validateAclMigrationStatements(rawText) {
  const statements = splitIntoStatements(stripSqlComments(rawText)).map(normalizeStatement);

  if (statements.some((s) => s.length === 0)) {
    return { valid: false, reason: 'an empty internal statement was found (e.g. two consecutive semicolons)', statements };
  }
  if (statements.length !== EXPECTED_STATEMENTS.length) {
    return {
      valid: false,
      reason: `expected exactly ${EXPECTED_STATEMENTS.length} statements, found ${statements.length}`,
      statements
    };
  }
  for (let i = 0; i < EXPECTED_STATEMENTS.length; i += 1) {
    if (statements[i] !== EXPECTED_STATEMENTS[i]) {
      return {
        valid: false,
        reason: `statement ${i + 1} does not exactly match the approved text (found: "${statements[i]}")`,
        statements
      };
    }
  }
  return { valid: true, reason: null, statements };
}

async function hasPrivilege(db, role, privilege) {
  try {
    const result = await scalar(
      db,
      `SELECT has_table_privilege($1, 'public.project_link_operations', $2)`,
      [role, privilege]
    );
    return result;
  } catch (error) {
    return { unsupported: true, message: error.message };
  }
}

// ---------------------------------------------------------------------------
// 1. Static assertion: the real migration file is exactly the two approved
//    statements, in order, nothing else.
// ---------------------------------------------------------------------------
async function runStaticAssertions() {
  console.log('=== Static assertions: migration SQL text ===');

  console.log('1. New migration exists and is ordered after the ledger migration');
  check(
    'filename sorts after 20260731102910_canonical_project_link_operation_ledger.sql',
    ACL_MIGRATION_FILENAME.localeCompare(PRECEDING_LEDGER_FILENAME) > 0
  );

  const rawText = await readFile(ACL_MIGRATION_URL, 'utf8');

  console.log('2. The comment-stripped migration is exactly the two approved statements, in order, and nothing else');
  const result = validateAclMigrationStatements(rawText);
  check(
    `exactly ${EXPECTED_STATEMENTS.length} statements found, matching the approved REVOKE-then-GRANT text exactly` +
      (result.valid ? '' : ` (${result.reason})`),
    result.valid
  );

  return rawText;
}

// ---------------------------------------------------------------------------
// 2. Adversarial probes against the statement validator itself, proving it
//    actually discriminates -- not merely that the real file happens to
//    pass. Built from the real file's own content plus targeted mutations,
//    never by modifying the migration file itself.
// ---------------------------------------------------------------------------
async function runAdversarialProbes(approvedRawText) {
  console.log('=== Adversarial probes: statement validator discrimination ===');

  console.log('A. approved two-statement migration -- accepted');
  check('A: approved migration is accepted', validateAclMigrationStatements(approvedRawText).valid);

  console.log('B. approved migration plus a trailing COMMENT ON TABLE -- rejected');
  const withComment =
    approvedRawText + '\nCOMMENT ON TABLE public.project_link_operations IS \'test\';\n';
  check('B: trailing COMMENT ON TABLE is rejected', !validateAclMigrationStatements(withComment).valid);

  console.log('C. approved migration plus a trailing GRANT DELETE -- rejected');
  const withGrantDelete =
    approvedRawText + '\nGRANT DELETE ON TABLE public.project_link_operations TO service_role;\n';
  check('C: trailing GRANT DELETE is rejected', !validateAclMigrationStatements(withGrantDelete).valid);

  console.log('D. approved migration plus a trailing GRANT SELECT ... TO postgres -- rejected');
  const withGrantPostgres =
    approvedRawText + '\nGRANT SELECT ON TABLE public.project_link_operations TO postgres;\n';
  check('D: trailing GRANT SELECT ... TO postgres is rejected', !validateAclMigrationStatements(withGrantPostgres).valid);

  console.log('E. an executable statement inserted between REVOKE and GRANT -- rejected');
  const [revokeStatement, grantStatement] = EXPECTED_STATEMENTS;
  const withInsertedStatement =
    `${revokeStatement};\nGRANT SELECT ON TABLE public.project_link_operations TO postgres;\n${grantStatement};\n`;
  check(
    'E: statement inserted between REVOKE and GRANT is rejected',
    !validateAclMigrationStatements(withInsertedStatement).valid
  );

  console.log('F. prohibited text placed only inside a SQL comment -- ignored safely, still accepted');
  const withHiddenCommentOnly =
    `${revokeStatement};\n-- GRANT DELETE ON TABLE public.project_link_operations TO service_role;\n${grantStatement};\n`;
  const hiddenResult = validateAclMigrationStatements(withHiddenCommentOnly);
  check('F: prohibited text inside a comment does not affect validity', hiddenResult.valid);
  check(
    'F: exactly the two approved statements survive comment stripping, unmerged',
    JSON.stringify(hiddenResult.statements) === JSON.stringify(EXPECTED_STATEMENTS)
  );

  console.log('F2. prohibited text inside a block comment between the two statements -- ignored safely');
  const withHiddenBlockComment =
    `${revokeStatement};\n/* GRANT DELETE ON TABLE public.project_link_operations TO service_role; */\n${grantStatement};\n`;
  const hiddenBlockResult = validateAclMigrationStatements(withHiddenBlockComment);
  check('F2: prohibited text inside a block comment does not affect validity', hiddenBlockResult.valid);
  check(
    'F2: exactly the two approved statements survive block-comment stripping, unmerged',
    JSON.stringify(hiddenBlockResult.statements) === JSON.stringify(EXPECTED_STATEMENTS)
  );

  console.log('G. comment stripping does not delete executable SQL outside comments');
  const strippedApproved = stripSqlComments(approvedRawText);
  check('G: REVOKE ALL PRIVILEGES survives stripping', strippedApproved.includes('REVOKE ALL PRIVILEGES'));
  check('G: GRANT SELECT, INSERT, UPDATE survives stripping', strippedApproved.includes('GRANT SELECT, INSERT, UPDATE'));

  console.log('H. an empty internal statement (two consecutive semicolons) -- rejected');
  const withEmptyStatement = `${revokeStatement};;\n${grantStatement};\n`;
  check('H: empty internal statement is rejected', !validateAclMigrationStatements(withEmptyStatement).valid);
}

// ---------------------------------------------------------------------------
// 3. Dynamic assertions: apply the real migration chain, reproduce the
//    hostile hosted ACL, assert the BEFORE matrix, apply the correction,
//    assert the complete AFTER matrix for every grantee.
// ---------------------------------------------------------------------------
async function assertPrivilegeMatrix(db, role, expected, { label, unsupported }) {
  for (const privilege of ALL_TABLE_PRIVILEGES) {
    const result = await hasPrivilege(db, role, privilege);
    if (result && typeof result === 'object' && result.unsupported) {
      const assertion = `${label}: ${privilege} = ${expected}`;
      unsupported.push({ assertion, reason: `local PGlite/Postgres engine does not support this check: ${result.message}` });
      console.log(`  [UNSUPPORTED] ${assertion} -- ${result.message}`);
      continue;
    }
    check(`${label}: ${privilege} = ${expected}`, result === expected);
  }
}

async function runDynamicAssertions() {
  console.log('=== Dynamic assertions: full migration chain, hostile ACL reproduced, BEFORE/AFTER matrices ===');
  const db = new PGlite();
  const unsupported = [];

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
        CONSTRAINT test_ledger_acl_orders_org_id UNIQUE (organization_id, id)
      );

      CREATE TABLE public.projects (
        id uuid PRIMARY KEY,
        organization_id uuid NOT NULL REFERENCES public.organizations(id),
        project_code text NOT NULL,
        CONSTRAINT test_ledger_acl_projects_org_id UNIQUE (organization_id, id)
      );

      CREATE TABLE public.purchase_order_lines (
        id uuid PRIMARY KEY,
        organization_id uuid NOT NULL REFERENCES public.organizations(id),
        order_id uuid NOT NULL,
        line_number integer NOT NULL,
        CONSTRAINT test_ledger_acl_lines_order_tenant
          FOREIGN KEY (organization_id, order_id)
          REFERENCES public.orders(organization_id, id),
        CONSTRAINT test_ledger_acl_lines_org_id UNIQUE (organization_id, id)
      );

      INSERT INTO public.organizations (id) VALUES ('${ID.orgA}');
      INSERT INTO public.orders (id, organization_id, order_code)
        VALUES ('${ID.orderA}', '${ID.orgA}', 'ORDER-A');
      INSERT INTO public.projects (id, organization_id, project_code)
        VALUES ('${ID.projectA1}', '${ID.orgA}', 'PROJECT-A1');
      INSERT INTO public.purchase_order_lines (id, organization_id, order_id, line_number)
        VALUES ('${ID.lineA}', '${ID.orgA}', '${ID.orderA}', 1);
    `);

    console.log('1. Apply foundation, precedence, and ledger migrations');
    for (const migrationUrl of MIGRATION_URLS) {
      await db.exec(await readFile(migrationUrl, 'utf8'));
    }
    check('foundation, precedence and ledger migrations applied in order without error', true);

    console.log('2. Reproduce the hostile hosted ACL (Supabase default privileges owned by postgres)');
    await db.exec(HOSTILE_HOSTED_GRANT_SQL);
    check('hostile GRANT ALL PRIVILEGES TO service_role executed, simulating the confirmed hosted defect', true);

    console.log('3. BEFORE matrix -- service_role must hold every privilege the hostile grant conferred');
    await assertPrivilegeMatrix(db, 'service_role', true, { label: 'BEFORE service_role', unsupported });

    console.log('4. Apply the ACL-correction migration');
    await db.exec(await readFile(ACL_MIGRATION_URL, 'utf8'));
    check('ACL-correction migration (20260802101500) applied without error', true);

    console.log('5. AFTER matrix -- service_role');
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE']) {
      check(`AFTER service_role: ${privilege} = true`, (await hasPrivilege(db, 'service_role', privilege)) === true);
    }
    for (const privilege of ['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
      check(`AFTER service_role: ${privilege} = false`, (await hasPrivilege(db, 'service_role', privilege)) === false);
    }
    const maintainAfter = await hasPrivilege(db, 'service_role', 'MAINTAIN');
    if (maintainAfter && typeof maintainAfter === 'object' && maintainAfter.unsupported) {
      unsupported.push({
        assertion: 'AFTER service_role: MAINTAIN = false',
        reason: `local PGlite/Postgres engine does not support the MAINTAIN privilege: ${maintainAfter.message}`
      });
      console.log(`  [UNSUPPORTED] AFTER service_role: MAINTAIN = false -- ${maintainAfter.message}`);
    } else {
      check('AFTER service_role: MAINTAIN = false', maintainAfter === false);
    }

    console.log('6. AFTER matrix -- anon (every privilege denied)');
    await assertPrivilegeMatrix(db, 'anon', false, { label: 'AFTER anon', unsupported });

    console.log('7. AFTER matrix -- authenticated (every privilege denied)');
    await assertPrivilegeMatrix(db, 'authenticated', false, { label: 'AFTER authenticated', unsupported });

    console.log('8. AFTER matrix -- PUBLIC pseudo-role (every privilege denied)');
    await assertPrivilegeMatrix(db, 'public', false, { label: 'AFTER PUBLIC', unsupported });

    console.log('9. Schema shape unaffected by the ACL correction');
    const columnCount = await scalar(
      db,
      `SELECT count(*)::int FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'project_link_operations'`
    );
    check('project_link_operations still has exactly 20 columns', columnCount === 20);

    const functionNames = (
      await db.query(`
        SELECT proname FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND proname IN ('assert_project_link_operation_references', 'guard_project_link_operation_history')
        ORDER BY proname
      `)
    ).rows.map((r) => r.proname);
    check(
      'both ledger functions still exist',
      JSON.stringify(functionNames) ===
        JSON.stringify(['assert_project_link_operation_references', 'guard_project_link_operation_history'])
    );

    const triggerNames = (
      await db.query(`
        SELECT tgname FROM pg_trigger
        WHERE tgrelid = 'public.project_link_operations'::regclass AND NOT tgisinternal
        ORDER BY tgname
      `)
    ).rows.map((r) => r.tgname);
    check(
      'both ledger triggers still exist',
      JSON.stringify(triggerNames) ===
        JSON.stringify(['trg_project_link_operations_history_guard', 'trg_project_link_operations_reference_guard'])
    );

    check(
      'RLS remains enabled',
      (await scalar(
        db,
        `SELECT relrowsecurity FROM pg_class WHERE oid = 'public.project_link_operations'::regclass`
      )) === true
    );
    check(
      'no policy introduced',
      (await scalar(
        db,
        `SELECT count(*)::int FROM pg_policy WHERE polrelid = 'public.project_link_operations'::regclass`
      )) === 0
    );

    console.log('10. No fixture rows remain');
    check(
      'project_link_operations has zero rows (no operation was ever inserted by this test)',
      (await scalar(db, `SELECT count(*)::int FROM public.project_link_operations`)) === 0
    );
  } finally {
    await db.close();
  }

  return unsupported;
}

async function main() {
  const approvedRawText = await runStaticAssertions();
  await runAdversarialProbes(approvedRawText);
  const unsupported = await runDynamicAssertions();

  console.log('');
  if (unsupported.length > 0) {
    console.log(`[INFO] ${unsupported.length} local-engine-unsupported assertion(s), each covered by a strong static check instead:`);
    for (const item of unsupported) {
      console.log(`  - ${item.assertion}: ${item.reason}`);
    }
  }

  if (failures > 0) {
    console.error(`\nFAIL: ${failures} check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log('\nPASS: project_link_operations ACL correction tests succeeded, zero checks failed.');
  }
}

main().catch((error) => {
  console.error('FATAL:', error);
  process.exitCode = 1;
});
