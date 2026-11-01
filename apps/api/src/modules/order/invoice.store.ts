import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';

/** Signed invoice links live this long (seconds). */
export const INVOICE_URL_TTL_S = 300;

/** Private invoices bucket (S3 / SeaweedFS). In-memory in tests. */
export abstract class InvoiceStore {
  /** Null when the worker has not written the PDF yet. */
  abstract signedUrl(key: string, fileName: string, ttlSeconds: number): Promise<string | null>;
}

@Injectable()
export class S3InvoiceStore extends InvoiceStore {
  private readonly bucket = process.env.INVOICE_BUCKET ?? 'invoices';
  private readonly s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:8333',
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? 'any',
      secretAccessKey: process.env.S3_SECRET_KEY ?? 'any',
    },
  });

  async signedUrl(key: string, fileName: string, ttlSeconds: number): Promise<string | null> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch {
      return null;
    }
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${fileName}.pdf"`,
      }),
      { expiresIn: ttlSeconds },
    );
  }
}
