import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getInitialDark, setTheme } from "@/lib/theme";

export default function Landing() {
  const [dark, setDark] = useState<boolean>(getInitialDark());

  useEffect(() => {
    setTheme(dark);
  }, [dark]);

  return (
    <div className="max-w-3xl mx-auto py-12 space-y-6">
      <header className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-3xl font-bold">Trade Journal</h1>
          <div className="flex items-center gap-2 text-sm">
            <span>Dark mode</span>
            <Switch checked={dark} onCheckedChange={setDark} />
          </div>
        </div>

        <p className="text-muted-foreground">
          Track trades, manage risk, review performance. Built for daytraders.
        </p>
      </header>

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link to="/login">Login</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/register">Create account</Link>
            </Button>
          </div>

          <div className="text-sm text-muted-foreground">
            After creating your account you’ll receive an activation email.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}