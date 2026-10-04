"use server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import {
  amountSchema,
  categories,
  dateSchema,
  monthSchema,
  people,
  shiftMonth,
  utcDate,
} from "@/lib/money";
import { audit } from "@/lib/audit";
import { storeDocument } from "@/lib/documents";
export type FormState = { error?: string };
const positive = amountSchema.refine(
  (v) => v > 0n,
  "El importe debe ser mayor que cero.",
);
const expenseSchema = z
  .object({
    id: z.string().optional(),
    version: z.coerce.number().int().positive().optional(),
    title: z.string().trim().min(1, "Escribí un nombre.").max(100),
    category: z.enum(categories),
    dueDate: dateSchema,
    amount: positive,
    extraordinary: amountSchema,
    notes: z.string().max(2000),
    documentId: z.string().optional(),
  })
  .refine(
    (v) =>
      v.extraordinary <= v.amount &&
      (v.category === "Expensas" || v.extraordinary === 0n),
    "Las extraordinarias deben ser parte de las expensas y no superar el total.",
  );
function errorState(e: unknown): FormState {
  if (e instanceof z.ZodError)
    return { error: e.issues[0]?.message ?? "Revisá los datos." };
  if (e instanceof Error && e.message.startsWith("NEXT_REDIRECT")) throw e;
  if (e instanceof Prisma.PrismaClientKnownRequestError)
    return {
      error:
        e.code === "P2002"
          ? "Ese registro ya existe. Revisá el historial."
          : e.code === "P2034"
            ? "Alguien guardó un cambio al mismo tiempo. Recargá y probá otra vez."
            : "No pudimos guardar. Probá otra vez.",
    };
  return {
    error:
      e instanceof Error ? e.message : "No pudimos guardar. Probá otra vez.",
  };
}
function fields(form: FormData) {
  return Object.fromEntries(
    [...form.entries()]
      .filter(([, v]) => typeof v === "string")
      .map(([k, v]) => [
        k,
        v === "" &&
        ["id", "version", "documentId", "expenseId", "rentMonth"].includes(k)
          ? undefined
          : v,
      ]),
  );
}
async function checkAffectedRents(
  tx: Prisma.TransactionClient,
  months: string[],
) {
  for (const month of new Set(months)) {
    const rent = await tx.rent.findUnique({
      where: { month },
      include: { payments: true },
    });
    if (!rent) continue;
    const prior = await tx.expense.aggregate({
      where: {
        archived: false,
        dueDate: {
          gte: new Date(`${shiftMonth(month, -1)}-01`),
          lt: new Date(`${month}-01`),
        },
      },
      _sum: { extraordinaryCents: true },
    });
    const credit =
      rent.creditOverrideCents ?? prior._sum.extraordinaryCents ?? 0n;
    const net = rent.grossCents > credit ? rent.grossCents - credit : 0n;
    const paid = rent.payments
      .filter((p) => !p.voided)
      .reduce((n, p) => n + p.amountCents, 0n);
    if (paid > net)
      throw new Error(
        "Este cambio deja el alquiler del mes siguiente por debajo de los pagos registrados. Revisá esos pagos antes de corregir las extraordinarias.",
      );
  }
}
export async function login(_: FormState, form: FormData): Promise<FormState> {
  try {
    await signIn("credentials", {
      username: form.get("username"),
      password: form.get("password"),
      redirectTo: "/",
    });
    return {};
  } catch (e) {
    if (e instanceof AuthError)
      return {
        error:
          "Revisá tu usuario y contraseña. Si probaste varias veces, esperá 15 minutos.",
      };
    throw e;
  }
}
export async function logout() {
  await signOut({ redirectTo: "/login" });
}
export async function saveExpense(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();
  let month = "";
  try {
    const data = expenseSchema.parse(fields(form));
    month = data.dueDate.slice(0, 7);
    let documentId = data.documentId;
    const file = form.get("file");
    if (file instanceof File && file.size > 0) {
      if (file.size > 20 * 1024 * 1024)
        throw new Error("El PDF supera los 20 MB.");
      const document = await storeDocument(
        Buffer.from(await file.arrayBuffer()),
        file.name,
        user.username,
      );
      documentId = document.id;
    }
    if (
      documentId &&
      !(await db.document.findUnique({ where: { id: documentId } }))
    )
      throw new Error("No encontramos ese comprobante.");
    await db.$transaction(
      async (tx) => {
        const before = data.id
          ? await tx.expense.findUnique({
              where: { id: data.id },
              include: { payments: true },
            })
          : null;
        if (
          data.id &&
          (!before || before.archived || before.version !== data.version)
        )
          throw new Error(
            "Este gasto cambió. Recargá la página antes de editarlo.",
          );
        const alreadyPaid =
          before?.payments
            .filter((p) => !p.voided)
            .reduce((n, p) => n + p.amountCents, 0n) ?? 0n;
        if (data.amount < alreadyPaid)
          throw new Error(
            "El gasto no puede ser menor que sus pagos. Anulá primero el pago incorrecto.",
          );
        const values = {
          title: data.title,
          category: data.category,
          dueDate: utcDate(data.dueDate),
          amountCents: data.amount,
          extraordinaryCents: data.extraordinary,
          notes: data.notes,
          documentId: documentId ?? null,
        };
        const after = before
          ? await tx.expense.update({
              where: { id: before.id, version: data.version },
              data: { ...values, version: { increment: 1 } },
            })
          : await tx.expense.create({ data: values });
        await checkAffectedRents(tx, [
          shiftMonth(month, 1),
          ...(before
            ? [shiftMonth(before.dueDate.toISOString().slice(0, 7), 1)]
            : []),
        ]);
        if (!before && documentId) {
          const duplicate = await tx.expense.findFirst({
            where: {
              documentId,
              dueDate: values.dueDate,
              archived: false,
              id: { not: after.id },
            },
          });
          if (duplicate)
            throw new Error(
              "Esta factura ya tiene un gasto en esa fecha. Abrí el registro existente.",
            );
        }
        await audit(
          tx,
          user.username,
          before ? "expense.update" : "expense.create",
          "expense",
          after.id,
          before,
          after,
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    return errorState(e);
  }
  revalidatePath("/", "layout");
  redirect(`/?month=${month}&saved=1`);
}
export async function saveRent(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();
  let month = "";
  try {
    const data = z
      .object({
        month: monthSchema,
        gross: positive,
        version: z.coerce.number().int().nonnegative(),
        credit: z.string(),
        reason: z.string().max(1000),
      })
      .parse(fields(form));
    month = data.month;
    const override = data.credit.trim()
      ? amountSchema.parse(data.credit)
      : null;
    if (override !== null && !data.reason.trim())
      throw new Error(
        "Explicá el motivo del descuento manual para que quede en el historial.",
      );
    await db.$transaction(
      async (tx) => {
        const before = await tx.rent.findUnique({
          where: { month },
          include: { payments: true },
        });
        if ((before?.version ?? 0) !== data.version)
          throw new Error("El alquiler cambió. Recargá la página.");
        const previous = await tx.expense.aggregate({
          where: {
            archived: false,
            dueDate: {
              gte: new Date(`${shiftMonth(month, -1)}-01`),
              lt: new Date(`${month}-01`),
            },
          },
          _sum: { extraordinaryCents: true },
        });
        const credit = override ?? previous._sum.extraordinaryCents ?? 0n;
        const net = data.gross > credit ? data.gross - credit : 0n;
        const paid =
          before?.payments
            .filter((p) => !p.voided)
            .reduce((n, p) => n + p.amountCents, 0n) ?? 0n;
        if (net < paid)
          throw new Error(
            "El alquiler resultante es menor que los pagos registrados. Revisá los pagos primero.",
          );
        const values = {
          grossCents: data.gross,
          creditOverrideCents: override,
          creditReason: data.reason,
        };
        const after = await tx.rent.upsert({
          where: { month },
          create: { month, ...values },
          update: { ...values, version: { increment: 1 } },
        });
        await audit(
          tx,
          user.username,
          "rent.save",
          "rent",
          month,
          before,
          after,
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    return errorState(e);
  }
  revalidatePath("/", "layout");
  redirect(`/?month=${month}&saved=1`);
}
export async function savePayment(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();
  let month = "";
  try {
    const data = z
      .object({
        expenseId: z.string().optional(),
        rentMonth: monthSchema.optional(),
        payer: z.enum(people),
        amount: positive,
        paidAt: dateSchema,
        notes: z.string().max(1000),
      })
      .refine(
        (v) => Boolean(v.expenseId) !== Boolean(v.rentMonth),
        "Elegí el gasto a pagar.",
      )
      .parse(fields(form));
    await db.$transaction(
      async (tx) => {
        let total = 0n;
        let payments: { amountCents: bigint; voided: boolean }[] = [];
        if (data.expenseId) {
          const bill = await tx.expense.findUnique({
            where: { id: data.expenseId },
            include: { payments: true },
          });
          if (!bill || bill.archived)
            throw new Error("No encontramos ese gasto.");
          total = bill.amountCents;
          payments = bill.payments;
          month = bill.dueDate.toISOString().slice(0, 7);
        } else {
          month = data.rentMonth!;
          const rent = await tx.rent.findUnique({
            where: { month },
            include: { payments: true },
          });
          if (!rent) throw new Error("Guardá primero el alquiler.");
          const prev = await tx.expense.aggregate({
            where: {
              archived: false,
              dueDate: {
                gte: new Date(`${shiftMonth(month, -1)}-01`),
                lt: new Date(`${month}-01`),
              },
            },
            _sum: { extraordinaryCents: true },
          });
          const credit =
            rent.creditOverrideCents ?? prev._sum.extraordinaryCents ?? 0n;
          total = rent.grossCents > credit ? rent.grossCents - credit : 0n;
          payments = rent.payments;
        }
        const paid = payments
          .filter((p) => !p.voided)
          .reduce((n, p) => n + p.amountCents, 0n);
        if (data.amount + paid > total)
          throw new Error("El pago supera lo que queda pendiente.");
        const payment = await tx.payment.create({
          data: {
            expenseId: data.expenseId,
            rentMonth: data.rentMonth,
            payer: data.payer,
            amountCents: data.amount,
            paidAt: utcDate(data.paidAt),
            notes: data.notes,
          },
        });
        await audit(
          tx,
          user.username,
          "payment.create",
          "payment",
          payment.id,
          null,
          payment,
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    return errorState(e);
  }
  revalidatePath("/", "layout");
  redirect(`/?month=${month}&saved=1`);
}
export async function saveSettlement(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();
  let month = "";
  try {
    const data = z
      .object({
        month: monthSchema,
        from: z.enum(people),
        amount: positive,
        paidAt: dateSchema,
        notes: z.string().max(1000),
      })
      .parse(fields(form));
    month = data.month;
    await db.$transaction(async (tx) => {
      const row = await tx.settlement.create({
        data: {
          month,
          from: data.from,
          amountCents: data.amount,
          paidAt: utcDate(data.paidAt),
          notes: data.notes,
        },
      });
      await audit(
        tx,
        user.username,
        "settlement.create",
        "settlement",
        row.id,
        null,
        row,
      );
    });
  } catch (e) {
    return errorState(e);
  }
  revalidatePath("/", "layout");
  redirect(`/?month=${month}&saved=1`);
}
export async function voidRecord(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();
  let month = "";
  try {
    const data = z
      .object({
        id: z.string().min(1),
        kind: z.enum(["expense", "payment", "settlement"]),
        reason: z
          .string()
          .trim()
          .min(3, "Explicá por qué lo anulás.")
          .max(1000),
        month: monthSchema,
      })
      .parse(fields(form));
    month = data.month;
    await db.$transaction(
      async (tx) => {
        let before, after;
        if (data.kind === "expense") {
          before = await tx.expense.findUnique({
            where: { id: data.id },
            include: { payments: true },
          });
          if (!before || before.archived)
            throw new Error("Ese gasto ya fue anulado.");
          if (before.payments.some((p) => !p.voided))
            throw new Error("Anulá primero los pagos del gasto.");
          after = await tx.expense.update({
            where: { id: data.id },
            data: { archived: true, version: { increment: 1 } },
          });
        } else if (data.kind === "payment") {
          before = await tx.payment.findUnique({ where: { id: data.id } });
          if (!before || before.voided)
            throw new Error("Ese pago ya fue anulado.");
          after = await tx.payment.update({
            where: { id: data.id },
            data: { voided: true },
          });
        } else {
          before = await tx.settlement.findUnique({ where: { id: data.id } });
          if (!before || before.voided)
            throw new Error("Esa transferencia ya fue anulada.");
          after = await tx.settlement.update({
            where: { id: data.id },
            data: { voided: true },
          });
        }
        await audit(
          tx,
          user.username,
          `${data.kind}.void`,
          data.kind,
          data.id,
          before,
          { ...after, reason: data.reason },
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    return errorState(e);
  }
  revalidatePath("/", "layout");
  redirect(`/?month=${month}&saved=1`);
}
