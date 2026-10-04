"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="login-page">
      <section className="login-card">
        <span className="eyebrow">VAMOS DE NUEVO</span>
        <h1>No pudimos abrir esta página.</h1>
        <p>Tus datos siguen guardados. Probá otra vez en un momento.</p>
        <button className="button primary" onClick={reset}>
          Volver a intentar
        </button>
        <p>
          <a className="text-link" href="/">
            Volver al mes
          </a>
        </p>
      </section>
    </main>
  );
}
