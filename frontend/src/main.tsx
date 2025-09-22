import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css"; // <- ensure Tailwind styles are included
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import routes from "./routes";

// Create the router from your route config (src/routes.tsx)
const router = createBrowserRouter(routes);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
