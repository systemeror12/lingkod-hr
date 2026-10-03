import { createHash } from 'node:crypto';
import {
  HttpException,
  Injectable,
  PayloadTooLargeException,
  type CallHandler,
  type ExecutionContext,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { RequestContext } from '@lingkod-hr/auth';
import sharp from 'sharp';

export interface BrandImageUpload {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

/** The file limits of one Agency branding image, named in every rejection. */
export interface BrandImageRules {
  /** Error code prefix, such as `AGENCY_SEAL`. */
  code: string;
  /** What stays unchanged when an upload is rejected, such as `seal`. */
  noun: string;
  maxBytes: number;
  maxLabel: string;
  minWidth: number;
  minHeight: number;
  /** The size rejection's limit, after the actual size. */
  minLabel: string;
}

export function brandError(
  context: RequestContext,
  code: string,
  message: string,
  status = 400,
): HttpException {
  return new HttpException({ error: { code, message, requestId: context.requestId } }, status);
}

function tooLarge(context: RequestContext, rules: BrandImageRules, fileName: string) {
  return brandError(
    context,
    `${rules.code}_TOO_LARGE`,
    `${fileName}: Use a file no larger than ${rules.maxLabel}. The current ${rules.noun} is unchanged.`,
  );
}

/**
 * Checks the actual image format, decodes every pixel, and applies the size limits. Each rejection
 * names the file and the limit. Returns the metadata the database keeps beside the private object.
 */
export async function validateBrandImage(
  context: RequestContext,
  file: BrandImageUpload,
  rules: BrandImageRules,
) {
  const fileName = file.originalname.trim().slice(0, 255) || 'Unnamed file';
  const reject = (suffix: string, message: string) =>
    brandError(
      context,
      `${rules.code}_${suffix}`,
      `${fileName}: ${message} The current ${rules.noun} is unchanged.`,
    );
  if (file.size > rules.maxBytes || file.buffer.length > rules.maxBytes) {
    throw tooLarge(context, rules, fileName);
  }
  if (!['image/png', 'image/jpeg'].includes(file.mimetype)) {
    throw reject('TYPE_INVALID', 'Use a PNG or JPEG image.');
  }
  let dimensions;
  try {
    const image = sharp(file.buffer, { limitInputPixels: 40_000_000, failOn: 'warning' });
    const metadata = await image.metadata();
    if (
      (metadata.format !== 'png' && metadata.format !== 'jpeg') ||
      file.mimetype !== `image/${metadata.format}` ||
      (metadata.pages ?? 1) !== 1
    ) {
      throw new Error('Unsupported image');
    }
    // Decode all pixels, so a valid header cannot hide truncated or corrupt image bytes.
    await image.stats();
    dimensions = { width: metadata.width, height: metadata.height };
  } catch {
    throw reject(
      'TYPE_INVALID',
      'Use a readable, single-frame PNG or JPEG image (at most 40 million pixels).',
    );
  }
  if (dimensions.width < rules.minWidth || dimensions.height < rules.minHeight) {
    throw reject(
      'TOO_SMALL',
      `The image is ${dimensions.width} × ${dimensions.height} px. ${rules.minLabel}`,
    );
  }
  return {
    fileName,
    contentType: file.mimetype,
    byteSize: file.buffer.length,
    ...dimensions,
    contentHash: createHash('sha256').update(file.buffer).digest('hex'),
  };
}

/** Accepts one in-memory `file` up to the limit, and rejects a larger one by name. */
export function brandImageInterceptor(rules: BrandImageRules) {
  @Injectable()
  class BrandImageInterceptor extends FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: rules.maxBytes + 1, files: 1, fields: 1 },
    fileFilter(request, file, callback) {
      (request as typeof request & { brandFileName?: string }).brandFileName = file.originalname;
      callback(null, true);
    },
  }) {
    async intercept(context: ExecutionContext, next: CallHandler) {
      try {
        return await super.intercept(context, next);
      } catch (error) {
        if (error instanceof PayloadTooLargeException) {
          const request = context
            .switchToHttp()
            .getRequest<{ brandFileName?: string; authSession: { context: RequestContext } }>();
          throw tooLarge(
            request.authSession.context,
            rules,
            request.brandFileName ?? 'Selected file',
          );
        }
        throw error;
      }
    }
  }
  return BrandImageInterceptor;
}
