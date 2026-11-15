import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";

export type ButtonVariant = "primary" | "subtle" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-ui font-medium whitespace-nowrap select-none " +
  "transition-[background-color,color,filter,transform] duration-150 active:scale-[0.98] " +
  "disabled:pointer-events-none disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-main text-main-fg hover:brightness-110",
  subtle: "bg-text/[0.07] text-text hover:bg-text/[0.13]",
  ghost: "text-sub hover:bg-text/[0.07] hover:text-text",
  danger: "bg-error/[0.14] text-error hover:bg-error/[0.24]",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

const ICON_SIZES: Record<ButtonSize, string> = { sm: "size-8", md: "size-10", lg: "size-12" };
const ICON_PX: Record<ButtonSize, number> = { sm: 16, md: 18, lg: 20 };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Icon before the label. */
  icon?: IconName;
  /** Icon after the label. */
  iconRight?: IconName;
  /** Renders a next/link <a> instead of a <button>. */
  href?: string;
  fullWidth?: boolean;
  ref?: Ref<HTMLButtonElement>;
  children?: ReactNode;
}

export function Button({
  variant = "subtle",
  size = "md",
  icon,
  iconRight,
  href,
  fullWidth,
  className,
  children,
  type = "button",
  ref,
  ...rest
}: ButtonProps) {
  const cls = cx(BASE, VARIANTS[variant], SIZES[size], fullWidth && "w-full", className);
  const body = (
    <>
      {icon && <Icon name={icon} size={ICON_PX[size]} />}
      {children}
      {iconRight && <Icon name={iconRight} size={ICON_PX[size]} />}
    </>
  );
  if (href !== undefined && !rest.disabled) {
    return (
      <Link
        href={href}
        className={cls}
        data-variant={variant}
        aria-label={rest["aria-label"]}
        data-testid={(rest as Record<string, unknown>)["data-testid"] as string | undefined}
        title={rest.title}
      >
        {body}
      </Link>
    );
  }
  return (
    <button ref={ref} type={type} className={cls} data-variant={variant} {...rest}>
      {body}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonProps, "icon" | "iconRight" | "children" | "fullWidth"> {
  icon: IconName;
  /** Required accessible name (also used as the native tooltip unless `title` is given). */
  label: string;
}

export function IconButton({
  icon,
  label,
  variant = "ghost",
  size = "md",
  className,
  href,
  type = "button",
  ref,
  ...rest
}: IconButtonProps) {
  const cls = cx(BASE, VARIANTS[variant], ICON_SIZES[size], className);
  const body = <Icon name={icon} size={ICON_PX[size]} />;
  if (href !== undefined && !rest.disabled) {
    return (
      <Link href={href} className={cls} aria-label={label} title={rest.title ?? label} data-variant={variant}>
        {body}
      </Link>
    );
  }
  return (
    <button ref={ref} type={type} className={cls} aria-label={label} title={label} data-variant={variant} {...rest}>
      {body}
    </button>
  );
}
