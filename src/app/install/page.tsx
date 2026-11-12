import { Shell } from "@/components/shell";
import { InstallSettings } from "@/components/install-settings";
import { requireUser } from "@/lib/session";
import { logout } from "@/app/actions";
export default async function InstallPage() {
  const user = await requireUser();
  return (
    <Shell name={user.name} active="install">
      <div className="page-heading">
        <div>
          <span className="eyebrow">CASA, A MANO</span>
          <h1>
            Instalar y avisos<span className="teal">.</span>
          </h1>
          <p>Un lugar en tu teléfono para lo que compartimos.</p>
        </div>
      </div>
      <InstallSettings />
      <section className="card install-card">
        <h2>Tu sesión queda abierta</h2>
        <p>
          Podés cerrar Casa o reiniciar el teléfono. Recordamos tu ingreso
          durante 90 días sin usarla y renovamos ese plazo cuando volvés.
        </p>
        <p>
          Si cerrás sesión, borrás los datos del navegador o desinstalás Casa,
          puede que tengas que ingresar de nuevo. En iPhone, la primera apertura
          desde el ícono puede pedirte ingresar aunque ya lo hayas hecho en
          Safari.
        </p>
        <form action={logout}>
          <button className="button" type="submit">
            Cerrar sesión
          </button>
        </form>
      </section>
    </Shell>
  );
}
