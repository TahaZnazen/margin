import type { SupabaseClient } from "@supabase/supabase-js";
import Uppy from "@uppy/core";
import Tus from "@uppy/tus";
import { SIGNED_URL_TTL_SECONDS } from "@/lib/documents/config";
import type { StorageProvider, UploadRequest } from "./storage-provider";

const BUCKET = "documents";
/** Supabase's resumable endpoint requires exactly 6 MB chunks. */
const CHUNK_SIZE = 6 * 1024 * 1024;

export function createSupabaseStorage(
  supabase: SupabaseClient,
  supabaseUrl: string,
): StorageProvider {
  const bucket = () => supabase.storage.from(BUCKET);

  async function authHeaders(): Promise<Record<string, string>> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Not signed in.");
    return { authorization: `Bearer ${token}`, "x-upsert": "true" };
  }

  return {
    createUpload({ path, data, contentType, onProgress }: UploadRequest) {
      const uppy = new Uppy({ autoProceed: false });
      uppy.use(Tus, {
        endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
        chunkSize: CHUNK_SIZE,
        retryDelays: [0, 1000, 3000, 5000, 10_000],
        removeFingerprintOnSuccess: true,
        uploadDataDuringCreation: true,
        allowedMetaFields: ["bucketName", "objectName", "contentType", "cacheControl"],
        // A fresh token on every request: a long upload can outlive the first one.
        onBeforeRequest: async (req) => {
          const headers = await authHeaders();
          for (const [name, value] of Object.entries(headers)) req.setHeader(name, value);
        },
      });
      uppy.on("upload-progress", (_file, progress) => {
        onProgress?.(progress.bytesUploaded, progress.bytesTotal ?? data.size);
      });
      let cancelled = false;
      uppy.on("cancel-all", () => {
        cancelled = true;
      });
      return {
        start: () =>
          new Promise<void>((resolve, reject) => {
            if (cancelled) {
              uppy.destroy();
              reject(new Error("Cancelled"));
              return;
            }
            uppy.addFile({
              name: path.split("/").pop() ?? "file",
              type: contentType,
              data,
              meta: { bucketName: BUCKET, objectName: path, contentType, cacheControl: "3600" },
            });
            uppy
              .upload()
              .then((result) => {
                const failed = result?.failed?.[0];
                if (cancelled) reject(new Error("Cancelled"));
                else if (failed) reject(new Error(failed.error ?? "Upload failed."));
                else resolve();
              })
              .catch(reject)
              .finally(() => uppy.destroy());
          }),
        cancel: () => {
          cancelled = true;
          uppy.cancelAll();
        },
      };
    },

    async getReadUrl(path) {
      const { data, error } = await bucket().createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
      if (error || !data) throw new Error(error?.message ?? "Could not sign the URL.");
      return data.signedUrl;
    },

    async getReadUrls(paths) {
      const urls = new Map<string, string>();
      if (paths.length === 0) return urls;
      const { data, error } = await bucket().createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
      if (error) throw new Error(error.message);
      for (const item of data) if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
      return urls;
    },

    async remove(paths) {
      const { error } = await bucket().remove(paths);
      if (error) throw new Error(error.message);
    },
  };
}
