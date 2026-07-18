import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import { Shell } from '@/components/Shell'
import { ClusterHealth } from '@/views/ClusterHealth'
import { Pods } from '@/views/Pods'
import { Deployments } from '@/views/Deployments'
import { Events } from '@/views/Events'
import { Logs } from '@/views/Logs'
import { Investigate } from '@/views/Investigate'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<ClusterHealth />} />
          <Route path="pods" element={<Pods />} />
          <Route path="deployments" element={<Deployments />} />
          <Route path="events" element={<Events />} />
          <Route path="logs" element={<Logs />} />
          <Route path="investigate" element={<Investigate />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
