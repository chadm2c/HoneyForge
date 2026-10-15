import type { ReactNode } from "react";

/** The shared data table shell used by the fleet, profiles, events and audit pages. */
export default function Table({ children }: { children: ReactNode }) {
  return (
    <table className="w-full border-collapse text-left text-sm">{children}</table>
  );
}

/** A column header. Renders an empty `<th>` when given no children. */
export function Th({ children }: { children?: ReactNode }) {
  return (
    <th className="py-2 pr-4 text-xs font-medium uppercase tracking-wide text-slate-500">
      {children}
    </th>
  );
}

/** A body cell. `className` carries the per-column styling. */
export function Td({
  colSpan,
  className,
  children,
}: {
  colSpan?: number;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <td
      colSpan={colSpan}
      className={"border-t border-slate-900 py-2 pr-4 " + (className ?? "")}
    >
      {children}
    </td>
  );
}
