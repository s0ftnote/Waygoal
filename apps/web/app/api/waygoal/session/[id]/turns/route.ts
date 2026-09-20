import { NextResponse } from "next/server";
import { readTurnPayload } from "@/lib/waygoal/turn-reader";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await readTurnPayload(id);
    if (!result) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const headers = { "Cache-Control": "private, no-cache", ETag: result.etag };
    if (req.headers.get("if-none-match") === result.etag) return new Response(null, { status: 304, headers });
    return new Response(result.body, { headers: { ...headers, "Content-Type": "application/json" } });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
