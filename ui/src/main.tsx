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
import { Overview } from '@/views/Overview'
import { NodePools } from '@/views/NodePools'
import { Secrets } from '@/views/Secrets'
import { BulkOps } from '@/views/BulkOps'
import { Identities } from '@/views/Identities'
import { Helm } from '@/views/Helm'

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
          <Route path="overview" element={<Overview />} />
          <Route path="nodepools" element={<NodePools />} />
          <Route path="secrets" element={<Secrets />} />
          <Route path="bulk" element={<BulkOps />} />
          <Route path="identities" element={<Identities />} />
          <Route path="helm" element={<Helm />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
