import { NavLink, Route, Routes } from 'react-router-dom'
import HotelsPage from './pages/HotelsPage'
import BookingsPage from './pages/BookingsPage'
import GuestsPage from './pages/GuestsPage'
import OccupancyPage from './pages/OccupancyPage'
import RoomTypesPage from './pages/RoomTypesPage'
import HousekeepingBoardPage from './pages/HousekeepingBoardPage'
import SlaBreachesPage from './pages/SlaBreachesPage'
import LateRoomsPage from './pages/LateRoomsPage'
import FloorAssignmentsPage from './pages/FloorAssignmentsPage'
import ReadyByPage from './pages/ReadyByPage'
import AssistantPage from './pages/AssistantPage'
import SofiaChatbot from './components/SofiaChatbot'

export default function App() {
  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">Larchmont Hotels</span>
        <nav>
          <NavLink to="/">Hotels</NavLink>
          <NavLink to="/bookings">Bookings</NavLink>
          <NavLink to="/guests">Guests</NavLink>
          <NavLink to="/room-types">Room Types</NavLink>
          <NavLink to="/housekeeping">Housekeeping</NavLink>
          <NavLink to="/housekeeping/sla-breaches">SLA Breaches</NavLink>
          <NavLink to="/reports/occupancy">Occupancy</NavLink>
          <NavLink to="/assistant">Assistant 🤖</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<HotelsPage />} />
          <Route path="/bookings" element={<BookingsPage />} />
          <Route path="/guests" element={<GuestsPage />} />
          <Route path="/room-types" element={<RoomTypesPage />} />
          <Route path="/housekeeping" element={<HousekeepingBoardPage />} />
          <Route path="/housekeeping/sla-breaches" element={<SlaBreachesPage />} />
          <Route path="/housekeeping/late-rooms" element={<LateRoomsPage />} />
          <Route path="/housekeeping/floor-assignments" element={<FloorAssignmentsPage />} />
          <Route path="/housekeeping/ready-by" element={<ReadyByPage />} />
          <Route path="/reports/occupancy" element={<OccupancyPage />} />
          <Route path="/assistant" element={<AssistantPage />} />
        </Routes>
      </main>

      {/* Floating MCP Operations Chatbot for Sofia available across all screens */}
      <SofiaChatbot />
    </div>
  )
}
