import { getDB } from './db';

/** Tracing reference image for one glyph. Stored in the `blobs` store, so deleting the project removes it. */
const refId = (projectId: string, char: string) => `${projectId}/ref/${char}`;

export async function saveRef(projectId: string, char: string, blob: Blob): Promise<void> {
  const db = await getDB();
  await db.put('blobs', { id: refId(projectId, char), projectId, name: `ref:${char}`, blob, createdAt: Date.now() });
}

export async function getRef(projectId: string, char: string): Promise<Blob | undefined> {
  const row = await (await getDB()).get('blobs', refId(projectId, char));
  return row?.blob;
}

export async function deleteRef(projectId: string, char: string): Promise<void> {
  await (await getDB()).delete('blobs', refId(projectId, char));
}
