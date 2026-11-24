"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, IconButton, type ButtonVariant } from "./Button";
import { cx } from "./cx";
import { useFocusTrap } from "./hooks";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  /** Accessible name when there is no visible title. */
  label?: string;
  children?: ReactNode;
  /** Right-aligned action row. */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** "center" for dialogs, "top" for palette-style sheets. */
  position?: "center" | "top";
  /** No header/padding chrome: children fill the dialog surface. */
  bare?: boolean;
  /** Show the × button (default true when a title is given). */
  showClose?: boolean;
  closeOnBackdrop?: boolean;
  className?: string;
  "data-testid"?: string;
}

const WIDTH = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-xl" };

let openModals = 0;

/**
 * Modal dialog rendered in a portal. Focus is trapped inside and restored on close;
 * Esc and backdrop click close it. Put `data-autofocus` on the element to focus first.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  label,
  children,
  footer,
  size = "md",
  position = "center",
  bare,
  showClose,
  closeOnBackdrop = true,
  className,
  ...rest
}: ModalProps) {
  const uid = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const active = open && mounted;
  useFocusTrap(ref, active);

  useEffect(() => {
    if (!active) return;
    openModals++;
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      openModals--;
      if (openModals === 0) root.style.overflow = prev === "hidden" ? "" : prev;
    };
  }, [active]);

  if (!active) return null;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return createPortal(
    <div
      data-ll-modal=""
      className={cx(
        "fixed inset-0 z-50 flex justify-center overflow-y-auto px-4",
        position === "center" ? "items-center py-8" : "items-start pt-[12vh] pb-8",
      )}
      onKeyDown={onKeyDown}
    >
      <div
        aria-hidden
        className="fixed inset-0 animate-fade-in bg-scrim"
        onClick={closeOnBackdrop ? onClose : undefined}
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title ? undefined : label}
        aria-labelledby={title ? `${uid}-title` : undefined}
        aria-describedby={description ? `${uid}-desc` : undefined}
        tabIndex={-1}
        className={cx(
          "relative w-full animate-pop-in border border-line bg-bg outline-none",
          WIDTH[size],
          className,
        )}
        {...rest}
      >
        {/* Title strip: the sheet's lettered heading, ruled off from the body. */}
        {!bare && (title || (showClose ?? !!title)) && (
          <div className="flex min-h-11 items-stretch border-b border-line">
            {title && (
              <h2 id={`${uid}-title`} className="ll-lettering-lg min-w-0 flex-1 self-center px-5 py-3 text-text">
                {title}
              </h2>
            )}
            {(showClose ?? !!title) && (
              <IconButton
                icon="x"
                label="Close"
                size="sm"
                className="ml-auto h-auto w-11 self-stretch border-0 border-l border-line hover:bg-text hover:text-bg"
                onClick={onClose}
              />
            )}
          </div>
        )}
        {bare ? (
          children
        ) : (
          <div className="p-5">
            {description && (
              <p id={`${uid}-desc`} className={cx("text-[15px] leading-snug text-sub", children ? "mb-5" : undefined)}>
                {description}
              </p>
            )}
            {children}
            {footer && <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export const Dialog = Modal;

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Variant of the confirm button; "danger" for destructive actions. */
  tone?: ButtonVariant;
  "data-testid"?: string;
}

/** Small confirm/cancel dialog. Cancel is focused first so Enter never confirms by accident. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "primary",
  ...rest
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      showClose={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} data-autofocus="" data-testid="confirm-cancel">
            {cancelLabel}
          </Button>
          <Button
            variant={tone}
            data-testid="confirm-ok"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
      {...rest}
    />
  );
}
