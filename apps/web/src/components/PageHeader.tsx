import type { ReactNode } from 'react';

/**
 * The top of every page: an optional back link, the page's <h1>, a short description and
 * the page's actions on the right.
 */
export function PageHeader({
  id,
  title,
  description,
  back,
  actions,
}: {
  /** The heading's id, for the page section's aria-labelledby. */
  id: string;
  title: ReactNode;
  description?: ReactNode;
  back?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      {back}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 id={id} className="text-2xl font-semibold tracking-tight">
            {title}
          </h1>
          {description && <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
