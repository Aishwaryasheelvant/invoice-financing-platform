import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname, join } from 'path';

/**
 * Local disk storage — deliberately not S3/cloud storage. This is a demo
 * feature (attach a PDF for human cross-reference, never parsed), running
 * on a single machine; adding a cloud storage SDK and credentials would
 * be complexity this project doesn't need. Swapping the destination for
 * a cloud bucket later is a contained change (this file only).
 */
export const INVOICE_DOCUMENTS_DIR = join(process.cwd(), 'uploads', 'invoices');
if (!existsSync(INVOICE_DOCUMENTS_DIR)) {
  mkdirSync(INVOICE_DOCUMENTS_DIR, { recursive: true });
}

const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB — a scanned invoice, not a video

export const invoiceDocumentMulterOptions = {
  storage: diskStorage({
    destination: INVOICE_DOCUMENTS_DIR,
    // A random name on disk, unrelated to the original filename — avoids
    // path traversal / collision entirely rather than trying to sanitize
    // a user-supplied filename. The original name is preserved separately
    // in the DB purely for display.
    filename: (_req: unknown, file: Express.Multer.File, callback: (error: Error | null, filename: string) => void) => {
      callback(null, `${randomUUID()}${extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: MAX_SIZE_BYTES },
  fileFilter: (_req: unknown, file: Express.Multer.File, callback: (error: Error | null, accept: boolean) => void) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      callback(new BadRequestException('Only PDF, PNG, or JPEG files are allowed'), false);
      return;
    }
    callback(null, true);
  },
};
