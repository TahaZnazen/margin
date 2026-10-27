/**
 * Where document bytes live. The app depends only on this interface; Supabase Storage is the MVP
 * implementation and R2 will be a second one.
 */
export interface UploadHandle {
  /** Resolves when the object is stored; rejects on failure or cancel. */
  start(): Promise<void>;
  cancel(): void;
}

export interface UploadRequest {
  path: string;
  data: Blob;
  contentType: string;
  onProgress?: (bytesUploaded: number, bytesTotal: number) => void;
}

export interface StorageProvider {
  createUpload(request: UploadRequest): UploadHandle;
  /** Signed read URL valid for at most 10 minutes. */
  getReadUrl(path: string): Promise<string>;
  getReadUrls(paths: string[]): Promise<Map<string, string>>;
  remove(paths: string[]): Promise<void>;
}
