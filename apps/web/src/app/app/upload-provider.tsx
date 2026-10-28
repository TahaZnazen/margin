"use client";

import { waitForUploads } from "@margin/sync/client";
import { Button } from "@margin/ui/components/button";
import { Progress } from "@margin/ui/components/progress";
import { toast } from "@margin/ui/components/sonner";
import { cn } from "@margin/ui/lib/utils";
import { CheckIcon, RotateCwIcon, UploadIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { coverPath, sourcePath } from "@/lib/documents/config";
import { hashFile } from "@/lib/documents/hash";
import { extractMetadata, IngestError } from "@/lib/documents/ingest";
import { opfsRemove, opfsWrite } from "@/lib/documents/opfs";
import { currentUserId, services } from "@/lib/documents/services";
import { rejectReason, titleFromFileName } from "@/lib/documents/validate";
import type { UploadHandle } from "@/lib/storage/storage-provider";
import { uuidv7 } from "@/lib/uuid";
import { CompleteUploadResponse } from "@/server/contracts/documents";

type Stage = "hashing" | "preparing" | "uploading" | "finishing" | "done" | "failed" | "cancelled";

export interface UploadJob {
  jobId: string;
  name: string;
  stage: Stage;
  /** 0 to 1 while uploading. */
  progress: number;
  message?: string;
  documentId?: string;
}

interface UploadContextValue {
  jobs: UploadJob[];
  /** Bumps whenever the set of books changes, so the library reloads. */
  version: number;
  addFiles(files: File[]): void;
  pickFiles(): void;
  retry(jobId: string): void;
  cancel(jobId: string): void;
  dismiss(jobId: string): void;
}

const UploadContext = createContext<UploadContextValue | null>(null);

export function useUploads(): UploadContextValue {
  const value = useContext(UploadContext);
  if (!value) throw new Error("useUploads needs <UploadProvider>.");
  return value;
}

interface Runtime {
  file: File;
  documentId?: string;
  sha256?: string;
  cover?: Blob | null;
  handles: UploadHandle[];
  cancelled: boolean;
}

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [version, setVersion] = useState(0);
  const [dragging, setDragging] = useState(false);
  const runtimes = useRef(new Map<string, Runtime>());
  const input = useRef<HTMLInputElement>(null);

  const patch = useCallback((jobId: string, change: Partial<UploadJob>) => {
    setJobs((all) => all.map((job) => (job.jobId === jobId ? { ...job, ...change } : job)));
  }, []);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  /** Upload source + cover, then ask the server to verify. Safe to re-run (retry). */
  const uploadAndComplete = useCallback(
    async (jobId: string, rt: Runtime, documentId: string, userId: string, cover: Blob | null) => {
      const { storage } = services();
      patch(jobId, { stage: "uploading", progress: 0, message: undefined });
      const source = storage.createUpload({
        path: sourcePath(userId, documentId),
        data: rt.file,
        contentType: "application/pdf",
        onProgress: (done, total) => patch(jobId, { progress: total ? done / total : 0 }),
      });
      rt.handles = [source];
      await source.start();
      let hasCover = false;
      if (cover) {
        const coverUpload = storage.createUpload({
          path: coverPath(userId, documentId),
          data: cover,
          contentType: "image/webp",
        });
        rt.handles = [coverUpload];
        hasCover = await coverUpload.start().then(
          () => true,
          () => false,
        );
      }
      patch(jobId, { stage: "finishing", progress: 1 });
      // The server looks the row up in Postgres: let the background sync deliver it first.
      await waitForUploads();
      const response = await fetch(`/api/documents/${documentId}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hasCover }),
      });
      const parsed = CompleteUploadResponse.safeParse(await response.json().catch(() => null));
      if (!parsed.success) throw new Error("The server could not confirm the upload.");
      if (parsed.data.status === "failed") throw new Error(parsed.data.reason);
      patch(jobId, { stage: "done", message: undefined });
      bump();
    },
    [patch, bump],
  );

  const run = useCallback(
    async (jobId: string, openWhenReady: boolean) => {
      const rt = runtimes.current.get(jobId);
      if (!rt) return;
      const { documents } = services();
      try {
        if (rt.documentId && rt.sha256) {
          // Retry after the row exists: only the upload is left.
          const userId = await currentUserId();
          await uploadAndComplete(jobId, rt, rt.documentId, userId, rt.cover ?? null);
          return;
        }
        const reason = await rejectReason(rt.file);
        if (reason) throw new IngestError(reason);

        patch(jobId, { stage: "hashing", progress: 0, message: undefined });
        const sha256 = await hashFile(rt.file);
        const existing = await documents.findBySha(sha256);
        if (existing) {
          patch(jobId, { stage: "done", documentId: existing.id });
          toast("Already in your library", { description: existing.title });
          if (openWhenReady) router.push(`/app/read/${existing.id}`);
          return;
        }

        patch(jobId, { stage: "preparing" });
        const documentId = uuidv7();
        const userId = await currentUserId();
        await opfsWrite(documentId, rt.file);
        if (rt.cancelled) throw new Error("Cancelled");
        // The row exists (and the book opens) before the slower metadata and cover work.
        await documents.create({
          id: documentId,
          title: titleFromFileName(rt.file.name),
          sha256,
          byteSize: rt.file.size,
          storagePath: sourcePath(userId, documentId),
        });
        rt.documentId = documentId;
        rt.sha256 = sha256;
        patch(jobId, { documentId });
        bump();
        if (openWhenReady) router.push(`/app/read/${documentId}`);
        const extracted = await extractMetadata(rt.file);
        if (rt.cancelled) throw new Error("Cancelled");
        rt.cover = extracted.cover;
        await documents.update(documentId, {
          title: extracted.title,
          author: extracted.author,
          pageCount: extracted.pageCount,
          hasTextLayer: extracted.hasTextLayer,
          outline: extracted.outline,
        });
        bump();
        await uploadAndComplete(jobId, rt, documentId, userId, extracted.cover);
      } catch (error) {
        if (rt.cancelled) return;
        const message = error instanceof Error ? error.message : "Upload failed.";
        patch(jobId, { stage: "failed", message });
        if (error instanceof IngestError && rt.documentId) {
          // Unreadable file: drop the placeholder row so the library never shows it.
          const id = rt.documentId;
          rt.documentId = undefined;
          rt.sha256 = undefined;
          await documents.softDelete(id).catch(() => {});
          await opfsRemove(id);
        }
        bump();
      }
    },
    [patch, bump, router, uploadAndComplete],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      const added = files.map((file) => ({ jobId: uuidv7(), file }));
      if (added.length === 0) return;
      setJobs((all) => [
        ...all,
        ...added.map(
          ({ jobId, file }): UploadJob => ({
            jobId,
            name: file.name,
            stage: "hashing",
            progress: 0,
          }),
        ),
      ]);
      for (const { jobId, file } of added) {
        runtimes.current.set(jobId, { file, handles: [], cancelled: false });
      }
      // One at a time keeps memory flat and the order predictable.
      void (async () => {
        for (const { jobId } of added) await run(jobId, added.length === 1);
      })();
    },
    [run],
  );

  const retry = useCallback(
    (jobId: string) => {
      const rt = runtimes.current.get(jobId);
      if (!rt) return;
      rt.cancelled = false;
      void run(jobId, false);
    },
    [run],
  );

  const cancel = useCallback(
    (jobId: string) => {
      const rt = runtimes.current.get(jobId);
      if (!rt) return;
      rt.cancelled = true;
      for (const handle of rt.handles) handle.cancel();
      patch(jobId, { stage: "cancelled", message: "Cancelled" });
      if (rt.documentId) {
        const id = rt.documentId;
        void services()
          .documents.softDelete(id)
          .then(() => opfsRemove(id))
          .then(bump);
      }
    },
    [patch, bump],
  );

  const dismiss = useCallback((jobId: string) => {
    runtimes.current.delete(jobId);
    setJobs((all) => all.filter((job) => job.jobId !== jobId));
  }, []);

  const pickFiles = useCallback(() => input.current?.click(), []);

  // Drop a PDF anywhere in /app.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      addFiles(Array.from(e.dataTransfer?.files ?? []));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [addFiles]);

  const value = useMemo(
    () => ({ jobs, version, addFiles, pickFiles, retry, cancel, dismiss }),
    [jobs, version, addFiles, pickFiles, retry, cancel, dismiss],
  );

  return (
    <UploadContext.Provider value={value}>
      {children}
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        data-testid="upload-input"
        onChange={(event) => {
          addFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      {dragging ? (
        <div
          className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80"
          data-testid="drop-overlay"
        >
          <div className="flex items-center gap-3 rounded-xl border-2 border-primary border-dashed bg-card px-8 py-6 font-serif text-xl">
            <UploadIcon /> Drop PDFs to add them
          </div>
        </div>
      ) : null}
      <UploadTray />
    </UploadContext.Provider>
  );
}

function UploadTray() {
  const { jobs, retry, cancel, dismiss } = useUploads();
  if (jobs.length === 0) return null;
  return (
    <ul
      aria-label="Uploads"
      className="fixed right-4 bottom-20 z-40 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 md:bottom-4"
      data-testid="upload-tray"
    >
      {jobs.map((job) => {
        const active = !["done", "failed", "cancelled"].includes(job.stage);
        return (
          <li
            key={job.jobId}
            data-testid="upload-item"
            data-stage={job.stage}
            className="rounded-lg border bg-card p-3 text-sm shadow-md"
          >
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{job.name}</span>
              {job.stage === "done" ? <CheckIcon className="size-4 text-primary" /> : null}
              {job.stage === "failed" ? (
                <Button size="sm" variant="ghost" onClick={() => retry(job.jobId)}>
                  <RotateCwIcon /> Retry
                </Button>
              ) : null}
              {active ? (
                <Button size="sm" variant="ghost" onClick={() => cancel(job.jobId)}>
                  Cancel
                </Button>
              ) : (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Dismiss"
                  onClick={() => dismiss(job.jobId)}
                >
                  <XIcon />
                </Button>
              )}
            </div>
            {job.stage === "uploading" || job.stage === "finishing" ? (
              <Progress value={job.progress * 100} className="mt-2" />
            ) : null}
            <p
              className={cn(
                "mt-1 text-muted-foreground text-xs",
                job.stage === "failed" && "text-destructive",
              )}
            >
              {job.message ?? STAGE_LABEL[job.stage]}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

const STAGE_LABEL: Record<Stage, string> = {
  hashing: "Checking the file…",
  preparing: "Reading the book…",
  uploading: "Uploading…",
  finishing: "Finishing…",
  done: "Saved",
  failed: "Failed",
  cancelled: "Cancelled",
};
