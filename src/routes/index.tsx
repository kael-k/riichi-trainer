import { createBrowserRouter } from 'react-router'
import { AppShell } from '../components/AppShell'
import { EfficiencyPage } from '../features/efficiency/EfficiencyPage'
import { EfficiencySoloPage } from '../features/efficiency-solo/EfficiencySoloPage'
import { FoldingPage } from '../features/folding/FoldingPage'
import { LabPage } from '../features/lab/LabPage'
import { ScoringPage } from '../features/scoring/ScoringPage'
import { ShantenPage } from '../features/shanten/ShantenPage'
import { HomePage } from './HomePage'

export const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <AppShell />,
      children: [
        { index: true, element: <HomePage /> },
        { path: 'efficiency', element: <EfficiencyPage /> },
        { path: 'efficiency-solo', element: <EfficiencySoloPage /> },
        { path: 'shanten', element: <ShantenPage /> },
        { path: 'scoring', element: <ScoringPage /> },
        { path: 'folding', element: <FoldingPage /> },
        { path: 'lab', element: <LabPage /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL },
)
