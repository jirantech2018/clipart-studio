// Design Ref: §8.1 Cloudflare R2 for image storage (Egress-free)
// Uses raw fetch with SigV4 via the AWS Signature v4 algorithm.
// This avoids pulling in @aws-sdk/client-s3 (~1MB) for a single PutObject call.
//
// If we later need presigned URLs (module-3 downloads), switch to
// @aws-sdk/s3-request-presigner. For simple server-side PUT, fetch+SigV4 is enough.

import { createHash, createHmac } from 'node:crypto';

type PutParams = {
  key: string;
  body: Buffer;
  contentType: string;
};

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`R2 env missing: ${name}`);
  return v;
}

function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

function hmac(key: Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function signatureKey(secret: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmac(Buffer.from(`AWS4${secret}`, 'utf8'), dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

/** Upload a buffer to R2 and return the object key. */
export async function putObject({ key, body, contentType }: PutParams): Promise<string> {
  const accountId = env('R2_ACCOUNT_ID');
  const accessKeyId = env('R2_ACCESS_KEY_ID');
  const secretAccessKey = env('R2_SECRET_ACCESS_KEY');
  const bucket = env('R2_BUCKET_NAME');

  const host = `${accountId}.r2.cloudflarestorage.com`;
  const region = 'auto';
  const service = 's3';
  const url = `https://${host}/${bucket}/${encodeURI(key)}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);

  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    'PUT',
    `/${bucket}/${encodeURI(key)}`,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = signatureKey(secretAccessKey, dateStamp, region, service);
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: authorization,
      'Content-Type': contentType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
    body: new Uint8Array(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`R2 PUT failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return key;
}

/** Public URL for an R2 key (module-3 will use this for CDN reads). */
export function publicUrl(key: string): string {
  const base = env('R2_PUBLIC_URL').replace(/\/+$/, '');
  return `${base}/${encodeURI(key)}`;
}
