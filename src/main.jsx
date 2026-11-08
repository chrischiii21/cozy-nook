import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import Gate from './Lock.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Gate />
    <Analytics />
  </StrictMode>,
)
