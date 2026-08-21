import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Search, X } from "lucide-react";
import { TONE_CLASSES, type Tone } from "@/lib/admin-dashboard-model";
import { initials as toInitials } from "@/lib/admin-dashboard-format";
import { cn } from "@/lib/utils";

/** Building blocks shared by every dashboard screen, styled from the `--color-admin-*` tokens. */

export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("text-[11.5px] font-medium tracking-[0.2em] text-admin-gold", className)}>
      {children}
    </p>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  id
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  id?: string;
}) {
  return (
    <header>
      <Eyebrow>{eyebrow}</Eyebrow>
      <div className="mt-3.5 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between sm:gap-10">
        <div className="max-w-[660px]">
          <h1 id={id} className="text-[clamp(2.25rem,5vw,3.25rem)] leading-[1.05]">
            {title}
          </h1>
          {description && (
            <p className="mt-3.5 text-base leading-[1.55] text-admin-ink-soft sm:text-[16.5px]">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2.5">{actions}</div>}
      </div>
    </header>
  );
}

export function Panel({
  children,
  className,
  ...rest
}: React.HTMLAttributes<HTMLElement> & { children: React.ReactNode }) {
  return (
    <section
      {...rest}
      className={cn("rounded-[14px] border border-admin-line bg-admin-surface", className)}
    >
      {children}
    </section>
  );
}

export function PanelHeading({
  children,
  aside
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-5">
      <h2 className="text-[25px]">{children}</h2>
      {aside && <span className="text-[13px] text-admin-faint">{aside}</span>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  valueClassName
}: {
  label: string;
  value: string;
  hint?: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-xl border border-admin-line bg-admin-surface px-[22px] py-5">
      <div className="text-[11.5px] font-medium tracking-[0.14em] text-admin-muted">{label}</div>
      <div className="mt-3 flex items-baseline gap-2.5">
        <span
          className={cn("font-admin-serif text-[34px] leading-none text-admin-ink", valueClassName)}
        >
          {value}
        </span>
        {hint && <span className="text-[12.5px] text-admin-faint">{hint}</span>}
      </div>
    </div>
  );
}

export function StatusPill({
  tone,
  children,
  withDot = false,
  className
}: {
  tone: Tone;
  children: React.ReactNode;
  withDot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[7px] whitespace-nowrap rounded-full px-[11px] py-[5px] text-[12.5px] font-medium",
        TONE_CLASSES[tone],
        className
      )}
    >
      {withDot && <span className="size-1.5 rounded-full bg-current opacity-80" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Avatar({
  name,
  className,
  text
}: {
  name: string;
  className?: string;
  text?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full bg-admin-mute-bg text-xs font-semibold text-admin-ink-soft",
        className
      )}
    >
      {text ?? toInitials(name)}
    </span>
  );
}

export function FilterTabs<T extends string>({
  options,
  value,
  onChange,
  label,
  className
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex flex-wrap gap-1.5 rounded-[10px] bg-admin-sunken p-1", className)}
    >
      {options.map((option) => {
        const active = option === value;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option)}
            className={cn(
              "min-h-9 whitespace-nowrap rounded-[7px] px-3.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ink",
              active
                ? "bg-admin-surface text-admin-ink shadow-[0_1px_2px_rgb(29_42_36/0.09)]"
                : "text-admin-slate hover:text-admin-ink"
            )}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
  label,
  className
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  label: string;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 min-w-[240px] flex-1 items-center gap-2.5 rounded-[9px] border border-admin-line-strong bg-admin-subtle px-3.5 focus-within:border-admin-ink sm:max-w-[340px]",
        className
      )}
    >
      <Search className="size-[15px] shrink-0 opacity-50" strokeWidth={1.7} aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm text-admin-ink outline-none placeholder:text-admin-fainter"
      />
    </label>
  );
}

export function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11.5px] font-medium tracking-[0.13em] text-admin-faint">{label}</dt>
      <dd className="mt-1.5 text-[15px] text-admin-ink">{value}</dd>
    </div>
  );
}

const buttonBase =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[9px] px-[18px] text-sm font-medium transition-[background-color,color,filter] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ink focus-visible:ring-offset-2 focus-visible:ring-offset-admin-canvas disabled:cursor-not-allowed disabled:opacity-75";

export const ADMIN_BUTTON = {
  primary: cn(buttonBase, "bg-admin-ink text-white hover:bg-admin-ink-hover disabled:bg-admin-disabled"),
  neutral: cn(
    buttonBase,
    "border border-admin-line-strong bg-admin-surface text-admin-ink hover:bg-admin-sunken"
  ),
  danger: cn(
    buttonBase,
    "border border-admin-danger-edge bg-admin-surface text-admin-danger hover:bg-admin-danger-soft"
  ),
  destructive: cn(buttonBase, "bg-admin-danger text-white hover:bg-admin-danger-hover"),
  confirm: cn(buttonBase, "bg-admin-ok-fg text-white hover:brightness-110 disabled:bg-admin-disabled")
};

/** Back link above a detail screen ("‹ VOLTAR PARA CONVITES"). */
export function BackLink({ href, onClick, children }: { href: string; onClick: (event: React.MouseEvent) => void; children: React.ReactNode }) {
  return (
    <a
      href={href}
      onClick={onClick}
      className="inline-flex min-h-11 items-center gap-2.5 rounded-lg py-2 pl-2 pr-3 text-[13.5px] font-medium tracking-[0.02em] text-admin-gold hover:bg-admin-gold-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ink"
    >
      {children}
    </a>
  );
}

/**
 * Modal shell for every dashboard dialog. Wraps Radix so focus trapping, Escape and
 * scroll locking come for free while the surface keeps the panel's own styling.
 */
export function AdminModal({
  open,
  onOpenChange,
  title,
  eyebrow,
  description,
  children,
  footer,
  widthClassName = "max-w-[520px]",
  alignTop = false,
  icon,
  closeButton = false
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  eyebrow?: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  widthClassName?: string;
  alignTop?: boolean;
  icon?: React.ReactNode;
  closeButton?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="admin-shell fixed inset-0 z-50 overflow-y-auto bg-[rgb(20_30_25/0.42)] data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            "admin-shell fixed left-1/2 z-50 w-[calc(100%-2rem)] -translate-x-1/2 overflow-hidden rounded-2xl border border-admin-line bg-admin-canvas text-admin-ink shadow-[0_26px_70px_rgb(20_30_25/0.28)] data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            alignTop
              ? "top-6 max-h-[calc(100dvh-3rem)] overflow-y-auto sm:top-12 sm:max-h-[calc(100dvh-6rem)]"
              : "top-1/2 max-h-[calc(100dvh-3rem)] -translate-y-1/2 overflow-y-auto",
            widthClassName
          )}
        >
          <div className="px-7 pb-6 pt-7">
            <div className="flex items-start gap-3.5">
              {icon}
              <div className="min-w-0">
                {eyebrow && (
                  <div className="text-[11px] font-medium tracking-[0.2em] text-admin-gold">
                    {eyebrow}
                  </div>
                )}
                <DialogPrimitive.Title className="mt-1.5 font-admin-serif text-[27px] font-normal leading-[1.15]">
                  {title}
                </DialogPrimitive.Title>
              </div>
              {closeButton && (
                <DialogPrimitive.Close className="ml-auto flex size-11 shrink-0 items-center justify-center rounded-full border border-admin-line-strong bg-admin-surface text-admin-ink-soft hover:bg-admin-gold-tint hover:text-admin-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ink">
                  <X className="size-4" strokeWidth={1.7} />
                  <span className="sr-only">Fechar</span>
                </DialogPrimitive.Close>
              )}
            </div>
            {description && (
              <DialogPrimitive.Description className="mt-4 text-[14.5px] leading-[1.55] text-admin-ink-soft [text-wrap:pretty]">
                {description}
              </DialogPrimitive.Description>
            )}
            {children}
          </div>
          {footer && (
            <div className="flex flex-wrap items-center gap-3.5 border-t border-admin-line bg-admin-surface px-7 py-4">
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Right-aligned cancel/confirm pair used by most modals. */
export function ModalActions({ children }: { children: React.ReactNode }) {
  return <div className="ml-auto flex shrink-0 flex-wrap justify-end gap-2.5">{children}</div>;
}

export function ModalNote({ tone, children }: { tone: "info" | "error"; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "min-w-[170px] flex-1 text-[13px] leading-[1.45]",
        tone === "error" ? "text-admin-danger" : "text-admin-muted"
      )}
    >
      {children}
    </p>
  );
}

export function TextInput({
  label,
  hint,
  invalid = false,
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: React.ReactNode;
  invalid?: boolean;
}) {
  // The hint is described, not labelled: a wrapping <label> would fold it into the
  // input's accessible name and have screen readers read it as part of the field.
  const id = React.useId();
  const hintId = `${id}-hint`;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label
        htmlFor={id}
        className="text-[11.5px] font-medium tracking-[0.13em] text-admin-muted"
      >
        {label}
      </label>
      <input
        {...rest}
        id={id}
        aria-invalid={invalid || undefined}
        aria-describedby={hint ? hintId : undefined}
        className={cn(
          "min-h-11 rounded-[9px] border bg-admin-surface px-3.5 text-[14.5px] text-admin-ink outline-none focus:border-admin-ink",
          invalid ? "border-admin-field-error" : "border-admin-line-strong"
        )}
      />
      {hint && (
        <span id={hintId} className="text-xs leading-[1.45] text-admin-fainter">
          {hint}
        </span>
      )}
    </div>
  );
}
