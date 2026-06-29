// Brand mark ufficiale del prodotto OrderWatch ("Graphite & Coral").
// Icona "Eye Watch" (giugno 2026, v5): non e' piu' un SVG disegnato a mano,
// ma il lockup grafico finale fornito dal cliente, salvato come PNG
// trasparente in public/brand/ e renderizzato via <img>. Questo garantisce
// fedelta' visiva perfetta rispetto al file approvato (niente piu'
// approssimazione di curve/proporzioni in SVG).
//
// Due asset, uno per superficie:
//  - orderwatch-lockup-light.png: icona+wordmark grafite, lockup verticale
//    (icona sopra, testo sotto) — usato su superfici chiare (pannello bianco
//    del form di Login).
//  - orderwatch-lockup-dark.png: icona+wordmark bianchi, lockup orizzontale
//    (icona a sinistra, testo a destra) — usato su superfici scure (sfondo
//    navy della Sidebar). Sfondo reso trasparente in fase di ritaglio cosi'
//    si fonde con qualsiasi sfondo scuro, incluso SIDEBAR_INK.
//
// Usato in: Sidebar.jsx (header, tone="dark") e LoginView.jsx (header form
// login, tone="light" di default).

// Stesso blu-navy usato per il pannello hero scuro del Login (LoginView.jsx,
// HERO_INK) e per lo sfondo della Sidebar — un solo "ink" scuro di brand.
export const SIDEBAR_INK = "#141820";

const LOCKUP_LIGHT = "/brand/orderwatch-lockup-light.png";
const LOCKUP_DARK = "/brand/orderwatch-lockup-dark.png";

// Altezza del lockup per ciascuna `size`. Le due immagini hanno proporzioni
// diverse (light = verticale ~1.64:1, dark = orizzontale ~4.97:1): la
// larghezza segue automaticamente (width: "auto") mantenendo l'aspect ratio
// originale del file, quindi qui si controlla solo l'altezza.
const heightMap = {
  sm: 26,
  md: 34,
  lg: 84
};

export default function OrderWatchMark({ size = "md", tone = "light", className = "" }) {
  const height = heightMap[size] || heightMap.md;
  const src = tone === "dark" ? LOCKUP_DARK : LOCKUP_LIGHT;

  return (
    <img
      src={src}
      alt="OrderWatch"
      className={className}
      style={{ height, width: "auto", display: "block" }}
    />
  );
}
