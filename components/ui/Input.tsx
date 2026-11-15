import type { InputHTMLAttributes, Ref, TextareaHTMLAttributes } from "react";
import { cx } from "./cx";

const FIELD =
  "w-full rounded-ui bg-text/[0.07] text-text placeholder:text-sub/70 transition-colors duration-150 " +
  "hover:bg-text/[0.1] focus:bg-text/[0.1] disabled:cursor-not-allowed disabled:opacity-40 " +
  "aria-[invalid=true]:outline-2 aria-[invalid=true]:outline-error";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: "sm" | "md";
  mono?: boolean;
  ref?: Ref<HTMLInputElement>;
}

export function Input({ size = "md", mono, className, ref, ...rest }: InputProps) {
  return (
    <input
      ref={ref}
      className={cx(FIELD, size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-10 px-3.5 text-sm", mono && "font-mono", className)}
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
      className={cx(FIELD, "min-h-24 resize-y px-3.5 py-2.5 text-sm leading-relaxed", mono && "font-mono text-[13px]", className)}
      {...rest}
    />
  );
}
