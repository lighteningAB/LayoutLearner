import { Button, Kbd } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center" data-testid="not-found">
      <div className="font-mono text-7xl leading-none font-medium text-main">404</div>
      <h1 className="mt-6 text-xl font-semibold tracking-tight text-text">That key isn&apos;t mapped</h1>
      <p className="mt-2 max-w-sm text-sm text-sub">
        The page you were reaching for doesn&apos;t exist. Head back to the test, or press <Kbd>esc</Kbd> to jump anywhere.
      </p>
      <Button href="/" variant="primary" className="mt-8" icon="keyboard">
        Back to the test
      </Button>
    </div>
  );
}
