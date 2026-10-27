/// <reference lib="webworker" />
import { createSHA256 } from "hash-wasm";

const CHUNK = 4 * 1024 * 1024;

/** Incremental SHA-256 of a File, off the main thread. */
self.onmessage = async (event: MessageEvent<File>) => {
  try {
    const file = event.data;
    const hasher = await createSHA256();
    hasher.init();
    for (let offset = 0; offset < file.size; offset += CHUNK) {
      hasher.update(new Uint8Array(await file.slice(offset, offset + CHUNK).arrayBuffer()));
    }
    self.postMessage({ sha256: hasher.digest("hex") });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "Hashing failed." });
  }
};
