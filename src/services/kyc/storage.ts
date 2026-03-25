/**
 * KYC document object storage: presigned URLs and server-side put.
 * Uses S3/MinIO when KYC_OBJECT_STORE_* and AWS credentials (or endpoint) are set.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../../config/env";

const BUCKET = config.kyc.objectStoreBucket;
const REGION = config.kyc.objectStoreRegion;
const ENDPOINT = config.kyc.objectStoreEndpoint || undefined;
const DEFAULT_EXPIRES = 3600; // 1 hour

function createClient(): S3Client | null {
  if (!BUCKET || BUCKET === "kyc-documents") {
    // Default bucket name is set even when not configured; treat as "not configured" if
    // no explicit override and no AWS credentials
    const hasCreds =
      process.env.AWS_ACCESS_KEY_ID ||
      process.env.AWS_SECRET_ACCESS_KEY ||
      process.env.AWS_SESSION_TOKEN;
    if (!ENDPOINT && !hasCreds) return null;
  }
  const cfg: S3ClientConfig = {
    region: REGION,
    ...(ENDPOINT && { endpoint: ENDPOINT, forcePathStyle: true }),
  };
  return new S3Client(cfg);
}

let _client: S3Client | null | undefined = undefined;

function getClient(): S3Client {
  if (_client === undefined) _client = createClient();
  if (_client === null) {
    throw new Error(
      "KYC object store not configured. Set KYC_OBJECT_STORE_BUCKET and AWS credentials (or KYC_OBJECT_STORE_ENDPOINT for MinIO). See ENV_VARS.md.",
    );
  }
  return _client;
}

/**
 * Build object key for a KYC document.
 */
export function documentKey(
  applicationId: string,
  kind: string,
  ext = "bin",
): string {
  return `kyc/${applicationId}/${kind}.${ext}`;
}

/**
 * Get a presigned PUT URL for client upload. Client should PUT the document body to the URL.
 */
export async function getPresignedUploadUrl(
  key: string,
  contentType?: string,
  expiresIn = DEFAULT_EXPIRES,
): Promise<{ url: string; key: string }> {
  const client = getClient();
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ...(contentType && { ContentType: contentType }),
  });
  const url = await getSignedUrl(client, command, { expiresIn });
  return { url, key };
}

/**
 * Get a presigned GET URL for secure download (e.g. redacted asset for validators).
 */
export async function getPresignedDownloadUrl(
  key: string,
  expiresIn = DEFAULT_EXPIRES,
): Promise<string> {
  const client = getClient();
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(client, command, { expiresIn });
}

/**
 * Server-side upload. Use when the backend has the buffer (e.g. after processing).
 */
export async function put(
  key: string,
  body: Buffer,
  contentType?: string,
): Promise<void> {
  const client = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ...(contentType && { ContentType: contentType }),
    }),
  );
}

/**
 * Download a document from object storage and return it as a Buffer.
 */
export async function getDocumentBuffer(key: string): Promise<Buffer> {
  const client = getClient();
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  const response = await client.send(command);
  const stream = response.Body;
  if (!stream) throw new Error(`Empty body for key ${key}`);
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Check if object store is configured (bucket + client). Does not validate credentials.
 */
export function isConfigured(): boolean {
  if (_client === undefined) _client = createClient();
  return _client !== null;
}
