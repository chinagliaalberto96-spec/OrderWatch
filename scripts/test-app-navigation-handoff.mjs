// Tests for the "Data Quality finding -> OrderOperationalView" navigation
// handoff (support/admin investigation workflow):
//   PilotDataQualityView emits onOpenOrder(orderId, context)
//     -> App.jsx's handleOpenOrderFromFinding switches to the existing
//        "orders" view via handleNavigate/drilldown
//     -> OrdersView resolves the target order by orderId (the stable key)
//     -> OrderDetailPanel/OrderOperationalView load through the SAME
//        existing authenticated fetch path used everywhere else.
//
// App.jsx itself has no existing test harness in this codebase (it's a
// large, session-driven root component) — these tests instead prove the
// wiring the same way scripts/test-order-operational-view.mjs proves
// "auth before DB access": source-order/text checks against the real files,
// plus a real-component SSR render of OrdersView (the same Vite SSR
// loader pattern as scripts/test-ui-pilot-data-quality.mjs) proving
// focusOrderId actually resolves and opens the correct order.

import assert from 'assert';
import { readFile } from 'fs/promises';
import { createServer } from 'vite';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';

async function loadRealModules() {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  const ordersView = await server.ssrLoadModule('/src/views/OrdersView.jsx');
  const customerConfig = await server.ssrLoadModule('/src/config/customer.config.js');
  return {
    server,
    OrdersView: ordersView.default,
    resolveFocusedOrder: ordersView.resolveFocusedOrder,
    config: customerConfig.default
  };
}

function makeOrder(overrides = {}) {
  return {
    id: 'order-real-1',
    orderCode: '0013545497',
    supplierName: 'Makito Italia Srl',
    material: 'Cartoncino',
    quantity: '10',
    projectCode: 'PRJ-1',
    status: 'In lavorazione',
    dueDate: '2099-01-01',
    daysRemaining: 30,
    needsReview: false,
    ...overrides
  };
}

async function run() {
  const { server, OrdersView, resolveFocusedOrder, config } = await loadRealModules();

  try {
    console.log('Test: OrdersView resolves the target order by focusOrderId (the stable key), opening OrderDetailPanel for it');
    {
      const target = makeOrder({ id: 'order-abc', orderCode: '0013545497' });
      const other = makeOrder({ id: 'order-def', orderCode: '0099999999' });
      const html = renderToStaticMarkup(
        h(OrdersView, { config, orders: [other, target], focusOrderId: 'order-abc', onFetchOrderOperationalView: async () => ({}) })
      );
      assert.ok(html.includes('0013545497'), 'expected the order matched by focusOrderId to be opened in the detail panel');
    }
    console.log('PASS');

    console.log('Test: OrdersView preserves the full investigation context only for the exact focused order');
    {
      const target = makeOrder({ id: 'order-abc', orderCode: '0013545497' });
      const context = {
        findingId: 'finding-1',
        type: 'LINE_WITHOUT_EVIDENCE',
        dimension: 'traceability',
        severity: 'warning',
        orderId: 'order-abc',
        orderCode: '0013545497',
        affectedLines: [{ id: 'line-1', description: 'Riga sintetica', itemCode: null }],
        affectedDocuments: [],
        evidenceRefs: [],
        description: 'La riga non presenta evidenza.',
        recommendedAction: 'Verificare la fonte.'
      };
      const html = renderToStaticMarkup(
        h(OrdersView, {
          config,
          orders: [target],
          focusOrderId: 'order-abc',
          investigationContext: context,
          onFetchOrderOperationalView: async () => ({})
        })
      );
      assert.ok(html.includes('Ordine aperto dal controllo qualità'));
      assert.ok(html.includes('Riga sintetica'));

      const mismatched = renderToStaticMarkup(
        h(OrdersView, {
          config,
          orders: [target],
          focusOrderId: 'order-abc',
          investigationContext: { ...context, orderId: 'order-other' },
          onFetchOrderOperationalView: async () => ({})
        })
      );
      assert.ok(!mismatched.includes('Ordine aperto dal controllo qualità'));
    }
    console.log('PASS');

    console.log('Test: stable order resolution is exact and never falls back to a decoy');
    {
      const target = makeOrder({ id: 'order-abc', orderCode: '0013545497' });
      const decoy = makeOrder({ id: 'order-def', orderCode: '0013545497' });
      assert.strictEqual(resolveFocusedOrder([decoy, target], 'order-abc', null), target);
      assert.strictEqual(resolveFocusedOrder([target], 'missing-id', '0013545497'), null);
    }
    console.log('PASS');

    console.log('Test: focusOrderId takes priority over focusOrderCode when both are present (orderId is the stable navigation key, per the task requirement)');
    {
      const target = makeOrder({ id: 'order-abc', orderCode: '0013545497' });
      const decoy = makeOrder({ id: 'order-decoy', orderCode: 'DECOY-CODE' });
      // focusOrderCode intentionally points at the decoy's code, but
      // focusOrderId points at the real target's id — the real target must win.
      const html = renderToStaticMarkup(
        h(OrdersView, { config, orders: [decoy, target], focusOrderId: 'order-abc', focusOrderCode: 'DECOY-CODE', onFetchOrderOperationalView: async () => ({}) })
      );
      assert.ok(html.includes('0013545497'), 'focusOrderId must win over focusOrderCode when both are supplied');
    }
    console.log('PASS');

    console.log('Test: an unmatched focusOrderId (e.g. cross-tenant/nonexistent order not in the already tenant-scoped orders list) opens nothing — never a fabricated detail panel');
    {
      const other = makeOrder({ id: 'order-def', orderCode: '0099999999' });
      const html = renderToStaticMarkup(
        h(OrdersView, { config, orders: [other], focusOrderId: 'someone-elses-order-id', onFetchOrderOperationalView: async () => ({}) })
      );
      assert.ok(!html.includes('Dettaglio'), 'no detail panel should open for an orderId not present in the (already tenant-scoped) orders list');
    }
    console.log('PASS');

    console.log('Test: without focusOrderId/focusOrderCode, OrdersView opens nothing (no behavior change to the default view)');
    {
      const other = makeOrder({ id: 'order-def', orderCode: '0099999999' });
      const html = renderToStaticMarkup(h(OrdersView, { config, orders: [other], onFetchOrderOperationalView: async () => ({}) }));
      assert.ok(!html.includes('Dettaglio'), 'no detail panel should open when no focus prop is supplied at all');
    }
    console.log('PASS');
  } finally {
    await server.close();
  }

  console.log('Test: App.jsx wires the Data Quality -> orders handoff through the existing handleNavigate/drilldown mechanism, not a new one');
  {
    const source = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
    const handlerMatch = source.match(/function handleOpenOrderFromFinding\(orderId, context = \{\}\) \{([\s\S]*?)\n {2}\}/);
    assert.ok(handlerMatch, 'expected handleOpenOrderFromFinding to be defined in App.jsx');
    const body = handlerMatch[1];
    assert.ok(/handleNavigate\(\s*["']orders["']/.test(body), 'handleOpenOrderFromFinding must switch to the existing "orders" view (where OrderOperationalView is rendered) via handleNavigate, not a new view/state mechanism');
    assert.ok(/normalizeFindingContext/.test(body), 'App.jsx must allowlist and preserve the complete finding context');
    assert.ok(/investigationContext/.test(body), 'App.jsx must store the normalized finding context in the existing drilldown state');
    assert.ok(!/adapter\.getOrderOperationalView|fetch\(/.test(body), 'handleOpenOrderFromFinding must not itself fetch order data — it only switches views');
  }
  console.log('PASS');

  console.log('Test: PilotDataQualityView is wired with onOpenOrder={handleOpenOrderFromFinding} in App.jsx');
  {
    const source = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
    assert.ok(/<PilotDataQualityView[\s\S]{0,300}onOpenOrder={handleOpenOrderFromFinding}/.test(source), 'App.jsx must pass handleOpenOrderFromFinding as the onOpenOrder prop to PilotDataQualityView');
  }
  console.log('PASS');

  console.log('Test: OrdersView still receives the same, unchanged handleFetchOrderOperationalView callback — no second order-fetching implementation was introduced');
  {
    const source = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
    // Only one function in the whole file may call adapter.getOrderOperationalView
    // (comments are allowed to mention it by name, as this file's own
    // handleOpenOrderFromFinding comment does).
    const codeLines = source.split('\n').filter((line) => !line.trim().startsWith('//'));
    const fetchCallSites = codeLines.join('\n').match(/adapter\.getOrderOperationalView/g) || [];
    assert.strictEqual(fetchCallSites.length, 1, 'adapter.getOrderOperationalView must be called from exactly one place in App.jsx (handleFetchOrderOperationalView) — a second call site would mean a duplicate fetch implementation');
    assert.ok(/<OrdersView[\s\S]{0,600}onFetchOrderOperationalView={handleFetchOrderOperationalView}/.test(source), 'OrdersView must still receive the existing handleFetchOrderOperationalView callback unchanged');
    assert.ok(/<OrdersView[\s\S]{0,400}focusOrderId={drilldown\.orderId}/.test(source), 'OrdersView must receive the new focusOrderId drilldown value so orderId-based navigation resolves the right order');
    assert.ok(/<OrdersView[\s\S]{0,500}investigationContext={drilldown\.investigationContext}/.test(source), 'OrdersView must receive the normalized investigation context');
    assert.ok(/onClearOrderDrilldown={handleClearOrderDrilldown}/.test(source), 'OrdersView must be able to clear stale drilldown context on close or normal navigation');
  }
  console.log('PASS');

  console.log('Test: leaving the orders view clears stale Data Quality context');
  {
    const source = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
    assert.ok(/activeView !== ["']orders["'] && drilldown\.investigationContext/.test(source));
    assert.ok(/setDrilldown\(\{\}\)/.test(source));
  }
  console.log('PASS');

  console.log('Test: normal row navigation and panel close clear investigation context before reuse');
  {
    const source = await readFile(new URL('../src/views/OrdersView.jsx', import.meta.url), 'utf8');
    assert.ok(/function openOrderNormally[\s\S]*setSelectedInvestigationContext\(null\)[\s\S]*onClearOrderDrilldown/.test(source));
    assert.ok(/function closeOrder[\s\S]*setSelectedInvestigationContext\(null\)[\s\S]*onClearOrderDrilldown/.test(source));
    assert.ok(/onRowClick={openOrderNormally}/.test(source));
    assert.ok(/onClose={closeOrder}/.test(source));
  }
  console.log('PASS');

  console.log('Test: handleNavigate itself is unmodified (still role-gates via canAccessView before switching view/drilldown) — no parallel navigation/authorization path was added');
  {
    const source = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
    const navMatch = source.match(/function handleNavigate\(view, context = \{\}\) \{([\s\S]*?)\n {2}\}/);
    assert.ok(navMatch, 'expected the existing handleNavigate to still exist unchanged in shape');
    assert.ok(/canAccessView\(sessionUser\?\.role, view\)/.test(navMatch[1]), 'handleNavigate must still be the single role gate for every cross-view navigation, including this new one');
  }
  console.log('PASS');

  console.log('All app navigation-handoff tests passed');
}

run().catch((e) => { console.error(e); process.exit(1); });
