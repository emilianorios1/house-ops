import Link from "next/link";
import {
  Home,
  ArrowUpRight,
  LayoutDashboard,
  History,
  Files,
  Clock3,
  LogOut,
  Heart,
} from "lucide-react";
import { logout } from "@/app/actions";
export function Shell({
  name,
  active = "month",
  children,
}: {
  name: string;
  active?: string;
  children: React.ReactNode;
}) {
  const links = [
    { href: "/", label: "Este mes", icon: LayoutDashboard, key: "month" },
    { href: "/history", label: "Historial", icon: History, key: "history" },
    {
      href: "/documents",
      label: "Comprobantes",
      icon: Files,
      key: "documents",
    },
    { href: "/audit", label: "Actividad", icon: Clock3, key: "audit" },
  ];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-icon">
            <Home size={23} />
          </span>
          <span>
            casa<span className="brand-dot">.</span>
          </span>
        </Link>
        <p className="sidebar-label">NUESTRO ESPACIO</p>
        <nav>
          {links.map((l) => (
            <Link
              key={l.key}
              href={l.href}
              className={active === l.key ? "nav-link active" : "nav-link"}
            >
              <l.icon size={19} />
              {l.label}
              {active === l.key && <span className="nav-dot" />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-note">
          <Heart size={20} />
          <strong>
            Las cuentas claras,
            <br />
            la casa tranquila.
          </strong>
          <span>Un lugar para lo que compartimos.</span>
        </div>
        <div className="profile">
          <span className="avatar">{name[0]}</span>
          <div>
            <strong>{name}</strong>
            <span>Emiliano + Vitoria</span>
          </div>
          <form action={logout}>
            <button type="submit" aria-label="Cerrar sesión">
              <LogOut size={18} />
            </button>
          </form>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>Gastos compartidos</span>
          <span className="household">
            <span className="avatar small">E</span>
            <span className="avatar small coral">V</span>
            <span>Emiliano & Vitoria</span>
          </span>
        </header>
        <main>{children}</main>
        <footer>
          Hecho para compartir. <span>Mitad y mitad, sin vueltas.</span>
          <ArrowUpRight size={13} />
        </footer>
      </div>
    </div>
  );
}
