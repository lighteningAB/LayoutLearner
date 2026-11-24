"use client";

import { useEffect, useRef, useState, type TextareaHTMLAttributes } from "react";
import { cx } from "@/components/ui";
import styles from "./layouts.module.css";

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

/**
 * Plain <textarea> in the sheet's mono face with a ruled line-number gutter and an optional marked
 * error line. Selection, caret and scrollbar come from the palette; focus thickens the frame.
 */
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
        "relative flex overflow-hidden border border-border font-mono text-[13px] outline-2 -outline-offset-2 outline-transparent transition-[outline-color] duration-150",
        marked != null ? "focus-within:outline-error" : "focus-within:outline-main",
        className,
      )}
      style={{ lineHeight: `${LINE_HEIGHT}px` }}
      data-error-line={marked}
    >
      <div
        aria-hidden
        className="ll-readout shrink-0 overflow-hidden border-r border-hairline text-right text-sub select-none"
        style={{ width: `calc(${digits}ch + 22px)` }}
      >
        <div style={{ transform: `translateY(${PAD_Y - scrollTop}px)` }}>
          {Array.from({ length: lineCount }, (_, i) => (
            <div
              key={i}
              className={cx("pr-2.5 pl-2", marked === i + 1 && "bg-error font-semibold text-bg")}
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
            className="pointer-events-none absolute inset-x-0 border-y border-error bg-error/15"
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
          className={cx(
            styles.code,
            "absolute inset-0 block h-full w-full resize-none overflow-auto bg-transparent pr-3 pl-3 whitespace-pre text-text outline-none placeholder:text-sub",
          )}
          style={{ paddingTop: PAD_Y, paddingBottom: PAD_Y, lineHeight: `${LINE_HEIGHT}px`, tabSize: 2 }}
          {...rest}
        />
      </div>
    </div>
  );
}
