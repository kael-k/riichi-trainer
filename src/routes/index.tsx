import { createBrowserRouter } from 'react-router'
import { AppShell } from '../components/AppShell'
import { HomePage } from './HomePage'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [{ index: true, element: <HomePage /> }],
  },
])
