import type { RouteObject } from "react-router-dom";
import RootLayout from "./routes/RootLayout";   // has <Outlet/>
import App from "./App";                        // <- the mockup dashboard
import Journal from "./routes/Journal";         // optional pages
import Settings from "./routes/Settings";
import ErrorPage from "./routes/ErrorPage";

const routes: RouteObject[] = [
  {
    path: "/",
    element: <RootLayout />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <App /> },        // mockup at "/"
      { path: "journal", element: <Journal /> },
      { path: "settings", element: <Settings /> },
      // add more children as you grow the app
    ],
  },
];

export default routes;
