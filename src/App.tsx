import { Routes, Route } from 'react-router'
import Home from './pages/Home'
import NewProject from './pages/NewProject'
import ProjectDetail from './pages/ProjectDetail'
import StakeholderSession from './pages/StakeholderSession'
import Privacy from './pages/Privacy'
import Login from "./pages/Login"
import NotFound from "./pages/NotFound"

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/projects/new" element={<NewProject />} />
      <Route path="/projects/:id" element={<ProjectDetail />} />
      <Route path="/s/:token" element={<StakeholderSession />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/login" element={<Login />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
