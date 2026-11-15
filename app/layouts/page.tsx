import type { Metadata } from "next";
import { LayoutsView } from "@/components/layouts/LayoutsView";

export const metadata: Metadata = { title: "Layouts" };

export default function LayoutsPage() {
  return <LayoutsView />;
}
