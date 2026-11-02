import type { ButtonHTMLAttributes, ReactNode } from "react";

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost"; size?: "sm" | "md" };

export function Button({ variant = "secondary", size = "md", className = "", ...rest }: BtnProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const sizes = { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-sm" };
  const variants = {
    primary: "bg-brass text-ink-950 hover:bg-[#e6b456]",
    secondary: "border border-line-strong bg-ink-850 text-fg hover:border-faint",
    ghost: "text-muted hover:text-fg",
  };
  return <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...rest} />;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-line bg-ink-900 ${className}`}>{children}</section>;
}

export function Stat({ label, value, className = "" }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted">{label}</div>
      <div className={`num mt-1 truncate text-base ${className}`}>{value}</div>
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 text-sm text-muted">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-faint border-t-brass" />
      {label}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-down/40 bg-down/10 px-3 py-2 text-sm text-down">{children}</div>;
}
