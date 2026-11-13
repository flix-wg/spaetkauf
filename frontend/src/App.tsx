import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Shell } from './components/Shell'
import { Search } from './screens/Search'
import { Picks } from './screens/Picks'
import { Trips } from './screens/Trips'
import { TripScreen } from './screens/Trip'
import { ClaimScreen } from './screens/Claim'
import { Late } from './screens/Late'
import { Empty } from './components/States'
import { Link } from 'react-router-dom'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<Search />} />
          <Route path="/picks" element={<Picks />} />
          <Route path="/trips" element={<Trips />} />
          <Route path="/trip/:id" element={<TripScreen />} />
          <Route path="/trip/:id/claim" element={<ClaimScreen />} />
          <Route path="/late" element={<Late />} />
          <Route
            path="*"
            element={
              <Empty title="Nothing here" action={<Link to="/" className="btn-primary">Back to search</Link>} />
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
