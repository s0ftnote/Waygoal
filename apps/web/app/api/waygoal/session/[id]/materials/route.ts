import { NextResponse } from "next/server";
import { captureMaterial } from "@/lib/waygoal/material-reader";
import type { MaterialScope } from "@/lib/waygoal/materials";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const query = new URL(req.url).searchParams;
  try {
    const material = await captureMaterial(id, query.get("turn") ?? "", query.get("target") ?? "", query.get("scope") as MaterialScope, query.get("excerpt") ?? undefined);
    return NextResponse.json(material, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
