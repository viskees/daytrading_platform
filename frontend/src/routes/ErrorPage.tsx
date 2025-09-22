import { useRouteError, isRouteErrorResponse, Link } from "react-router-dom";

export default function ErrorPage() {
  const err = useRouteError();

  let title = "Something went wrong";
  let detail = "An unexpected error occurred.";
  let status: number | undefined;

  if (isRouteErrorResponse(err)) {
    status = err.status;
    title = err.statusText || title;
    detail = (err.data as any)?.message || detail;
  } else if (err instanceof Error) {
    detail = err.message || detail;
  }

  return (
    <div className="container py-10 space-y-4">
      <h1 className="text-2xl font-semibold">{title}{status ? ` (${status})` : ""}</h1>
      <pre className="text-sm whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">
        {detail}
      </pre>
      <Link to="/" className="text-sm underline">Back to dashboard</Link>
    </div>
  );
}
