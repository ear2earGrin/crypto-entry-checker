import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import Nav from './components/Nav.jsx'
import LorePage from './pages/LorePage.jsx'
import LoreArticle from './pages/LoreArticle.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Nav />
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/lore" element={<LorePage />} />
        <Route path="/lore/:slug" element={<LoreArticle />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
