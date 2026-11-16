// Documentos clínicos en S3 mediante URL prefirmadas: el archivo nunca pasa por la API.
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const TIPOS_PERMITIDOS = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };
export const TAMANO_MAXIMO = 10 * 1024 * 1024;
const EXPIRA_SEGUNDOS = 300;

export function createStorage(s3Config) {
  const client = new S3Client({
    region: s3Config.region,
    endpoint: s3Config.endpoint,
    forcePathStyle: s3Config.forcePathStyle,
    // Sin checksums automáticos en las URL prefirmadas: el navegador no podría reproducirlos.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  return {
    // PUT firmado con tipo de contenido y SHA-256: S3 rechaza el archivo si no coincide con lo declarado.
    async urlSubida({ key, contentType, sha256Hex }) {
      const checksum = Buffer.from(sha256Hex, 'hex').toString('base64');
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({ Bucket: s3Config.bucket, Key: key, ContentType: contentType, ChecksumSHA256: checksum }),
        { expiresIn: EXPIRA_SEGUNDOS, unhoistableHeaders: new Set(['x-amz-checksum-sha256']) },
      );
      return {
        url,
        metodo: 'PUT',
        cabeceras: { 'Content-Type': contentType, 'x-amz-checksum-sha256': checksum },
        expiraEnSegundos: EXPIRA_SEGUNDOS,
      };
    },

    async urlDescarga({ key, nombre }) {
      const seguro = nombre.replace(/[^\w.\- ]/g, '_');
      return getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: s3Config.bucket, Key: key, ResponseContentDisposition: `attachment; filename="${seguro}"` }),
        { expiresIn: EXPIRA_SEGUNDOS },
      );
    },
  };
}
