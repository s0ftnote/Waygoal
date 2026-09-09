import { Suspense } from "react";
import { I18nProvider } from "@/hooks/useI18n";
import { BeaconCanvas } from "@/components/BeaconCanvas";
import "./beacon.css";
export const metadata = { title: "Beacon · 为想法找到方向" };
export default function BeaconPage() {
  return <Suspense><I18nProvider><BeaconCanvas /></I18nProvider></Suspense>;
}
