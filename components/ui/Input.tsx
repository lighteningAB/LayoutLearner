import type { InputHTMLAttributes, Ref, TextareaHTMLAttributes } from "react";
import { cx } from "./cx";

const FIELD =
  "w-full border border-border bg-fill text-text placeholder:text-sub transition-colors duration-150 " +
  "hover:border-line focus:border-line focus:bg-transparent " +
  "disabled:cursor-not-allowed disabled:border-dashed disabled:bg-transparent disabled:text-sub disabled:hover:border-border " +
  "aria-[invalid=true]:border-error aria-[invalid=true]:outline-2 aria-[invalid=true]:outline-offset-0 aria-[invalid=true]:outline-error";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: "sm" | "md";
  mono?: boolean;
  ref?: Ref<HTMLInputElement>;
}

export function Input({ size = "md", mono, className, ref, ...rest }: InputProps) {
  return (
    <input
      ref={ref}
      className={cx(FIELD, size === "sm" ? "h-8 px-2.5 text-[14px]" : "h-10 px-3 text-[15px]", mono && "font-mono", className)}
      {...rest}
    />
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  mono?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({ mono, className, ref, ...rest }: TextareaProps) {
  return (
    <textarea
      ref={ref}
      className={cx(FIELD, "min-h-24 resize-y px-3 py-2.5 text-[15px] leading-relaxed", mono && "font-mono text-[13px]", className)}
      {...rest}
    />
  );
}
