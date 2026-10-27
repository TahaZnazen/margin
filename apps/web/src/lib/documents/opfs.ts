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

export async function opfsRemove(id: string): Promise<void> {
  try {
    await (await dir(false))?.removeEntry(`${id}.pdf`);
  } catch {
    // Not cached: nothing to do.
  }
}
