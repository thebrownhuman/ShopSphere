import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';

/** Where review photos live. S3 (SeaweedFS locally) in the app; in-memory in unit tests. */
export abstract class ReviewMediaStore {
  abstract put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  abstract url(key: string): string;
}

/** Writes to `S3_BUCKET` (default `catalog`, public-read like product renditions). */
@Injectable()
export class S3ReviewMediaStore extends ReviewMediaStore {
  private readonly bucket = process.env.S3_BUCKET ?? 'catalog';
  private readonly base = (
    process.env.MEDIA_BASE_URL ?? `${process.env.S3_ENDPOINT ?? 'http://localhost:8333'}/catalog`
  ).replace(/\/$/, '');
  private readonly s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:8333',
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? 'any',
      secretAccessKey: process.env.S3_SECRET_KEY ?? 'any',
    },
  });

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType }),
    );
  }

  url(key: string): string {
    return `${this.base}/${key}`;
  }
}
