import { z } from "zod";

/** POST /api/documents/[id]/complete: the client says "bytes are in storage"; the server verifies. */
export const CompleteUploadRequest = z.object({
  /** True when `cover.webp` was uploaded too. */
  hasCover: z.boolean().default(false),
});
export type CompleteUploadRequest = z.infer<typeof CompleteUploadRequest>;

export const CompleteUploadResponse = z.discriminatedUnion("status", [
  z.object({ status: z.literal("readable"), byteSize: z.number().int().nonnegative() }),
  z.object({ status: z.literal("failed"), reason: z.string() }),
]);
export type CompleteUploadResponse = z.infer<typeof CompleteUploadResponse>;

export const DocumentIdParam = z.uuid();
