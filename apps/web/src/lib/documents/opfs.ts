/** Origin-private file system cache of the PDFs: `documents/{id}.pdf`. Every call is best-effort. */
async function dir(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle("documents", { create });
  } catch {
    return null;
  }
}

export async function opfsWrite(id: string, data: Blob): Promise<boolean> {
  try {
    const handle = await (await dir(true))?.getFileHandle(`${id}.pdf`, { create: true });
    if (!handle) return false;
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

export async function opfsRead(id: string): Promise<File | null> {
  try {
    const handle = await (await dir(false))?.getFileHandle(`${id}.pdf`);
    return handle ? await handle.getFile() : null;
  } catch {
    return null;
  }
}

/** Every cached PDF with its size in bytes. */
export async function opfsList(): Promise<{ id: string; size: number }[]> {
  const out: { id: string; size: number }[] = [];
  try {
    const folder = await dir(false);
    if (!folder) return out;
    // The DOM typings in TypeScript 5.9 lack the async iterator of directory handles.
    const entries = folder as unknown as AsyncIterable<[string, FileSystemHandle]>;
    for await (const [name, handle] of entries) {
      if (handle.kind !== "file" || !name.endsWith(".pdf")) continue;
      const file = await (handle as FileSystemFileHandle).getFile();
      out.push({ id: name.slice(0, -4), size: file.size });
    }
  } catch {
    // Unsupported or blocked: nothing is cached.
  }
  return out;
}

export async function opfsRemove(id: string): Promise<void> {
  try {
    await (await dir(false))?.removeEntry(`${id}.pdf`);
  } catch {
    // Not cached: nothing to do.
  }
}
