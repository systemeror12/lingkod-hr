import { createDecipheriv, createCipheriv, randomBytes } from 'node:crypto';

export const PROTECTED_VALUE_ENVELOPE_VERSION = 1 as const;
const PROTECTED_VALUE_MAGIC = Buffer.from('PV1', 'ascii');
const PROTECTED_VALUE_IV_LENGTH = 12;
const PROTECTED_VALUE_AUTH_TAG_LENGTH = 16;
const PROTECTED_VALUE_HEADER_LENGTH = 14;

const INVALID_KEY_MESSAGE = 'Invalid protected value key.';
const INVALID_INPUT_MESSAGE = 'Invalid protected value input.';
const INVALID_ENVELOPE_MESSAGE = 'Invalid protected value envelope.';
const DECRYPTION_FAILED_MESSAGE = 'Unable to decrypt protected value.';

export type ProtectedValueKey = Buffer;
export type ProtectedValueEnvelope = Buffer;
export type ProtectedValueMetadataInput = string | Uint8Array;

export interface ProtectedValueMaskOptions {
  visibleSuffix?: number;
  maskCharacter?: string;
}

export interface ProtectedValueSealOptions {
  metadata?: ProtectedValueMetadataInput;
}

export interface ProtectedValueSealed {
  envelope: ProtectedValueEnvelope;
  maskedValue: string;
}

export interface ProtectedValueOpened {
  plaintext: string;
  metadata: Buffer;
}

export class ProtectedValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtectedValueError';
  }
}

function fail(message: string): never {
  throw new ProtectedValueError(message);
}

function toBuffer(value: Uint8Array): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

function encodeMetadata(metadata?: ProtectedValueMetadataInput): Buffer {
  if (metadata === undefined) {
    return Buffer.alloc(0);
  }

  if (typeof metadata === 'string') {
    return Buffer.from(metadata, 'utf8');
  }

  return toBuffer(metadata);
}

function encodeAad(header: Buffer, iv: Buffer, metadata: Buffer): Buffer {
  return Buffer.concat([header, iv, metadata]);
}

function readEnvelope(envelope: ProtectedValueEnvelope): {
  header: Buffer;
  iv: Buffer;
  authTag: Buffer;
  metadata: Buffer;
  ciphertext: Buffer;
} {
  if (!Buffer.isBuffer(envelope) || envelope.length < PROTECTED_VALUE_HEADER_LENGTH) {
    fail(INVALID_ENVELOPE_MESSAGE);
  }

  const header = envelope.subarray(0, PROTECTED_VALUE_HEADER_LENGTH);
  if (!header.subarray(0, PROTECTED_VALUE_MAGIC.length).equals(PROTECTED_VALUE_MAGIC)) {
    fail(INVALID_ENVELOPE_MESSAGE);
  }

  const version = header.readUInt8(3);
  const ivLength = header.readUInt8(4);
  const authTagLength = header.readUInt8(5);
  const metadataLength = header.readUInt32BE(6);
  const ciphertextLength = header.readUInt32BE(10);

  if (
    version !== PROTECTED_VALUE_ENVELOPE_VERSION ||
    ivLength !== PROTECTED_VALUE_IV_LENGTH ||
    authTagLength !== PROTECTED_VALUE_AUTH_TAG_LENGTH
  ) {
    fail(INVALID_ENVELOPE_MESSAGE);
  }

  const expectedLength =
    PROTECTED_VALUE_HEADER_LENGTH + ivLength + authTagLength + metadataLength + ciphertextLength;
  if (envelope.length !== expectedLength) {
    fail(INVALID_ENVELOPE_MESSAGE);
  }

  let offset = PROTECTED_VALUE_HEADER_LENGTH;
  const iv = envelope.subarray(offset, offset + ivLength);
  offset += ivLength;
  const authTag = envelope.subarray(offset, offset + authTagLength);
  offset += authTagLength;
  const metadata = envelope.subarray(offset, offset + metadataLength);
  offset += metadataLength;
  const ciphertext = envelope.subarray(offset, offset + ciphertextLength);

  return { header, iv, authTag, metadata, ciphertext };
}

function normalizeVisibleSuffix(visibleSuffix: number | undefined): number {
  if (visibleSuffix === undefined) {
    return 4;
  }

  if (!Number.isInteger(visibleSuffix) || visibleSuffix < 0) {
    fail(INVALID_INPUT_MESSAGE);
  }

  return visibleSuffix;
}

function normalizeMaskCharacter(maskCharacter: string | undefined): string {
  if (maskCharacter === undefined || maskCharacter.length === 0) {
    return '*';
  }

  return maskCharacter.charAt(0);
}

function parseCanonicalBase64Key(value: string): ProtectedValueKey | null {
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== 32 || decoded.toString('base64') !== value) {
    return null;
  }

  return decoded;
}

function containsControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return (code >= 0 && code <= 31) || (code >= 127 && code <= 159);
  });
}

export function normalizeProtectedValue(value: string): string {
  if (typeof value !== 'string') {
    fail(INVALID_INPUT_MESSAGE);
  }

  const normalized = value.normalize('NFKC').trim();
  if (containsControlCharacters(normalized)) {
    fail(INVALID_INPUT_MESSAGE);
  }
  return normalized;
}

export function maskProtectedValue(value: string, options: ProtectedValueMaskOptions = {}): string {
  const normalized = normalizeProtectedValue(value);
  const visibleSuffix = normalizeVisibleSuffix(options.visibleSuffix);
  const maskCharacter = normalizeMaskCharacter(options.maskCharacter);

  if (normalized.length === 0) {
    return normalized;
  }

  if (visibleSuffix === 0) {
    return maskCharacter.repeat(normalized.length);
  }

  if (normalized.length <= visibleSuffix) {
    return maskCharacter.repeat(normalized.length);
  }

  return `${maskCharacter.repeat(normalized.length - visibleSuffix)}${normalized.slice(-visibleSuffix)}`;
}

export function parseProtectedValueKey(value: string): ProtectedValueKey {
  if (typeof value !== 'string') {
    fail(INVALID_KEY_MESSAGE);
  }

  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, 'hex');
  }

  const decoded = parseCanonicalBase64Key(value);
  if (decoded === null) {
    fail(INVALID_KEY_MESSAGE);
  }

  return decoded;
}

export function encryptProtectedValue(
  value: string,
  key: ProtectedValueKey,
  options: ProtectedValueSealOptions = {},
): ProtectedValueSealed {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    fail(INVALID_KEY_MESSAGE);
  }

  const plaintext = normalizeProtectedValue(value);
  if (plaintext.length === 0) {
    fail(INVALID_INPUT_MESSAGE);
  }
  const plaintextBytes = Buffer.from(plaintext, 'utf8');
  const metadata = encodeMetadata(options.metadata);
  const iv = randomBytes(PROTECTED_VALUE_IV_LENGTH);
  const header = Buffer.alloc(PROTECTED_VALUE_HEADER_LENGTH);
  PROTECTED_VALUE_MAGIC.copy(header, 0);
  header.writeUInt8(PROTECTED_VALUE_ENVELOPE_VERSION, 3);
  header.writeUInt8(iv.length, 4);
  header.writeUInt8(PROTECTED_VALUE_AUTH_TAG_LENGTH, 5);
  header.writeUInt32BE(metadata.length, 6);
  header.writeUInt32BE(plaintextBytes.length, 10);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(encodeAad(header, iv, metadata));

  const ciphertext = Buffer.concat([cipher.update(plaintextBytes), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const envelope = Buffer.concat([header, iv, authTag, metadata, ciphertext]);

  return {
    envelope,
    maskedValue: maskProtectedValue(plaintext),
  };
}

export function decryptProtectedValue(
  envelope: ProtectedValueEnvelope,
  key: ProtectedValueKey,
): ProtectedValueOpened {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    fail(INVALID_KEY_MESSAGE);
  }

  const { header, iv, authTag, metadata, ciphertext } = readEnvelope(envelope);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(encodeAad(header, iv, metadata));
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      'utf8',
    );

    return {
      plaintext,
      metadata: Buffer.from(metadata),
    };
  } catch {
    fail(DECRYPTION_FAILED_MESSAGE);
  }
}
