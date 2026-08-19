import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import Nav from './components/Nav.jsx'
import Scanner from './pages/Scanner.jsx'
import Backtest from './pages/Backtest.jsx'
import TradeLog from './pages/TradeLog.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <Nav />
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/scanner" element={<Scanner />} />
        <Route path="/backtest" element={<Backtest />} />
        <Route path="/log" element={<TradeLog />} />
      </Routes>
    </HashRouter>
  </StrictMode>,
)
