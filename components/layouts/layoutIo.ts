// Copy and download helpers shared by the gallery menus and the editor. Kept apart from the editor
// so the gallery does not pull the editor's code in just to offer "Copy data".
import { toast } from "@/components/ui";
import { exportFilename, exportLayoutJson } from "@/lib/layout/custom";
import type { Layers } from "@/lib/layout/layers";
import type { FingerOverrides } from "@/lib/layout/overrides";

export async function copyText(text: string, what = "Layout data"): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied to clipboard`, { variant: "success" });
  } catch {
    toast("Couldn't reach the clipboard", { variant: "error", description: "Select the text and copy it by hand instead." });
  }
}

export function downloadLayout(name: string, source: string, fingers?: FingerOverrides, layers?: Layers): void {
  const blob = new Blob([exportLayoutJson(name, source, fingers, layers)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = exportFilename(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
