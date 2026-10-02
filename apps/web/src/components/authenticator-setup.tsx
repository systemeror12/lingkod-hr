'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Button } from './ui/button';

// The authenticator setup both sign-in and Invitation Activation show.

export function manilaTime(value: string | Date, options: Intl.DateTimeFormatOptions): string {
  return new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', ...options });
}

/** The QR code for `otpauthUri`, with the setup key and URI for apps that cannot scan. */
export function SetupKey({ otpauthUri }: { otpauthUri: string }) {
  // Empty while drawing; null when the QR code could not be drawn.
  const [qrCode, setQrCode] = useState<string | null>('');
  const secret = new URL(otpauthUri).searchParams.get('secret') ?? '';

  useEffect(() => {
    let current = true;
    QRCode.toDataURL(otpauthUri, { margin: 1, width: 152 }).then(
      (dataUrl) => {
        if (current) setQrCode(dataUrl);
      },
      () => {
        if (current) setQrCode(null);
      },
    );
    return () => {
      current = false;
    };
  }, [otpauthUri]);

  return (
    <div className="grid gap-5 min-[540px]:grid-cols-[auto_minmax(0,1fr)] min-[540px]:items-start">
      <div className="grid size-[152px] place-items-center rounded-control border border-border bg-surface">
        {qrCode ? (
          <img src={qrCode} width={152} height={152} alt="QR code for your authenticator app" />
        ) : qrCode === null ? (
          <p className="m-0 p-3 text-center text-caption text-ink-muted">
            The QR code could not be shown. Use the setup key instead.
          </p>
        ) : null}
      </div>
      <ol className="m-0 grid list-decimal gap-2 pl-5 text-small">
        <li>Open an authenticator app on your phone.</li>
        <li>Scan this code, or type the setup key.</li>
        <li>Enter the 6-digit code the app shows.</li>
        <li className="list-none">
          <details className="text-caption text-ink-muted">
            <summary className="cursor-pointer text-primary">Show setup key</summary>
            <code className="mt-1 block text-small break-all text-ink">{secret}</code>
            <code className="mt-1 block break-all" data-testid="otpauth-uri">
              {otpauthUri}
            </code>
          </details>
        </li>
      </ol>
    </div>
  );
}

/** The Recovery Codes, shown once on a slip the User can print or copy. */
export function RecoveryCodeSlip({ account, codes }: { account: string; codes: string[] }) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copyCodes() {
    try {
      await (
        globalThis as unknown as {
          navigator: { clipboard: { writeText(text: string): Promise<void> } };
        }
      ).navigator.clipboard.writeText(codes.join('\n'));
      setCopy('copied');
    } catch {
      setCopy('failed');
    }
  }

  return (
    <>
      <figure
        data-print-slip
        className="m-0 grid gap-3 rounded-control border-2 border-dashed border-border p-5 print:break-inside-avoid"
      >
        <figcaption className="flex flex-wrap justify-between gap-2 text-caption text-ink-muted">
          <span>LingkodHR Recovery Codes</span>
          <span>{account}</span>
        </figcaption>
        <ol
          aria-label="Recovery Codes"
          className="m-0 grid list-none grid-cols-2 gap-x-8 gap-y-1.5 p-0 font-mono text-[0.9375rem] text-ink"
        >
          {codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ol>
        <p className="m-0 text-caption text-ink-muted">
          Issued {manilaTime(new Date(), { dateStyle: 'long' })}. Each code works once. Keep this
          slip away from your phone.
        </p>
      </figure>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          type="button"
          onClick={() => (globalThis as unknown as { print(): void }).print()}
        >
          Print slip
        </Button>
        <Button variant="secondary" type="button" onClick={() => void copyCodes()}>
          {copy === 'copied' ? 'Copied' : copy === 'failed' ? 'Couldn’t copy' : 'Copy codes'}
        </Button>
      </div>
    </>
  );
}
