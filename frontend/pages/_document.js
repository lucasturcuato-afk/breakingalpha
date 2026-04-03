import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html>
      <Head>
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            var theme = 'dark';
            try { theme = localStorage.getItem('ba-theme') || 'dark'; } catch(e) {}
            document.documentElement.classList.add(theme);
          })();
        `}} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
