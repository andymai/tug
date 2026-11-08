import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

import { ICON } from "../lib/states";

const VARIANTS = {
  primary: "border-transparent bg-primary text-on-primary hover:bg-primary/88",
  secondary: "border-control-border bg-surface text-ink hover:bg-hover",
  ghost: "border-transparent text-ink hover:bg-hover",
} as const;

const SIZES = {
  md: "h-[30px] gap-1.5 px-3 text-body-strong",
  sm: "h-6 gap-1 px-2 text-small font-medium",
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  icon?: LucideIcon;
}

export function Button({ variant = "secondary", size = "md", icon: Icon, className, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex shrink-0 items-center justify-center rounded-sm border transition-colors duration-(--duration-fast) ease-(--ease-out) disabled:cursor-default disabled:border-line disabled:bg-surface disabled:text-ink-faint ${VARIANTS[variant]} ${SIZES[size]} ${className ?? ""}`}
      {...rest}
    >
      {Icon && <Icon {...ICON} />}
      {children}
    </button>
  );
}
