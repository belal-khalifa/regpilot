import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/AuthProvider'
import Landing from './pages/Landing'
import Login from './pages/Login'
import AppHome from './pages/AppHome'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/app" element={<AppHome />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
