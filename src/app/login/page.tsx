import { LoginForm } from "@/components/forms";
import { Home } from "lucide-react";
export default function LoginPage() {
  return (
    <main className="login-page">
      <div className="login-copy">
        <span className="brand">
          <Home />
          casa.
        </span>
        <h1>
          Las cuentas claras.
          <br />
          <em>La casa tranquila.</em>
        </h1>
        <p>
          Lo que compartimos, en un solo lugar.
          <br />
          Gastos, facturas y el reparto de cada mes.
        </p>
        <div className="login-people">
          <span className="avatar">E</span>
          <span className="avatar coral">V</span>
          <span>Emiliano + Vitoria</span>
        </div>
      </div>
      <section className="login-card">
        <span className="eyebrow">BIENVENIDOS A CASA</span>
        <h2>Entrá a tu espacio</h2>
        <p>Un lugar simple para nuestras cuentas.</p>
        <LoginForm />
      </section>
    </main>
  );
}
