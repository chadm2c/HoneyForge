import type { ReactNode } from "react";

/** The muted paragraph shown when a list is legitimately empty. */
export default function EmptyState({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={"text-sm text-slate-500 " + (className ?? "")}>{children}</p>
  );
}
