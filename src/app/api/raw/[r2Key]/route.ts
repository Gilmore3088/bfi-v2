import { NextRequest, NextResponse } from "next/server";
import { presignR2 } from "@/lib/r2";

/**
 * GET /api/raw/[r2Key]
 *
 * Presigns the underlying R2 object and 302-redirects the client there so
 * the browser can render HTML/PDF inline (or download it). The r2Key path
 * segment is URL-encoded by the caller and may include slashes after
 * decoding (e.g. raw/123/2026-05-25/abc.html).
 *
 * Query params:
 *   ?download=1  -> force attachment Content-Disposition
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ r2Key: string }> },
): Promise<NextResponse> {
  const { r2Key } = await ctx.params;
  const decodedKey = decodeURIComponent(r2Key);

  const download = req.nextUrl.searchParams.get("download") === "1";
  const filename = decodedKey.split("/").pop() ?? "document";

  try {
    const url = await presignR2(decodedKey, {
      expiresIn: 3600,
      download,
      filename: download ? filename : undefined,
    });
    return NextResponse.redirect(url, { status: 302 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "presign failed";
    return NextResponse.json(
      { status: "error", message },
      { status: 500 },
    );
  }
}
