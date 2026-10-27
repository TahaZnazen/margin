/** SHA-256 hex of a file, computed in a Web Worker (hash-wasm, incremental). */
export function hashFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./hash.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ sha256?: string; error?: string }>) => {
      worker.terminate();
      if (event.data.sha256) resolve(event.data.sha256);
      else reject(new Error(event.data.error ?? "Hashing failed."));
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("Hashing failed."));
    };
    worker.postMessage(file);
  });
}
