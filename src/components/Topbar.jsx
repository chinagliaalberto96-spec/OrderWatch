import { useState } from "react";
import { Bell, LogOut, RefreshCw, Search } from "lucide-react";
import Button from "./Button";

export default function Topbar({
  title,
  tagline,
  userEmail,
  onLogout,
  searchQuery = "",
  onSearchChange,
  reviewItems = [],
  onSelectReviewItem,
  lastUpdated,
  onRefresh,
  isRefreshing
}) {
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  return (
    <header
      className="relative flex h-[68px] items-center justify-between border-b bg-white px-6"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-card)" }}
    >
      <div
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ background: "linear-gradient(90deg, var(--color-primary), var(--color-accent))" }}
      />
      <div className="flex min-w-0 items-center gap-4">
        <div>
          <h1 className="text-[22px] font-semibold leading-7" style={{ color: "var(--color-text)" }}>
            {title}
          </h1>
          <p className="text-[13px]" style={{ color: "var(--color-text-muted)" }}>
            {tagline}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {lastUpdated && (
          <span className="hidden text-xs lg:block" style={{ color: "var(--color-text-muted)" }}>
            Aggiornato alle{" "}
            {lastUpdated.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        <Button
          variant="secondary"
          className="h-9 w-9 px-0"
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-label="Aggiorna dati"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
        </Button>
        <div
          className="flex h-9 w-64 items-center gap-2 rounded-md border px-3"
          style={{ borderColor: "var(--color-border)" }}
        >
          <Search className="h-4 w-4 shrink-0" style={{ color: "var(--color-text-muted)" }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => onSearchChange?.(event.target.value)}
            placeholder="Cerca ordini, fornitori, lavori"
            className="h-full w-full border-0 bg-transparent text-sm outline-none placeholder:text-[color:var(--color-text-muted)]"
            style={{ color: "var(--color-text)" }}
          />
        </div>
        <div className="relative">
          <Button
            variant="secondary"
            className="relative h-9 w-9 px-0"
            aria-label="Notifiche"
            onClick={() => setNotificationsOpen((open) => !open)}
          >
            <Bell className="h-4 w-4" />
            {reviewItems.length > 0 && (
              <span
                className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white"
                style={{ backgroundColor: "var(--color-danger)" }}
              >
                {reviewItems.length}
              </span>
            )}
          </Button>
          {notificationsOpen && (
            <>
              <button
                type="button"
                className="fixed inset-0 z-10 cursor-default"
                aria-label="Chiudi notifiche"
                onClick={() => setNotificationsOpen(false)}
              />
              <div
                className="absolute right-0 top-11 z-20 w-72 rounded-md border p-2 shadow-elevated"
                style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-card)" }}
              >
                <div
                  className="px-2 py-1 text-xs font-semibold uppercase tracking-wide"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Da verificare
                </div>
                {reviewItems.length === 0 ? (
                  <div className="px-2 py-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
                    Nessun elemento da verificare.
                  </div>
                ) : (
                  <ul className="max-h-64 space-y-1 overflow-y-auto">
                    {reviewItems.slice(0, 8).map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className="w-full rounded-md px-2 py-2 text-left text-sm transition hover:bg-[color:var(--color-primary-soft)]"
                          onClick={() => {
                            onSelectReviewItem?.(item.view);
                            setNotificationsOpen(false);
                          }}
                        >
                          {item.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
        {userEmail && (
          <div className="hidden max-w-48 truncate text-sm lg:block" style={{ color: "var(--color-text-muted)" }}>
            {userEmail}
          </div>
        )}
        {onLogout && (
          <Button variant="secondary" className="h-9 w-9 px-0" onClick={onLogout} aria-label="Esci">
            <LogOut className="h-4 w-4" />
          </Button>
        )}
      </div>
    </header>
  );
}
