export const PROJECT_CONTEXT_STATUS = Object.freeze({
  NOT_EVALUATED: "PROCUREMENT_CONTEXT_NOT_EVALUATED",
  CONFIRMED: "PROJECT_LINK_CONFIRMED",
  CODE_ONLY_UNVERIFIED: "PROJECT_CODE_OBSERVED_UNVERIFIED",
  UNKNOWN_PROJECT: "PROJECT_LINK_UNKNOWN_PROJECT",
  CROSS_TENANT_INVALID: "PROJECT_LINK_CROSS_TENANT_INVALID",
  CONFLICT: "PROJECT_LINK_CONFLICT",
  MULTI_PROJECT: "MULTI_PROJECT_ORDER"
});

export const PROJECT_ASSIGNMENT_ORIGIN = Object.freeze({
  EXPLICIT_LINE: "EXPLICIT_LINE",
  INHERITED_ORDER: "INHERITED_ORDER",
  NONE: "NONE"
});

export const PROJECT_PROJECTION_STATUS = Object.freeze({
  NO_PROJECT: "NO_PROJECT",
  SINGLE_PROJECT: "SINGLE_PROJECT",
  MULTI_PROJECT_ORDER: "MULTI_PROJECT_ORDER"
});

export const PROJECT_CODE_CONSISTENCY = Object.freeze({
  NOT_OBSERVED: "PROJECT_CODE_NOT_OBSERVED",
  CONSISTENT: "PROJECT_CODE_CONSISTENT",
  CONFLICT: "PROJECT_CODE_CONFLICT",
  NOT_APPLICABLE: "PROJECT_CODE_NOT_APPLICABLE"
});

function stableString(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function observedCode(value) {
  if (typeof value !== "string") return null;
  return value.trim() ? value : null;
}

function safeProject(project) {
  if (!project) return null;
  return {
    projectCode: observedCode(project.project_code) || null,
    name: stableString(project.name) || null,
    status: stableString(project.status) || null
  };
}

function compareSafeProjects(left, right) {
  return String(left.projectCode || "").localeCompare(String(right.projectCode || ""))
    || String(left.name || "").localeCompare(String(right.name || ""))
    || String(left.status || "").localeCompare(String(right.status || ""));
}

function evaluateReference({
  organizationId,
  projectId,
  projectCode,
  projectRowsById
}) {
  const normalizedProjectId = stableString(projectId);
  const rawObservedCode = observedCode(projectCode);
  const invalidObservedCodeType = projectCode !== null
    && projectCode !== undefined
    && typeof projectCode !== "string";

  if (!normalizedProjectId) {
    return rawObservedCode
      ? {
          evaluationStatus: PROJECT_CONTEXT_STATUS.CODE_ONLY_UNVERIFIED,
          observedProjectCode: rawObservedCode,
          codeConsistency: PROJECT_CODE_CONSISTENCY.NOT_APPLICABLE,
          resolvedProject: null,
          effectiveProjectId: null,
          hasConflict: false
        }
      : {
          evaluationStatus: PROJECT_CONTEXT_STATUS.NOT_EVALUATED,
          observedProjectCode: null,
          codeConsistency: PROJECT_CODE_CONSISTENCY.NOT_APPLICABLE,
          resolvedProject: null,
          effectiveProjectId: null,
          hasConflict: false
        };
  }

  const project = projectRowsById.get(normalizedProjectId) || null;
  if (!project) {
    return {
      evaluationStatus: PROJECT_CONTEXT_STATUS.UNKNOWN_PROJECT,
      observedProjectCode: rawObservedCode,
      codeConsistency: PROJECT_CODE_CONSISTENCY.NOT_APPLICABLE,
      resolvedProject: null,
      effectiveProjectId: null,
      hasConflict: false
    };
  }

  if (stableString(project.organization_id) !== stableString(organizationId)) {
    return {
      evaluationStatus: PROJECT_CONTEXT_STATUS.CROSS_TENANT_INVALID,
      observedProjectCode: rawObservedCode,
      codeConsistency: PROJECT_CODE_CONSISTENCY.NOT_APPLICABLE,
      resolvedProject: null,
      effectiveProjectId: null,
      hasConflict: false
    };
  }

  const resolvedProject = safeProject(project);
  if (
    invalidObservedCodeType
    || (rawObservedCode !== null && rawObservedCode !== resolvedProject.projectCode)
  ) {
    return {
      evaluationStatus: PROJECT_CONTEXT_STATUS.CONFLICT,
      observedProjectCode: rawObservedCode,
      codeConsistency: PROJECT_CODE_CONSISTENCY.CONFLICT,
      resolvedProject,
      effectiveProjectId: null,
      hasConflict: true
    };
  }

  return {
    evaluationStatus: PROJECT_CONTEXT_STATUS.CONFIRMED,
    observedProjectCode: rawObservedCode,
    codeConsistency: rawObservedCode === null
      ? PROJECT_CODE_CONSISTENCY.NOT_OBSERVED
      : PROJECT_CODE_CONSISTENCY.CONSISTENT,
    resolvedProject,
    effectiveProjectId: normalizedProjectId,
    hasConflict: false
  };
}

function publicReference(reference) {
  return {
    evaluationStatus: reference.evaluationStatus,
    observedProjectCode: reference.observedProjectCode,
    codeConsistency: reference.codeConsistency,
    resolvedProject: reference.resolvedProject,
    hasConflict: reference.hasConflict
  };
}

function effectiveProject(projectId, projectRowsById) {
  return safeProject(projectRowsById.get(projectId) || null);
}

function deriveOverallStatus(orderReference, lineContexts, projectionStatus) {
  const statuses = [
    orderReference.evaluationStatus,
    ...lineContexts.map((line) => line.evaluationStatus)
  ];

  if (statuses.includes(PROJECT_CONTEXT_STATUS.CONFLICT)) {
    return PROJECT_CONTEXT_STATUS.CONFLICT;
  }
  if (statuses.includes(PROJECT_CONTEXT_STATUS.CROSS_TENANT_INVALID)) {
    return PROJECT_CONTEXT_STATUS.CROSS_TENANT_INVALID;
  }
  if (statuses.includes(PROJECT_CONTEXT_STATUS.UNKNOWN_PROJECT)) {
    return PROJECT_CONTEXT_STATUS.UNKNOWN_PROJECT;
  }
  if (projectionStatus === PROJECT_PROJECTION_STATUS.MULTI_PROJECT_ORDER) {
    return PROJECT_CONTEXT_STATUS.MULTI_PROJECT;
  }
  if (
    orderReference.evaluationStatus === PROJECT_CONTEXT_STATUS.CONFIRMED
    || lineContexts.some((line) => line.effectiveProject)
  ) {
    return PROJECT_CONTEXT_STATUS.CONFIRMED;
  }
  if (statuses.includes(PROJECT_CONTEXT_STATUS.CODE_ONLY_UNVERIFIED)) {
    return PROJECT_CONTEXT_STATUS.CODE_ONLY_UNVERIFIED;
  }
  return PROJECT_CONTEXT_STATUS.NOT_EVALUATED;
}

export function buildPurchaseOrderProjectContext({
  organizationId,
  orderReference = {},
  lines = [],
  projects = []
}) {
  const tenantId = stableString(organizationId);
  const projectRowsById = new Map();
  for (const project of Array.isArray(projects) ? projects : []) {
    const id = stableString(project?.id);
    if (id && !projectRowsById.has(id)) projectRowsById.set(id, project);
  }

  const evaluatedOrderReference = evaluateReference({
    organizationId: tenantId,
    projectId: orderReference?.projectId,
    projectCode: orderReference?.projectCode,
    projectRowsById
  });

  const lineContexts = (Array.isArray(lines) ? lines : []).map((line) => {
    const lineHasObservedReference = Boolean(
      stableString(line?.projectId) || observedCode(line?.projectCode)
    );
    const explicitReference = evaluateReference({
      organizationId: tenantId,
      projectId: line?.projectId,
      projectCode: line?.projectCode,
      projectRowsById
    });

    if (lineHasObservedReference) {
      const effective = explicitReference.effectiveProjectId
        ? effectiveProject(explicitReference.effectiveProjectId, projectRowsById)
        : null;
      return {
        ...publicReference(explicitReference),
        _effectiveProjectId: explicitReference.effectiveProjectId,
        assignmentOrigin: effective
          ? PROJECT_ASSIGNMENT_ORIGIN.EXPLICIT_LINE
          : PROJECT_ASSIGNMENT_ORIGIN.NONE,
        explicitProject: explicitReference.resolvedProject,
        inheritedProject: null,
        effectiveProject: effective,
        isInherited: false
      };
    }

    if (evaluatedOrderReference.effectiveProjectId) {
      const inherited = effectiveProject(
        evaluatedOrderReference.effectiveProjectId,
        projectRowsById
      );
      return {
        evaluationStatus: PROJECT_CONTEXT_STATUS.CONFIRMED,
        observedProjectCode: null,
        codeConsistency: PROJECT_CODE_CONSISTENCY.NOT_APPLICABLE,
        resolvedProject: null,
        hasConflict: false,
        _effectiveProjectId: evaluatedOrderReference.effectiveProjectId,
        assignmentOrigin: PROJECT_ASSIGNMENT_ORIGIN.INHERITED_ORDER,
        explicitProject: null,
        inheritedProject: inherited,
        effectiveProject: inherited,
        isInherited: true
      };
    }

    return {
      ...publicReference(explicitReference),
      _effectiveProjectId: null,
      assignmentOrigin: PROJECT_ASSIGNMENT_ORIGIN.NONE,
      explicitProject: null,
      inheritedProject: null,
      effectiveProject: null,
      isInherited: false
    };
  });

  const effectiveProjectsById = new Map();
  for (const line of lineContexts) {
    const project = line.effectiveProject;
    if (!line._effectiveProjectId || !project) continue;
    if (!effectiveProjectsById.has(line._effectiveProjectId)) {
      effectiveProjectsById.set(line._effectiveProjectId, project);
    }
  }
  const effectiveProjects = Array.from(effectiveProjectsById.values()).sort(compareSafeProjects);
  const projectionStatus = effectiveProjects.length === 0
    ? PROJECT_PROJECTION_STATUS.NO_PROJECT
    : effectiveProjects.length === 1
      ? PROJECT_PROJECTION_STATUS.SINGLE_PROJECT
      : PROJECT_PROJECTION_STATUS.MULTI_PROJECT_ORDER;

  const lineSummary = lineContexts.reduce((summary, line) => {
    summary.total += 1;
    if (line.assignmentOrigin === PROJECT_ASSIGNMENT_ORIGIN.EXPLICIT_LINE) summary.explicit += 1;
    else if (line.assignmentOrigin === PROJECT_ASSIGNMENT_ORIGIN.INHERITED_ORDER) summary.inherited += 1;
    else summary.unassigned += 1;
    if (
      line.evaluationStatus === PROJECT_CONTEXT_STATUS.CONFLICT
      || line.evaluationStatus === PROJECT_CONTEXT_STATUS.UNKNOWN_PROJECT
      || line.evaluationStatus === PROJECT_CONTEXT_STATUS.CROSS_TENANT_INVALID
    ) {
      summary.invalid += 1;
    }
    return summary;
  }, { total: 0, explicit: 0, inherited: 0, unassigned: 0, invalid: 0 });

  return {
    projectContext: {
      evaluationStatus: deriveOverallStatus(
        evaluatedOrderReference,
        lineContexts,
        projectionStatus
      ),
      orderReference: publicReference(evaluatedOrderReference),
      effectiveProjectSummary: {
        projectionStatus,
        isMultiProject: projectionStatus === PROJECT_PROJECTION_STATUS.MULTI_PROJECT_ORDER,
        projectCount: effectiveProjects.length,
        projects: effectiveProjects
      },
      lineSummary
    },
    lineContexts: lineContexts.map((lineContext) => {
      const publicLineContext = { ...lineContext };
      delete publicLineContext._effectiveProjectId;
      return publicLineContext;
    })
  };
}
