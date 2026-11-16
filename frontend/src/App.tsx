import { useEffect } from 'react'
import { api } from './api'
import { tr, useT } from './i18n'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Shell } from './components/Shell'
import { Search } from './screens/Search'
import { Picks } from './screens/Picks'
import { Trips } from './screens/Trips'
import { TripScreen } from './screens/Trip'
import { ClaimScreen } from './screens/Claim'
import { Late } from './screens/Late'
import { Lookup } from './screens/Lookup'
import { Empty } from './components/States'
import { Link } from 'react-router-dom'
import { Legal } from './screens/Legal'

export function App() {
  useT()
  useEffect(() => api.watchTrips(), [])
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<Search />} />
          <Route path="/picks" element={<Picks />} />
          <Route path="/trips" element={<Trips />} />
          <Route path="/trip/:id" element={<TripScreen />} />
          <Route path="/trips/:id" element={<TripScreen />} />
          <Route path="/trip/:id/claim" element={<ClaimScreen />} />
          <Route path="/late" element={<Late />} />
          <Route path="/impressum" element={<Legal page="impressum" />} />
          <Route path="/datenschutz" element={<Legal page="datenschutz" />} />
          <Route path="/lookup" element={<Lookup />} />
          <Route
            path="*"
            element={
              <Empty title={tr('nothingHere')} action={<Link to="/" className="btn-primary">{tr('backToSearch')}</Link>} />
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
