import type { DocumentType } from "@/generated/prisma/enums";

import type { Adapter, AdapterResult } from "@/adapters/types";

/**
 * File storage.
 *
 * Uploads on this platform are medical reports, licences and identity
 * documents, so the contract is deliberately narrow: callers hand over bytes
 * and a declared purpose, and the adapter returns an opaque storage key. They
 * never construct paths themselves, which is what keeps traversal and
 * cross-tenant reads out of reach of application code.
 */

export interface PutObjectInput {
  /** Raw bytes. Already fully buffered — these are documents, not video. */
  body: Buffer;
  originalName: string;
  /** Declared by the client and therefore untrusted; verified against magic bytes. */
  declaredMimeType: string;
  type: DocumentType;
  /** Namespaces the object so one user's files cannot collide with another's. */
  ownerId: string;
  /** Public objects may be served directly; everything else streams through auth. */
  isPublic?: boolean;
}

export interface StoredObject {
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  isPublic: boolean;
}

export interface RetrievedObject {
  body: Buffer;
  mimeType: string;
  sizeBytes: number;
}

export interface StorageAdapter extends Adapter {
  put(input: PutObjectInput): Promise<AdapterResult<StoredObject>>;
  get(storageKey: string): Promise<AdapterResult<RetrievedObject>>;
  delete(storageKey: string): Promise<AdapterResult<{ deleted: boolean }>>;
  /**
   * A URL the browser can use. Local storage returns an authorised app route;
   * S3 returns a pre-signed URL. Never a raw filesystem path.
   */
  urlFor(storageKey: string): Promise<AdapterResult<{ url: string; expiresAt: Date | null }>>;
}
