import { Info } from "lucide-react";
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
};

export function Button({ variant = "secondary", size = "md", className = "", ...rest }: BtnProps) {
  const base =
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100";
  // 44px tall on touch widths, the compact heights only from lg up.
  const sizes = { sm: "h-11 px-3 text-sm lg:h-9", md: "h-11 px-4 text-sm lg:h-10", lg: "h-12 px-5 text-[15px]" };
  const variants = {
    primary: "bg-green-deep text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.14)] hover:bg-green-deep-hover",
    secondary: "border border-line-strong bg-ink-800 text-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.05)] hover:border-faint",
    ghost: "text-muted hover:text-fg",
    danger: "border border-down/60 text-down hover:bg-down/10",
  };
  return <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...rest} />;
}

/** `danger` is a prop, not a className: two border colors in one class list resolve by CSS order, not by intent. */
export function Card({ children, className = "", danger = false }: { children: ReactNode; className?: string; danger?: boolean }) {
  return <section className={`rounded-2xl border bg-ink-900 ${danger ? "border-down/50" : "border-line"} ${className}`}>{children}</section>;
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 text-sm text-muted">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-faint border-t-green" />
      {label}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-down/40 bg-ink-900 px-3 py-2 text-sm text-down">{children}</div>;
}

/** A status line the visitor should not miss, such as the demo purchase banner. */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="flex items-center gap-2 rounded-lg border border-green/40 bg-ink-900 px-4 py-3 text-sm">
      <Info size={16} strokeWidth={1.5} className="shrink-0 text-green" aria-hidden />
      {children}
    </div>
  );
}

/** Inputs and selects share one look. */
export const fieldClass =
  "h-11 w-full rounded-lg border bg-ink-800 px-3 text-sm text-fg transition-colors focus:border-green focus:outline-none";

/**
 * The one modal. A plain fixed layer rather than <dialog>.showModal(): the top layer would sit above
 * the NEAR wallet popup and leave it unclickable, and Buy key opens that popup from inside this.
 */
export function Dialog({
  labelledBy,
  onClose,
  danger = false,
  children,
}: {
  labelledBy: string;
  onClose: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
      // Keep Tab inside the dialog, but leave focus alone while it is in the wallet popup.
      const root = panel.current;
      if (e.key !== "Tab" || !root?.contains(document.activeElement)) return;
      const items = root.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), input, select");
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-4 sm:items-center" onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`rise max-h-full w-full max-w-md overflow-y-auto rounded-2xl border bg-ink-900 p-6 focus:outline-none ${danger ? "border-down/50" : "border-line-strong"}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
