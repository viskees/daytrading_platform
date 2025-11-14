import { Outlet, NavLink } from "react-router-dom";

export default function RootLayout() {
  return (
    <div className="min-h-screen">
      <header className="container py-4 flex gap-4">
        <NavLink to="/" className="font-semibold">Dashboard</NavLink>
        <NavLink to="/journal">Journal</NavLink>
        <NavLink to="/settings">Settings</NavLink>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
