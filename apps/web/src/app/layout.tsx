import type { Metadata } from 'next';
import '@fontsource-variable/noto-sans/wght.css';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'LingkodHR',
    template: '%s · LingkodHR',
  },
  description: 'Philippine Public-Sector HRIS',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
