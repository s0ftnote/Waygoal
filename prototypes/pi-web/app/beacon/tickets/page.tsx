import { Suspense } from "react";
import { I18nProvider } from "@/hooks/useI18n";
import { BeaconCanvas } from "@/components/BeaconCanvas";
import "../beacon.css";
// Earlier Pi × Wayfinder ticket prototype. Kept reachable until ticket
// discussions move onto the session canvas; the product entry is /beacon.
export const metadata = { title: "Beacon · 票据地图（旧原型）" };
export default function BeaconTicketsPage() {
  return <Suspense><I18nProvider><BeaconCanvas /></I18nProvider></Suspense>;
}
