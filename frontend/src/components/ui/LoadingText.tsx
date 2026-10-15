import type { ReactNode } from "react";
import EmptyState from "./EmptyState";

/**
 * The loading counterpart of `EmptyState`. Loading is an empty page whose text
 * has not arrived yet, so it shares the same muted paragraph styling.
 */
export default function LoadingText({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <EmptyState className={className}>{children ?? "Loading…"}</EmptyState>
  );
}
