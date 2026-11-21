export const metadata = { title: 'Kimono Editor', robots: { index: false, follow: false } };
export const viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="tr">
      <body style={{ margin: 0, background: '#f6f5f2' }}>{children}</body>
    </html>
  );
}
