"use client";

import { useEffect, useRef, useState, type TextareaHTMLAttributes } from "react";
import { cx } from "@/components/ui";

const LINE_HEIGHT = 20;
const PAD_Y = 12;

export interface CodeEditorProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "wrap"> {
  value: string;
  onChange: (value: string) => void;
  /** 1-based line to mark as broken. */
  errorLine?: number;
  className?: string;
  "data-testid"?: string;
}

/** Plain themed <textarea> with a line-number gutter and an optional highlighted error line. */
export function CodeEditor({ value, onChange, errorLine, className, onKeyDown, ...rest }: CodeEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const lineCount = value.split("\n").length;
  const digits = Math.max(2, String(lineCount).length);
  const marked = errorLine != null && errorLine >= 1 && errorLine <= lineCount ? errorLine : undefined;

  // Content can shrink under the scroll position (paste over, import): resync.
  useEffect(() => {
    const el = ref.current;
    if (el && el.scrollTop !== scrollTop) setScrollTop(el.scrollTop);
  }, [value, scrollTop]);

  return (
    <div
      className={cx(
        "relative flex overflow-hidden rounded-ui border border-border bg-bg-alt font-mono text-[13px] transition-colors duration-150",
        "focus-within:border-main/70",
        marked != null && "border-error/60 focus-within:border-error/80",
        className,
      )}
      style={{ lineHeight: `${LINE_HEIGHT}px` }}
      data-error-line={marked}
    >
      <div
        aria-hidden
        className="shrink-0 overflow-hidden border-r border-border/70 bg-text/[0.03] text-right text-sub/70 select-none"
        style={{ width: `calc(${digits}ch + 22px)` }}
      >
        <div style={{ transform: `translateY(${PAD_Y - scrollTop}px)` }}>
          {Array.from({ length: lineCount }, (_, i) => (
            <div
              key={i}
              className={cx("pr-2.5 pl-2", marked === i + 1 && "bg-error/[0.16] font-semibold text-error")}
              style={{ height: LINE_HEIGHT }}
            >
              {i + 1}
            </div>
          ))}
        </div>
      </div>
      <div className="relative min-w-0 flex-1">
        {marked != null && (
          <div
            aria-hidden
            data-testid="editor-error-line"
            data-line={marked}
            className="pointer-events-none absolute inset-x-0 bg-error/[0.13]"
            style={{ top: PAD_Y + (marked - 1) * LINE_HEIGHT - scrollTop, height: LINE_HEIGHT }}
          />
        )}
        <textarea
          ref={ref}
          value={value}
          wrap="off"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          onKeyDown={(e) => {
            onKeyDown?.(e);
            // Esc would otherwise open the command palette over half-typed data.
            if (e.key === "Escape" && !e.defaultPrevented) {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          className="absolute inset-0 block h-full w-full resize-none overflow-auto bg-transparent pr-3 pl-3 whitespace-pre text-text caret-caret outline-none placeholder:text-sub/60"
          style={{ paddingTop: PAD_Y, paddingBottom: PAD_Y, lineHeight: `${LINE_HEIGHT}px`, tabSize: 2 }}
          {...rest}
        />
      </div>
    </div>
  );
}
