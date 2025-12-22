
 import type { RouteObject } from "react-router-dom";
 import RootLayout from "./routes/RootLayout";
 import { Navigate, useLocation } from "react-router-dom";
 import App from "./App";
 import Journal from "./routes/Journal";
 import Settings from "./routes/Settings";
 import ErrorPage from "./routes/ErrorPage";
 import Login from "./routes/Login";
 import Register from "./routes/Register";
 import ForgotPassword from "./routes/ForgotPassword";
 import ResetPassword from "./routes/ResetPassword";
 import Landing from "./routes/Landing";
 import { getTokens } from "@/lib/auth";
 
function RequireAuth({ children }: { children: JSX.Element }) {
  // IMPORTANT: this must run at *render time*, not when routes are constructed.
  const location = useLocation();
  const authed = !!getTokens();
  if (authed) return children;
  return <Navigate to="/login" replace state={{ from: location.pathname }} />;
}

const routes: RouteObject[] = [
  // Public
  { path: "/", element: <Landing /> },
  { path: "/login", element: <Login /> },
  { path: "/register", element: <Register /> },
  { path: "/forgot-password", element: <ForgotPassword /> },
  { path: "/reset-password/:uid/:token", element: <ResetPassword /> },

  // Authenticated app
  {
    path: "/app",
    element: (
      <RequireAuth>
        <RootLayout />
      </RequireAuth>
    ),
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <App /> },
      { path: "journal", element: <Journal /> },
      { path: "settings", element: <Settings /> },
    ],
  },
  { path: "/settings", element: <Navigate to="/app/settings" replace /> },
  { path: "*", element: <ErrorPage /> },
 ];
 
 export default routes;