import { describe, expect, it } from "vitest";
import type { Annotation, AnnotationsRepo } from "./annotations-repo";
import { createAnnotationStore } from "./store";

const fingerprint = `sha256:${"a".repeat(64)}`;
const make = (id: string, page = 0): Annotation => ({
  id,
  documentId: "d1",
  kind: "highlight",
  color: "key",
  target: {
    fingerprint,
    segments: [{ page, rects: [[0, 0, 10, 10]] }],
    quote: { exact: "x", prefix: "", suffix: "" },
  },
  pageStart: page,
  quoteText: "x",
  comment: null,
  tags: [],
  anchorStatus: "anchored",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

function fakeRepo(failTimes = 0) {
  const rows = new Map<string, Annotation>();
  let fails = failTimes;
  const repo: AnnotationsRepo = {
    list: async () => [...rows.values()],
    save: async (a) => {
      if (fails-- > 0) throw new Error("offline");
      rows.set(a.id, a);
    },
    remove: async (id) => {
      if (fails-- > 0) throw new Error("offline");
      rows.delete(id);
    },
  };
  return { repo, rows };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

describe("annotation store", () => {
  it("applies writes at once and persists them in the background", async () => {
    const { repo, rows } = fakeRepo();
    const store = createAnnotationStore(repo, "d1");
    store.create(make("a"));
    expect(store.getSnapshot().items).toHaveLength(1);
    await settle();
    expect(rows.has("a")).toBe(true);
    expect(store.getSnapshot().pending).toBe(0);
  });

  it("undoes and redoes create, update and delete", async () => {
    const { repo, rows } = fakeRepo();
    const store = createAnnotationStore(repo, "d1");
    store.create(make("a"));
    store.update("a", { color: "example" });
    store.remove("a");
    expect(store.getSnapshot().items).toHaveLength(0);
    store.undo();
    expect(store.get("a")?.color).toBe("example");
    store.undo();
    expect(store.get("a")?.color).toBe("key");
    store.undo();
    expect(store.getSnapshot().items).toHaveLength(0);
    store.redo();
    store.redo();
    store.redo();
    expect(store.getSnapshot().items).toHaveLength(0);
    store.undo();
    await settle();
    expect(rows.get("a")?.color).toBe("example");
  });

  it("adding and removing a tag is one undo step each", async () => {
    const { repo, rows } = fakeRepo();
    const store = createAnnotationStore(repo, "d1");
    store.create(make("a", 0));
    store.update("a", { tags: ["renal"] });
    store.update("a", { tags: ["renal", "exam-2"] });
    expect(store.get("a")?.tags).toEqual(["renal", "exam-2"]);
    store.undo();
    expect(store.get("a")?.tags).toEqual(["renal"]);
    store.redo();
    expect(store.get("a")?.tags).toEqual(["renal", "exam-2"]);
    store.undo();
    store.undo();
    expect(store.get("a")?.tags).toEqual([]);
    await settle();
    expect(rows.get("a")?.tags).toEqual([]);
  });

  it("coalesces keyed updates into one undo step", () => {
    const { repo } = fakeRepo();
    const store = createAnnotationStore(repo, "d1");
    store.create(make("a"));
    store.update("a", { comment: "h" }, "comment");
    store.update("a", { comment: "hi" }, "comment");
    store.undo();
    expect(store.get("a")?.comment).toBeNull();
  });

  it("retries failed writes and reports failing after repeated errors", async () => {
    const { repo, rows } = fakeRepo(3);
    const store = createAnnotationStore(repo, "d1", { retryBaseMs: 5, retryMaxMs: 10 });
    store.create(make("a"));
    await new Promise((r) => setTimeout(r, 12));
    expect(store.getSnapshot().failing).toBe(true);
    expect(store.getSnapshot().items).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 80));
    expect(rows.has("a")).toBe(true);
    expect(store.getSnapshot().failing).toBe(false);
    expect(store.getSnapshot().pending).toBe(0);
  });

  it("keeps unsaved local writes when the server list is older", async () => {
    const { repo } = fakeRepo(100);
    const store = createAnnotationStore(repo, "d1", { retryBaseMs: 1000 });
    store.create(make("a"));
    await store.load();
    expect(store.get("a")).toBeDefined();
  });
});

describe("annotation store load race", () => {
  it("keeps an annotation created while the list request was out", async () => {
    const { repo } = fakeRepo();
    let release: (rows: Annotation[]) => void = () => undefined;
    repo.list = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const store = createAnnotationStore(repo, "d1");
    const loading = store.load();
    store.create(make("a"));
    await settle();
    release([]);
    await loading;
    expect(store.get("a")).toBeDefined();
  });

  it("merges highlights into the first one's id; one undo step restores them all", async () => {
    const { repo, rows } = fakeRepo();
    const store = createAnnotationStore(repo, "d1");
    const a = make("a");
    const b = { ...make("b"), color: "example" as const, comment: "second" };
    store.create(a);
    store.create(b);
    await settle();
    const merged = { ...a, color: "definition" as const, comment: "second", quoteText: "xx" };
    store.merge(merged, [a, b]);
    expect(store.getSnapshot().items.map((i) => i.id)).toEqual(["a"]);
    expect(store.get("a")?.color).toBe("definition");
    await settle();
    expect([...rows.keys()]).toEqual(["a"]);

    expect(store.undo()).not.toBeNull();
    expect(
      store
        .getSnapshot()
        .items.map((i) => i.id)
        .sort(),
    ).toEqual(["a", "b"]);
    expect(store.get("a")?.color).toBe("key");
    expect(store.get("b")?.comment).toBe("second");
    await settle();
    expect([...rows.keys()].sort()).toEqual(["a", "b"]);

    store.redo();
    expect(store.getSnapshot().items.map((i) => i.id)).toEqual(["a"]);
    await settle();
    expect([...rows.keys()]).toEqual(["a"]);
  });
});
