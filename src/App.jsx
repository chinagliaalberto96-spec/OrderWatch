import { useCallback, useEffect, useMemo, useState } from "react";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import baseConfig from "./config/base.config";
import customerConfig from "./config/customer.config";
import { mockAdapter } from "./adapters/mockAdapter";
import { createApiAdapter } from "./adapters/apiAdapter";
import { createTheme } from "./theme/createTheme";
import { filterRows } from "./utils/search";
import DashboardView from "./views/DashboardView";
import SupplierOrderDrawer from "./components/SupplierOrderDrawer";
import DocumentsView from "./views/DocumentsView";
import InvoicesView from "./views/InvoicesView";
import ImportsView from "./views/ImportsView";
import LoginView from "./views/LoginView";
import NotificationsView from "./views/NotificationsView";
import OrdersView from "./views/OrdersView";
import ProjectsView from "./views/ProjectsView";
import ContractProjectsView from "./views/ContractProjectsView";
import QuotesView from "./views/QuotesView";
import ReceivingView from "./views/ReceivingView";
import AlteraView from "./views/AlteraView";
import SettingsView from "./views/SettingsView";
import SuppliersView from "./views/SuppliersView";
import ContactsView from "./views/ContactsView";
import { AUTH_MODE, getAccessToken, getAuthClient } from "./lib/authClient";
import PasswordResetView from "./views/PasswordResetView";
import { getWorkflowPolicy } from "./config/workflowModes";
import { canAccessView, canWriteOperationalData } from "./utils/permissions";
import { createSafeLanguagePolicy } from "./utils/safeLanguage";

const viewLabels = (terminology) => ({
  dashboard: "Oggi",
  orders: terminology.ordersPlural,
  projects: terminology.projectsPlural,
  contract_watch: "ContractWatch",
  suppliers: terminology.suppliersPlural,
  contacts: "Anagrafica",
  quotes: "Quotazioni",
  documents: terminology.documentsPlural,
  invoices: terminology.invoicesPlural || "Fatture",
  imports: terminology.importsPlural || "Importazioni",
  reminders: "Notifiche",
  receiving: "Ricevimenti",
  altera: "Altera",
  settings: "Impostazioni"
});

const REFRESH_INTERVAL_MS = 60000;
const USES_MOCK_DATA = import.meta.env.VITE_USE_MOCK_DATA === "true";
const MAILBOX_MANAGEMENT_ENABLED =
  AUTH_MODE === "supabase" && import.meta.env.VITE_MAILBOX_MANAGEMENT_ENABLED === "true";
const SEEN_REVIEW_ITEMS_KEY = "orderwatch-seen-review-items";
// Item gia' mostrati dal badge: il contatore rosso conta solo le notifiche
// mai viste; aprire il dropdown le marca tutte viste (senza eliminarle dalla
// lista — quello succede solo al click sull'item).
const NOTIFIED_REVIEW_ITEMS_KEY = "orderwatch-notified-review-items";

function settingsValue(settings, key, fallback = null) {
  return (settings || []).find((setting) => setting.settingKey === key)?.value ?? fallback;
}

function isPasswordSetupLink() {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const authFlowType = query.get("type") || hash.get("type");
  return authFlowType === "invite" || authFlowType === "recovery";
}

export default function App() {
  const config = customerConfig;
  const [activeView, setActiveView] = useState("dashboard");
  // Contesto di drill-down: quando si arriva a una vista da un click sulla
  // dashboard (o dalle notifiche) porta con se' l'elemento da aprire o il
  // filtro da applicare. La navigazione via sidebar lo azzera.
  const [drilldown, setDrilldown] = useState({});
  const [sessionUser, setSessionUser] = useState(() => {
    if (AUTH_MODE === "supabase") return null;
    const stored = window.sessionStorage.getItem("orderwatch-session-user");
    return stored ? JSON.parse(stored) : null;
  });
  const [authReady, setAuthReady] = useState(AUTH_MODE === "legacy");
  const [passwordRecovery, setPasswordRecovery] = useState(
    () => AUTH_MODE === "supabase" && isPasswordSetupLink()
  );
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [supplierOrderItem, setSupplierOrderItem] = useState(null);
  const [seenReviewItemIds, setSeenReviewItemIds] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem(SEEN_REVIEW_ITEMS_KEY) || "[]");
    } catch {
      return [];
    }
  });
  const [notifiedReviewItemIds, setNotifiedReviewItemIds] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem(NOTIFIED_REVIEW_ITEMS_KEY) || "[]");
    } catch {
      return [];
    }
  });
  // Regola di prodotto (giugno 2026): la palette del cliente (config.theme,
  // es. "Ink & Paper" di Graphic Center) si vede SOLO nella pagina di Login.
  // Tutta la dashboard (sidebar, topbar, ogni view) usa sempre il brand
  // ufficiale OrderWatch "Graphite & Coral" definito in base.config.js,
  // indipendentemente dal cliente loggato. L'unico riferimento al cliente
  // dentro la dashboard e' il nome azienda mostrato in Topbar.
  const loginThemeStyle = createTheme(config.theme);
  const appThemeStyle = createTheme(baseConfig.theme);
  const labels = viewLabels(config.terminology);

  useEffect(() => {
    document.title = `OrderWatch — ${config.company.name}`;
  }, [config.company.name]);

  const adapter = useMemo(
    () => (USES_MOCK_DATA ? mockAdapter : createApiAdapter(undefined, {
      getAccessToken: AUTH_MODE === "supabase" ? getAccessToken : undefined
    })),
    []
  );

  useEffect(() => {
    if (AUTH_MODE !== "supabase") return undefined;

    const client = getAuthClient();
    let active = true;

    async function restoreUser(session) {
      if (!session?.access_token) {
        if (active) setSessionUser(null);
        return;
      }
      const response = await fetch("/api/session", {
        headers: { Authorization: `Bearer ${session.access_token}` }
      });
      if (!response.ok) {
        await client.auth.signOut();
        if (active) setSessionUser(null);
        return;
      }
      const payload = await response.json();
      if (active) setSessionUser(payload.user);
    }

    client.auth.getSession()
      .then(({ data: { session } }) => restoreUser(session))
      .catch(() => setSessionUser(null))
      .finally(() => {
        if (active) setAuthReady(true);
      });

    const { data: listener } = client.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        if (active) setPasswordRecovery(true);
        return;
      }
      if (event === "SIGNED_OUT") {
        if (active) setSessionUser(null);
        return;
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        restoreUser(session).catch(() => {
          if (active) setSessionUser(null);
        });
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  // Gating moduli lato backend: le voci "modules.<key>" in Settings
  // (customer_visible=false, editabili solo da noi via Supabase) decidono
  // quali moduli il cliente vede davvero, indipendentemente dal config
  // statico. Default true se il setting manca, per compatibilita'.
  const backendModuleFlags = useMemo(() => {
    const settingsList = data?.settings || [];
    const flags = {};
    for (const setting of settingsList) {
      const match = /^modules\.(.+)$/.exec(setting.settingKey || "");
      if (match) flags[match[1]] = String(setting.value).toLowerCase() !== "false";
    }
    return flags;
  }, [data?.settings]);

  const navItems = useMemo(
    () =>
      ["dashboard", "altera", "orders", "projects", "contract_watch", "suppliers", "contacts", "quotes", "receiving", "documents", "invoices", "imports", "reminders", "settings"]
        .filter((key) => (config.modules[key] || backendModuleFlags[key] === true) && backendModuleFlags[key] !== false)
        .filter((key) => canAccessView(sessionUser?.role, key))
        .map((key) => ({ key, label: labels[key] })),
    [config.modules, backendModuleFlags, labels, sessionUser?.role]
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
    [adapter]
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
        view: "orders",
        orderCode: order.orderCode
      }));

    const documentItems = (data.documents || [])
      .filter((document) => document.needsHumanReview)
      .map((document) => ({
        id: `document-${document.id}`,
        label: `${document.name || "Documento"} da verificare`,
        view: "documents"
      }));

    const reminderItems = (data.reminders || [])
      .filter((reminder) => ["draft", "failed"].includes(reminder.status))
      .map((reminder) => ({
        id: `reminder-${reminder.id}`,
        label: `${reminder.status === "failed" ? "Sollecito fallito" : "Bozza sollecito"} ${reminder.orderCode || ""} (${reminder.supplierName || "fornitore"})`,
        view: "reminders"
      }));

    const importItems = (data.processedEmails || [])
      .filter((email) => email.status === "Error" || email.status?.trim() === "Processing")
      .map((email) => ({
        id: `import-${email.id}`,
        label: `${email.status === "Error" ? "Errore importazione" : "Importazione in lavorazione"}: ${email.subject || email.messageId || "email"}`,
        view: "imports"
      }));

    return [...orderItems, ...documentItems, ...reminderItems, ...importItems];
  }, [data]);

  const visibleReviewItems = useMemo(() => {
    const seenIds = new Set(seenReviewItemIds);
    return reviewItems.filter((item) => !seenIds.has(item.id));
  }, [reviewItems, seenReviewItemIds]);

  // Il badge conta solo le notifiche mai mostrate: si azzera aprendo il
  // dropdown, non serve cliccarle tutte.
  const unseenReviewCount = useMemo(() => {
    const notified = new Set(notifiedReviewItemIds);
    return visibleReviewItems.filter((item) => !notified.has(item.id)).length;
  }, [visibleReviewItems, notifiedReviewItemIds]);

  function handleNotificationsOpened() {
    const next = Array.from(new Set([...notifiedReviewItemIds, ...visibleReviewItems.map((item) => item.id)]));
    setNotifiedReviewItemIds(next);
    window.localStorage.setItem(NOTIFIED_REVIEW_ITEMS_KEY, JSON.stringify(next));
  }

  useEffect(() => {
    const activeIds = new Set(reviewItems.map((item) => item.id));
    const compactSeenIds = seenReviewItemIds.filter((id) => activeIds.has(id));

    if (compactSeenIds.length !== seenReviewItemIds.length) {
      setSeenReviewItemIds(compactSeenIds);
      window.localStorage.setItem(SEEN_REVIEW_ITEMS_KEY, JSON.stringify(compactSeenIds));
    }
  }, [reviewItems, seenReviewItemIds]);

  const filteredData = useMemo(() => {
    if (!data) return data;
    const languagePolicy = createSafeLanguagePolicy(data.dataCoverage || []);
    const sanitizeItem = (item) => ({
      ...item,
      title: languagePolicy.sanitize(item.title),
      detail: languagePolicy.sanitize(item.detail),
      actionLabel: languagePolicy.sanitize(item.actionLabel)
    });
    return {
      ...data,
      orders: filterRows(data.orders, searchQuery),
      projects: filterRows(data.projects, searchQuery),
      suppliers: filterRows(data.suppliers, searchQuery),
      contacts: filterRows(data.contacts || [], searchQuery),
      materialLines: filterRows(data.materialLines || [], searchQuery),
      documents: filterRows(data.documents, searchQuery),
      invoices: filterRows(data.invoices || [], searchQuery),
      processedEmails: filterRows(data.processedEmails || [], searchQuery),
      reminders: filterRows(data.reminders || [], searchQuery).map((reminder) => ({
        ...reminder,
        body: languagePolicy.sanitize(reminder.body)
      })),
      activities: (data.activities || []).map(sanitizeItem),
      operationalQueue: (data.operationalQueue || []).map(sanitizeItem),
      operationalSuggestions: (data.operationalSuggestions || []).map(sanitizeItem)
    };
  }, [data, searchQuery]);

  // Se il modulo attivo viene disattivato lato backend mentre l'utente e'
  // dentro (o al prossimo refresh), riporta alla home invece di mostrare una
  // vista fantasma non piu' raggiungibile dalla sidebar.
  useEffect(() => {
    if (activeView === "settings") return;
    if (!navItems.some((item) => item.key === activeView)) setActiveView("dashboard");
  }, [navItems, activeView]);

  const currentTitle = labels[activeView] || config.product.name;

  function handleNavigate(view, context = {}) {
    if (!canAccessView(sessionUser?.role, view)) {
      setDrilldown({});
      setActiveView("dashboard");
      return;
    }
    setDrilldown(context);
    setActiveView(view);
  }

  function handleSelectReviewItem(item) {
    const nextSeenIds = Array.from(new Set([...seenReviewItemIds, item.id]));
    setSeenReviewItemIds(nextSeenIds);
    window.localStorage.setItem(SEEN_REVIEW_ITEMS_KEY, JSON.stringify(nextSeenIds));
    handleNavigate(item.view, item.orderCode ? { orderCode: item.orderCode } : {});
  }

  function handleSidebarNavigate(view) {
    setDrilldown({});
    setActiveView(view);
  }

  async function handleLogin(user) {
    if (AUTH_MODE === "supabase") {
      const client = getAuthClient();
      const { data: authData, error: authError } = await client.auth.signInWithPassword({
        email: user.email,
        password: user.password
      });
      if (authError) throw new Error("Email o password non corrette.");

      const response = await fetch("/api/session", {
        headers: { Authorization: `Bearer ${authData.session.access_token}` }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        await client.auth.signOut();
        throw new Error(payload.error || "Utente non autorizzato per questo pilota.");
      }
      setSessionUser(payload.user);
      return;
    }
    window.sessionStorage.setItem("orderwatch-session-user", JSON.stringify(user));
    setSessionUser(user);
  }

  async function handleForgotPassword(email) {
    const { error: resetError } = await getAuthClient().auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin
    });
    if (resetError) throw new Error("Non è stato possibile inviare l'email di recupero.");
  }

  async function handleUpdatePassword(password) {
    const { error: updateError } = await getAuthClient().auth.updateUser({ password });
    if (updateError) throw new Error("Non è stato possibile aggiornare la password.");
    window.history.replaceState({}, document.title, window.location.pathname);
    setPasswordRecovery(false);
  }

  async function handleLogout() {
    if (AUTH_MODE === "supabase") await getAuthClient().auth.signOut();
    window.sessionStorage.removeItem("orderwatch-session-user");
    setSessionUser(null);
    setData(null);
    setError(null);
    setLastUpdated(null);
    setSearchQuery("");
    setActiveView("dashboard");
  }

  async function handleUpdateOrder(orderId, fields) {
    const result = await adapter.updateOrder(orderId, fields);
    await loadData({ silent: true });
    return result;
  }

  async function handleUpdateProject(projectId, fields) {
    const result = await adapter.updateProject(projectId, fields);
    await loadData({ silent: true });
    return result;
  }

  async function handleProcurementRequirement(payload) {
    const result = await adapter.procurementRequirementAction(payload);
    await loadData({ silent: true });
    return result.requirement || result;
  }

  async function handleSaveContractProject(fields) {
    const result = await adapter.saveContractProject(fields);
    await loadData({ silent: true });
    return result.project || result;
  }

  async function handleSupplierAction(payload) {
    const result = await adapter.supplierAction(payload);
    await loadData({ silent: true });
    return result;
  }

  async function handleContactAction(payload) {
    const result = await adapter.contactAction(payload);
    await loadData({ silent: true });
    return result;
  }

  async function handleDeleteOrder(orderId) {
    const result = await adapter.deleteOrder(orderId);
    await loadData({ silent: true });
    return result;
  }

  async function handleUpdateSetting(settingId, fields) {
    const result = await adapter.updateSetting(settingId, fields);
    const updatedSetting = result.setting || result;

    setData((currentData) => {
      if (!currentData) return currentData;

      return {
        ...currentData,
        settings: (currentData.settings || []).map((setting) =>
          setting.id === updatedSetting.id ? { ...setting, ...updatedSetting } : setting
        )
      };
    });

    setLastUpdated(new Date());
    return updatedSetting;
  }

  async function handleSaveAppUser(fields) {
    const result = await adapter.saveAppUser(fields);
    const savedUser = result.user || result;

    setData((currentData) => {
      if (!currentData) return currentData;
      const users = currentData.appUsers || [];
      const exists = users.some((user) => user.id === savedUser.id);

      return {
        ...currentData,
        appUsers: exists
          ? users.map((user) => (user.id === savedUser.id ? { ...user, ...savedUser } : user))
          : [...users, savedUser]
      };
    });

    setLastUpdated(new Date());
    return savedUser;
  }

  async function handleSaveReportRecipient(fields) {
    const result = await adapter.saveReportRecipient(fields);
    const savedRecipient = result.recipient || result;

    setData((currentData) => {
      if (!currentData) return currentData;
      const recipients = currentData.reportRecipients || [];
      const exists = recipients.some((recipient) => recipient.id === savedRecipient.id);

      return {
        ...currentData,
        reportRecipients: exists
          ? recipients.map((recipient) => (recipient.id === savedRecipient.id ? { ...recipient, ...savedRecipient } : recipient))
          : [...recipients, savedRecipient]
      };
    });

    setLastUpdated(new Date());
    return savedRecipient;
  }

  async function handleDeleteReportRecipient(id) {
    const result = await adapter.deleteReportRecipient(id);
    const deletedId = result.deletedId || id;

    setData((currentData) => {
      if (!currentData) return currentData;

      return {
        ...currentData,
        reportRecipients: (currentData.reportRecipients || []).filter((recipient) => recipient.id !== deletedId)
      };
    });

    setLastUpdated(new Date());
    return deletedId;
  }

  async function handleSaveMailbox(fields) {
    const result = await adapter.saveMailbox(fields);
    const savedMailbox = result.mailbox || result;

    setData((currentData) => {
      if (!currentData) return currentData;
      const mailboxes = currentData.mailboxes || [];
      const exists = mailboxes.some((mailbox) => mailbox.id === savedMailbox.id);

      return {
        ...currentData,
        mailboxes: exists
          ? mailboxes.map((mailbox) => (mailbox.id === savedMailbox.id ? { ...mailbox, ...savedMailbox } : mailbox))
          : [...mailboxes, savedMailbox]
      };
    });

    setLastUpdated(new Date());
    return result;
  }

  async function handleTestMailbox(fields) {
    return adapter.testMailbox(fields);
  }

  async function handleDisconnectMailbox(id) {
    const result = await adapter.disconnectMailbox(id);
    const disconnectedMailbox = result.mailbox || result;

    setData((currentData) => {
      if (!currentData) return currentData;

      return {
        ...currentData,
        mailboxes: (currentData.mailboxes || []).map((mailbox) =>
          mailbox.id === disconnectedMailbox.id ? { ...mailbox, ...disconnectedMailbox } : mailbox
        )
      };
    });

    setLastUpdated(new Date());
    return disconnectedMailbox;
  }

  async function handleVerifyOperationalItem(item) {
    const result = await adapter.verifyOperationalItem({ kind: item.kind, id: item.entityId });
    await loadData({ silent: true });
    return result;
  }

  async function handleLinkOperationalItem(item, link) {
    const result = await adapter.linkOperationalItem({
      kind: item.kind,
      id: item.entityId,
      projectCode: link.projectCode || null,
      orderCode: link.orderCode || null
    });
    await loadData({ silent: true });
    return result;
  }

  async function handleVerifyMaterialLines(lineIds) {
    const ids = [...new Set(lineIds || [])].filter(Boolean);
    const results = await Promise.all(
      ids.map((id) => adapter.verifyOperationalItem({ kind: "material_line", id }))
    );
    await loadData({ silent: true });
    return results;
  }

  async function handleLinkMaterialLines(lineIds, link) {
    const ids = [...new Set(lineIds || [])].filter(Boolean);
    const results = await Promise.all(
      ids.map((id) => adapter.linkOperationalItem({
        kind: "material_line",
        id,
        projectCode: link.projectCode || null,
        orderCode: link.orderCode || null
      }))
    );
    await loadData({ silent: true });
    return results;
  }

  async function handlePrepareCustomerConfirmation(item) {
    const result = await adapter.prepareCustomerConfirmation(item.entityId);
    await loadData({ silent: true });
    return result.confirmation || result;
  }

  async function handleUpdateCustomerConfirmation(fields) {
    const result = await adapter.updateCustomerConfirmation(fields);
    await loadData({ silent: true });
    return result.confirmation || result;
  }

  async function handleSendCustomerConfirmation(fields) {
    const result = await adapter.sendCustomerConfirmation({
      ...fields,
      approvedBy: sessionUser?.email || "Buyer OrderWatch"
    });
    await loadData({ silent: true });
    return result.confirmation || result;
  }

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={loginThemeStyle}>
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>Verifica sessione...</p>
      </div>
    );
  }

  if (AUTH_MODE === "supabase" && passwordRecovery) {
    return <div style={loginThemeStyle}><PasswordResetView onUpdatePassword={handleUpdatePassword} /></div>;
  }

  if (!sessionUser) {
    return (
      <div style={loginThemeStyle}>
        <LoginView config={config} authMode={AUTH_MODE} onLogin={handleLogin} onForgotPassword={handleForgotPassword} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center" style={appThemeStyle}>
        <div>
          <p className="font-semibold text-[color:var(--color-danger)]">Errore nel caricamento dati</p>
          <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={appThemeStyle}>
        <p className="text-sm text-[color:var(--color-text-muted)]">Caricamento dati...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen" style={appThemeStyle}>
      <Sidebar config={config} navItems={navItems} activeView={activeView} onNavigate={handleSidebarNavigate} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          title={currentTitle}
          tagline={config.product.tagline}
          companyName={config.company.name}
          userEmail={sessionUser.email}
          onLogout={handleLogout}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          reviewItems={visibleReviewItems}
          unseenReviewCount={unseenReviewCount}
          onNotificationsOpened={handleNotificationsOpened}
          onSelectReviewItem={handleSelectReviewItem}
          lastUpdated={lastUpdated}
          onRefresh={() => loadData()}
          isRefreshing={isRefreshing}
        />
        <main className="min-w-0 flex-1 p-3 sm:p-4 lg:p-5">
          {activeView === "dashboard" && (
            <DashboardView
              config={config}
              data={data}
              onNavigate={handleNavigate}
              onVerifyOperationalItem={canWriteOperationalData(sessionUser?.role) ? handleVerifyOperationalItem : null}
              onLinkOperationalItem={canWriteOperationalData(sessionUser?.role) ? handleLinkOperationalItem : null}
              onPrepareCustomerConfirmation={canWriteOperationalData(sessionUser?.role) ? handlePrepareCustomerConfirmation : null}
              onUpdateCustomerConfirmation={canWriteOperationalData(sessionUser?.role) ? handleUpdateCustomerConfirmation : null}
              onSendCustomerConfirmation={canWriteOperationalData(sessionUser?.role) ? handleSendCustomerConfirmation : null}
              onPrepareSupplierOrder={canWriteOperationalData(sessionUser?.role) && backendModuleFlags.supplier_orders !== false && getWorkflowPolicy(settingsValue(data.settings, "workflow.traceability_mode")).allowSupplierOrderPreparation ? setSupplierOrderItem : null}
            />
          )}
          {activeView === "orders" && (
            <OrdersView
              config={config}
              orders={filteredData.orders}
              focusOrderCode={drilldown.orderCode}
              presetFilter={drilldown.ordersFilter}
              onClearFilter={() => setDrilldown({})}
              onUpdateOrder={handleUpdateOrder}
              onDeleteOrder={handleDeleteOrder}
              materialLines={filteredData.materialLines || []}
              materialLineRevisions={data.materialLineRevisions || []}
              pendingDeliveryNotesCount={(data.deliveryNotes || []).filter((note) => note.needsReview).length}
              onNavigate={handleNavigate}
              onPrepareSupplierOrder={canWriteOperationalData(sessionUser?.role) && backendModuleFlags.supplier_orders !== false && getWorkflowPolicy(settingsValue(data.settings, "workflow.traceability_mode")).allowSupplierOrderPreparation
                ? (item) => setSupplierOrderItem(item)
                : null}
            />
          )}
          {activeView === "projects" && (
            <ProjectsView
              config={config}
              projects={filteredData.projects}
              materialLines={filteredData.materialLines || []}
              orders={filteredData.orders || []}
              activities={data.activities || []}
              focusProjectCode={drilldown.projectCode}
              onNavigate={handleNavigate}
              onUpdateProject={canWriteOperationalData(sessionUser?.role) ? handleUpdateProject : null}
              onCreateProcurementRequirement={canWriteOperationalData(sessionUser?.role) ? handleProcurementRequirement : null}
            />
          )}
          {activeView === "contract_watch" && (
            <ContractProjectsView
              projects={filteredData.projects || []}
              contacts={data.contacts || []}
              appUsers={data.appUsers || []}
              progressReports={data.contractProgressReports || []}
              billingItems={data.contractBillingItems || []}
              operationalActions={data.operationalActions || []}
              focusProjectCode={drilldown.projectCode}
              focusBillingItemId={drilldown.billingItemId}
              readOnly={sessionUser?.role === "ReadOnly"}
              onSave={handleSaveContractProject}
              adapter={adapter}
              onRefresh={() => loadData({ silent: true })}
            />
          )}
          {activeView === "suppliers" && (
            <SuppliersView
              config={config}
              suppliers={filteredData.suppliers}
              supplierContacts={data.supplierContacts || []}
              materialLines={data.materialLines || []}
              orders={data.orders || []}
              projects={data.projects || []}
              activities={data.activities || []}
              focusSupplierId={drilldown.supplierId}
              focusSupplierName={drilldown.supplierName}
              focusTab={drilldown.supplierTab}
              focusMaterialLineIds={drilldown.materialLineIds || []}
              onNavigate={handleNavigate}
              onSupplierAction={canWriteOperationalData(sessionUser?.role) ? handleSupplierAction : null}
              onVerifyMaterialLines={canWriteOperationalData(sessionUser?.role) ? handleVerifyMaterialLines : null}
              onLinkMaterialLines={canWriteOperationalData(sessionUser?.role) ? handleLinkMaterialLines : null}
              onPrepareSupplierOrder={canWriteOperationalData(sessionUser?.role) && backendModuleFlags.supplier_orders !== false && getWorkflowPolicy(settingsValue(data.settings, "workflow.traceability_mode")).allowSupplierOrderPreparation
                ? (item) => setSupplierOrderItem(item)
                : null}
            />
          )}
          {activeView === "contacts" && (
            <ContactsView
              data={{ ...data, contacts: filteredData.contacts }}
              onContactAction={handleContactAction}
              readOnly={sessionUser?.role === "ReadOnly"}
            />
          )}
          {activeView === "quotes" && (
            <QuotesView
              data={filteredData}
              onNavigate={handleNavigate}
              focusQuoteId={drilldown.quoteId}
              onConvertQuote={canWriteOperationalData(sessionUser?.role) && backendModuleFlags.supplier_orders !== false && getWorkflowPolicy(settingsValue(data.settings, "workflow.traceability_mode")).allowSupplierOrderPreparation
                ? (item) => setSupplierOrderItem(item)
                : null}
              onVerifyQuote={canWriteOperationalData(sessionUser?.role) ? handleVerifyOperationalItem : null}
            />
          )}
          {activeView === "receiving" && <ReceivingView adapter={adapter} readOnly={sessionUser?.role === "ReadOnly"} focusDeliveryNoteId={drilldown.deliveryNoteId} />}
          {activeView === "altera" && <AlteraView adapter={adapter} onNavigate={handleNavigate} />}
          {activeView === "documents" && <DocumentsView config={config} documents={filteredData.documents} />}
          {activeView === "invoices" && <InvoicesView config={config} invoices={filteredData.invoices} />}
          {activeView === "imports" && <ImportsView config={config} processedEmails={filteredData.processedEmails} focusEmailId={drilldown.emailId} />}
          {activeView === "reminders" && <NotificationsView config={config} data={filteredData} onNavigate={handleNavigate} />}
          {activeView === "settings" && (
            <SettingsView
              config={config}
              data={data}
              onUpdateSetting={handleUpdateSetting}
              onSaveAppUser={handleSaveAppUser}
              onSaveReportRecipient={handleSaveReportRecipient}
              onDeleteReportRecipient={handleDeleteReportRecipient}
              onSaveMailbox={handleSaveMailbox}
              onTestMailbox={handleTestMailbox}
              onDisconnectMailbox={handleDisconnectMailbox}
              mailboxManagementEnabled={MAILBOX_MANAGEMENT_ENABLED}
              onNavigate={handleNavigate}
              meta={{
                mode: USES_MOCK_DATA ? "mock" : "live",
                lastUpdated,
                counts: {
                  orders: data.orders.length,
                  projects: data.projects.length,
                  suppliers: data.suppliers.length,
                  documents: data.documents.length,
                  processedEmails: data.processedEmails?.length || 0,
                  review: visibleReviewItems.length
                }
              }}
            />
          )}
        </main>
      </div>
      <SupplierOrderDrawer
        open={Boolean(supplierOrderItem)}
        item={supplierOrderItem}
        data={data}
        adapter={adapter}
        onClose={() => setSupplierOrderItem(null)}
        onDone={() => loadData({ silent: true })}
      />
    </div>
  );
}
