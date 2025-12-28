import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiFetch } from "@/lib/api";

function unwrapList<T>(payload: any): T[] {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.results)) return payload.results;
  return [];
}

type Feature = {
  id: number;
  title: string;
  description: string;
  created_by: number;
  created_at: string;
  votes: number;
};

type RoadmapItem = {
  id: number;
  title: string;
  description: string;
  order: number;
  is_public: boolean;
  created_at: string;
  updated_at: string;
};

type Bug = {
  id: number;
  title: string;
  description: string;
  status: "open" | "in_progress" | "resolved";
  created_by: number;
  created_at: string;
  updated_at: string;
};

export default function Feedback() {
  const [tab, setTab] = useState<"features" | "roadmap" | "bugs">("features");

  // Features
  const [features, setFeatures] = useState<Feature[]>([]);
  const [featureTitle, setFeatureTitle] = useState("");
  const [featureDesc, setFeatureDesc] = useState("");

  // Roadmap
  const [roadmap, setRoadmap] = useState<RoadmapItem[]>([]);

  // Bugs
  const [bugs, setBugs] = useState<Bug[]>([]);
  const [bugTitle, setBugTitle] = useState("");
  const [bugDesc, setBugDesc] = useState("");

  const sortedFeatures = useMemo(() => {
    if (!Array.isArray(features)) return [];
    return [...features].sort((a, b) => b.votes - a.votes || b.id - a.id);
  }, [features]);

async function loadAll() {
  const [fRes, rRes, bRes] = await Promise.all([
    apiFetch("/feedback/features/"),
    apiFetch("/feedback/roadmap/"),
    apiFetch("/feedback/bugs/"),
  ]);

  const f = fRes.ok ? await fRes.json() : null;
  const r = rRes.ok ? await rRes.json() : null;
  const b = bRes.ok ? await bRes.json() : null;

  setFeatures(unwrapList<Feature>(f));
  setRoadmap(unwrapList<RoadmapItem>(r));
  setBugs(unwrapList<Bug>(b));
}

  useEffect(() => {
    loadAll().catch(console.error);
  }, []);

async function createFeature() {
  if (!featureTitle.trim()) return;

  const res = await apiFetch("/feedback/features/", {
    method: "POST",
    body: JSON.stringify({
      title: featureTitle.trim(),
      description: featureDesc.trim(),
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error("Create feature failed:", res.status, txt);
    return;
  }

  setFeatureTitle("");
  setFeatureDesc("");
  await loadAll();
}

async function vote(featureId: number) {
  const res = await apiFetch(`/feedback/features/${featureId}/vote/`, { method: "POST" });
  if (!res.ok) console.error("Vote failed:", res.status, await res.text());
  await loadAll();
}

async function unvote(featureId: number) {
  const res = await apiFetch(`/feedback/features/${featureId}/vote/`, { method: "DELETE" });
  if (!res.ok) console.error("Unvote failed:", res.status, await res.text());
  await loadAll();
}

async function createBug() {
  if (!bugTitle.trim()) return;

  const res = await apiFetch("/feedback/bugs/", {
    method: "POST",
    body: JSON.stringify({
      title: bugTitle.trim(),
      description: bugDesc.trim(),
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error("Create bug failed:", res.status, txt);
    return;
  }

  setBugTitle("");
  setBugDesc("");
  await loadAll();
}

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Feedback</h1>
        <p className="text-sm opacity-80">
          Feature requests (vote), roadmap (admin-managed), and bug reports.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="features">Features</TabsTrigger>
          <TabsTrigger value="roadmap">Roadmap</TabsTrigger>
          <TabsTrigger value="bugs">Bugs</TabsTrigger>
        </TabsList>

        <TabsContent value="features" className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-2">
              <div className="font-semibold">Create feature request</div>
              <div className="flex gap-2">
                <Input
                  placeholder="Title"
                  value={featureTitle}
                  onChange={(e) => setFeatureTitle(e.target.value)}
                />
                <Button onClick={createFeature}>Create</Button>
              </div>
              <Input
                placeholder="Description (optional)"
                value={featureDesc}
                onChange={(e) => setFeatureDesc(e.target.value)}
              />
            </CardContent>
          </Card>

          <div className="space-y-2">
            {sortedFeatures.map((f) => (
              <Card key={f.id}>
                <CardContent className="p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{f.title}</div>
                    {f.description ? (
                      <div className="text-sm opacity-80 line-clamp-2">{f.description}</div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <div className="text-sm opacity-80">{f.votes} votes</div>
                    <Button variant="outline" onClick={() => vote(f.id)}>Vote</Button>
                    <Button variant="outline" onClick={() => unvote(f.id)}>Unvote</Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="roadmap" className="space-y-2">
          {roadmap.map((r) => (
            <Card key={r.id}>
              <CardContent className="p-4">
                <div className="font-semibold">{r.title}</div>
                {r.description ? <div className="text-sm opacity-80">{r.description}</div> : null}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="bugs" className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-2">
              <div className="font-semibold">Report a bug</div>
              <div className="flex gap-2">
                <Input
                  placeholder="Title"
                  value={bugTitle}
                  onChange={(e) => setBugTitle(e.target.value)}
                />
                <Button onClick={createBug}>Create</Button>
              </div>
              <Input
                placeholder="Description (optional)"
                value={bugDesc}
                onChange={(e) => setBugDesc(e.target.value)}
              />
            </CardContent>
          </Card>

          <div className="space-y-2">
            {bugs.map((b) => (
              <Card key={b.id}>
                <CardContent className="p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{b.title}</div>
                    {b.description ? (
                      <div className="text-sm opacity-80 line-clamp-2">{b.description}</div>
                    ) : null}
                  </div>
                  <div className="text-sm opacity-80 whitespace-nowrap">
                    {b.status.replace("_", " ")}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}