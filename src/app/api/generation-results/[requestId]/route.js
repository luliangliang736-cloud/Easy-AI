import { NextResponse } from "next/server";
import { readGenerationResult } from "@/lib/server/generationResultStore";

export const runtime = "nodejs";

export async function GET(_request, { params }) {
  const { requestId } = await params;
  const result = await readGenerationResult(requestId);

  if (!result) {
    return NextResponse.json({ status: "pending" }, { status: 202 });
  }

  return NextResponse.json(result);
}
