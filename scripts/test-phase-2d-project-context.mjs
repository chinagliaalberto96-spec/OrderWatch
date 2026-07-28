import assert from 'node:assert/strict';
import {
  PROJECT_ASSIGNMENT_ORIGIN,
  PROJECT_CODE_CONSISTENCY,
  PROJECT_CONTEXT_STATUS,
  PROJECT_PROJECTION_STATUS,
  buildPurchaseOrderProjectContext
} from '../server/lib/purchaseOrderProjectContext.js';
import { buildPurchaseOrderOperationalSuggestions } from '../src/utils/purchaseOrderOperationalSuggestions.js';

const PROJECT_A = {
  id: 'project-a-private-id',
  organization_id: 'org-a',
  project_code: 'PRJ-A',
  name: 'Commessa Alpha',
  status: 'Aperto'
};
const PROJECT_B = {
  id: 'project-b-private-id',
  organization_id: 'org-a',
  project_code: 'PRJ-B',
  name: 'Commessa Beta',
  status: 'Aperto'
};

function build(overrides = {}) {
  return buildPurchaseOrderProjectContext({
    organizationId: 'org-a',
    orderReference: {},
    lines: [],
    projects: [PROJECT_A, PROJECT_B],
    ...overrides
  });
}

function serialized(value) {
  return JSON.stringify(value);
}

console.log('Phase 2D.1A: purchase-order project context');

{
  const result = build();
  assert.equal(result.projectContext.evaluationStatus, PROJECT_CONTEXT_STATUS.NOT_EVALUATED);
  assert.equal(
    result.projectContext.effectiveProjectSummary.projectionStatus,
    PROJECT_PROJECTION_STATUS.NO_PROJECT
  );
}

{
  const result = build({ orderReference: { projectId: PROJECT_A.id, projectCode: 'PRJ-A' } });
  assert.equal(result.projectContext.evaluationStatus, PROJECT_CONTEXT_STATUS.CONFIRMED);
  assert.equal(result.projectContext.orderReference.codeConsistency, PROJECT_CODE_CONSISTENCY.CONSISTENT);
  assert.deepEqual(result.projectContext.orderReference.resolvedProject, {
    projectCode: 'PRJ-A',
    name: 'Commessa Alpha',
    status: 'Aperto'
  });
}

{
  const result = build({ orderReference: { projectId: PROJECT_A.id } });
  assert.equal(result.projectContext.evaluationStatus, PROJECT_CONTEXT_STATUS.CONFIRMED);
  assert.equal(result.projectContext.orderReference.codeConsistency, PROJECT_CODE_CONSISTENCY.NOT_OBSERVED);
  assert.equal(result.projectContext.orderReference.observedProjectCode, null);
}

{
  const result = build({ orderReference: { projectId: PROJECT_A.id, projectCode: 'PRJ-B' } });
  assert.equal(result.projectContext.evaluationStatus, PROJECT_CONTEXT_STATUS.CONFLICT);
  assert.equal(result.projectContext.orderReference.codeConsistency, PROJECT_CODE_CONSISTENCY.CONFLICT);
  assert.equal(result.projectContext.effectiveProjectSummary.projectCount, 0);
}

{
  const result = build({ orderReference: { projectId: PROJECT_A.id, projectCode: 'prj-a' } });
  assert.equal(result.projectContext.evaluationStatus, PROJECT_CONTEXT_STATUS.CONFLICT);
  assert.equal(result.projectContext.effectiveProjectSummary.projectCount, 0);
}

{
  const exactProject = { ...PROJECT_A, project_code: 'PRJ-001/A' };
  const exact = build({
    orderReference: { projectId: exactProject.id, projectCode: 'PRJ-001/A' },
    projects: [exactProject]
  });
  assert.equal(exact.projectContext.evaluationStatus, PROJECT_CONTEXT_STATUS.CONFIRMED);

  for (const nonExactCode of ['PRJ-1/A', 'PRJ-001-A', 'prj-001/a', 1]) {
    const result = build({
      orderReference: { projectId: exactProject.id, projectCode: nonExactCode },
      projects: [exactProject]
    });
    assert.equal(result.projectContext.evaluationStatus, PROJECT_CONTEXT_STATUS.CONFLICT);
    assert.equal(result.projectContext.effectiveProjectSummary.projectCount, 0);
  }
}

{
  const result = build({ orderReference: { projectId: 'unknown-project', projectCode: 'PRJ-A' } });
  assert.equal(result.projectContext.evaluationStatus, PROJECT_CONTEXT_STATUS.UNKNOWN_PROJECT);
  assert.equal(result.projectContext.orderReference.resolvedProject, null);
  assert.equal(result.projectContext.effectiveProjectSummary.projectCount, 0);
}

{
  const foreignProject = {
    id: 'foreign-private-id',
    organization_id: 'org-b',
    project_code: 'FOREIGN-1',
    name: 'Foreign secret name',
    status: 'Aperto'
  };
  const result = build({
    orderReference: { projectId: foreignProject.id, projectCode: 'OBSERVED-LOCAL' },
    projects: [PROJECT_A, foreignProject]
  });
  assert.equal(result.projectContext.evaluationStatus, PROJECT_CONTEXT_STATUS.CROSS_TENANT_INVALID);
  assert.equal(result.projectContext.orderReference.resolvedProject, null);
  assert.ok(!serialized(result).includes('Foreign secret name'));
  assert.ok(!serialized(result).includes('FOREIGN-1'));
  assert.ok(serialized(result).includes('OBSERVED-LOCAL'));
}

{
  const result = build({
    orderReference: { projectCode: 'PRJ-A' },
    projects: [PROJECT_A]
  });
  assert.equal(result.projectContext.evaluationStatus, PROJECT_CONTEXT_STATUS.CODE_ONLY_UNVERIFIED);
  assert.equal(result.projectContext.orderReference.resolvedProject, null);
  assert.equal(result.projectContext.effectiveProjectSummary.projectCount, 0);
}

{
  const result = build({
    orderReference: { projectId: PROJECT_A.id, projectCode: 'PRJ-A' },
    lines: [
      { projectId: PROJECT_B.id, projectCode: 'PRJ-B' },
      {}
    ]
  });
  assert.equal(result.lineContexts[0].assignmentOrigin, PROJECT_ASSIGNMENT_ORIGIN.EXPLICIT_LINE);
  assert.equal(result.lineContexts[0].effectiveProject.projectCode, 'PRJ-B');
  assert.equal(result.lineContexts[0].isInherited, false);
  assert.equal(result.lineContexts[1].assignmentOrigin, PROJECT_ASSIGNMENT_ORIGIN.INHERITED_ORDER);
  assert.equal(result.lineContexts[1].effectiveProject.projectCode, 'PRJ-A');
  assert.equal(result.lineContexts[1].isInherited, true);
  assert.equal(result.projectContext.evaluationStatus, PROJECT_CONTEXT_STATUS.MULTI_PROJECT);
}

{
  const result = build({
    orderReference: { projectId: PROJECT_A.id, projectCode: 'PRJ-A' },
    lines: [{ projectCode: 'PRJ-B' }]
  });
  assert.equal(result.lineContexts[0].assignmentOrigin, PROJECT_ASSIGNMENT_ORIGIN.NONE);
  assert.equal(result.lineContexts[0].evaluationStatus, PROJECT_CONTEXT_STATUS.CODE_ONLY_UNVERIFIED);
  assert.equal(result.lineContexts[0].effectiveProject, null);
}

{
  const result = build({
    orderReference: { projectId: PROJECT_A.id, projectCode: 'PRJ-A' },
    lines: [{ projectId: 'unknown-project' }]
  });
  assert.equal(result.lineContexts[0].assignmentOrigin, PROJECT_ASSIGNMENT_ORIGIN.NONE);
  assert.equal(result.lineContexts[0].evaluationStatus, PROJECT_CONTEXT_STATUS.UNKNOWN_PROJECT);
  assert.equal(result.lineContexts[0].effectiveProject, null);
}

{
  const result = build({
    orderReference: { projectId: PROJECT_A.id, projectCode: 'PRJ-A' },
    lines: [{ projectId: PROJECT_B.id, projectCode: 'PRJ-A' }]
  });
  assert.equal(result.lineContexts[0].evaluationStatus, PROJECT_CONTEXT_STATUS.CONFLICT);
  assert.equal(result.lineContexts[0].assignmentOrigin, PROJECT_ASSIGNMENT_ORIGIN.NONE);
  assert.equal(result.lineContexts[0].effectiveProject, null);
  assert.equal(result.projectContext.effectiveProjectSummary.projectCount, 0);
}

{
  const duplicateSameProject = build({
    lines: [
      { projectId: PROJECT_A.id, projectCode: 'PRJ-A' },
      { projectId: PROJECT_A.id, projectCode: 'PRJ-A' }
    ]
  });
  assert.equal(duplicateSameProject.projectContext.effectiveProjectSummary.projectCount, 1);
  assert.equal(
    duplicateSameProject.projectContext.effectiveProjectSummary.projectionStatus,
    PROJECT_PROJECTION_STATUS.SINGLE_PROJECT
  );

  const multi = build({
    lines: [
      { projectId: PROJECT_B.id, projectCode: 'PRJ-B' },
      { projectId: PROJECT_A.id, projectCode: 'PRJ-A' }
    ]
  });
  const reordered = build({
    lines: [
      { projectId: PROJECT_A.id, projectCode: 'PRJ-A' },
      { projectId: PROJECT_B.id, projectCode: 'PRJ-B' }
    ]
  });
  assert.equal(multi.projectContext.evaluationStatus, PROJECT_CONTEXT_STATUS.MULTI_PROJECT);
  assert.deepEqual(
    multi.projectContext.effectiveProjectSummary,
    reordered.projectContext.effectiveProjectSummary
  );
}

{
  const result = build({
    orderReference: { projectId: PROJECT_A.id, projectCode: 'PRJ-A' },
    lines: []
  });
  assert.equal(result.projectContext.evaluationStatus, PROJECT_CONTEXT_STATUS.CONFIRMED);
  assert.equal(result.projectContext.effectiveProjectSummary.projectCount, 0);
}

{
  const result = build({
    orderReference: { projectId: PROJECT_A.id, projectCode: 'PRJ-A' },
    lines: [{}, { projectId: PROJECT_B.id, projectCode: 'PRJ-B' }]
  });
  for (const forbiddenId of [PROJECT_A.id, PROJECT_B.id]) {
    assert.ok(!serialized(result).includes(forbiddenId), `raw project id leaked: ${forbiddenId}`);
  }
}

{
  const data = {
    orderId: 'order-1',
    canonicalMaterialLines: [{
      id: 'line-1',
      description: 'Materiale',
      remainingQuantity: 2,
      dueDate: '2026-01-01'
    }],
    linkedDocuments: [],
    activeCommitments: [],
    activeCommitmentsAvailable: false,
    coverageAndSyncHealth: {}
  };
  const before = buildPurchaseOrderOperationalSuggestions({
    data,
    businessStatus: 'CRITICAL',
    qualityState: { status: 'loaded', data: { dataQualityStatus: 'complete' } }
  });
  const after = buildPurchaseOrderOperationalSuggestions({
    data: { ...data, projectContext: build().projectContext },
    businessStatus: 'CRITICAL',
    qualityState: { status: 'loaded', data: { dataQualityStatus: 'complete' } }
  });
  assert.deepEqual(after, before, 'Phase 2C suggestions must ignore project context');
}

console.log('PASS: Phase 2D.1A project context is deterministic and fail-closed');
