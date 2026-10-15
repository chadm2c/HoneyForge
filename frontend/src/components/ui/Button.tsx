import type { ButtonHTMLAttributes } from "react";

const VARIANTS = {
  primary:
    "rounded bg-cyan-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-600 disabled:opacity-60",
  secondary:
    "rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-cyan-700 disabled:opacity-40",
  danger: "rounded border border-red-800 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950",
} as const;

/**
 * The three button treatments used across the admin pages. `type` and
 * `disabled` (and every other native attribute) are forwarded through `rest`.
 */
export default function Button({
  variant = "secondary",
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof VARIANTS }) {
  return (
    <button
      type={type}
      className={`${VARIANTS[variant]} ${className ?? ""}`}
      {...rest}
    />
  );
}
