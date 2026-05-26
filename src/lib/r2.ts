import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Cloudflare R2 client. R2 is S3-compatible; we use the AWS SDK v3 with
 * region "auto" and the R2 endpoint. Credentials are server-side only —
 * the only thing leaving the server is short-lived presigned GET URLs.
 */

declare global {
  // eslint-disable-next-line no-var
  var __bfiR2: S3Client | undefined;
}

function createClient(): S3Client {
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2 credentials missing: set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY",
    );
  }

  return new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
}

export function r2Client(): S3Client {
  if (!global.__bfiR2) {
    global.__bfiR2 = createClient();
  }
  return global.__bfiR2;
}

export function r2Bucket(): string {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) {
    throw new Error("R2_BUCKET is not set");
  }
  return bucket;
}

/**
 * Issue a short-lived signed GET URL for an R2 object. Default 1 hour TTL.
 * Pass `download` to force a Content-Disposition: attachment response.
 */
export async function presignR2(
  key: string,
  options: { expiresIn?: number; download?: boolean; filename?: string } = {},
): Promise<string> {
  const { expiresIn = 3600, download = false, filename } = options;

  const command = new GetObjectCommand({
    Bucket: r2Bucket(),
    Key: key,
    ...(download
      ? {
          ResponseContentDisposition: filename
            ? `attachment; filename="${filename}"`
            : "attachment",
        }
      : {}),
  });

  return getSignedUrl(r2Client(), command, { expiresIn });
}
