import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React, { StrictMode, act, createElement as h, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

const vite = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true }
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true
});

const installedGlobals = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Node",
  "Event",
  "MouseEvent",
  "IS_REACT_ACT_ENVIRONMENT"
];
const originalDescriptors = new Map(
  installedGlobals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)])
);

function installGlobal(name, value) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value
  });
}

installGlobal("window", dom.window);
installGlobal("document", dom.window.document);
installGlobal("navigator", dom.window.navigator);
installGlobal("HTMLElement", dom.window.HTMLElement);
installGlobal("Node", dom.window.Node);
installGlobal("Event", dom.window.Event);
installGlobal("MouseEvent", dom.window.MouseEvent);
installGlobal("IS_REACT_ACT_ENVIRONMENT", true);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createControlledFetch() {
  const requests = [];
  const fetchQualityContract = ({ orderId, signal }) => {
    const pending = deferred();
    const request = {
      id: requests.length + 1,
      orderId,
      signal,
      pending
    };
    requests.push(request);
    return pending.promise;
  };
  return { fetchQualityContract, requests };
}

function qualityContract(orderId, marker = orderId) {
  return {
    generatedAt: "2026-07-28T09:00:00.000Z",
    orders: [{
      orderId,
      orderCode: marker,
      dataQualityStatus: "open_findings",
      evidenceCoverage: { totalLines: 1, coveredLines: 1 }
    }],
    findings: [{
      findingId: `finding-${marker}`,
      orderId,
      type: "DATE_CONFLICT",
      severity: "warning",
      affectedLines: [],
      affectedDocuments: [],
      evidenceRefs: []
    }],
    organizationFindings: []
  };
}

function operationalData() {
  return {
    order: {},
    canonicalMaterialLines: [],
    linkedDocuments: [],
    evidenceReferences: [],
    commitments: { order: [], lines: [] }
  };
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function flushCleanupTimers() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function settleRequest(request, contract) {
  await act(async () => {
    request.pending.resolve(contract);
    await request.pending.promise;
    await Promise.resolve();
  });
}

function latestObservation(observations, consumer, status) {
  return observations
    .filter((entry) => entry.consumer === consumer && entry.state.status === status)
    .at(-1);
}

function publicState(container, consumer = "phase-2a") {
  const node = container.querySelector(`[data-consumer="${consumer}"]`);
  return {
    status: node?.getAttribute("data-status") || null,
    marker: node?.getAttribute("data-marker") || null
  };
}

function diagnosticSurfaceVisible(container) {
  return container.textContent.includes("Qualità dati");
}

let usePurchaseOrderQualityContract;
let PurchaseOrderOperationalSuggestions;

function StateConsumer({ consumer, state, onObserve }) {
  useEffect(() => {
    onObserve({ consumer, state });
  }, [consumer, state, onObserve]);
  return h("output", {
    "data-consumer": consumer,
    "data-status": state.status,
    "data-marker": state.qualityContract?.orderQuality?.orderCode || ""
  });
}

function HookHarness({
  orderId,
  role,
  fetchPurchaseOrderQualityContract,
  onObserve
}) {
  const qualityState = usePurchaseOrderQualityContract({
    orderId,
    userRole: role,
    fetchQualityContract: fetchPurchaseOrderQualityContract
  });

  return h(
    React.Fragment,
    null,
    h(StateConsumer, { consumer: "phase-2a", state: qualityState, onObserve }),
    h(StateConsumer, { consumer: "phase-2c", state: qualityState, onObserve }),
    h(PurchaseOrderOperationalSuggestions, {
      data: operationalData(),
      businessStatus: "CLOSED",
      referenceDate: "2026-07-28",
      qualityState,
      userRole: role
    })
  );
}

function createMountedHarness(options = {}) {
  const orderId = Object.hasOwn(options, "orderId") ? options.orderId : "order-a";
  const role = Object.hasOwn(options, "role") ? options.role : "Owner";
  const fetchPurchaseOrderQualityContract = options.fetchPurchaseOrderQualityContract;
  const strict = options.strict === true;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const observations = [];
  const onObserve = (entry) => observations.push(entry);
  let currentProps = {
    orderId,
    role,
    fetchPurchaseOrderQualityContract,
    onObserve
  };

  function tree() {
    const harness = h(HookHarness, currentProps);
    return strict ? h(StrictMode, null, harness) : harness;
  }

  return {
    container,
    observations,
    async render(nextProps = {}) {
      currentProps = { ...currentProps, ...nextProps };
      await act(async () => {
        root.render(tree());
        await Promise.resolve();
      });
    },
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  };
}

async function withHarness(options, test) {
  const harness = createMountedHarness(options);
  try {
    await harness.render();
    await test(harness);
  } finally {
    await harness.unmount();
    await flushCleanupTimers();
  }
}

function assertConsumersShareReference(observations, status) {
  const phase2a = latestObservation(observations, "phase-2a", status);
  const phase2c = latestObservation(observations, "phase-2c", status);
  assert.ok(phase2a, `Phase 2A must observe ${status}`);
  assert.ok(phase2c, `Phase 2C must observe ${status}`);
  assert.equal(phase2a.state, phase2c.state, `both consumers must share the ${status} object`);
}

try {
  const hookModule = await vite.ssrLoadModule("/src/hooks/usePurchaseOrderQualityContract.js");
  const suggestionsModule = await vite.ssrLoadModule(
    "/src/components/PurchaseOrderOperationalSuggestions.jsx"
  );
  usePurchaseOrderQualityContract = hookModule.default;
  PurchaseOrderOperationalSuggestions = suggestionsModule.default;

  console.log("Test: mounted shared consumers use one hook request and the same state object");
  {
    const controlled = createControlledFetch();
    await withHarness({
      fetchPurchaseOrderQualityContract: controlled.fetchQualityContract
    }, async (harness) => {
      await flushMicrotasks();
      assert.equal(controlled.requests.length, 1);
      assertConsumersShareReference(harness.observations, "loading");
      assert.equal(diagnosticSurfaceVisible(harness.container), true);

      await settleRequest(controlled.requests[0], qualityContract("order-a", "A-loaded"));
      assert.deepStrictEqual(publicState(harness.container), {
        status: "loaded",
        marker: "A-loaded"
      });
      assert.deepStrictEqual(publicState(harness.container, "phase-2c"), {
        status: "loaded",
        marker: "A-loaded"
      });
      assertConsumersShareReference(harness.observations, "loaded");
    });
  }
  console.log("PASS");

  console.log("Test: genuine React StrictMode replay reuses one in-flight request");
  {
    const controlled = createControlledFetch();
    await withHarness({
      fetchPurchaseOrderQualityContract: controlled.fetchQualityContract,
      strict: true
    }, async (harness) => {
      await flushMicrotasks();
      assert.equal(controlled.requests.length, 1);
      assert.equal(controlled.requests[0].signal.aborted, false);
      await flushCleanupTimers();
      assert.equal(controlled.requests[0].signal.aborted, false);

      await settleRequest(controlled.requests[0], qualityContract("order-a", "strict-loaded"));
      assert.equal(publicState(harness.container).marker, "strict-loaded");
      assertConsumersShareReference(harness.observations, "loaded");
    });
  }
  console.log("PASS");

  console.log("Test: Owner, Admin and IT each start exactly one mounted request");
  for (const role of ["Owner", "Admin", "IT"]) {
    const controlled = createControlledFetch();
    await withHarness({
      role,
      fetchPurchaseOrderQualityContract: controlled.fetchQualityContract
    }, async (harness) => {
      await flushMicrotasks();
      assert.equal(controlled.requests.length, 1, role);
      await settleRequest(controlled.requests[0], qualityContract("order-a", `${role}-loaded`));
      assert.equal(publicState(harness.container).marker, `${role}-loaded`, role);
      assert.equal(diagnosticSurfaceVisible(harness.container), true, role);
    });
  }
  console.log("PASS");

  console.log("Test: Buyer and ReadOnly stay inaccessible and never request diagnostics");
  for (const role of ["Buyer", "ReadOnly"]) {
    const controlled = createControlledFetch();
    await withHarness({
      role,
      fetchPurchaseOrderQualityContract: controlled.fetchQualityContract
    }, async (harness) => {
      await flushMicrotasks();
      assert.equal(controlled.requests.length, 0, role);
      assert.deepStrictEqual(publicState(harness.container), { status: "idle", marker: null });
      assert.equal(diagnosticSurfaceVisible(harness.container), false, role);
    });
  }
  console.log("PASS");

  console.log("Test: authorized to unauthorized masks immediately, aborts and rejects stale data");
  for (const role of ["Buyer", "ReadOnly"]) {
    const controlled = createControlledFetch();
    await withHarness({
      role: "Owner",
      fetchPurchaseOrderQualityContract: controlled.fetchQualityContract
    }, async (harness) => {
      await flushMicrotasks();
      assert.equal(controlled.requests.length, 1);
      const oldRequest = controlled.requests[0];

      await harness.render({ role });
      assert.deepStrictEqual(publicState(harness.container), { status: "idle", marker: null });
      assert.equal(diagnosticSurfaceVisible(harness.container), false);
      await flushCleanupTimers();
      assert.equal(oldRequest.signal.aborted, true);

      await settleRequest(oldRequest, qualityContract("order-a", "must-not-return"));
      assert.deepStrictEqual(publicState(harness.container), { status: "idle", marker: null });
      assert.equal(diagnosticSurfaceVisible(harness.container), false);
    });
  }
  console.log("PASS");

  console.log("Test: unauthorized to authorized starts only the post-authorization request");
  {
    const controlled = createControlledFetch();
    await withHarness({
      role: "Buyer",
      fetchPurchaseOrderQualityContract: controlled.fetchQualityContract
    }, async (harness) => {
      await flushMicrotasks();
      assert.equal(controlled.requests.length, 0);

      await harness.render({ role: "Owner" });
      await flushMicrotasks();
      assert.equal(controlled.requests.length, 1);
      await settleRequest(controlled.requests[0], qualityContract("order-a", "post-auth"));
      assert.deepStrictEqual(publicState(harness.container), {
        status: "loaded",
        marker: "post-auth"
      });
    });
  }
  console.log("PASS");

  console.log("Test: rapid A to B switch keeps B after an aborted A resolves late");
  {
    const controlled = createControlledFetch();
    await withHarness({
      orderId: "order-a",
      fetchPurchaseOrderQualityContract: controlled.fetchQualityContract
    }, async (harness) => {
      await flushMicrotasks();
      const requestA = controlled.requests[0];

      await harness.render({ orderId: "order-b" });
      await flushMicrotasks();
      assert.deepStrictEqual(controlled.requests.map((request) => request.orderId), [
        "order-a",
        "order-b"
      ]);
      const requestB = controlled.requests[1];
      await flushCleanupTimers();
      assert.equal(requestA.signal.aborted, true);

      await settleRequest(requestB, qualityContract("order-b", "B-final"));
      await settleRequest(requestA, qualityContract("order-a", "A-stale"));
      assert.deepStrictEqual(publicState(harness.container), {
        status: "loaded",
        marker: "B-final"
      });
    });
  }
  console.log("PASS");

  console.log("Test: rapid A to B to A uses distinct request identities and final A wins");
  {
    const controlled = createControlledFetch();
    await withHarness({
      orderId: "order-a",
      fetchPurchaseOrderQualityContract: controlled.fetchQualityContract
    }, async (harness) => {
      await flushMicrotasks();
      const firstA = controlled.requests[0];

      await harness.render({ orderId: "order-b" });
      await flushMicrotasks();
      const requestB = controlled.requests[1];
      await flushCleanupTimers();
      assert.equal(firstA.signal.aborted, true);

      await harness.render({ orderId: "order-a" });
      await flushMicrotasks();
      const finalA = controlled.requests[2];
      await flushCleanupTimers();
      assert.deepStrictEqual(controlled.requests.map((request) => request.orderId), [
        "order-a",
        "order-b",
        "order-a"
      ]);
      assert.notEqual(firstA.id, finalA.id);
      assert.equal(requestB.signal.aborted, true);

      await settleRequest(firstA, qualityContract("order-a", "A-old"));
      await settleRequest(requestB, qualityContract("order-b", "B-old"));
      assert.deepStrictEqual(publicState(harness.container), {
        status: "loading",
        marker: null
      });
      await settleRequest(finalA, qualityContract("order-a", "A-final"));
      assert.deepStrictEqual(publicState(harness.container), {
        status: "loaded",
        marker: "A-final"
      });
    });
  }
  console.log("PASS");

  console.log("Test: unmount aborts pending work without updates, warnings or unhandled rejection");
  {
    const controlled = createControlledFetch();
    const harness = createMountedHarness({
      fetchPurchaseOrderQualityContract: controlled.fetchQualityContract
    });
    const unhandled = [];
    const reactWarnings = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    const originalConsoleError = console.error;
    process.on("unhandledRejection", onUnhandled);
    console.error = (...args) => {
      reactWarnings.push(args.map(String).join(" "));
    };
    try {
      await harness.render();
      await flushMicrotasks();
      const request = controlled.requests[0];
      await harness.unmount();
      await flushCleanupTimers();
      assert.equal(request.signal.aborted, true);
      request.pending.reject(new Error("late rejection after unmount"));
      await Promise.resolve();
      await Promise.resolve();
      assert.deepStrictEqual(unhandled, []);
      assert.equal(
        reactWarnings.some((warning) => (
          warning.includes("state update")
          || warning.includes("not wrapped in act")
        )),
        false
      );
    } finally {
      console.error = originalConsoleError;
      process.off("unhandledRejection", onUnhandled);
      if (harness.container.isConnected) {
        await harness.unmount();
      }
    }
  }
  console.log("PASS");

  console.log("Test: missing and invalid mounted inputs never request or throw");
  for (const invalid of [
    { orderId: undefined },
    { orderId: "" },
    { fetchPurchaseOrderQualityContract: undefined },
    { fetchPurchaseOrderQualityContract: null },
    { fetchPurchaseOrderQualityContract: "not-a-function" }
  ]) {
    const controlled = createControlledFetch();
    const options = {
      fetchPurchaseOrderQualityContract: controlled.fetchQualityContract,
      ...invalid
    };
    await withHarness(options, async (harness) => {
      await flushMicrotasks();
      assert.equal(controlled.requests.length, 0);
      assert.deepStrictEqual(publicState(harness.container), { status: "idle", marker: null });
      assert.equal(diagnosticSurfaceVisible(harness.container), true);
    });
  }
  console.log("PASS");

  console.log("Test: production OrderDetailPanel owns the hook once and shares qualityState twice");
  {
    const source = await readFile(
      new URL("../src/components/OrderDetailPanel.jsx", import.meta.url),
      "utf8"
    );
    assert.equal((source.match(/usePurchaseOrderQualityContract\(\{/g) || []).length, 1);
    assert.equal((source.match(/qualityState=\{qualityState\}/g) || []).length, 2);
  }
  console.log("PASS");

  console.log("All mounted Phase 2C.1B shared-quality-hook tests passed.");
} finally {
  await vite.close();
  dom.window.close();
  for (const name of installedGlobals) {
    const descriptor = originalDescriptors.get(name);
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      delete globalThis[name];
    }
  }
}
