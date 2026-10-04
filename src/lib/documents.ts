import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import { PDFParse } from "pdf-parse";
import { db } from "./db";
import { audit } from "./audit";
import { cents, utcDate } from "./money";
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export function validatePdf(bytes: Buffer) {
  if (
    !bytes.length ||
    bytes.length > MAX_PDF_BYTES ||
    !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))
  )
    throw new Error("Elegí un PDF válido de hasta 20 MB.");
}
function storagePath(key: string) {
  const root = resolve(
    /* turbopackIgnore: true */ process.env.DOCUMENT_STORE_PATH ??
      "data/shared-documents",
  );
  const path = resolve(root, key);
  if (!path.startsWith(root + sep)) throw new Error("Invalid document path");
  return path;
}
export async function pdfText(bytes: Buffer) {
  validatePdf(bytes);
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    if (result.total > 200) throw new Error("El PDF tiene demasiadas páginas.");
    return result.text;
  } finally {
    await parser.destroy();
  }
}
export async function storeDocument(
  bytes: Buffer,
  filename: string,
  actor: string,
  source = "manual",
) {
  validatePdf(bytes);
  await pdfText(bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const existing = await db.document.findUnique({ where: { sha256 } });
  if (existing) return existing;
  const storageKey = `${sha256.slice(0, 2)}/${sha256}.pdf`;
  const path = storagePath(storageKey);
  await mkdir(resolve(path, ".."), { recursive: true });
  try {
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  return db.$transaction(async (tx) => {
    const document = await tx.document.upsert({
      where: { sha256 },
      update: {},
      create: {
        sha256,
        filename: basename(filename)
          .replace(/[\r\n]/g, "")
          .slice(0, 180),
        storageKey,
        byteSize: bytes.length,
        source,
      },
    });
    await audit(tx, actor, "document.upload", "document", document.id, null, {
      filename: document.filename,
      sha256,
      source,
    });
    return document;
  });
}
export async function readDocument(key: string) {
  return readFile(/* turbopackIgnore: true */ storagePath(key));
}
export function parseExpensas(text: string) {
  const normalized = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  if (
    !/EXPENSAS\s+GENERALES/i.test(normalized) ||
    !/1er\.?\s*Vencim/i.test(normalized)
  )
    return null;
  const date = "(\\d{1,2}\\s*[-/]\\s*\\d{1,2}\\s*[-/]\\s*20\\d{2})";
  const amount = "([\\d.,]+)";
  const due =
    normalized.match(
      new RegExp(`${date}\\s*\\$\\s*${amount}\\s*1er\\.?\\s*Vencim`, "i"),
    ) ??
    normalized.match(
      new RegExp(`1er\\.?\\s*Vencim\\.?:?\\s*${date}\\s*\\$\\s*${amount}`, "i"),
    );
  if (!due) return null;
  const [d, m, y] = due[1].replace(/\s/g, "").split(/[-/]/);
  const dueDate = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  try {
    utcDate(dueDate);
  } catch {
    return null;
  }
  const parseAmount = (v: string) =>
    cents(v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v);
  function concept(label: string) {
    const match = normalized.match(
      new RegExp(
        `^\\s*(?:${amount}\\s*${label}|${label}\\s*\\$?\\s*${amount})\\s*$`,
        "im",
      ),
    );
    return match ? parseAmount(match[1] ?? match[2]) : 0n;
  }
  const extraordinaryCents = concept("EXPENSAS\\s+EXTRAORDINARIAS");
  const balance = concept("SALDO\\s+ANTERIOR");
  const interest = concept("PUNITORIOS");
  return {
    title: "Expensas · Concorde",
    category: "Expensas" as const,
    dueDate,
    amountCents: parseAmount(due[2]),
    extraordinaryCents,
    notes: `${balance > 0n ? "La liquidación incluye saldo anterior. Revisar para evitar contarlo dos veces. " : ""}${interest > 0n ? "Incluye punitorios. " : ""}Primer vencimiento. Extraordinarias descontadas del alquiler del mes siguiente.`,
  };
}
