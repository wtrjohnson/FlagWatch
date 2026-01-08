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
  // Check if API key exists
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("⚠️  No ANTHROPIC_API_KEY found, falling back to regex extraction");
    return { reason: null, reason_detail: null };
  }

  try {
    console.log("🤖 Calling Claude AI to extract reason...");
    
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
      const errorText = await response.text();
      console.error("❌ API Error:", response.status, errorText);
      return { reason: null, reason_detail: null };
    }

    const data = await response.json();
    
    if (data.content && data.content[0] && data.content[0].text) {
      const summary = data.content[0].text.trim();
      console.log("✅ AI raw response:", summary);
      
      // Clean any markdown formatting
      const cleaned = summary.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      
      console.log("✅ AI extracted - reason:", parsed.reason);
      console.log("✅ AI extracted - reason_detail:", parsed.reason_detail);
      
      return {
        reason: parsed.reason || null,
        reason_detail: parsed.reason_detail || null
      };
    }
    
    console.log("⚠️  No content in AI response");
    return { reason: null, reason_detail: null };
  } catch (error) {
    console.error("❌ AI summarization failed:", error.message);
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
      console.log("📝 Regex extracted reason:", reason);
      break;
    }
  }
  
  if (!reason) {
    console.log("⚠️  No reason found with regex");
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
    console.log(`📅 Found date range: ${month} ${startDay}-${endDay}`);
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
    console.log(`📅 Found date range: ${startMonth} ${startDay} through ${endMonth} ${endDay}`);
    return {
      start: `${startMonth} ${startDay}`,
      end: `${endMonth} ${endDay}`
    };
  }
  
  // Fall back to finding individual dates
  const regex = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}/gi;
  const matches = [...text.matchAll(regex)];
  
  console.log(`📅 Found ${matches.length} individual dates`);

  return {
    start: matches[0]?.[0] || null,
    end: matches[1]?.[0] || null
  };
}

/** MAIN HANDLER */
export default async function handler(req, res) {
  console.log("\n=== 📧 INGEST EMAIL START ===");
  console.log("Timestamp:", new Date().toISOString());

  let payload = req.body;
  
  let subject = null;
  let from = null;
  let html = null;
  let plain = null;

  // Parse different email formats
  if (payload && typeof payload === "object" && payload.headers) {
    // CloudMailin JSON format
    subject = payload.headers.subject || null;
    from = payload.headers.from || null;
    html = payload.html || null;
    plain = payload.plain || null;
  } else if (typeof payload === "string") {
    // Multipart/form-data format
    const params = new URLSearchParams(payload);
    subject = params.get("headers[subject]") || params.get("subject");
    from = params.get("headers[from]");
    html = params.get("html");
    plain = params.get("plain");
  } else {
    // Direct properties
    subject = payload?.subject || null;
    from = payload?.from || null;
    html = payload?.html || null;
    plain = payload?.plain || null;
  }

  console.log("📬 Subject:", subject);
  console.log("👤 From:", from);

  if (!subject) {
    console.log("⚠️  Could not extract subject → ignoring email");
    return res.status(200).send("ignored");
  }

  const emailText = html ? stripHtml(html) : (plain || "");
  console.log("📄 Email text length:", emailText.length, "characters");
  console.log("📄 Preview:", emailText.slice(0, 200), "...");

  const isNational = detectNational(subject);
  const stateCode = isNational ? null : detectState(subject);

  console.log("🇺🇸 National order:", isNational);
  console.log("🏛️  State detected:", stateCode || "None");

  if (!isNational && !stateCode) {
    console.log("⚠️  No state detected → ignoring email");
    return res.status(200).send("ignored");
  }

  // Extract reason with AI (with fallback)
  let reasonData = await summarizeReason(emailText);
  if (!reasonData.reason) {
    console.log("⚠️  AI failed, using regex fallback");
    reasonData = extractReasonFallback(emailText);
  }
  
  const reason = reasonData.reason;
  const reasonDetail = reasonData.reason_detail;
  
  console.log("📝 Final reason:", reason);
  console.log("📝 Final reason_detail:", reasonDetail);

  const { start, end } = extractDates(emailText);
  console.log("📅 Start date:", start);
  console.log("📅 End date:", end);

  const sql = neon(process.env.DATABASE_URL);

  try {
    if (isNational) {
      console.log("💾 Inserting NATIONAL flag order...");
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
      console.log(`💾 Inserting STATE flag order for ${stateCode}...`);
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

    console.log("✅ Database updated successfully");
    console.log("=== 📧 INGEST EMAIL COMPLETE ===\n");
    return res.status(200).send("ok");
  } catch (dbError) {
    console.error("❌ Database error:", dbError);
    return res.status(500).json({ error: "Database update failed" });
  }
}
