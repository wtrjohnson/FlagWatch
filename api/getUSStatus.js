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
    console.log(`Current time: ${now.toString()} (${now.toISOString()})`);
    
    for (const order of allOrders) {
        try {
            // Parse "December 10" or similar formats - add current year
            const dateStr = `${order.end_date} ${now.getFullYear()}`;
            const endDate = new Date(dateStr);
            
            console.log(`US Order: Parsing "${dateStr}"`);
            console.log(`  -> Parsed as: ${endDate.toString()}`);
            console.log(`  -> Is valid? ${!isNaN(endDate.getTime())}`);
            
            if (isNaN(endDate.getTime())) {
                console.error(`  -> Invalid date! Skipping.`);
                continue;
            }
            
            // Set to end of day (11:59:59 PM) so flags stay at half-mast through the entire end date
            endDate.setHours(23, 59, 59, 999);
            
            console.log(`  -> End of day: ${endDate.toString()}`);
            console.log(`  -> Expired? ${endDate < now}`);
            
            // If the date is in the past, reset to full staff
            if (endDate < now) {
                console.log(`  -> RESETTING to full staff`);
                await sql`
                    UPDATE flag_status
                    SET half_mast = false, updated_at = NOW()
                    WHERE id = ${order.id}
                `;
            } else {
                console.log(`  -> Still active, keeping at half-mast`);
            }
        } catch (e) {
            console.error(`ERROR parsing date: ${order.end_date}:`, e);
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

    console.log("US Status Query Result:", result);

    let usStatusData = { 
        status: "FULL", 
        reason: "Standard Protocols", 
        duration: "Indefinite" 
    };

    // If a record exists, check the half_mast value
    if (result.length > 0) {
        const record = result[0];
        console.log("Half Mast Value:", record.half_mast, "Type:", typeof record.half_mast);
        
        // Explicitly check if half_mast is true
        if (record.half_mast === true) {
            // Use the end_date string directly (already in "Month Day" format)
            const duration = record.end_date 
                ? `Until ${record.end_date}` 
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

    console.log("Returning US Status:", usStatusData);

    return res.status(200).json(usStatusData);
  } catch (err) {
    console.error("Error in getUSStatus function:", err);
    return res.status(500).json({ error: "Failed to fetch US flag status" });
  }
}
