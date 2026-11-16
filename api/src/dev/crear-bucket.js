// Solo desarrollo local: crea el bucket de documentos en RustFS (S3 compatible) si no existe.
import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';

const bucket = process.env.DOCS_BUCKET;
const s3 = new S3Client({ region: 'us-east-1', endpoint: process.env.S3_ENDPOINT, forcePathStyle: true });

try {
  await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  console.log(`bucket ${bucket} ya existe`);
} catch {
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  console.log(`bucket ${bucket} creado`);
}
