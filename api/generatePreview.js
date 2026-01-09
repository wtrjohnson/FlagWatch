// api/generatePreview.js
import { neon } from "@neondatabase/serverless";

/**
 * Generates a dynamic OG image showing current US and state flag status
 * This runs server-side to create the preview image when shared on social media
 */
export default async function handler(req, res) {
  try {
    const sql = neon(process.env.DATABASE_URL);
    const { state } = req.query; // Optional: specific state to highlight

    // Fetch US status
    const usResult = await sql`
      SELECT reason, reason_detail, end_date, half_mast
      FROM flag_status
      WHERE country_code = 'US' AND state_code IS NULL
      ORDER BY updated_at DESC
      LIMIT 1;
    `;

    const usStatus = usResult.length > 0 && usResult[0].half_mast === true ? 'HALF' : 'FULL';
    const usReason = usResult[0]?.reason || 'Standard Protocols';

    // Fetch state status (default to user's location or VA)
    let stateCode = state || 'VA';
    const stateResult = await sql`
      SELECT state_code, reason, reason_detail, half_mast
      FROM flag_status
      WHERE state_code = ${stateCode} AND half_mast = true
      LIMIT 1;
    `;

    const stateStatus = stateResult.length > 0 ? 'HALF' : 'FULL';
    const stateReason = stateResult[0]?.reason || 'No active orders';

    // Generate SVG (lightweight, scales perfectly, no dependencies needed)
    const svg = `
      <svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#050505;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#1a1a1a;stop-opacity:1" />
          </linearGradient>
          
          <filter id="glow">
            <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        
        <!-- Background -->
        <rect width="1200" height="630" fill="url(#bg)"/>
        
        <!-- Grid pattern -->
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.02)" stroke-width="1"/>
        </pattern>
        <rect width="1200" height="630" fill="url(#grid)"/>
        
        <!-- Header -->
        <text x="60" y="80" font-family="Arial, sans-serif" font-size="48" font-weight="bold" fill="#FFFFFF">
          FLAG WATCH
        </text>
        <rect x="60" y="95" width="280" height="3" fill="#D2FF00"/>
        <text x="60" y="130" font-family="monospace" font-size="16" fill="#888888">
          REAL-TIME FLAG STATUS MONITOR
        </text>
        
        <!-- Center Divider -->
        <line x1="600" y1="180" x2="600" y2="570" stroke="rgba(255,255,255,0.1)" stroke-width="2"/>
        
        <!-- US FLAG SECTION (LEFT) -->
        <text x="60" y="220" font-family="monospace" font-size="14" fill="#888888">
          JURISDICTION: UNITED STATES
        </text>
        
        <!-- US Status Badge -->
        <rect x="60" y="240" width="200" height="50" rx="25" fill="${usStatus === 'HALF' ? 'rgba(178,34,52,0.2)' : 'rgba(210,255,0,0.1)'}" stroke="${usStatus === 'HALF' ? '#B22234' : '#D2FF00'}" stroke-width="2"/>
        <circle cx="85" cy="265" r="6" fill="${usStatus === 'HALF' ? '#FF2E00' : '#D2FF00'}" filter="url(#glow)"/>
        <text x="105" y="273" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="${usStatus === 'HALF' ? '#FF6B6B' : '#D2FF00'}">
          ${usStatus} STAFF
        </text>
        
        <!-- US Flag Pole -->
        <rect x="140" y="${usStatus === 'HALF' ? '380' : '320'}" width="8" height="200" fill="#666666"/>
        <circle cx="144" cy="${usStatus === 'HALF' ? '378' : '318'}" r="10" fill="#999999"/>
        
        <!-- US Flag -->
        <rect x="152" y="${usStatus === 'HALF' ? '390' : '330'}" width="160" height="100" fill="#3C3B6E"/>
        <rect x="152" y="${usStatus === 'HALF' ? '390' : '330'}" width="160" height="8" fill="#B22234"/>
        <rect x="152" y="${usStatus === 'HALF' ? '406' : '346'}" width="160" height="8" fill="#B22234"/>
        <rect x="152" y="${usStatus === 'HALF' ? '422' : '362'}" width="160" height="8" fill="#B22234"/>
        <rect x="152" y="${usStatus === 'HALF' ? '438' : '378'}" width="160" height="8" fill="#B22234"/>
        <rect x="152" y="${usStatus === 'HALF' ? '454' : '394'}" width="160" height="8" fill="#B22234"/>
        <rect x="152" y="${usStatus === 'HALF' ? '470' : '410'}" width="160" height="8" fill="#B22234"/>
        
        ${usStatus === 'HALF' ? `
        <!-- US Reason (only if half-staff) -->
        <text x="340" y="420" font-family="Georgia, serif" font-size="18" font-style="italic" fill="#999999">
          in honor of
        </text>
        <text x="340" y="455" font-family="Arial, sans-serif" font-size="28" font-weight="bold" fill="#FFFFFF">
          ${usReason.length > 25 ? usReason.substring(0, 25) + '...' : usReason}
        </text>
        ` : ''}
        
        <!-- STATE FLAG SECTION (RIGHT) -->
        <text x="640" y="220" font-family="monospace" font-size="14" fill="#888888">
          STATE: ${stateCode}
        </text>
        
        <!-- State Status Badge -->
        <rect x="640" y="240" width="200" height="50" rx="25" fill="${stateStatus === 'HALF' ? 'rgba(178,34,52,0.2)' : 'rgba(210,255,0,0.1)'}" stroke="${stateStatus === 'HALF' ? '#B22234' : '#D2FF00'}" stroke-width="2"/>
        <circle cx="665" cy="265" r="6" fill="${stateStatus === 'HALF' ? '#FF2E00' : '#D2FF00'}" filter="url(#glow)"/>
        <text x="685" y="273" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="${stateStatus === 'HALF' ? '#FF6B6B' : '#D2FF00'}">
          ${stateStatus} STAFF
        </text>
        
        <!-- State Flag Pole -->
        <rect x="720" y="${stateStatus === 'HALF' ? '380' : '320'}" width="8" height="200" fill="#666666"/>
        <circle cx="724" cy="${stateStatus === 'HALF' ? '378' : '318'}" r="10" fill="#999999"/>
        
        <!-- State Flag (generic representation) -->
        <rect x="732" y="${stateStatus === 'HALF' ? '390' : '330'}" width="160" height="100" fill="#1E3A8A" stroke="#D2FF00" stroke-width="2"/>
        <text x="812" y="${stateStatus === 'HALF' ? '450' : '390'}" font-family="Arial, sans-serif" font-size="32" font-weight="bold" fill="#D2FF00" text-anchor="middle">
          ${stateCode}
        </text>
        
        ${stateStatus === 'HALF' ? `
        <!-- State Reason (only if half-staff) -->
        <text x="920" y="420" font-family="Georgia, serif" font-size="18" font-style="italic" fill="#999999">
          in honor of
        </text>
        <text x="920" y="455" font-family="Arial, sans-serif" font-size="28" font-weight="bold" fill="#FFFFFF">
          ${stateReason.length > 25 ? stateReason.substring(0, 25) + '...' : stateReason}
        </text>
        ` : ''}
        
        <!-- Footer -->
        <text x="600" y="600" font-family="monospace" font-size="14" fill="#666666" text-anchor="middle">
          flag-watch.vercel.app • Live Status: ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })} EST
        </text>
      </svg>
    `;

    // Return SVG with proper headers for Open Graph
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=300'); // Cache for 5 minutes
    return res.send(svg);

  } catch (err) {
    console.error("Error generating preview:", err);
    
    // Return a fallback static image on error
    const fallbackSvg = `
      <svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
        <rect width="1200" height="630" fill="#050505"/>
        <text x="600" y="315" font-family="Arial, sans-serif" font-size="48" font-weight="bold" fill="#D2FF00" text-anchor="middle">
          FLAG WATCH
        </text>
        <text x="600" y="365" font-family="monospace" font-size="20" fill="#888888" text-anchor="middle">
          Real-Time US Flag Status Monitor
        </text>
      </svg>
    `;
    
    res.setHeader('Content-Type', 'image/svg+xml');
    return res.send(fallbackSvg);
  }
}
