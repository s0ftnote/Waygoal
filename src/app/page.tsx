import { redirect } from "next/navigation";
import WaygoalPage from "./waygoal/page";
export { metadata } from "./waygoal/page";

export default async function Home({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  // Existing bookmarks and completion notifications still use /?session=.
  if (query.session) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item);
    }
    redirect(`/chat?${params}`);
  }
  return <WaygoalPage />;
}
