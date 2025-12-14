// netlify/functions/getUSStatus.js
import { neon } from "@neondatabase/serverless";

/**
 * Fetches the current US National Flag status from the Neon database.
 */
export async function handler() {
  try {
    const sql = neon(process.env.NETLIFY_DATABASE_URL);

    // Query for the US National Flag status (state_code is NULL)
    const result = await sql`
        SELECT reason, end_date, half_mast
        FROM flag_status
        WHERE country_code = 'US' AND state_code IS NULL
        ORDER BY updated_at DESC
        LIMIT 1;
    `;

    let usStatusData = { 
        status: "FULL", 
        reason: "Standard Protocols", 
        duration: "Indefinite" 
    };

    // If a record exists and indicates half mast, use that data
    if (result.length > 0) {
        const record = result[0];
        const isHalf = record.half_mast === true;
        
        if (isHalf) {
            // Format end_date if it exists
            const duration = record.end_date 
                ? `Until ${new Date(record.end_date).toLocaleDateString()}` 
                : "Until further notice";
            
            usStatusData = {
                status: "HALF",
                reason: record.reason || "Presidential Proclamation",
                duration: duration
            };
        }
        // If half_mast is false or null, it remains the default FULL
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(usStatusData),
    };
  } catch (err) {
    console.error("Error in getUSStatus function:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to fetch US flag status" }),
    };
  }
}
