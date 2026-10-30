import type { ReactNode } from "react";

export function PageHeader({ title, description, actions, className = "mb-6" }: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-end justify-between gap-4 ${className}`}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Card({ title, description, actions, children, className = "" }: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`glass min-w-0 rounded-2xl p-4 sm:p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-xl bg-sunken ${className}`} />;
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <span className="text-subtle">{icon}</span>
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
    </div>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
      {message}
    </p>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: "success" | "danger" }) {
  return (
    // A row of label and value on phones, where three columns leave no room for the amount.
    <div className="glass flex min-w-0 items-baseline justify-between gap-3 rounded-xl px-4 py-2.5 sm:block sm:p-4">
      <p className="text-sm font-medium text-muted">{label}</p>
      <p className={`tabular truncate font-semibold sm:mt-1 sm:text-xl ${tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : ""}`}>
        {value}
      </p>
    </div>
  );
}
