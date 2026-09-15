import { NextResponse } from "next/server";
import { readTurns } from "@/lib/waygoal/turn-reader";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await readTurns(id);
    return result ? NextResponse.json(result, { headers: { "Cache-Control": "no-store" } })
      : NextResponse.json({ error: "Session not found" }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
