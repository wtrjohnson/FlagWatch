// netlify/functions/ingestEmail.js
import { neon } from "@neondatabase/serverless";

/**
 * Utility: normalize text by stripping HTML tags if needed.
 */
function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .trim();
}

/**
 * Utility: extract state code from subject line
 */
function detectState(subject) {
  if (!subject) return null;

  // Map of all 50 states + DC
  const stateMap = {
    "ALABAMA": "AL", "ALASKA": "AK", "ARIZONA": "AZ", "ARKANSAS": "AR",
    "CALIFORNIA": "CA", "COLORADO": "CO", "CONNECTICUT": "CT", "DELAWARE": "DE",
    "FLORIDA": "FL", "GEORGIA": "GA", "HAWAII": "HI", "HAWAI'I": "HI",
    "IDAHO": "ID", "ILLINOIS": "IL", "INDIANA": "IN", "IOWA": "IA",
    "KANSAS": "KS", "KENTUCKY": "KY", "LOUISIANA": "LA", "MAINE": "ME",
    "MARYLAND": "MD", "MASSACHUSETTS": "MA", "MICHIGAN": "MI", "MINNESOTA": "MN",
    "MISSISSIPPI": "MS", "MISSOURI": "MO", "MONTANA": "MT", "NEBRASKA": "NE",
    "NEVADA": "NV", "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ", "NEW MEXICO": "NM",
    "NEW YORK": "NY", "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND", "OHIO": "OH",
    "OKLAHOMA": "OK", "OREGON": "OR", "PENNSYLVANIA": "PA", "RHODE ISLAND": "RI",
    "SOUTH CAROLINA": "SC", "SOUTH DAKOTA": "SD", "TENNESSEE": "TN", "TEXAS": "TX",
    "UTAH": "UT", "VERMONT": "VT", "VIRGINIA": "VA", "WASHINGTON": "WA",
    "WEST VIRGINIA": "WV", "WISCONSIN": "WI", "WYOMING": "WY",
    "DISTRICT OF COLUMBIA": "DC", "WASHINGTON DC": "DC"
  };

  const upper = subject.toUpperCase();
  for (const stateName in stateMap) {
    if (upper.includes(stateName)) {
      return stateMap[stateName];
    }
  }
  return null;
}

/**
 * Detect if this is a national half-staff alert
 */
function detectNational(subject) {
  if (!subject) return false;
  const s = subject.toUpperCase();

  return (
    s.includes("U.S.") ||
    s.includes("UNITED STATES") ||
    s.includes("NATIONWIDE") ||
    s.includes("ALL U.S.") ||
    s.includes("US FLAGS") ||
    s.includes("U. S. FLAG") ||
    s.includes("U S FLAG")
  );
}

/**
 * Extract reason ("in honor of ___")
 */
function extractReason(text) {
  if (!text) return null;

  const match = text.match(/in honor of ([^.,\n]+)/i);
  if (match) return match[1].trim();

  // Fallback: pick the first person-like phrase
  const m2 = text.match(/(Governor|President).+?(?:for|in honor of)\s+([^.,\n]+)/i);
  if (m2) return m2[2].trim();

  return null;
}

/**
 * Extract dates (simple version)
 */
function extractDates(text) {
  if (!text) return { start: null, end: null };

  const dateRegex = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}/gi;
  const matches = [...text.matchAll(dateRegex)];

  if (matches.length >= 2) {
    return {
      start: matches[0][0],
      end: matches[1][0]
    };
  }

  if (matches.length === 1) {
    return {
      start: matches[0][0],
      end: null
    };
  }

  return { start: null, end: null };
}


/**
 * MAIN HANDLER — CloudMailin → Neon DB
 */
export async function handler(event, context) {
  console.log("=== ingestEmail START ===");

  // Try to parse JSON body
let payload;
try {
  payload = JSON.parse(event.body);
  console.log("Parsed JSON OK");
} catch (err) {
  console.log("JSON parse failed, body was not JSON");
  console.log("Raw body shows:", event.body.substring(0, 500));
  return { statusCode: 400, body: "Invalid JSON" };
}


  try {
    const sql = neon(process.env.NETLIFY_DATABASE_URL);

    // CloudMailin sends multipart-normalized, so the body is form-encoded key=value
    const contentType = event.headers["content-type"] || "";
    const isMultipart = contentType.includes("multipart");

    let body = "";

    if (isMultipart) {
      // Netlify parses form-encoded multipart into "body" as raw
      // We must let Netlify parse it into event.body normally
      // Netlify gives event.body as base64 when binary, so decode conditionally
      if (event.isBase64Encoded) {
        body = Buffer.from(event.body, "base64").toString("utf-8");
      } else {
        body = event.body;
      }
    } else {
      body = event.body;
    }

    // CloudMailin normalized multipart sends fields like: plain=...&html=...&headers[subject]=...
    const params = new URLSearchParams(body);

    const html = params.get("html");
    const plain = params.get("plain");

    const subject = params.get("headers[subject]") || params.get("subject");
    const from = params.get("headers[from]");

    console.log("Raw body keys:", [...params.keys()]);
    console.log("Subject:", subject);
    console.log("From:", from);

    // Combine HTML → fallback to plain
    const emailText = html ? stripHtml(html) : (plain || "");
    console.log("Extracted text:", emailText.slice(0, 200), "...");

    // Detect national vs state
    const isNational = detectNational(subject);
    const stateCode = isNational ? null : detectState(subject);

    console.log("Detected State:", stateCode);
    console.log("National Alert?", isNational);

    if (!isNational && !stateCode) {
      console.log("No recognizable state → ignoring email.");
      return { statusCode: 200, body: "Ignored" };
    }

    // Parse reason + dates
    const reason = extractReason(emailText);
    const { start, end } = extractDates(emailText);

    console.log("Reason:", reason);
    console.log("Start date:", start, "End date:", end);

    // Overwrite logic
    if (isNational) {
      console.log("Updating NATIONAL half-staff order...");

      await sql`
        INSERT INTO flag_status (country_code, state_code, half_mast, reason, start_date, end_date, raw_email)
        VALUES ('US', NULL, true, ${reason}, ${start}, ${end}, ${emailText})
        ON CONFLICT (country_code, state_code)
        DO UPDATE SET
          half_mast = EXCLUDED.half_mast,
          reason = EXCLUDED.reason,
          start_date = EXCLUDED.start_date,
          end_date = EXCLUDED.end_date,
          raw_email = EXCLUDED.raw_email,
          updated_at = NOW();
      `;

    } else {
      console.log(`Updating state ${stateCode} half-staff order...`);

      await sql`
        INSERT INTO flag_status (country_code, state_code, half_mast, reason, start_date, end_date, raw_email)
        VALUES ('US', ${stateCode}, true, ${reason}, ${start}, ${end}, ${emailText})
        ON CONFLICT (country_code, state_code)
        DO UPDATE SET
          half_mast = EXCLUDED.half_mast,
          reason = EXCLUDED.reason,
          start_date = EXCLUDED.start_date,
          end_date = EXCLUDED.end_date,
          raw_email = EXCLUDED.raw_email,
          updated_at = NOW();
      `;
    }

    console.log("=== ingestEmail SUCCESS ===");
    return {
      statusCode: 200,
      body: JSON.stringify({ status: "ok" })
    };

  } catch (err) {
    console.error("INGEST ERROR:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
}
