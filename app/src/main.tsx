import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/literata/opsz.css'
import '@fontsource-variable/literata/opsz-italic.css'
import '@fontsource-variable/instrument-sans/wght.css'
import '@fontsource-variable/jetbrains-mono/wght.css'
import '@fontsource/noto-serif-hebrew/hebrew-400.css'
import '@fontsource/noto-serif-hebrew/hebrew-600.css'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
