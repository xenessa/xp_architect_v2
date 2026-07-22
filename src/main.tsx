import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { ThemeProvider } from 'next-themes'
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { Toaster } from "@/components/ui/sonner"
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <TRPCProvider>
          <ErrorBoundary>
            <App />
            <Toaster position="bottom-right" />
          </ErrorBoundary>
        </TRPCProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
