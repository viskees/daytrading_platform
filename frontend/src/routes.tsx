import type { RouteObject } from "react-router-dom";
import RootLayout from "./routes/RootLayout";
import App from "./App";
import Journal from "./routes/Journal";
import Settings from "./routes/Settings";
import ErrorPage from "./routes/ErrorPage";
import Login from "./routes/Login";
import Register from "./routes/Register";
import { getTokens } from "./lib/auth";

function requireAuth(element: JSX.Element) {
  return getTokens() ? element : <Settings />; // redirect-ish: show Settings page as landing
}

const routes: RouteObject[] = [
  { path: "/login", element: <Login /> },
  { path: "/register", element: <Register /> },
  {
    path: "/",
    element: <RootLayout />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: requireAuth(<App />) },
      { path: "journal", element: requireAuth(<Journal />) },
      { path: "settings", element: <Settings /> },
    ],
  },
];

export default routes;
