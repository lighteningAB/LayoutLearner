import type { Metadata } from "next";
import { CourseMap } from "@/components/learn/CourseMap";

export const metadata: Metadata = { title: "Learn" };

export default function LearnPage() {
  return <CourseMap />;
}
