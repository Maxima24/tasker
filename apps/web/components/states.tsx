import * as React from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-ink-300 bg-white px-6 py-14 text-center",
        className,
      )}
    >
      {icon && <div className="text-ink-400">{icon}</div>}
      <div className="space-y-1">
        <p className="text-base font-medium text-ink-900">{title}</p>
        {description && (
          <p className="mx-auto max-w-md text-sm text-ink-500">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  retry,
}: {
  title?: string;
  description?: string;
  retry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-status-rejected/40 bg-white/60 px-6 py-12 text-center">
      <p className="text-base font-medium text-status-rejected">{title}</p>
      {description && (
        <p className="max-w-md text-sm text-ink-500">{description}</p>
      )}
      {retry && (
        <button
          type="button"
          onClick={retry}
          className="text-sm text-ink-500 underline underline-offset-4 hover:text-ink-700"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function PageHeading({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
          {title}
        </h1>
        {description && (
          <p className="max-w-2xl text-ink-500">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
