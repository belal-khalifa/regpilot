import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/AuthProvider'
import Landing from './pages/Landing'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import AppHome from './pages/AppHome'
import ProductDetail from './pages/ProductDetail'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/app" element={<AppHome />} />
          <Route path="/app/products/:id" element={<ProductDetail />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
