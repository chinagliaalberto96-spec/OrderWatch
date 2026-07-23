// Real-component UI test for OrderOperationalView.
//
// Loads the actual src/components/OrderOperationalView.jsx through Vite's own
// SSR module loader (Vite is already a project dependency and this is its
// documented programmatic API) so the JSX is transformed exactly as it is at
// runtime, without adding a jsdom/testing-library dependency and without
// duplicating any presentation logic in a second hand-written renderer.
//
// Coverage:
//  - pure state machine (orderOperationalViewReducer, isNotFoundError)
//  - real fetch orchestration (loadOrderOperationalView): stale-response and
//    unmount protection, tested by calling the actual function directly
//  - real presentational output (OrderOperationalViewContent), rendered via
//    react-dom/server so every assertion below is against genuine JSX output
//  - OrderDetailPanel's removal of the four legacy fields

import assert from 'assert';
import { readFile } from 'fs/promises';
import { createServer } from 'vite';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';

async function loadRealModules() {
  const server = await createServer({
    server: { middlewareMode: true },
    appType: 'custom'
  });
  const view = await server.ssrLoadModule('/src/components/OrderOperationalView.jsx');
  const panel = await server.ssrLoadModule('/src/components/OrderDetailPanel.jsx');
  const adapter = await server.ssrLoadModule('/src/adapters/apiAdapter.js');
  return { server, view, panel, adapter };
}

// Captures the last fetch() call so tests can inspect exactly what the real
// createApiAdapter/apiFetch sent, without any network access.
function withMockedFetch(responseFactory, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return responseFactory(url, options);
  };
  return Promise.resolve(run(calls)).finally(() => {
    globalThis.fetch = original;
  });
}

function sectionSlice(html, id) {
  const start = html.indexOf(`id="${id}"`);
  assert.notStrictEqual(start, -1, `Section #${id} not found in rendered output`);
  const nextSectionStart = html.indexOf('<section', start + 1);
  return html.slice(start, nextSectionStart === -1 ? html.length : nextSectionStart);
}

async function run() {
  const { server, view, panel, adapter } = await loadRealModules();
  const {
    orderOperationalViewReducer,
    initialOrderOperationalViewState,
    isNotFoundError,
    loadOrderOperationalView,
    OrderOperationalViewContent
  } = view;
  const { createApiAdapter } = adapter;

  try {
    /* ---------------------------------------------------------------- *
     * Authentication propagation — real createApiAdapter/apiFetch code,
     * the exact same shared helper every other protected call uses.
     * ---------------------------------------------------------------- */
    console.log('Test: getOrderOperationalView uses the shared authenticated request path (Authorization forwarded)');
    {
      const FAKE_TOKEN = 'session-token-abc123';
      const api = createApiAdapter(undefined, { getAccessToken: async () => FAKE_TOKEN });
      await withMockedFetch(
        () => ({ ok: true, json: async () => ({ orderId: 'order-1' }) }),
        async (calls) => {
          await api.getOrderOperationalView('order-1');
          assert.strictEqual(calls.length, 1);
          assert.strictEqual(calls[0].url, '/api/order-operational-view?orderId=order-1');
          assert.strictEqual(calls[0].options.headers.Authorization, `Bearer ${FAKE_TOKEN}`);
        }
      );
    }
    console.log('PASS');

    console.log('Test: AbortSignal is forwarded to the underlying fetch');
    {
      const api = createApiAdapter(undefined, { getAccessToken: async () => 'tok' });
      const controller = new AbortController();
      await withMockedFetch(
        () => ({ ok: true, json: async () => ({}) }),
        async (calls) => {
          await api.getOrderOperationalView('order-1', { signal: controller.signal });
          assert.strictEqual(calls[0].options.signal, controller.signal);
        }
      );
    }
    console.log('PASS');

    console.log('Test: HTTP 401 from the real endpoint surfaces as error.status === 401');
    {
      const api = createApiAdapter(undefined, { getAccessToken: async () => 'expired-or-missing-session' });
      await withMockedFetch(
        () => ({ ok: false, status: 401, json: async () => ({ error: 'Sessione mancante. Accedi nuovamente.' }) }),
        async () => {
          let thrown = null;
          try {
            await api.getOrderOperationalView('order-1');
          } catch (e) {
            thrown = e;
          }
          assert.ok(thrown, 'a 401 response must throw');
          assert.strictEqual(thrown.status, 401);
        }
      );
    }
    console.log('PASS');

    console.log('Test: no token/credential leaks into the rendered error UI or console logs');
    {
      const SECRET_TOKEN = 'do-not-leak-this-token-xyz';
      const api = createApiAdapter(undefined, { getAccessToken: async () => SECRET_TOKEN });
      const consoleCalls = [];
      const originalLog = console.log;
      const originalError = console.error;
      const originalWarn = console.warn;
      console.log = (...args) => consoleCalls.push(args.join(' '));
      console.error = (...args) => consoleCalls.push(args.join(' '));
      console.warn = (...args) => consoleCalls.push(args.join(' '));
      try {
        await withMockedFetch(
          () => ({ ok: false, status: 401, json: async () => ({ error: 'Sessione mancante. Accedi nuovamente.' }) }),
          async () => {
            let dispatched;
            const dispatch = (a) => { dispatched = a; };
            await loadOrderOperationalView({
              orderId: 'order-1',
              fetchFn: (orderId, opts) => api.getOrderOperationalView(orderId, opts),
              dispatch,
              tokenRef: { current: 1 },
              myToken: 1
            });
            assert.strictEqual(dispatched.type, 'LOAD_ERROR');
            assert.ok(!dispatched.message.includes(SECRET_TOKEN), 'dispatched error message must not contain the token');
            const html = renderToStaticMarkup(h(OrderOperationalViewContent, { status: 'error', error: dispatched.message, data: null }));
            assert.ok(!html.includes(SECRET_TOKEN), 'rendered error UI must not contain the token');
          }
        );
      } finally {
        console.log = originalLog;
        console.error = originalError;
        console.warn = originalWarn;
      }
      assert.ok(!consoleCalls.some((line) => line.includes(SECRET_TOKEN)), 'no console output must contain the token');
    }
    console.log('PASS');

    console.log('Test: OrderDetailPanel wires the real shared adapter method, not a separate/unauthenticated one');
    {
      // Regression guard for the exact bug that shipped: OrderOperationalView.jsx
      // must not import the bare `apiAdapter` singleton (no getAccessToken) and
      // OrderDetailPanel must forward the authenticated prop through.
      const viewSource = await readFile(new URL('../src/components/OrderOperationalView.jsx', import.meta.url), 'utf8');
      assert.ok(!viewSource.includes("import { apiAdapter"), 'OrderOperationalView must not import the unauthenticated singleton adapter');
      assert.ok(viewSource.includes('fetchOperationalView'), 'OrderOperationalView must accept the authenticated fetch function as a prop');

      const panelSource = await readFile(new URL('../src/components/OrderDetailPanel.jsx', import.meta.url), 'utf8');
      assert.ok(panelSource.includes('fetchOperationalView={onFetchOrderOperationalView}'), 'OrderDetailPanel must forward the authenticated handler, not construct its own client');
    }
    console.log('PASS');

    /* ---------------------------------------------------------------- *
     * 1. Pure reducer — real state machine, no DOM needed
     * ---------------------------------------------------------------- */
    console.log('Test: reducer clears stale data on new load');
    {
      const loaded = orderOperationalViewReducer(initialOrderOperationalViewState, { type: 'LOAD_SUCCESS', data: { orderId: 'order-1' } });
      assert.strictEqual(loaded.data.orderId, 'order-1');
      const started = orderOperationalViewReducer(loaded, { type: 'LOAD_START' });
      assert.strictEqual(started.data, null, 'LOAD_START must clear the previous order data');
      assert.strictEqual(started.loading, true);
    }
    console.log('PASS');

    console.log('Test: isNotFoundError prefers structured status');
    assert.strictEqual(isNotFoundError({ status: 404, message: 'boom' }), true);
    assert.strictEqual(isNotFoundError({ status: 500, message: 'not found in cache' }), false);
    assert.strictEqual(isNotFoundError({ message: 'Order not found' }), true, 'message fallback still works when status is absent');
    console.log('PASS');

    /* ---------------------------------------------------------------- *
     * 18/19. Stale-response and unmount protection — real orchestration fn
     * ---------------------------------------------------------------- */
    console.log('Test: stale response cannot overwrite a newer selected order');
    {
      const dispatched = [];
      const dispatch = (action) => dispatched.push(action);
      const tokenRef = { current: 1 };
      let resolveFirst;
      const firstFetch = () => new Promise((resolve) => { resolveFirst = resolve; });
      const firstLoad = loadOrderOperationalView({ orderId: 'order-1', fetchFn: firstFetch, dispatch, tokenRef, myToken: 1 });
      // A newer order is selected before the first request resolves.
      tokenRef.current = 2;
      resolveFirst({ orderId: 'order-1', stale: true });
      await firstLoad;
      assert.strictEqual(dispatched.length, 0, 'stale resolution must not dispatch');
    }
    console.log('PASS');

    console.log('Test: unmount (AbortError) is ignored, not surfaced as an error');
    {
      const dispatched = [];
      const dispatch = (action) => dispatched.push(action);
      const tokenRef = { current: 1 };
      const abortErr = new Error('aborted');
      abortErr.name = 'AbortError';
      const fetchFn = () => Promise.reject(abortErr);
      await loadOrderOperationalView({ orderId: 'order-1', fetchFn, dispatch, tokenRef, myToken: 1 });
      assert.strictEqual(dispatched.length, 0, 'an AbortError must never reach LOAD_ERROR');
    }
    console.log('PASS');

    console.log('Test: a real failure after unmount is dropped by the token check');
    {
      const dispatched = [];
      const dispatch = (action) => dispatched.push(action);
      const tokenRef = { current: 2 }; // unmount already bumped the token
      const fetchFn = () => Promise.reject(new Error('network down'));
      await loadOrderOperationalView({ orderId: 'order-1', fetchFn, dispatch, tokenRef, myToken: 1 });
      assert.strictEqual(dispatched.length, 0);
    }
    console.log('PASS');

    console.log('Test: a genuine current failure is classified correctly (404 vs generic)');
    {
      let dispatched;
      const dispatch = (a) => { dispatched = a; };
      const tokenRef = { current: 1 };
      const notFoundErr = new Error('Order not found');
      notFoundErr.status = 404;
      await loadOrderOperationalView({ orderId: 'order-1', fetchFn: () => Promise.reject(notFoundErr), dispatch, tokenRef, myToken: 1 });
      assert.strictEqual(dispatched.type, 'LOAD_NOT_FOUND');

      const genericErr = new Error('Server exploded');
      genericErr.status = 500;
      await loadOrderOperationalView({ orderId: 'order-1', fetchFn: () => Promise.reject(genericErr), dispatch, tokenRef, myToken: 1 });
      assert.strictEqual(dispatched.type, 'LOAD_ERROR');
      assert.strictEqual(dispatched.message, 'Server exploded');
    }
    console.log('PASS');

    /* ---------------------------------------------------------------- *
     * 1-4. Loading / success / 404 / generic error — real JSX render
     * ---------------------------------------------------------------- */
    console.log('Test: loading state is announced via role=status/aria-live');
    {
      const html = renderToStaticMarkup(h(OrderOperationalViewContent, { status: 'loading', error: null, data: null }));
      assert.ok(html.includes('role="status"'));
      assert.ok(html.includes('aria-live="polite"'));
    }
    console.log('PASS');

    console.log('Test: 404 state is reachable and distinct from generic error');
    {
      const html = renderToStaticMarkup(h(OrderOperationalViewContent, { status: 'not-found', error: null, data: null }));
      assert.ok(html.includes('non disponibile per questo ordine'));
      assert.ok(!html.includes('role="alert"'));
    }
    console.log('PASS');

    console.log('Test: generic error uses role=alert');
    {
      const html = renderToStaticMarkup(h(OrderOperationalViewContent, { status: 'error', error: 'Errore di rete', data: null }));
      assert.ok(html.includes('role="alert"'));
      assert.ok(html.includes('Errore di rete'));
    }
    console.log('PASS');

    /* ---------------------------------------------------------------- *
     * Full success payload used by most remaining checks
     * ---------------------------------------------------------------- */
    const baseData = {
      orderId: 'order-1',
      orderNumber: 'PO-1',
      summary: { material: undefined }, // 5. missing scalar
      currentObservedSituation: { severity: 'ok', asOf: null },
      resolvedSupplierOrganization: { legalName: 'ACME Srl' },
      resolvedSupplierContact: null, // 6. must not be inferred from the org
      canonicalMaterialLines: [
        { id: 'line-1', description: 'Item A', quantity: 10, status: 'open', provenanceRefs: ['E1'] },
        { id: 'line-2', description: 'Item B', quantity: 5, status: 'open', provenanceRefs: ['E2', 'E9'] } // E9 = dangling
      ],
      evidenceReferences: [
        { ref: 'E1', kind: 'line_source', sourceEmailId: 'se-1' },
        { ref: 'E2', kind: 'line_source', sourceEmailId: 'se-1' } // same source email as E1, distinct ref
      ],
      safeEvidenceExcerpts: [
        { ref: 'E1', excerpt: '{"description":"<b>hostile</b>"}' } // 15. must render as inert text
      ],
      linkedDocuments: [],
      anomaliesAndAttention: [],
      unresolvedEvidence: [],
      unresolvedEvidenceAvailable: false, // 7
      ambiguousEvidence: [{ id: 'amb-1', reason: 'Due ordini candidati' }],
      ambiguousEvidenceAvailable: true, // 10 populated
      activeCommitments: [],
      activeCommitmentsAvailable: true, // 11 evaluated-empty
      supersededCommitments: [{ id: 'c-1', description: 'Consegna 2024-01-01 superata' }],
      supersededCommitmentsAvailable: true, // 11 populated
      coverageAndSyncHealth: {
        inboundEmail: { status: 'available', message: 'quiet ok' }, // observed & quiet
        attachments: { status: 'partial', message: 'incomplete', limitation: 'parziale' }, // incomplete
        operationalLinking: null // unwatched/unavailable
      },
      // 16. hostile/unknown top-level fields that must never be rendered
      rawBody: '<script>alert(1)</script>',
      headers: { authorization: 'Bearer super-secret-token' }
    };

    console.log('Test: missing scalar values render as "Non disponibile", no crash');
    {
      const html = renderToStaticMarkup(h(OrderOperationalViewContent, { status: 'loaded', error: null, data: baseData }));
      assert.ok(html.includes('Non disponibile'));
    }
    console.log('PASS');

    console.log('Test: organization and contact rendered separately, contact not inferred');
    {
      const html = renderToStaticMarkup(h(OrderOperationalViewContent, { status: 'loaded', error: null, data: baseData }));
      const summarySlice = sectionSlice(html, 'ooview-summary');
      assert.ok(summarySlice.includes('ACME Srl'));
      const contactIdx = summarySlice.indexOf('Contatto fornitore');
      const contactValue = summarySlice.slice(contactIdx, contactIdx + 120);
      assert.ok(!contactValue.includes('ACME Srl'), 'missing contact must not fall back to the organization name');
      assert.ok(contactValue.includes('Non disponibile'));
    }
    console.log('PASS');

    console.log('Test: unresolvedEvidence unavailable -> "Verifica non disponibile"');
    {
      const html = renderToStaticMarkup(h(OrderOperationalViewContent, { status: 'loaded', error: null, data: baseData }));
      assert.ok(sectionSlice(html, 'ooview-unresolved').includes('Verifica non disponibile'));
    }
    console.log('PASS');

    console.log('Test: activeCommitments available+empty -> truthful evaluated-empty text, not "unavailable"');
    {
      const html = renderToStaticMarkup(h(OrderOperationalViewContent, { status: 'loaded', error: null, data: baseData }));
      const slice = sectionSlice(html, 'ooview-active-commitments');
      assert.ok(slice.includes('Nessun impegno attivo rilevato'));
      assert.ok(!slice.includes('Verifica non disponibile'));
    }
    console.log('PASS');

    console.log('Test: ambiguousEvidence populated renders the real item; supersededCommitments populated too');
    {
      const html = renderToStaticMarkup(h(OrderOperationalViewContent, { status: 'loaded', error: null, data: baseData }));
      assert.ok(sectionSlice(html, 'ooview-ambiguous').includes('Due ordini candidati'));
      assert.ok(sectionSlice(html, 'ooview-superseded-commitments').includes('Consegna 2024-01-01 superata'));
    }
    console.log('PASS');

    console.log('Test: no .status access on the four contract arrays (would be undefined/[object Object])');
    {
      const html = renderToStaticMarkup(h(OrderOperationalViewContent, { status: 'loaded', error: null, data: baseData }));
      assert.ok(!html.includes('[object Object]'));
    }
    console.log('PASS');

    console.log('Test: two lines sharing one evidence source stay distinct, each with its own resolvable ref');
    {
      const html = renderToStaticMarkup(h(OrderOperationalViewContent, { status: 'loaded', error: null, data: baseData }));
      assert.ok(html.includes('href="#evidence-E1"'));
      assert.ok(html.includes('href="#evidence-E2"'));
      assert.ok(html.includes('id="evidence-E1"'));
      assert.ok(html.includes('id="evidence-E2"'));
    }
    console.log('PASS');

    console.log('Test: a dangling provenance ref is never rendered as valid evidence');
    {
      const html = renderToStaticMarkup(h(OrderOperationalViewContent, { status: 'loaded', error: null, data: baseData }));
      assert.ok(!html.includes('href="#evidence-E9"'), 'a dangling ref must not become a link');
      assert.ok(html.includes('E9') && html.includes('non risolto'));
    }
    console.log('PASS');

    console.log('Test: safe excerpt renders as inert escaped text, never as HTML');
    {
      const html = renderToStaticMarkup(h(OrderOperationalViewContent, { status: 'loaded', error: null, data: baseData }));
      assert.ok(!html.includes('<b>hostile</b>'), 'the excerpt must be HTML-escaped, not interpreted');
      assert.ok(html.includes('&lt;b&gt;hostile&lt;/b&gt;'));
    }
    console.log('PASS');

    console.log('Test: hostile/unknown top-level response fields are never rendered');
    {
      const html = renderToStaticMarkup(h(OrderOperationalViewContent, { status: 'loaded', error: null, data: baseData }));
      assert.ok(!html.includes('alert(1)'));
      assert.ok(!html.includes('super-secret-token'));
      assert.ok(!html.includes('rawBody'));
      assert.ok(!html.includes('authorization'));
    }
    console.log('PASS');

    console.log('Test: coverage quiet / incomplete / unwatched remain distinct, never presented as healthy');
    {
      const html = renderToStaticMarkup(h(OrderOperationalViewContent, { status: 'loaded', error: null, data: baseData }));
      const coverage = sectionSlice(html, 'ooview-coverage');
      assert.ok(coverage.includes('available') && coverage.includes('quiet ok'));
      assert.ok(coverage.includes('partial') && coverage.includes('incomplete'));
      assert.ok(coverage.includes('Copertura non disponibile'), 'a null coverage entry (unwatched/unavailable) must say so explicitly');
    }
    console.log('PASS');

    console.log('Test: no send/action/state-mutation controls exist in the operational view');
    {
      const html = renderToStaticMarkup(h(OrderOperationalViewContent, { status: 'loaded', error: null, data: baseData }));
      assert.ok(!html.includes('<button'), 'OrderOperationalView must remain fully read-only');
    }
    console.log('PASS');

    /* ---------------------------------------------------------------- *
     * 21. Legacy fields no longer shown as authoritative in OrderDetailPanel
     * ---------------------------------------------------------------- */
    console.log('Test: legacy fields are not rendered by OrderDetailPanel');
    {
      const order = {
        id: 'order-1',
        orderCode: 'PO-1',
        supplierName: 'ACME Srl',
        projectCode: 'PRJ-1',
        material: 'Cartoncino',
        quantity: 10,
        orderDate: '2024-01-01',
        dueDate: '2024-02-01',
        requiredDate: '2024-02-01',
        supplierOrderRef: '13974707',
        supplierResponse: 'Confermato',
        reminderCount: 2,
        aiConfidence: 0.9
      };
      const terminology = { supplierSingular: 'Fornitore', projectSingular: 'Lavoro', material: 'Materiale', dueDate: 'Scadenza', orderSingular: 'ordine' };
      const html = renderToStaticMarkup(h(panel.default, { order, status: 'OPEN', terminology }));
      assert.ok(!html.includes('Rif. fornitore'));
      assert.ok(!html.includes('Risposta fornitore'));
      assert.ok(!html.includes('Solleciti'));
      assert.ok(!html.includes('AI confidence'));
      assert.ok(!html.includes('13974707'));
      assert.ok(!html.includes('Confermato'));
    }
    console.log('PASS');

    console.log('All UI tests passed');
  } finally {
    await server.close();
  }
}

run()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
