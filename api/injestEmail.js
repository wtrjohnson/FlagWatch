// api/ingestEmail.js
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

/** AI-powered reason extraction using Claude 3 Haiku */
async function summarizeReason(rawEmailText) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { reason: null, reason_detail: null };
  }

  try {
    
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307", // Cheapest model, perfect for this task
        max_tokens: 150,
        messages: [{
          role: "user",
          content: `Extract information from this flag order email. Return ONLY valid JSON with no markdown formatting, preamble, or explanation.

Required format:
{
  "reason": "name or event",
  "reason_detail": "brief description of what happened"
}

Rules:
- "reason": Extract ONLY the person's name (no titles) OR event name. For multiple people, list all names separated by "and".
- "reason_detail": Brief description of what happened or why the flag is at half-staff. Examples: "Police Officer killed in line of duty", "Former State Senator", "Wildfire victims", "Pearl Harbor remembrance". Keep under 8 words. NEVER use generic phrases like "Half-Staff Alert" or "Flag Order".
- For commemorative events (Pearl Harbor, 9/11, etc.), "reason" is the event name, "reason_detail" describes significance.
- Look for context about the person's role, how they died, or what happened.

Examples:
Person killed: {"reason": "Stephen LaPorta", "reason_detail": "Police Officer killed in line of duty"}
Former official: {"reason": "John Smith", "reason_detail": "Former State Senator"}
Multiple: {"reason": "John Smith and Jane Doe", "reason_detail": "Victims of wildfire disaster"}
Event: {"reason": "Pearl Harbor Remembrance Day", "reason_detail": "Honoring those who served"}

Email text:
${rawEmailText.slice(0, 1500)}`
        }]
      })
    });

    if (!response.ok) {
      return { reason: null, reason_detail: null };
    }

    const data = await response.json();
    
    if (data.content && data.content[0] && data.content[0].text) {
      const summary = data.content[0].text.trim();
      const cleaned = summary.replace(/```json|```/g, "").trim();

      try {
        const parsed = JSON.parse(cleaned);
        return {
          reason: parsed.reason || null,
          reason_detail: parsed.reason_detail || null
        };
      } catch (parseError) {
        return { reason: null, reason_detail: null };
      }
    }

    return { reason: null, reason_detail: null };
  } catch (error) {
    return { reason: null, reason_detail: null };
  }
}

/** Fallback: Extract reason with regex */
function extractReasonFallback(text) {
  if (!text) return { reason: null, reason_detail: null };
  
  // Try multiple patterns for the name
  const patterns = [
    /in honor of ([^.,\n]+)/i,
    /in memory of ([^.,\n]+)/i,
    /honoring ([^.,\n]+)/i,
    /for ([^.,\n]+)/i
  ];
  
  let reason = null;
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      reason = match[1].trim();
      break;
    }
  }

  if (!reason) {
    reason = "Governor's Order";
  }
  
  // For fallback, we can't reliably extract detail, so leave it null
  return { reason, reason_detail: null };
}

function detectState(subject) {
  if (!subject) return null;

  const upper = subject.toUpperCase();

  const stateMap = {
    "ALABAMA": "AL", "ALASKA": "AK", "ARIZONA": "AZ", "ARKANSAS": "AR",
    "CALIFORNIA": "CA", "COLORADO": "CO", "CONNECTICUT": "CT", "DELAWARE": "DE",
    "FLORIDA": "FL", "GEORGIA": "GA", "HAWAII": "HI", "HAWAI'I": "HI",
    "IDAHO": "ID", "ILLINOIS": "IL", "INDIANA": "IN", "IOWA": "IA",
    "KANSAS": "KS", "KENTUCKY": "KY", "LOUISIANA": "LA", "MAINE": "ME",
    "MARYLAND": "MD", "MASSACHUSETTS": "MA", "MICHIGAN": "MI", "MINNESOTA": "MN",
    "MISSISSIPPI": "MS", "MISSOURI": "MO", "MONTANA": "MT", "NEBRASKA": "NE",
    "NEVADA": "NV", "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ", "NEW MEXICO": "NM",
    "NEW YORK": "NY", "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND",
    "OHIO": "OH", "OKLAHOMA": "OK", "OREGON": "OR", "PENNSYLVANIA": "PA",
    "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC", "SOUTH DAKOTA": "SD",
    "TENNESSEE": "TN", "TEXAS": "TX", "UTAH": "UT", "VERMONT": "VT",
    "VIRGINIA": "VA", "WASHINGTON": "WA", "WEST VIRGINIA": "WV",
    "WISCONSIN": "WI", "WYOMING": "WY", "WASHINGTON DC": "DC",
    "DISTRICT OF COLUMBIA": "DC"
  };

  for (const fullName in stateMap) {
    if (upper.includes(fullName)) return stateMap[fullName];
  }

  for (const code of Object.values(stateMap)) {
    const regex = new RegExp(`\\b${code}\\b`);
    if (regex.test(upper)) return code;
  }

  return null;
}

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

function extractDates(text) {
  if (!text) return { start: null, end: null };
  
  // Try to find date ranges first (e.g., "January 6-7" or "January 6 through January 7")
  const rangePatterns = [
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\s*[-–—]\s*(\d{1,2})/i,
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\s+(?:through|to)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})/i
  ];
  
  // Check for "Month Day-Day" format (e.g., "January 6-7")
  const rangeMatch = text.match(rangePatterns[0]);
  if (rangeMatch) {
    const month = rangeMatch[1];
    const startDay = rangeMatch[2];
    const endDay = rangeMatch[3];
    return {
      start: `${month} ${startDay}`,
      end: `${month} ${endDay}`
    };
  }

  // Check for "Month Day through Month Day" format
  const throughMatch = text.match(rangePatterns[1]);
  if (throughMatch) {
    const startMonth = throughMatch[1];
    const startDay = throughMatch[2];
    const endMonth = throughMatch[3];
    const endDay = throughMatch[4];
    return {
      start: `${startMonth} ${startDay}`,
      end: `${endMonth} ${endDay}`
    };
  }

  // Fall back to finding individual dates
  const regex = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}/gi;
  const matches = [...text.matchAll(regex)];

  return {
    start: matches[0]?.[0] || null,
    end: matches[1]?.[0] || null
  };
}

/** MAIN HANDLER */
export default async function handler(req, res) {
  let payload = req.body;

  let subject = null;
  let html = null;
  let plain = null;

  // Parse different email formats
  if (payload && typeof payload === "object" && payload.headers) {
    // CloudMailin JSON format
    subject = payload.headers.subject || null;
    html = payload.html || null;
    plain = payload.plain || null;
  } else if (typeof payload === "string") {
    // Multipart/form-data format
    const params = new URLSearchParams(payload);
    subject = params.get("headers[subject]") || params.get("subject");
    html = params.get("html");
    plain = params.get("plain");
  } else {
    // Direct properties
    subject = payload?.subject || null;
    html = payload?.html || null;
    plain = payload?.plain || null;
  }

  if (!subject) {
    return res.status(200).send("ignored");
  }

  const emailText = html ? stripHtml(html) : (plain || "");

  const isNational = detectNational(subject);
  const stateCode = isNational ? null : detectState(subject);

  if (!isNational && !stateCode) {
    return res.status(200).send("ignored");
  }

  // Extract reason with AI (with fallback)
  let reasonData = await summarizeReason(emailText);
  if (!reasonData.reason) {
    reasonData = extractReasonFallback(emailText);
  }

  const reason = reasonData.reason;
  const reasonDetail = reasonData.reason_detail;

  const { start, end } = extractDates(emailText);

  const sql = neon(process.env.DATABASE_URL);

  try {
    if (isNational) {
      await sql`
        INSERT INTO flag_status (country_code, state_code, half_mast, reason, reason_detail, start_date, end_date, raw_email)
        VALUES ('US', NULL, true, ${reason}, ${reasonDetail}, ${start}, ${end}, ${emailText})
        ON CONFLICT (country_code, state_code)
        DO UPDATE SET
          half_mast = EXCLUDED.half_mast,
          reason = EXCLUDED.reason,
          reason_detail = EXCLUDED.reason_detail,
          start_date = EXCLUDED.start_date,
          end_date = EXCLUDED.end_date,
          raw_email = EXCLUDED.raw_email,
          updated_at = NOW();
      `;
    } else {
      await sql`
        INSERT INTO flag_status (country_code, state_code, half_mast, reason, reason_detail, start_date, end_date, raw_email)
        VALUES ('US', ${stateCode.toUpperCase()}, true, ${reason}, ${reasonDetail}, ${start}, ${end}, ${emailText})
        ON CONFLICT (country_code, state_code)
        DO UPDATE SET
          half_mast = EXCLUDED.half_mast,
          reason = EXCLUDED.reason,
          reason_detail = EXCLUDED.reason_detail,
          start_date = EXCLUDED.start_date,
          end_date = EXCLUDED.end_date,
          raw_email = EXCLUDED.raw_email,
          updated_at = NOW();
      `;
    }

    return res.status(200).send("ok");
  } catch (dbError) {
    return res.status(500).json({ error: "Database update failed" });
  }
}
