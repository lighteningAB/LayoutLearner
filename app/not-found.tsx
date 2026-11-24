import { Button, Kbd } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="grid items-center gap-x-14 gap-y-10 py-10 sm:py-16 md:grid-cols-[auto_minmax(0,1fr)]" data-testid="not-found">
      {/* A key that is not on the board: drawn as a hidden line, with its width dimensioned. */}
      <div aria-hidden className="w-[220px] max-w-full">
        <div className="ll-hatch flex aspect-square items-center justify-center border border-dashed border-line">
          <span className="ll-numeral text-[84px] text-text">404</span>
        </div>
        <div className="mt-3 flex items-center gap-2 text-sub">
          <span className="h-2.5 w-px bg-border" />
          <span className="h-px flex-1 bg-border" />
          <span className="ll-note">1u · unmapped</span>
          <span className="h-px flex-1 bg-border" />
          <span className="h-2.5 w-px bg-border" />
        </div>
      </div>
      <div className="max-w-[65ch]">
        <h1 className="ll-title text-text">That key isn&apos;t mapped</h1>
        <p className="mt-5 text-[17px] leading-[1.55] text-sub">
          The page you were reaching for doesn&apos;t exist. Head back to the test, or press <Kbd>esc</Kbd> to jump anywhere.
        </p>
        <Button href="/" variant="primary" className="mt-8" icon="keyboard">
          Back to the test
        </Button>
      </div>
    </div>
  );
}
