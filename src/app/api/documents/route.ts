import { currentUser } from "@/lib/session";
import {
  storeDocument,
  pdfText,
  parseExpensas,
  MAX_PDF_BYTES,
} from "@/lib/documents";
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Iniciá sesión." }, { status: 401 });
  const expectedOrigin = new URL(process.env.AUTH_URL ?? request.url).origin;
  if (request.headers.get("origin") !== expectedOrigin)
    return Response.json({ error: "Origen inválido." }, { status: 403 });
  const size = Number(request.headers.get("content-length"));
  if (!Number.isFinite(size) || size > MAX_PDF_BYTES + 100000)
    return Response.json(
      { error: "El PDF supera los 20 MB." },
      { status: 413 },
    );
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size > MAX_PDF_BYTES)
      throw new Error("Elegí un PDF de hasta 20 MB.");
    const bytes = Buffer.from(await file.arrayBuffer());
    const doc = await storeDocument(bytes, file.name, user.username);
    const parsed = parseExpensas(await pdfText(bytes));
    return Response.json({
      id: doc.id,
      filename: doc.filename,
      parsed: parsed
        ? {
            ...parsed,
            amountCents: parsed.amountCents.toString(),
            extraordinaryCents: parsed.extraordinaryCents.toString(),
          }
        : null,
    });
  } catch {
    return Response.json(
      {
        error:
          "No pudimos leer ese PDF. Verificá que no esté dañado o protegido por contraseña.",
      },
      { status: 400 },
    );
  }
}
