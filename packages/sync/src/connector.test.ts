import { describe, expect, it } from "vitest";
import { toRemote } from "./connector";

describe("toRemote", () => {
  it("turns JSON text columns back into JSON values", () => {
    const out = toRemote("annotations", { target: '{"segments":[]}', tags: "[]", comment: "x" });
    expect(out).toEqual({ target: { segments: [] }, tags: [], comment: "x" });
  });

  it("turns 0/1 into booleans where Postgres has a boolean", () => {
    expect(toRemote("documents", { has_text_layer: 1 })).toEqual({ has_text_layer: true });
    expect(toRemote("documents", { has_text_layer: 0 })).toEqual({ has_text_layer: false });
    expect(toRemote("documents", { has_text_layer: null })).toEqual({ has_text_layer: null });
  });

  it("re-adds the columns a PUT left out as null, so a replaced row is cleared on the server", () => {
    const out = toRemote("annotations", { kind: "highlight" }, true);
    expect(out.deleted_at).toBeNull();
    expect(out.comment).toBeNull();
    expect(out.kind).toBe("highlight");
    expect(out).not.toHaveProperty("id");
  });

  it("leaves other tables and unparseable text alone", () => {
    expect(toRemote("collections", { name: "[1]" })).toEqual({ name: "[1]" });
    expect(toRemote("notes", { doc_json: "not json" })).toEqual({ doc_json: "not json" });
  });
});
