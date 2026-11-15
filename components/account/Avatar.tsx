"use client";

import { useState } from "react";
import { cx } from "@/components/ui";

/** Provider image if there is one (and it loads), else the initial. Fixed box, never shifts layout. */
export function Avatar({ name, image, className }: { name: string; image: string | null; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = image !== null && failed !== image;
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? "?";
  return (
    <span
      className={cx(
        "relative inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-main/[0.16] text-xs font-semibold text-main",
        className,
      )}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt=""
          width={32}
          height={32}
          referrerPolicy="no-referrer"
          className="size-8 object-cover"
          onError={() => setFailed(image)}
        />
      ) : (
        initial
      )}
    </span>
  );
}
