import { Bell, LogOut, Search } from "lucide-react";
import Button from "./Button";

export default function Topbar({ title, tagline, userEmail, onLogout }) {
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
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-64 items-center gap-2 rounded-md border px-3" style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}>
          <Search className="h-4 w-4" />
          <span className="text-sm">Cerca ordini, fornitori, lavori</span>
        </div>
        <Button variant="secondary" className="h-9 w-9 px-0" aria-label="Notifiche">
          <Bell className="h-4 w-4" />
        </Button>
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
