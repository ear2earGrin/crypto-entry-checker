import { Link, useLocation } from 'react-router-dom';

const NAV_LINKS = [
  { to: '/', label: 'CHECKER' },
  { to: '/lore', label: 'WORLD LORE' },
];

export default function Nav() {
  const { pathname } = useLocation();

  return (
    <nav style={{
      position: 'sticky',
      top: 0,
      zIndex: 100,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 24px',
      height: '52px',
      background: '#111',
      borderBottom: '1px solid #2a2a2a',
    }}>
      <span style={{
        fontFamily: 'monospace',
        fontSize: '13px',
        fontWeight: 700,
        letterSpacing: '0.15em',
        color: '#2cff9c',
      }}>
        SHELLFORGE
      </span>

      <div style={{ display: 'flex', gap: '4px' }}>
        {NAV_LINKS.map(({ to, label }) => {
          const active = to === '/' ? pathname === '/' : pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              style={{
                fontFamily: 'monospace',
                fontSize: '11px',
                fontWeight: 600,
                letterSpacing: '0.12em',
                padding: '6px 14px',
                borderRadius: '4px',
                textDecoration: 'none',
                color: active ? '#111' : '#888',
                background: active ? '#2cff9c' : 'transparent',
                transition: 'all 0.15s',
              }}
            >
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
