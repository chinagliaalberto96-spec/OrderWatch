// Brand mark ufficiale del prodotto OrderWatch ("Graphite & Coral").
// Icona "Scan ring" v2: anello quasi chiuso (monitoraggio continuo) con una
// spunta corallo piu' marcata nel piccolo varco in basso, a evocare una
// scansione che si chiude con una conferma. Wordmark a due toni: "Order" nel
// colore del ring, "Watch" in corallo (logo migliorato, giugno 2026).
// E' un brand generico di prodotto, indipendente dal tema del singolo cliente:
// usa colori fissi (non le CSS var --color-*) cosi' resta identico ovunque
// venga mostrato, anche dentro un'interfaccia con palette cliente diversa
// (es. "Ink & Paper" di Graphic Center Group).
//
// Usato in: Sidebar.jsx (blocco "Powered by") e LoginView.jsx (header form login).

const GRAPHITE = "#23262B";
const CORAL = "#FF5A48";
const WHITE = "#FFFFFF";

const sizeMap = {
  sm: { icon: 24, text: "text-sm", gap: "gap-2" },
  md: { icon: 32, text: "text-lg", gap: "gap-2.5" },
  lg: { icon: 40, text: "text-2xl", gap: "gap-3" }
};

function ScanRingIcon({ pixelSize, tone }) {
  const ringColor = tone === "dark" ? WHITE : GRAPHITE;
  const checkColor = CORAL;

  return (
    <svg
      width={pixelSize}
      height={pixelSize}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Anello quasi chiuso: varco stretto (~80 grad) in basso, centrato */}
      <path
        d="M 14.36 35.49 A 15 15 0 1 1 33.64 35.49"
        stroke={ringColor}
        strokeWidth="5"
        strokeLinecap="round"
      />
      {/* Spunta corallo, piu' marcata, che attraversa il varco verso l'interno */}
      <path
        d="M 17 32 L 22 38 L 32 23"
        stroke={checkColor}
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function OrderWatchMark({ variant = "full", size = "md", tone = "light", className = "" }) {
  const config = sizeMap[size] || sizeMap.md;
  const textColor = tone === "dark" ? WHITE : GRAPHITE;

  if (variant === "mark") {
    return (
      <span className={`inline-flex ${className}`}>
        <ScanRingIcon pixelSize={config.icon} tone={tone} />
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center ${config.gap} ${className}`}>
      <ScanRingIcon pixelSize={config.icon} tone={tone} />
      <span className={`font-heading font-extrabold tracking-tight ${config.text}`}>
        <span style={{ color: textColor }}>Order</span>
        <span style={{ color: CORAL }}>Watch</span>
      </span>
    </span>
  );
}
