export type Paid = { payer: string; amountCents: bigint; voided: boolean };
export type Bill = {
  id: string;
  amountCents: bigint;
  extraordinaryCents: bigint;
  payments: Paid[];
};
export function calculateMonth(
  bills: Bill[],
  previous: Pick<Bill, "extraordinaryCents">[],
  rent: {
    grossCents: bigint;
    creditOverrideCents: bigint | null;
    payments: Paid[];
  } | null,
  settlements: { from: string; amountCents: bigint; voided: boolean }[],
) {
  const credit =
    rent?.creditOverrideCents ??
    previous.reduce((n, e) => n + e.extraordinaryCents, 0n);
  const gross = rent?.grossCents ?? 0n;
  const net = gross > credit ? gross - credit : 0n;
  const total = net + bills.reduce((n, e) => n + e.amountCents, 0n);
  const payments = [
    ...bills.flatMap((e) => e.payments),
    ...(rent?.payments ?? []),
  ].filter((p) => !p.voided);
  const paid = payments.reduce((n, p) => n + p.amountCents, 0n);
  const emilianoPaid = payments
    .filter((p) => p.payer === "emiliano")
    .reduce((n, p) => n + p.amountCents, 0n);
  const vitoriaPaid = payments
    .filter((p) => p.payer === "vitoria")
    .reduce((n, p) => n + p.amountCents, 0n);
  // Deterministic odd-cent allocation: Emiliano receives the extra cent.
  const emilianoShare = (total + 1n) / 2n;
  const vitoriaShare = total / 2n;
  const transfers = settlements
    .filter((s) => !s.voided)
    .reduce(
      (n, s) => n + (s.from === "vitoria" ? s.amountCents : -s.amountCents),
      0n,
    );
  // Only actual supplier payments create a reimbursement; unpaid bills remain obligations.
  const assignedPaid = emilianoPaid + vitoriaPaid;
  const reimbursement = emilianoPaid - (assignedPaid + 1n) / 2n - transfers;
  return {
    credit,
    gross,
    net,
    total,
    paid,
    unassignedPaid: paid - assignedPaid,
    pending: total > paid ? total - paid : 0n,
    emilianoShare,
    vitoriaShare,
    emilianoPaid,
    vitoriaPaid,
    reimbursement,
    unusedCredit: credit > gross ? credit - gross : 0n,
  };
}
