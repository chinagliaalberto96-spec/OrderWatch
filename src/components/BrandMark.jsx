import { Building2 } from "lucide-react";

export default function BrandMark({ label, logoUrl, initials, tone = "primary", size = "md" }) {
  const sizes = {
    sm: "h-8 w-8 text-xs",
    md: "h-10 w-10 text-sm",
    lg: "h-12 w-12 text-base"
  };

  if (logoUrl) {
    return (
      <img
        className={`${sizes[size]} rounded-md border object-contain bg-white p-1`}
        src={logoUrl}
        alt={label}
        style={{ borderColor: "var(--color-border)" }}
      />
    );
  }

  return (
    <div
      className={`${sizes[size]} flex items-center justify-center rounded-md font-semibold text-white`}
      style={{ backgroundColor: `var(--color-${tone})` }}
      aria-label={label}
    >
      {initials || <Building2 className="h-5 w-5" />}
    </div>
  );
}
