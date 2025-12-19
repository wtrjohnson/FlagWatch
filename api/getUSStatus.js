// api/getUSStatus.js
import { neon } from "@neondatabase/serverless";

/**
 * Fetches the current US National Flag status from the Neon database.
 * Automatically resets expired half-mast orders to full staff.
 */
export default async function handler(req, res) {
  try {
    const sql = neon(process.env.DATABASE_URL);

    // STEP 1: Clean up expired orders
    // Since end_date may be in "Month Day" format like "December 10", we'll handle it in JavaScript
    const allOrders = await sql`
        SELECT id, end_date
        FROM flag_status
        WHERE half_mast = true 
        AND end_date IS NOT NULL 
        AND end_date != ''
        AND country_code = 'US'
        AND state_code IS NULL
    `;

    const now = new Date();
    for (const order of allOrders) {
        try {
            // Parse "December 10" or similar formats - add current year
            const endDate = new Date(`${order.end_date} ${now.getFullYear()}`);
            
            // If the date is in the past, reset to full staff
            if (endDate < now) {
                await sql`
                    UPDATE flag_status
                    SET half_mast = false, updated_at = NOW()
                    WHERE id = ${order.id}
                `;
            }
        } catch (e) {
            console.error(`Could not parse date: ${order.end_date}`);
        }
    }

    // STEP 2: Query for the US National Flag status (state_code is NULL)
    const result = await sql`
        SELECT reason, end_date, half_mast
        FROM flag_status
        WHERE country_code = 'US' AND state_code IS NULL
        ORDER BY updated_at DESC
        LIMIT 1;
    `;

    console.log("US Status Query Result:", result); // Debug log

    let usStatusData = { 
        status: "FULL", 
        reason: "Standard Protocols", 
        duration: "Indefinite" 
    };

    // If a record exists, check the half_mast value
    if (result.length > 0) {
        const record = result[0];
        console.log("Half Mast Value:", record.half_mast, "Type:", typeof record.half_mast); // Debug log
        
        // Explicitly check if half_mast is true
        if (record.half_mast === true) {
            // Format end_date if it exists
            const duration = record.end_date 
                ? `Until ${new Date(record.end_date).toLocaleDateString()}` 
                : "Until further notice";
            
            usStatusData = {
                status: "HALF",
                reason: record.reason || "Presidential Proclamation",
                duration: duration
            };
        } else {
            // Explicitly set to FULL when half_mast is false
            usStatusData = {
                status: "FULL",
                reason: record.reason || "Standard Protocols",
                duration: "Indefinite"
            };
        }
    }

    console.log("Returning US Status:", usStatusData); // Debug log

    return res.status(200).json(usStatusData);
  } catch (err) {
    console.error("Error in getUSStatus function:", err);
    return res.status(500).json({ error: "Failed to fetch US flag status" });
  }
}