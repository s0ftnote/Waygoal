export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { configureHttpDispatcher } = await import("@/server/http/http-dispatcher");
  configureHttpDispatcher();
}
