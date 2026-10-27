import {
  AnnotationShape,
  type AnnotationTarget,
  DEFAULT_HIGHLIGHT_LABELS,
} from "@margin/annotation-model";
import type { Annotation, Document, NewAnnotation } from "@margin/db";
import { DOCUMENTS_BUCKET } from "@margin/db";
import { describe, expect, expectTypeOf, it } from "vitest";

// The contract packages resolve and type-check from the web app (tsc covers this file too).
describe("contract packages in apps/web", () => {
  it("share one annotation target type between the DB row and the model", () => {
    expectTypeOf<Annotation["target"]>().toEqualTypeOf<AnnotationTarget>();
    expectTypeOf<NewAnnotation["kind"]>().toEqualTypeOf<
      "highlight" | "area" | "bookmark" | "ink"
    >();
    expectTypeOf<Document["readStatus"]>().toEqualTypeOf<"uploading" | "readable" | "failed">();
  });

  it("import at runtime", () => {
    expect(DOCUMENTS_BUCKET).toBe("documents");
    expect(DEFAULT_HIGHLIGHT_LABELS.key).toBe("Key idea");
    expect(AnnotationShape.safeParse({ kind: "ink" }).success).toBe(false);
  });
});
