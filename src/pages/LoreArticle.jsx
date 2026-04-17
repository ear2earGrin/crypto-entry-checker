import { useParams, Link } from 'react-router-dom';
import { loreEntries, CATEGORY_COLORS } from '../data/lore';

export default function LoreArticle() {
  const { slug } = useParams();
  const entry = loreEntries.find(e => e.id === slug);

  if (!entry) {
    return (
      <div style={{
        width: '100%',
        minHeight: 'calc(100vh - 52px)',
        background: '#0e0e0e',
        alignSelf: 'flex-start',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'monospace',
        color: '#444',
        fontSize: '14px',
        letterSpacing: '0.1em',
      }}>
        [ ARCHIVE NODE NOT FOUND ]
      </div>
    );
  }

  const categoryColor = CATEGORY_COLORS[entry.category] ?? '#888';
  const imagePromptSection = entry.sections.find(s => s.type === 'imagePrompt');
  const bodySections = entry.sections.filter(s => s.type !== 'imagePrompt');

  return (
    <div style={{
      width: '100%',
      minHeight: 'calc(100vh - 52px)',
      background: '#0e0e0e',
      alignSelf: 'flex-start',
    }}>
      {/* Hero Image */}
      {entry.image && (
        <div style={{
          width: '100%',
          height: 'clamp(300px, 45vw, 560px)',
          position: 'relative',
          overflow: 'hidden',
          background: '#111',
        }}>
          <img
            src={entry.image}
            alt={entry.title}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
              opacity: 0.85,
            }}
          />
          {/* Gradient overlay */}
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(to bottom, transparent 40%, #0e0e0e 100%)',
          }} />
        </div>
      )}

      {/* Article Container */}
      <div style={{
        maxWidth: '760px',
        margin: '0 auto',
        padding: '48px 32px 80px',
      }}>
        {/* Back Link */}
        <Link
          to="/lore"
          style={{
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#444',
            textDecoration: 'none',
            letterSpacing: '0.12em',
            display: 'inline-block',
            marginBottom: '32px',
          }}
          onMouseEnter={e => e.target.style.color = '#2cff9c'}
          onMouseLeave={e => e.target.style.color = '#444'}
        >
          ← BACK TO ARCHIVE
        </Link>

        {/* Metadata */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <span style={{
            fontFamily: 'monospace',
            fontSize: '10px',
            fontWeight: 700,
            letterSpacing: '0.15em',
            color: categoryColor,
            background: `${categoryColor}18`,
            border: `1px solid ${categoryColor}44`,
            padding: '4px 10px',
            borderRadius: '3px',
          }}>
            {entry.category.toUpperCase()}
          </span>
          <span style={{
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#444',
            letterSpacing: '0.1em',
          }}>
            DAY {String(entry.day).padStart(2, '0')}
          </span>
          <span style={{
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#333',
          }}>
            {entry.date}
          </span>
        </div>

        {/* Title */}
        <h1 style={{
          fontFamily: 'monospace',
          fontSize: 'clamp(22px, 4vw, 36px)',
          fontWeight: 800,
          color: '#fff',
          margin: '0 0 40px',
          lineHeight: 1.2,
          letterSpacing: '0.02em',
        }}>
          {entry.title}
        </h1>

        {/* Body */}
        <div style={{ borderTop: `1px solid ${categoryColor}33`, paddingTop: '40px' }}>
          {bodySections.map((section, i) => (
            <Section key={i} section={section} />
          ))}
        </div>

        {/* Image Prompt */}
        {imagePromptSection && (
          <div style={{
            marginTop: '56px',
            padding: '20px 24px',
            background: '#111',
            border: '1px solid #222',
            borderRadius: '6px',
          }}>
            <div style={{
              fontFamily: 'monospace',
              fontSize: '10px',
              letterSpacing: '0.2em',
              color: '#444',
              marginBottom: '10px',
            }}>
              IMAGE GENERATION PROMPT
            </div>
            <p style={{
              fontFamily: 'monospace',
              fontSize: '12px',
              color: '#555',
              margin: 0,
              lineHeight: 1.7,
            }}>
              {imagePromptSection.text}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ section }) {
  switch (section.type) {
    case 'heading':
      return (
        <h2 style={{
          fontFamily: 'monospace',
          fontSize: '14px',
          fontWeight: 700,
          letterSpacing: '0.18em',
          color: '#2cff9c',
          textTransform: 'uppercase',
          margin: '40px 0 16px',
        }}>
          {section.text}
        </h2>
      );
    case 'meta':
      return (
        <p style={{
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#3a3a3a',
          fontStyle: 'italic',
          margin: '0 0 32px',
          lineHeight: 1.6,
          letterSpacing: '0.03em',
        }}>
          {section.text}
        </p>
      );
    case 'closing':
      return (
        <p style={{
          fontFamily: 'Georgia, serif',
          fontSize: '15px',
          color: '#888',
          fontStyle: 'italic',
          margin: '40px 0 0',
          lineHeight: 1.8,
          borderLeft: '2px solid #2cff9c33',
          paddingLeft: '20px',
        }}>
          {section.text}
        </p>
      );
    case 'paragraph':
    default:
      return (
        <p style={{
          fontFamily: 'Georgia, serif',
          fontSize: '16px',
          color: '#aaa',
          margin: '0 0 22px',
          lineHeight: 1.85,
        }}>
          {section.text}
        </p>
      );
  }
}
