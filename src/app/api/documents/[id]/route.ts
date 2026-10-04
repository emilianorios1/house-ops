import { currentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { readDocument } from "@/lib/documents";
import { createHash } from "node:crypto";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await currentUser()))
    return new Response("Iniciá sesión.", { status: 401 });
  const { id } = await params;
  const document = await db.document.findUnique({ where: { id } });
  if (!document)
    return new Response("No encontramos ese comprobante.", { status: 404 });
  try {
    const bytes = await readDocument(document.storageKey);
    if (createHash("sha256").update(bytes).digest("hex") !== document.sha256)
      throw new Error("hash mismatch");
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(document.filename)}`,
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "sandbox",
      },
    });
  } catch {
    return new Response(
      "No encontramos el archivo. El registro sigue conservado.",
      { status: 404 },
    );
  }
}
