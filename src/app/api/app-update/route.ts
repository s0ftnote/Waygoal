import { NextResponse } from "next/server";
import type { AppUpdateResponse } from "@/shared/api-types";

// Waygoal is maintained and versioned independently. A pi-web npm release
// cannot update this application; retain the response contract for chat UI.
export function GET() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0-alpha.4";
  return NextResponse.json({
    currentVersion: version,
    latestVersion: version,
    updateAvailable: false,
    releaseUrl: "https://github.com/s0ftnote/Waygoal/releases",
  } satisfies AppUpdateResponse);
}
