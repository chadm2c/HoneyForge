import type { ReactNode } from "react";

/**
 * A titled content box — the `border-slate-800` card repeated across the admin
 * pages. `title` is optional (a filter bar has no heading); when present it
 * renders the shared cyan section heading.
 */
export default function Panel({
  title,
  className,
  children,
}: {
  title?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={"rounded border border-slate-800 bg-slate-900 p-4 " + (className ?? "")}>
      {title && (
        <h3 className="text-xs font-semibold tracking-wide text-cyan-300">{title}</h3>
      )}
      {children}
    </div>
  );
}
