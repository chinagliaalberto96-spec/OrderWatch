export default function Button({ children, variant = "primary", className = "", ...props }) {
  const variants = {
    primary: "text-white",
    secondary: "border bg-white",
    ghost: "bg-transparent"
  };

  const style =
    variant === "primary"
      ? { backgroundColor: "var(--color-primary)" }
      : { borderColor: "var(--color-border)", color: "var(--color-text)" };

  return (
    <button
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      style={style}
      {...props}
    >
      {children}
    </button>
  );
}
