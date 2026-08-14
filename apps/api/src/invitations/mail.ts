import { createConnection, type Socket } from 'node:net';
import { connect as createTlsConnection, type TLSSocket } from 'node:tls';
import type { AppConfig } from '@lingkod-hr/config';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface MailDelivery {
  send(message: MailMessage): Promise<void>;
}

export const INVITATION_MAIL_DELIVERY = Symbol('INVITATION_MAIL_DELIVERY');

export class MailDeliveryError extends Error {
  constructor(message = 'Mail delivery failed.') {
    super(message);
    this.name = 'MailDeliveryError';
  }
}

type SmtpSocket = Socket | TLSSocket;

function assertSafeHeader(value: string): void {
  if (/[\r\n]/.test(value)) throw new MailDeliveryError();
}

function smtpCode(response: string): number | null {
  const match = /^(\d{3})[ -]/.exec(response);
  return match?.[1] ? Number(match[1]) : null;
}

function readResponse(socket: SmtpSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    let buffer = '';

    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    };
    const fail = () => {
      cleanup();
      reject(new MailDeliveryError());
    };
    const onError = () => fail();
    const onClose = () => fail();
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n');
      if (lines.length < 2) return;
      const finalLine = lines.find((line) => /^\d{3} /.test(line));
      if (!finalLine) return;
      const code = smtpCode(finalLine);
      if (code === null) return fail();
      cleanup();
      resolve(code);
    };

    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

async function connect(config: {
  host: string;
  port: number;
  secure: boolean;
}): Promise<SmtpSocket> {
  const socket = config.secure
    ? createTlsConnection({ host: config.host, port: config.port })
    : createConnection({ host: config.host, port: config.port });

  await new Promise<void>((resolve, reject) => {
    const connectedEvent = config.secure ? 'secureConnect' : 'connect';
    const onConnected = () => {
      socket.setTimeout(10_000);
      resolve();
    };
    const onError = () => reject(new MailDeliveryError());
    socket.once(connectedEvent, onConnected);
    socket.once('error', onError);
    socket.setTimeout(10_000, () => {
      socket.destroy();
      reject(new MailDeliveryError());
    });
  });
  return socket;
}

async function command(socket: SmtpSocket, value: string, expected: number[]): Promise<void> {
  socket.write(`${value}\r\n`);
  const response = await readResponse(socket);
  if (!expected.includes(response)) throw new MailDeliveryError();
}

function smtpBody(from: string, message: MailMessage): string {
  assertSafeHeader(from);
  assertSafeHeader(message.to);
  assertSafeHeader(message.subject);
  const headers = [
    `From: ${from}`,
    `To: ${message.to}`,
    `Subject: ${message.subject}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  const body = message.text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  return `${[...headers, '', body]
    .join('\r\n')
    .split('\r\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n')}\r\n`;
}

export class SmtpMailDelivery implements MailDelivery {
  constructor(
    private readonly config: {
      host: string;
      port: number;
      secure: boolean;
      from: string;
    },
  ) {}

  async send(message: MailMessage): Promise<void> {
    assertSafeHeader(this.config.from);
    assertSafeHeader(message.to);
    assertSafeHeader(message.subject);
    const socket = await connect(this.config);
    try {
      const greeting = await readResponse(socket);
      if (greeting !== 220) throw new MailDeliveryError();
      await command(socket, 'EHLO lingkod-hr.local', [250]);
      await command(socket, `MAIL FROM:<${this.config.from}>`, [250]);
      await command(socket, `RCPT TO:<${message.to}>`, [250, 251]);
      await command(socket, 'DATA', [354]);
      socket.write(`${smtpBody(this.config.from, message)}.\r\n`);
      await readResponse(socket).then((response) => {
        if (response !== 250) throw new MailDeliveryError();
      });
      await command(socket, 'QUIT', [221, 250]);
    } catch (error: unknown) {
      if (error instanceof MailDeliveryError) throw error;
      throw new MailDeliveryError();
    } finally {
      socket.destroy();
    }
  }
}

export function createMailDelivery(
  config: Pick<AppConfig, 'EMAIL_HOST' | 'EMAIL_PORT' | 'EMAIL_SECURE' | 'EMAIL_FROM'>,
): MailDelivery {
  return new SmtpMailDelivery({
    host: config.EMAIL_HOST,
    port: config.EMAIL_PORT,
    secure: config.EMAIL_SECURE,
    from: config.EMAIL_FROM,
  });
}
