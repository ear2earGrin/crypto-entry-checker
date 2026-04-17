import { Link } from 'react-router-dom';
import { loreEntries, CATEGORY_COLORS } from '../data/lore';

export default function LorePage() {
  return (
    <div style={{
      width: '100%',
      minHeight: 'calc(100vh - 52px)',
      background: '#0e0e0e',
      alignSelf: 'flex-start',
    }}>
      {/* Hero Header */}
      <div style={{
        padding: '64px 40px 48px',
        borderBottom: '1px solid #1e1e1e',
        maxWidth: '1100px',
        margin: '0 auto',
      }}>
        <div style={{
          fontFamily: 'monospace',
          fontSize: '11px',
          letterSpacing: '0.25em',
          color: '#2cff9c',
          marginBottom: '16px',
          textTransform: 'uppercase',
        }}>
          Recovered Archives — The Realms
        </div>
        <h1 style={{
          fontFamily: 'monospace',
          fontSize: 'clamp(28px, 5vw, 52px)',
          fontWeight: 800,
          letterSpacing: '0.05em',
          color: '#fff',
          margin: '0 0 16px',
          lineHeight: 1.1,
        }}>
          WORLD LORE ARCHIVE
        </h1>
        <p style={{
          fontFamily: 'monospace',
          fontSize: '13px',
          color: '#555',
          margin: 0,
          maxWidth: '560px',
          lineHeight: 1.7,
        }}>
          Fragments compiled from corrupted archives. Histories contested, myths unverified, truths buried between the lines. Trust none of it completely. Question all of it.
        </p>
      </div>

      {/* Entry Grid */}
      <div style={{
        maxWidth: '1100px',
        margin: '0 auto',
        padding: '48px 40px 80px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
        gap: '24px',
      }}>
        {loreEntries.map((entry) => (
          <LoreCard key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}

function LoreCard({ entry }) {
  const categoryColor = CATEGORY_COLORS[entry.category] ?? '#888';

  return (
    <Link
      to={`/lore/${entry.id}`}
      style={{ textDecoration: 'none' }}
    >
      <div
        style={{
          background: '#141414',
          border: '1px solid #222',
          borderRadius: '8px',
          overflow: 'hidden',
          cursor: 'pointer',
          transition: 'border-color 0.2s, transform 0.2s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = categoryColor;
          e.currentTarget.style.transform = 'translateY(-2px)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = '#222';
          e.currentTarget.style.transform = 'translateY(0)';
        }}
      >
        {/* Image */}
        <div style={{
          height: '200px',
          background: '#1a1a1a',
          position: 'relative',
          overflow: 'hidden',
        }}>
          {entry.image ? (
            <img
              src={entry.image}
              alt={entry.title}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              onError={e => { e.target.style.display = 'none'; }}
            />
          ) : (
            <div style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'monospace',
              fontSize: '11px',
              color: '#333',
              letterSpacing: '0.1em',
            }}>
              [ NO IMAGE ]
            </div>
          )}
          <div style={{
            position: 'absolute',
            bottom: '10px',
            left: '12px',
            fontFamily: 'monospace',
            fontSize: '10px',
            fontWeight: 700,
            letterSpacing: '0.15em',
            color: categoryColor,
            background: 'rgba(0,0,0,0.7)',
            padding: '3px 8px',
            borderRadius: '3px',
          }}>
            {entry.category.toUpperCase()}
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: '20px' }}>
          <div style={{
            fontFamily: 'monospace',
            fontSize: '10px',
            color: '#444',
            letterSpacing: '0.1em',
            marginBottom: '8px',
          }}>
            DAY {String(entry.day).padStart(2, '0')} — {entry.date}
          </div>
          <h2 style={{
            fontFamily: 'monospace',
            fontSize: '15px',
            fontWeight: 700,
            color: '#e8e8e8',
            margin: '0 0 12px',
            lineHeight: 1.3,
          }}>
            {entry.title}
          </h2>
          <p style={{
            fontFamily: 'Georgia, serif',
            fontSize: '13px',
            color: '#666',
            margin: 0,
            lineHeight: 1.65,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {entry.excerpt}
          </p>
          <div style={{
            marginTop: '16px',
            fontFamily: 'monospace',
            fontSize: '11px',
            color: categoryColor,
            letterSpacing: '0.05em',
          }}>
            READ ENTRY →
          </div>
        </div>
      </div>
    </Link>
  );
}
