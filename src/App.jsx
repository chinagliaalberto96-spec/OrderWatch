import { useCallback, useEffect, useMemo, useState } from "react";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import customerConfig from "./config/customer.config";
import { mockAdapter } from "./adapters/mockAdapter";
import { apiAdapter } from "./adapters/apiAdapter";
import { createTheme } from "./theme/createTheme";
import { filterRows } from "./utils/search";
import DashboardView from "./views/DashboardView";
import DocumentsView from "./views/DocumentsView";
import LoginView from "./views/LoginView";
import OrdersView from "./views/OrdersView";
import ProjectsView from "./views/ProjectsView";
import SettingsView from "./views/SettingsView";
import SuppliersView from "./views/SuppliersView";

const viewLabels = (terminology) => ({
  dashboard: "Dashboard",
  orders: terminology.ordersPlural,
  projects: terminology.projectsPlural,
  suppliers: terminology.suppliersPlural,
  documents: terminology.documentsPlural,
  settings: "Impostazioni"
});

const REFRESH_INTERVAL_MS = 60000;
const USES_MOCK_DATA = import.meta.env.VITE_USE_MOCK_DATA === "true";

// In produzione usa la API Vercel /api/dashboard, che tiene le chiavi Airtable
// lato server. Per lavorare offline si puo' impostare VITE_USE_MOCK_DATA=true.
const adapter = USES_MOCK_DATA ? mockAdapter : apiAdapter;

export default function App() {
  const config = customerConfig;
  const [activeView, setActiveView] = useState("dashboard");
  const [sessionUser, setSessionUser] = useState(() => {
    const stored = window.sessionStorage.getItem("orderwatch-session-user");
    return stored ? JSON.parse(stored) : null;
  });
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const themeStyle = createTheme(config.theme);
  const labels = viewLabels(config.terminology);

  const navItems = useMemo(
    () =>
      ["dashboard", "orders", "projects", "suppliers", "documents", "settings"]
        .filter((key) => config.modules[key])
        .map((key) => ({ key, label: labels[key] })),
    [config.modules, labels]
  );

  const loadData = useCallback(
    ({ silent = false } = {}) => {
      if (!silent) setIsRefreshing(true);
      return adapter
        .getDashboardData()
        .then((result) => {
          setData(result);
          setError(null);
          setLastUpdated(new Date());
        })
        .catch((err) => {
          setError(err.message);
        })
        .finally(() => {
          if (!silent) setIsRefreshing(false);
        });
    },
    []
  );

  useEffect(() => {
    if (!sessionUser) return undefined;

    let cancelled = false;
    loadData();

    const interval = setInterval(() => {
      if (!cancelled) loadData({ silent: true });
    }, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sessionUser, loadData]);

  const reviewItems = useMemo(() => {
    if (!data) return [];

    const orderItems = (data.orders || [])
      .filter((order) => order.needsReview)
      .map((order) => ({
        id: `order-${order.orderCode}`,
        label: `Ordine ${order.orderCode} (${order.supplierName || "fornitore"}) da verificare`,
        view: "orders"
      }));

    const documentItems = (data.documents || [])
      .filter((document) => document.needsHumanReview)
      .map((document) => ({
        id: `document-${document.id}`,
        label: `${document.name || "Documento"} da verificare`,
        view: "documents"
      }));

    return [...orderItems, ...documentItems];
  }, [data]);

  const filteredData = useMemo(() => {
    if (!data) return data;
    return {
      ...data,
      orders: filterRows(data.orders, searchQuery),
      projects: filterRows(data.projects, searchQuery),
      suppliers: filterRows(data.suppliers, searchQuery),
      documents: filterRows(data.documents, searchQuery)
    };
  }, [data, searchQuery]);

  const currentTitle = labels[activeView] || config.product.name;

  function handleLogin(user) {
    window.sessionStorage.setItem("orderwatch-session-user", JSON.stringify(user));
    setSessionUser(user);
  }

  function handleLogout() {
    window.sessionStorage.removeItem("orderwatch-session-user");
    setSessionUser(null);
    setData(null);
    setError(null);
    setLastUpdated(null);
    setSearchQuery("");
    setActiveView("dashboard");
  }

  if (!sessionUser) {
    return (
      <div style={themeStyle}>
        <LoginView config={config} onLogin={handleLogin} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center" style={themeStyle}>
        <div>
          <p className="font-semibold text-[color:var(--color-danger)]">Errore nel caricamento dati Airtable</p>
          <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={themeStyle}>
        <p className="text-sm text-[color:var(--color-text-muted)]">Caricamento dati...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen" style={themeStyle}>
      <Sidebar config={config} navItems={navItems} activeView={activeView} onNavigate={setActiveView} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          title={currentTitle}
          tagline={config.product.tagline}
          userEmail={sessionUser.email}
          onLogout={handleLogout}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          reviewItems={reviewItems}
          onSelectReviewItem={setActiveView}
          lastUpdated={lastUpdated}
          onRefresh={() => loadData()}
          isRefreshing={isRefreshing}
        />
        <main className="min-w-0 flex-1 p-5">
          {activeView === "dashboard" && <DashboardView config={config} data={data} />}
          {activeView === "orders" && <OrdersView config={config} orders={filteredData.orders} />}
          {activeView === "projects" && <ProjectsView config={config} projects={filteredData.projects} />}
          {activeView === "suppliers" && <SuppliersView config={config} suppliers={filteredData.suppliers} />}
          {activeView === "documents" && <DocumentsView config={config} documents={filteredData.documents} />}
          {activeView === "settings" && (
            <SettingsView
              config={config}
              meta={{
                mode: USES_MOCK_DATA ? "mock" : "live",
                lastUpdated,
                counts: {
                  orders: data.orders.length,
                  projects: data.projects.length,
                  suppliers: data.suppliers.length,
                  documents: data.documents.length,
                  review: reviewItems.length
                }
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}
