
 import { RouterProvider, createBrowserRouter } from "react-router-dom";
 import routes from "./routes";
 import { useEffect, useState } from "react";
 import { initAccessTokenFromRefresh } from "./lib/auth";
 
 const router = createBrowserRouter(routes);
 
 export default function RouterApp() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        // If refresh cookie exists, hydrate ACCESS_TOKEN so route guards work.
        await initAccessTokenFromRefresh();
      } catch {
        // ignore; user stays logged out
      } finally {
        setReady(true);
      }
    })();
  }, []);

  if (!ready) return null;
  return <RouterProvider router={router} />;
 }