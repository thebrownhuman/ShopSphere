import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';

/** Private storage for data-export archives (same private bucket as invoices). In-memory in tests. */
export abstract class PrivacyExportStore {
  abstract put(key: string, bytes: Buffer): Promise<void>;
  abstract signedUrl(key: string, fileName: string, ttlSeconds: number): Promise<string>;
  abstract remove(key: string): Promise<void>;
}

const client = (endpoint: string) =>
  new S3Client({
    endpoint,
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? 'any',
      secretAccessKey: process.env.S3_SECRET_KEY ?? 'any',
    },
  });

@Injectable()
export class S3PrivacyExportStore extends PrivacyExportStore {
  private readonly bucket = process.env.PRIVACY_BUCKET ?? process.env.INVOICE_BUCKET ?? 'invoices';
  private readonly s3 = client(process.env.S3_ENDPOINT ?? 'http://localhost:8333');
  // Signatures cover the host, so sign against the endpoint browsers reach.
  private readonly signer = client(
    process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_ENDPOINT ?? 'http://localhost:8333',
  );
  private bucketReady?: Promise<void>;

  async put(key: string, bytes: Buffer): Promise<void> {
    this.bucketReady ??= this.s3
      .send(new HeadBucketCommand({ Bucket: this.bucket }))
      .then(() => undefined)
      .catch(() =>
        this.s3.send(new CreateBucketCommand({ Bucket: this.bucket })).then(() => undefined),
      );
    await this.bucketReady.catch((err) => {
      this.bucketReady = undefined;
      throw err;
    });
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: 'application/zip',
      }),
    );
  }

  signedUrl(key: string, fileName: string, ttlSeconds: number): Promise<string> {
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${fileName}"`,
      }),
      { expiresIn: ttlSeconds },
    );
  }

  async remove(key: string): Promise<void> {
    await this.s3
      .send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
      .catch(() => undefined);
  }
}
