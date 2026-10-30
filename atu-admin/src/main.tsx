import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'

// No React.StrictMode on purpose: it would run the two-factor setup twice in development.
createRoot(document.getElementById('root')!).render(<App />)
