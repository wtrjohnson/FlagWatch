// netlify/functions/ingestEmail.js
import { neon } from "@neondatabase/serverless";

/** Utility: strip HTML */
function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .trim();
}

/** State detection */
function detectState(subject) {
  if (!subject) return null;

  const stateMap = {
    "ALABAMA": "AL", "ALASKA": "AK", "ARIZONA": "AZ", "ARKANSAS": "AR",
    "CALIFORNIA": "CA", "COLORADO": "CO", "CONNECTICUT": "CT", "DELAWARE": "DE",
    "FLORIDA": "FL", "GEORGIA": "GA", "HAWAII": "HI", "HAWAI'I": "HI",
    "IDAHO": "ID", "ILLINOIS": "IL", "INDIANA": "IN", "IOWA": "IA",
    "KANSAS": "KS", "KENTUCKY": "KY", "LOUISIANA": "LA", "MAINE": "ME",
    "MARYLAND": "MD", "MASSACHUSETTS": "MA", "MICHIGAN": "MI", "MINNESOTA": "MN",
    "MISSISSIPPI": "MS", "MISSOURI": "MO", "MONTANA": "MT", "NEBRASKA": "NE",
    "NEVADA": "NV", "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ",
    "NEW MEXICO": "NM", "NEW YORK": "NY", "NORTH CAROLINA": "NC",
    "NORTH DAKOTA": "ND", "OHIO": "OH", "OKLAHOMA": "OK", "OREGON": "OR",
    "PENNSYLVANIA": "PA", "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC",
    "SOUTH DAKOTA": "SD", "TENNESSEE": "TN", "TEXAS": "TX", "UTAH": "UT",
    "VERMONT": "VT", "VIRGINIA": "VA", "WASHINGTON": "WA",
    "WEST VIRGINIA": "WV", "WISCONSIN": "WI", "WYOMING": "WY",
    "DISTRICT OF COLUMBIA": "DC", "WASHINGTON DC": "DC"
  };

  const upper = subject.toUpperCase();
  for (const name in stateMap) {
    if (upper.includes(name)) return stateMap[name];
  }
  return null;
}

/** National detection */
function detectNational(subject) {
  if (!subject) return false;
  const s = subject.toUpperCase();
  return (
    s.includes("UNITED STATES") ||
    s.includes("NATIONWIDE") ||
    s.includes("ALL U.S.") ||
    s.includes("US FLAGS") ||
    s.includes("U.S. FLAGS")
  );
}

/** Extract reason */
function extractReason(text) {
  if (!text) return null;
  const m = text.match(/in honor of ([^.,\n]+)/i);
  return m ? m[1].trim() : null;
}

/** Extract dates */
function extractDates(text) {
  if (!text) return { start: null, end: null };
  const regex = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}/gi;
  const matches = [...text.matchAll(regex)];

  return {
    start: matches[0]?.[0] || null,
    end: matches[1]?.[0] || null
  };
}

/** MAIN HANDLER */
export async function handler(event) {
  console.log("=== ingestEmail START ===");

  let payload = null;

  /** Try JSON first (CloudMailin sends JSON unless you choose MIME passthrough) */
  try {
    payload = JSON.parse(event.body);
    console.log("CloudMailin JSON detected");
  } catch {
    console.log("Not JSON; checking for multipart/form-data");
  }

  let subject = null;
  let from = null;
  let html = null;
  let plain = null;

  if (payload && typeof payload === "object" && payload.headers) {
    // ---- CLOUDMAILIN JSON ----
    subject = payload.headers.subject || null;
    from = payload.headers.from || null;
    html = payload.html || null;
    plain = payload.plain || null;
  } else {
    // ---- MULTIPART FALLBACK ----
    const params = new URLSearchParams(event.body);
    subject = params.get("headers[subject]") || params.get("subject");
    from = params.get("headers[from]");
    html = params.get("html");
    plain = params.get("plain");
  }

  console.log("Subject:", subject);
  console.log("From:", from);

  if (!subject) {
    console.log("Could not extract subject → ignoring email.");
    return { statusCode: 200, body: "ignored" };
  }

  const emailText = html ? stripHtml(html) : (plain || "");
  console.log("Extracted text:", emailText.slice(0, 200), "...");

  const isNational = detectNational(subject);
  const stateCode = isNational ? null : detectState(subject);

  console.log("Detected state:", stateCode);
  console.log("National:", isNational);

  if (!isNational && !stateCode) {
    console.log("No state detected → ignoring");
    return { statusCode: 200, body: "ignored" };
  }

  const reason = extractReason(emailText);
  const { start, end } = extractDates(emailText);

  const sql = neon(process.env.NETLIFY_DATABASE_URL);

  if (isNational) {
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

  console.log("=== SUCCESS ===");
  return { statusCode: 200, body: "ok" };
}
