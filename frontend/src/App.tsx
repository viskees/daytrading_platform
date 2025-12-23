import { AppStateProvider } from "@/state/appState";
import { Outlet } from "react-router-dom";

export default function App() {
  return (
    <AppStateProvider>
      <Outlet />
    </AppStateProvider>
  );
}