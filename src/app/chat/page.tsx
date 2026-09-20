import { Suspense } from "react";
import { AppShell } from "@/features/workspace/AppShell";
import { I18nProvider } from "@/shared/hooks/useI18n";

export default function Home() {
  return (
    <Suspense>
      <I18nProvider>
        <AppShell />
      </I18nProvider>
    </Suspense>
  );
}
