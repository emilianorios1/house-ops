import Link from "next/link";
export default function NotFound() {
  return (
    <main className="login-page">
      <section className="login-card">
        <span className="eyebrow">POR ACÁ NO ERA</span>
        <h1>No encontramos esta página.</h1>
        <p>Podés volver a los gastos de este mes.</p>
        <Link className="button primary" href="/">
          Volver a casa
        </Link>
      </section>
    </main>
  );
}
