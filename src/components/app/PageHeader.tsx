import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-bold">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("panel flex flex-col items-center gap-3 px-6 py-14 text-center", className)}>
      <span className="grid size-11 place-items-center rounded-full bg-secondary">
        <Inbox className="size-5 text-muted-foreground" />
      </span>
      <div>
        <p className="font-display text-base font-semibold">{title}</p>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: "default" | "success" | "warning" | "danger" | "accent";
}) {
  const tones: Record<string, string> = {
    default: "bg-secondary text-secondary-foreground",
    success: "bg-success/12 text-success",
    warning: "bg-warning/15 text-warning-foreground",
    danger: "bg-destructive/12 text-destructive",
    accent: "bg-accent/15 text-accent-foreground",
  };
  return (
    <div className="panel p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {Icon && (
          <span className={cn("grid size-8 shrink-0 place-items-center rounded-md", tones[tone])}>
            <Icon className="size-4" />
          </span>
        )}
      </div>
      <p className="mt-2 font-display text-2xl font-bold text-numeric">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
