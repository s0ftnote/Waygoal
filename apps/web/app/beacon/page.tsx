import { Suspense } from "react";
import { I18nProvider } from "@/hooks/useI18n";
import { WaygoalCanvas } from "@/components/WaygoalCanvas";
import "./waygoal.css";
export const metadata = { title: "Waygoal · 会话画布" };
export default function WaygoalPage() {
  return <Suspense><I18nProvider><WaygoalCanvas /></I18nProvider></Suspense>;
}
