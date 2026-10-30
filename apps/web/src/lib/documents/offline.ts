import { warmPage } from "@/lib/pwa/pwa";
import type { Book } from "./documents-repo";
import { opfsWrite } from "./opfs";
import { services } from "./services";

/** Downloads a book's PDF into this device's cache (OPFS), the same copy the reader opens first. */
export async function keepOffline(book: Book): Promise<void> {
  if (book.readStatus !== "readable" || !book.storagePath) {
    throw new Error("This book is not uploaded yet.");
  }
  const url = await services().storage.getReadUrl(book.storagePath);
  const res = await fetch(url);
  if (!res.ok) throw new Error("The download failed.");
  const blob = await res.blob();
  if (!(await opfsWrite(book.id, blob))) throw new Error("This browser could not store the file.");
  // Also store the reader page, so the book opens offline even if it was never opened here.
  await warmPage(`/app/read/${book.id}`).catch(() => {});
}
