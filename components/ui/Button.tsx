import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cx, isText } from "./cx";
import { Icon, type IconName } from "./Icon";

export type ButtonVariant = "primary" | "subtle" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

// Lettered, square, 1px outline. Pressed: the label drops 1px. Disabled: a dashed outline with no
// fill (a hidden line). Busy (aria-busy / `loading`): section hatching runs across the face.
const BASE =
  "group/btn relative inline-flex shrink-0 items-center justify-center gap-2 border font-display font-semibold tracking-[0.12em] whitespace-nowrap uppercase select-none " +
  "transition-[background-color,color,border-color] duration-150 active:translate-y-px " +
  "disabled:pointer-events-none disabled:border-dashed disabled:border-border disabled:bg-transparent disabled:text-sub " +
  "aria-disabled:pointer-events-none aria-disabled:border-dashed aria-disabled:border-border aria-disabled:bg-transparent aria-disabled:text-sub " +
  "aria-busy:pointer-events-none aria-busy:border-solid aria-busy:border-line aria-busy:text-text aria-busy:ll-hatch aria-busy:animate-hatch aria-busy:[background-size:8px_8px]";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "border-line bg-main text-main-fg hover:bg-text hover:text-bg",
  subtle: "border-line text-text hover:bg-text hover:text-bg",
  ghost: "border-transparent text-sub underline-offset-[5px] hover:text-text hover:underline disabled:border-transparent aria-disabled:border-transparent",
  danger: "border-error text-error hover:bg-error hover:text-bg",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
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
  /** Work in progress: the button is disabled, announced busy and drawn hatched. */
  loading?: boolean;
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
  loading,
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
      {isText(children) ? <span className="ll-trim">{children}</span> : children}
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
    <button
      ref={ref}
      type={type}
      className={cls}
      data-variant={variant}
      {...rest}
      disabled={rest.disabled || loading || undefined}
      aria-busy={loading || rest["aria-busy"]}
    >
      {body}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonProps, "icon" | "iconRight" | "children" | "fullWidth" | "loading"> {
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
  // A ghost icon button has no label to underline: it gets an outline on hover instead.
  const cls = cx(BASE, VARIANTS[variant], variant === "ghost" && "hover:border-line", ICON_SIZES[size], className);
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
