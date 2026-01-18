import type { RouteObject } from "react-router-dom";
import { Navigate, useLocation } from "react-router-dom";
import RootLayout from "./routes/RootLayout";
import ErrorPage from "./routes/ErrorPage";

import Landing from "./routes/Landing";
import Login from "./routes/Login";
import Register from "./routes/Register";
import ForgotPassword from "./routes/ForgotPassword";
import ResetPassword from "./routes/ResetPassword";

import AppLayout from "./routes/AppLayout";
import Dashboard from "./routes/app/Dashboard";
import Risk from "./routes/app/Risk";
import Journal from "./routes/app/Journal";
import Feedback from "./routes/app/Feedback";
import Account from "./routes/app/Account";
import Scanner from "./routes/app/Scanner";

import { getTokens } from "@/lib/auth";

function RequireAuth({ children }: { children: JSX.Element }) {
  const location = useLocation();
  const authed = !!getTokens();
  if (authed) return children;
  return <Navigate to="/login" replace state={{ from: location.pathname }} />;
}

const routes: RouteObject[] = [
  {
    path: "/",
    element: <RootLayout />,
    errorElement: <ErrorPage />,
    children: [
      // Public
      { index: true, element: <Landing /> },
      { path: "login", element: <Login /> },
      { path: "register", element: <Register /> },
      { path: "forgot-password", element: <ForgotPassword /> },
      { path: "reset-password/:uid/:token", element: <ResetPassword /> },

      // Authenticated app
      {
        path: "app",
        element: (
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        ),
        children: [
          { index: true, element: <Dashboard /> },
          { path: "risk", element: <Risk /> },
          { path: "journal", element: <Journal /> },
          { path: "scanner", element: <Scanner /> },
          { path: "feedback", element: <Feedback /> },
          { path: "account", element: <Account /> },

          // Catch-all under /app
          { path: "*", element: <Navigate to="/app" replace /> },
        ],
      },

      // Legacy redirect (if you still have any)
      { path: "settings", element: <Navigate to="/app/risk" replace /> },

      // Global catch-all
      { path: "*", element: <ErrorPage /> },
    ],
  },
];

export default routes;