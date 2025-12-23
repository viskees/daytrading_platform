import { Card, CardContent } from "@/components/ui/card";
import JournalDashboard from "@/pages/JournalDashboard";

export default function Journal() {
  return (
    <Card>
      <CardContent className="p-0">
        <JournalDashboard />
      </CardContent>
    </Card>
  );
}