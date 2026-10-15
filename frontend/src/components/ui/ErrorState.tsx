import type { ReactNode } from "react";

/** The inline error paragraph. `role="alert"` announces it to assistive tech. */
export default function ErrorState({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p role="alert" className={"text-xs text-red-400 " + (className ?? "")}>
      {children}
    </p>
  );
}
