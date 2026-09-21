import { request, type Project, type Field } from "./api";
type Draft = {
  id: string;
  field: Field;
  text: string;
  base: string;
  version: number;
};
// One serial queue per editor. DOM values are captured before every navigation or
// workflow action; acknowledgements never replace a newer local draft.
export class Drafts {
  project: Project;
  drafts = new Map<string, Draft>();
  status = "Enregistré";
  error = "";
  private pending: Promise<void> = Promise.resolve();
  private storageKey: string;
  constructor(
    project: Project,
    user: string,
    private changed: () => void,
  ) {
    this.project = project;
    this.storageKey = `tarjama-draft:${user}:${project.id}`;
    try {
      const saved = JSON.parse(
        localStorage.getItem(this.storageKey) || "[]",
      ) as Draft[];
      for (const d of saved) {
        if (project.segments.some((s) => s.id === d.id))
          this.drafts.set(`${d.id}:${d.field}`, d);
      }
    } catch {
      /* Storage may be unavailable on a private browser. */
    }
  }
  value(id: string, field: Field) {
    return (
      this.drafts.get(`${id}:${field}`)?.text ??
      this.project.segments.find((s) => s.id === id)?.[field] ??
      ""
    );
  }
  edit(id: string, field: Field, text: string) {
    const key = `${id}:${field}`;
    let d = this.drafts.get(key);
    if (!d) {
      const s = this.project.segments.find((s) => s.id === id)!;
      d = { id, field, text, base: s[field], version: s.version };
    } else d = { ...d, text };
    this.drafts.set(key, d);
    this.status = "Modification en cours";
    this.persist();
    this.changed();
  }
  private persist() {
    try {
      localStorage.setItem(
        this.storageKey,
        JSON.stringify(
          [...this.drafts.values()].filter((d) => d.text !== d.base),
        ),
      );
    } catch {
      /* In-memory draft remains intact. */
    }
  }
  get dirty() {
    return [...this.drafts.values()].some((d) => d.text !== d.base);
  }
  adopt(p: Project) {
    for (const [key, d] of this.drafts)
      if (d.text === d.base) this.drafts.delete(key);
    this.project = p;
    this.changed();
  }
  flush(only?: string): Promise<void> {
    const snapshots = [...this.drafts.entries()].filter(
      ([key, d]) => d.text !== d.base && (!only || key === only),
    );
    const run = async () => {
      this.error = "";
      try {
        for (const [key, snapshot] of snapshots) {
          const currentDraft = this.drafts.get(key);
          if (!currentDraft || currentDraft.base === snapshot.text) continue;
          this.status = "Enregistrement…";
          this.changed();
          const p = await request<Project>(
            `/api/projects/${this.project.id}/segments/${snapshot.id}`,
            "PATCH",
            {
              field: snapshot.field,
              text: snapshot.text,
              version: currentDraft.version,
            },
          );
          this.project = p;
          const acknowledged = p.segments.find((s) => s.id === snapshot.id)!;
          for (const [k, d] of this.drafts) {
            if (d.id === snapshot.id) {
              this.drafts.set(k, {
                ...d,
                version: acknowledged.version,
                base: d.field === snapshot.field ? snapshot.text : d.base,
              });
            }
          }
          const current = this.drafts.get(key)!;
          if (current.text === current.base) this.drafts.delete(key);
          this.persist();
        }
        this.status = this.dirty ? "Modification en cours" : "Enregistré";
      } catch (e) {
        this.status = "Échec — réessayer";
        this.error =
          e instanceof Error ? e.message : "Enregistrement impossible";
        throw e;
      } finally {
        this.changed();
      }
    };
    const promise = this.pending.catch(() => {}).then(run);
    this.pending = promise;
    return promise;
  }
  async resolve() {
    const { project } = await request<{ project: Project }>(
      `/api/projects/${this.project.id}`,
    );
    this.project = project;
    for (const [k, d] of this.drafts) {
      const s = project.segments.find((s) => s.id === d.id);
      if (s) this.drafts.set(k, { ...d, base: s[d.field], version: s.version });
    }
    this.error = "";
    this.persist();
    this.changed();
  }
  clear() {
    localStorage.removeItem(this.storageKey);
  }
}
export function purgeDrafts() {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k?.startsWith("tarjama-draft:")) localStorage.removeItem(k);
  }
}
