import '../styles/globals.css'
import '../styles/tokens.css'
import localFont from 'next/font/local'
import ThemeProvider from '../components/ThemeProvider'

const geistSans = localFont({
  src: '../public/fonts/Geist-Variable.woff2',
  variable: '--font-geist-sans',
  display: 'swap',
})

const geistMono = localFont({
  src: '../public/fonts/GeistMono-Variable.woff2',
  variable: '--font-geist-mono',
  display: 'swap',
})

export default function App({ Component, pageProps }) {
  return (
    <ThemeProvider>
      <div className={`${geistSans.variable} ${geistMono.variable}`}>
        <Component {...pageProps} />
      </div>
    </ThemeProvider>
  )
}
