export const API = {
  async get(path: string) {
    const r = await fetch(`/api${path}`);
    if (!r.ok) throw new Error(`GET ${path}: ${r.status}`);
    return r.json();
  },
  async post(path: string, body: any) {
    const r = await fetch(`/api${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`POST ${path}: ${r.status}`);
    return r.json();
  },
  async upload(path: string, form: FormData) {
    const r = await fetch(`/api${path}`, { method: "POST", body: form });
    if (!r.ok) throw new Error(`UPLOAD ${path}: ${r.status}`);
    return r.json();
  }
};
