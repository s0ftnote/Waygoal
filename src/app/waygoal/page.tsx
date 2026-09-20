import { Suspense } from "react";
import { I18nProvider } from "@/shared/hooks/useI18n";
import { WaygoalCanvas } from "@/features/canvas/Canvas";
import "./waygoal.css";
export const metadata = { title: "Waygoal · 会话画布" };
export default function WaygoalPage() {
  return <Suspense><I18nProvider><WaygoalCanvas /></I18nProvider></Suspense>;
}
