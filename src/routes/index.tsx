import { createBrowserRouter } from 'react-router'
import { AppShell } from '../components/AppShell'
import { EfficiencyPage } from '../features/efficiency/EfficiencyPage'
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
        { path: 'shanten', element: <ShantenPage /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL },
)
