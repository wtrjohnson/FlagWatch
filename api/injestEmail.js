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
    return null;
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
        max_tokens: 100,
        messages: [{
          role: "user",
          content: `You are extracting information from a flag order email. Extract who or what this flag order honors.

Return ONLY a clean, specific 2-8 word phrase describing the person, event, or group being honored.

Examples of good responses:
- "Former Senator John Smith"
- "Victims of California Wildfires"
- "National Peace Officers"
- "Pearl Harbor Remembrance Day"
- "Governor Jane Doe"

Email text:
${rawEmailText.slice(0, 1500)}`
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ API Error:", response.status, errorText);
      return null;
    }

    const data = await response.json();
    
    if (data.content && data.content[0] && data.content[0].text) {
      const summary = data.content[0].text.trim();
      console.log("✅ AI extracted reason:", summary);
      return summary;
    }
    
    console.log("⚠️  No content in AI response");
    return null;
  } catch (error) {
    console.error("❌ AI summarization failed:", error.message);
    return null;
  }
}

/** Fallback: Extract reason with regex */
function extractReasonFallback(text) {
  if (!text) return null;
  
  // Try multiple patterns
  const patterns = [
    /in honor of ([^.,\n]+)/i,
    /in memory of ([^.,\n]+)/i,
    /honoring ([^.,\n]+)/i,
    /for ([^.,\n]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      console.log("📝 Regex extracted reason:", match[1].trim());
      return match[1].trim();
    }
  }
  
  console.log("⚠️  No reason found with regex");
  return "Governor's Order";
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
  const regex = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}/gi;
  const matches = [...text.matchAll(regex)];

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
  let reason = await summarizeReason(emailText);
  if (!reason) {
    console.log("⚠️  AI failed, using regex fallback");
    reason = extractReasonFallback(emailText);
  }
  
  console.log("📝 Final reason:", reason);

  const { start, end } = extractDates(emailText);
  console.log("📅 Start date:", start);
  console.log("📅 End date:", end);

  const sql = neon(process.env.DATABASE_URL);

  try {
    if (isNational) {
      console.log("💾 Inserting NATIONAL flag order...");
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
      console.log(`💾 Inserting STATE flag order for ${stateCode}...`);
      await sql`
        INSERT INTO flag_status (country_code, state_code, half_mast, reason, start_date, end_date, raw_email)
        VALUES ('US', ${stateCode.toUpperCase()}, true, ${reason}, ${start}, ${end}, ${emailText})
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

    console.log("✅ Database updated successfully");
    console.log("=== 📧 INGEST EMAIL COMPLETE ===\n");
    return res.status(200).send("ok");
  } catch (dbError) {
    console.error("❌ Database error:", dbError);
    return res.status(500).json({ error: "Database update failed" });
  }
}
