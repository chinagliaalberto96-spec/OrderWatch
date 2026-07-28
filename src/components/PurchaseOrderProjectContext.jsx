import React from 'react';

const STATUS = Object.freeze({
  NOT_EVALUATED: 'PROCUREMENT_CONTEXT_NOT_EVALUATED',
  CONFIRMED: 'PROJECT_LINK_CONFIRMED',
  CODE_ONLY_UNVERIFIED: 'PROJECT_CODE_OBSERVED_UNVERIFIED',
  UNKNOWN_PROJECT: 'PROJECT_LINK_UNKNOWN_PROJECT',
  CROSS_TENANT_INVALID: 'PROJECT_LINK_CROSS_TENANT_INVALID',
  CONFLICT: 'PROJECT_LINK_CONFLICT',
  MULTI_PROJECT: 'MULTI_PROJECT_ORDER'
});

const ORIGIN = Object.freeze({
  EXPLICIT_LINE: 'EXPLICIT_LINE',
  INHERITED_ORDER: 'INHERITED_ORDER'
});

function ProjectName({ project }) {
  if (!project) return null;
  return (
    <span>
      <strong>{project.projectCode || 'Codice non disponibile'}</strong>
      {project.name ? ` · ${project.name}` : ''}
    </span>
  );
}

function statusCopy(status) {
  switch (status) {
    case STATUS.NOT_EVALUATED:
      return 'Contesto commessa non ancora valutato.';
    case STATUS.CODE_ONLY_UNVERIFIED:
      return 'È presente soltanto un codice commessa osservato, non verificato.';
    case STATUS.UNKNOWN_PROJECT:
    case STATUS.CROSS_TENANT_INVALID:
      return 'Il riferimento commessa memorizzato non è disponibile nel perimetro aziendale.';
    case STATUS.CONFLICT:
      return 'I riferimenti commessa memorizzati non sono coerenti tra loro.';
    case STATUS.MULTI_PROJECT:
      return 'Le righe dell’ordine fanno riferimento a più commesse.';
    case STATUS.CONFIRMED:
      return 'Il riferimento commessa esistente è stato verificato nel perimetro aziendale.';
    default:
      return 'Contesto commessa non disponibile.';
  }
}

export function LineProjectContext({ context }) {
  if (!context) {
    return <span className="text-xs text-[color:var(--color-text-muted)]">Non valutata</span>;
  }

  if (context.effectiveProject) {
    const originLabel = context.assignmentOrigin === ORIGIN.EXPLICIT_LINE
      ? 'Esplicita'
      : context.assignmentOrigin === ORIGIN.INHERITED_ORDER
        ? 'Ereditata dall’ordine'
        : null;
    return (
      <span className="block min-w-36">
        <span className="block text-xs"><ProjectName project={context.effectiveProject} /></span>
        {originLabel ? (
          <span className="mt-0.5 block text-[11px] text-[color:var(--color-text-muted)]">
            {originLabel}
          </span>
        ) : null}
      </span>
    );
  }

  if (context.evaluationStatus === STATUS.CODE_ONLY_UNVERIFIED) {
    return (
      <span className="block min-w-36 text-xs">
        <span className="block">{context.observedProjectCode || 'Codice osservato'}</span>
        <span className="text-[11px] text-[color:var(--color-text-muted)]">Non verificata</span>
      </span>
    );
  }

  if (context.evaluationStatus === STATUS.CONFLICT) {
    return <span className="text-xs text-[color:var(--color-warning)]">Riferimenti in conflitto</span>;
  }

  if (
    context.evaluationStatus === STATUS.UNKNOWN_PROJECT
    || context.evaluationStatus === STATUS.CROSS_TENANT_INVALID
  ) {
    return <span className="text-xs text-[color:var(--color-text-muted)]">Riferimento non disponibile</span>;
  }

  return <span className="text-xs text-[color:var(--color-text-muted)]">Non valutata</span>;
}

export default function PurchaseOrderProjectContext({ projectContext }) {
  if (!projectContext) {
    return (
      <section aria-labelledby="ooview-project-context">
        <h3 id="ooview-project-context" className="text-sm font-semibold">Contesto commessa</h3>
        <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">
          Contesto commessa non disponibile.
        </p>
      </section>
    );
  }

  const status = projectContext.evaluationStatus;
  const effectiveProjects = Array.isArray(projectContext.effectiveProjectSummary?.projects)
    ? projectContext.effectiveProjectSummary.projects
    : [];
  const confirmedOrderProject = projectContext.orderReference?.resolvedProject || null;
  const displayedProjects = effectiveProjects.length
    ? effectiveProjects
    : status === STATUS.CONFIRMED && confirmedOrderProject
      ? [confirmedOrderProject]
      : [];
  const observedCode = projectContext.orderReference?.observedProjectCode || null;

  return (
    <section aria-labelledby="ooview-project-context">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="ooview-project-context" className="text-sm font-semibold">Contesto commessa</h3>
        {status === STATUS.MULTI_PROJECT ? (
          <span className="text-xs font-semibold">Ordine multi-commessa</span>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-[color:var(--color-text-muted)]">{statusCopy(status)}</p>

      {displayedProjects.length > 0 ? (
        <ul className="mt-2 divide-y text-sm" style={{ borderColor: 'var(--color-border)' }}>
          {displayedProjects.map((project) => (
            <li key={`${project.projectCode || ''}:${project.name || ''}`} className="py-1.5">
              <ProjectName project={project} />
              {project.status ? (
                <span className="ml-2 text-xs text-[color:var(--color-text-muted)]">{project.status}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {status === STATUS.CODE_ONLY_UNVERIFIED && observedCode ? (
        <div className="mt-2 text-sm">
          Riferimento osservato: <strong>{observedCode}</strong>
          <span className="ml-2 text-xs text-[color:var(--color-text-muted)]">Non verificato</span>
        </div>
      ) : null}

      {status === STATUS.CONFLICT && confirmedOrderProject ? (
        <div className="mt-2 text-sm">
          Riferimento strutturato: <ProjectName project={confirmedOrderProject} />
          {observedCode ? <span className="block text-xs text-[color:var(--color-text-muted)]">Codice osservato: {observedCode}</span> : null}
        </div>
      ) : null}
    </section>
  );
}
