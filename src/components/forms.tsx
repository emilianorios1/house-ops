"use client";
import { useActionState, useState } from "react";
import {
  login,
  saveExpense,
  saveRent,
  savePayment,
  saveSettlement,
  voidRecord,
  type FormState,
} from "@/app/actions";
import { categories, decimal, today } from "@/lib/money";
import { Upload, LoaderCircle, ArrowRight } from "lucide-react";
type Action = (state: FormState, data: FormData) => Promise<FormState>;
function Feedback({
  state,
  pending,
  label,
}: {
  state: FormState;
  pending: boolean;
  label: string;
}) {
  return (
    <>
      <p role="alert" className="form-error">
        {state.error}
      </p>
      <button className="button primary" disabled={pending} type="submit">
        {pending ? (
          <>
            <LoaderCircle size={17} className="spin" />
            Guardando…
          </>
        ) : (
          <>
            {label}
            <ArrowRight size={17} />
          </>
        )}
      </button>
    </>
  );
}
export function LoginForm() {
  const [state, action, pending] = useActionState(login, {});
  return (
    <form action={action}>
      <label>
        Quién sos
        <select name="username">
          <option value="emiliano">Emiliano</option>
          <option value="vitoria">Vitoria</option>
        </select>
      </label>
      <label>
        Contraseña
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
        />
      </label>
      <Feedback state={state} pending={pending} label="Entrar a casa" />
    </form>
  );
}
export type ExpenseInput = {
  id?: string;
  version?: number;
  title: string;
  category: string;
  dueDate: string;
  amount: string;
  extraordinary: string;
  notes: string;
  documentId?: string;
};
export function ExpenseForm({ initial }: { initial: ExpenseInput }) {
  const [values, setValues] = useState(initial);
  const [state, action, pending] = useActionState(saveExpense, {});
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [fileName, setFileName] = useState("");
  const [suggested, setSuggested] = useState(false);
  function field(key: keyof ExpenseInput, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }
  async function upload(file?: File) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setUploadError("Elegí un PDF de hasta 20 MB.");
      return;
    }
    setUploading(true);
    setUploadError("");
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/documents", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setFileName(result.filename);
      setValues((v) => ({
        ...v,
        documentId: result.id,
        ...(result.parsed
          ? {
              title: result.parsed.title,
              category: result.parsed.category,
              dueDate: result.parsed.dueDate,
              amount: decimal(BigInt(result.parsed.amountCents)),
              extraordinary: decimal(BigInt(result.parsed.extraordinaryCents)),
              notes: result.parsed.notes,
            }
          : {}),
      }));
      setSuggested(Boolean(result.parsed));
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "No pudimos subirlo.");
    } finally {
      setUploading(false);
    }
  }
  return (
    <form action={action} className="expense-form">
      <input type="hidden" name="id" value={values.id ?? ""} />
      <input type="hidden" name="version" value={values.version ?? ""} />
      <input type="hidden" name="documentId" value={values.documentId ?? ""} />
      <label className="upload-box">
        <Upload size={26} />
        <strong>
          {uploading ? "Leyendo comprobante…" : fileName || "Subí la factura"}
        </strong>
        <span>PDF de hasta 20 MB · también podés cargar sin factura</span>
        <input
          type="file"
          accept="application/pdf"
          disabled={uploading}
          onChange={(e) => upload(e.target.files?.[0])}
        />
      </label>
      {uploadError && (
        <p role="alert" className="form-error">
          {uploadError}
        </p>
      )}
      {suggested && (
        <div className="notice">
          Leímos la liquidación. Revisá el importe y el vencimiento antes de
          guardar.
        </div>
      )}
      <label>
        Nombre del gasto
        <input
          name="title"
          value={values.title}
          onChange={(e) => field("title", e.target.value)}
          placeholder="Ej. Expensas · Concorde"
          required
          maxLength={100}
        />
      </label>
      <div className="form-grid">
        <label>
          Categoría
          <select
            name="category"
            value={values.category}
            onChange={(e) => field("category", e.target.value)}
          >
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Vencimiento
          <input
            type="date"
            name="dueDate"
            value={values.dueDate}
            onChange={(e) => field("dueDate", e.target.value)}
            required
          />
        </label>
      </div>
      <div className="form-grid">
        <label>
          Importe total ($)
          <input
            name="amount"
            inputMode="decimal"
            value={values.amount}
            onChange={(e) => field("amount", e.target.value)}
            placeholder="0.00"
            required
          />
        </label>
        <label>
          Extraordinarias incluidas ($)
          <input
            name="extraordinary"
            inputMode="decimal"
            value={values.extraordinary}
            onChange={(e) => field("extraordinary", e.target.value)}
            required
          />
        </label>
      </div>
      <p className="help">
        El gasto se divide en el mes del vencimiento. Las extraordinarias de
        expensas descuentan el alquiler del mes siguiente.
      </p>
      <label>
        Nota (opcional)
        <textarea
          name="notes"
          value={values.notes}
          onChange={(e) => field("notes", e.target.value)}
          rows={3}
          maxLength={2000}
        />
      </label>
      {values.documentId && (
        <a
          className="text-link"
          target="_blank"
          href={`/api/documents/${values.documentId}`}
        >
          Abrir comprobante ↗
        </a>
      )}
      <Feedback
        state={state}
        pending={pending || uploading}
        label={initial.id ? "Guardar cambios" : "Guardar gasto"}
      />
    </form>
  );
}
export function RentForm({
  month,
  gross,
  credit,
  reason,
  version,
}: {
  month: string;
  gross: string;
  credit: string;
  reason: string;
  version: number;
}) {
  const [state, action, pending] = useActionState(saveRent, {});
  return (
    <form action={action}>
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="version" value={version} />
      <label>
        Alquiler acordado, antes del descuento ($)
        <input
          name="gross"
          inputMode="decimal"
          defaultValue={gross}
          required
          placeholder="700000"
        />
      </label>
      <p className="help">
        El descuento se calcula con las extraordinarias que vencieron el mes
        anterior.
      </p>
      <details>
        <summary>Corregir el descuento manualmente</summary>
        <label>
          Descuento ($)
          <input
            name="credit"
            inputMode="decimal"
            defaultValue={credit}
            placeholder="Vacío = automático"
          />
        </label>
        <label>
          Motivo de la corrección
          <textarea
            name="reason"
            defaultValue={reason}
            rows={2}
            maxLength={1000}
          />
        </label>
      </details>
      <Feedback state={state} pending={pending} label="Guardar alquiler" />
    </form>
  );
}
export function PaymentForm({
  expenseId,
  rentMonth,
  amount,
  payer,
}: {
  expenseId?: string;
  rentMonth?: string;
  amount: string;
  payer: string;
}) {
  const [state, action, pending] = useActionState(savePayment, {});
  return (
    <form action={action}>
      <input name="expenseId" type="hidden" value={expenseId ?? ""} />
      <input name="rentMonth" type="hidden" value={rentMonth ?? ""} />
      <label>
        Quién pagó
        <select name="payer" defaultValue={payer}>
          <option value="emiliano">Emiliano</option>
          <option value="vitoria">Vitoria</option>
        </select>
      </label>
      <div className="form-grid">
        <label>
          Importe pagado ($)
          <input
            name="amount"
            inputMode="decimal"
            defaultValue={amount}
            required
          />
        </label>
        <label>
          Fecha del pago
          <input name="paidAt" type="date" defaultValue={today()} required />
        </label>
      </div>
      <label>
        Nota (opcional)
        <input
          name="notes"
          maxLength={1000}
          placeholder="Transferencia, efectivo…"
        />
      </label>
      <Feedback state={state} pending={pending} label="Registrar pago" />
    </form>
  );
}
export function SettlementForm({
  month,
  amount,
  from,
}: {
  month: string;
  amount: string;
  from: string;
}) {
  const [state, action, pending] = useActionState(saveSettlement, {});
  return (
    <form action={action}>
      <input name="month" type="hidden" value={month} />
      <label>
        Quién transfirió
        <select name="from" defaultValue={from}>
          <option value="vitoria">Vitoria a Emiliano</option>
          <option value="emiliano">Emiliano a Vitoria</option>
        </select>
      </label>
      <div className="form-grid">
        <label>
          Importe ($)
          <input
            name="amount"
            inputMode="decimal"
            defaultValue={amount}
            required
          />
        </label>
        <label>
          Fecha
          <input name="paidAt" type="date" defaultValue={today()} required />
        </label>
      </div>
      <label>
        Nota (opcional)
        <input name="notes" maxLength={1000} />
      </label>
      <Feedback
        state={state}
        pending={pending}
        label="Registrar transferencia"
      />
    </form>
  );
}
export function VoidForm({
  id,
  kind,
  month,
}: {
  id: string;
  kind: "expense" | "payment" | "settlement";
  month: string;
}) {
  const [state, action, pending] = useActionState(voidRecord, {});
  return (
    <details className="void-form">
      <summary>
        Anular{" "}
        {kind === "expense"
          ? "gasto"
          : kind === "payment"
            ? "pago"
            : "transferencia"}
      </summary>
      <form action={action}>
        <input name="id" type="hidden" value={id} />
        <input name="kind" type="hidden" value={kind} />
        <input name="month" type="hidden" value={month} />
        <label>
          Motivo
          <input name="reason" required minLength={3} maxLength={1000} />
        </label>
        <Feedback state={state} pending={pending} label="Confirmar anulación" />
      </form>
    </details>
  );
}
