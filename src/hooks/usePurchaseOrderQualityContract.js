import { useEffect, useReducer, useRef } from "react";
import {
  canViewPurchaseOrderQualitySummary,
  extractSingleOrderQualityContract
} from "../utils/purchaseOrderOperationalSummary";

export const initialPurchaseOrderQualityState = Object.freeze({
  status: "idle",
  qualityContract: null,
  error: null
});

export function purchaseOrderQualityReducer(state, action) {
  switch (action.type) {
    case "RESET":
      return initialPurchaseOrderQualityState;
    case "LOAD_START":
      return { status: "loading", qualityContract: null, error: null };
    case "LOAD_SUCCESS":
      return { status: "loaded", qualityContract: action.qualityContract, error: null };
    case "LOAD_UNAVAILABLE":
      return { status: "unavailable", qualityContract: null, error: null };
    case "LOAD_ERROR":
      return { status: "error", qualityContract: null, error: action.message || null };
    default:
      return state;
  }
}

// A short-lived lease coalesces React StrictMode's repeated effect while
// preserving cancellation when an order is genuinely changed or closed.
export function createPurchaseOrderQualityRequestCoordinator(fetchQualityContract) {
  const entries = new Map();

  function acquire(orderId) {
    let entry = entries.get(orderId);
    if (!entry) {
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      entry = {
        controller,
        consumers: 0,
        cleanupTimer: null,
        settled: false,
        promise: Promise.resolve().then(() => fetchQualityContract({
          orderId,
          signal: controller?.signal
        }))
      };
      entry.promise.finally(() => {
        entry.settled = true;
      }).catch(() => {});
      entries.set(orderId, entry);
    }

    if (entry.cleanupTimer) {
      clearTimeout(entry.cleanupTimer);
      entry.cleanupTimer = null;
    }
    entry.consumers += 1;
    let released = false;

    return {
      promise: entry.promise,
      release() {
        if (released) return;
        released = true;
        entry.consumers = Math.max(0, entry.consumers - 1);
        if (entry.consumers > 0) return;
        entry.cleanupTimer = setTimeout(() => {
          if (entry.consumers > 0) return;
          if (!entry.settled) entry.controller?.abort();
          entries.delete(orderId);
        }, 0);
      }
    };
  }

  return { acquire };
}

export async function loadPurchaseOrderQualityContract({
  orderId,
  requestPromise,
  dispatch,
  tokenRef,
  myToken
}) {
  try {
    const contract = await requestPromise;
    if (tokenRef.current !== myToken) return;
    const qualityContract = extractSingleOrderQualityContract(contract, orderId);
    dispatch(qualityContract
      ? { type: "LOAD_SUCCESS", qualityContract }
      : { type: "LOAD_UNAVAILABLE" });
  } catch (error) {
    if (error?.name === "AbortError" || tokenRef.current !== myToken) return;
    dispatch({
      type: "LOAD_ERROR",
      message: "La valutazione qualità non è disponibile per questo ordine."
    });
  }
}

export function canLoadPurchaseOrderQualityContract({
  orderId,
  userRole,
  fetchQualityContract
}) {
  return canViewPurchaseOrderQualitySummary(userRole)
    && typeof fetchQualityContract === "function"
    && typeof orderId === "string"
    && Boolean(orderId);
}

export default function usePurchaseOrderQualityContract({
  orderId,
  userRole,
  fetchQualityContract
}) {
  const [state, dispatch] = useReducer(
    purchaseOrderQualityReducer,
    initialPurchaseOrderQualityState
  );
  const tokenRef = useRef(0);
  const coordinatorRef = useRef(null);
  const canLoad = canLoadPurchaseOrderQualityContract({
    orderId,
    userRole,
    fetchQualityContract
  });

  if (
    canLoad
    && (!coordinatorRef.current || coordinatorRef.current.fetchFn !== fetchQualityContract)
  ) {
    coordinatorRef.current = {
      fetchFn: fetchQualityContract,
      coordinator: createPurchaseOrderQualityRequestCoordinator(fetchQualityContract)
    };
  }

  useEffect(() => {
    if (!canLoad) {
      tokenRef.current += 1;
      dispatch({ type: "RESET" });
      return undefined;
    }

    const myToken = ++tokenRef.current;
    const lease = coordinatorRef.current.coordinator.acquire(orderId);
    dispatch({ type: "LOAD_START" });
    loadPurchaseOrderQualityContract({
      orderId,
      requestPromise: lease.promise,
      dispatch,
      tokenRef,
      myToken
    });
    return () => {
      tokenRef.current += 1;
      lease.release();
    };
  }, [canLoad, orderId, fetchQualityContract]);

  return canLoad ? state : initialPurchaseOrderQualityState;
}
