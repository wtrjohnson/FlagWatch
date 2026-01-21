// api/getUSStatus.js
import { neon } from "@neondatabase/serverless";

/**
 * Parse a "Month Day" date string and handle year wraparound.
 * If the parsed date is more than 6 months in the future, assume it's from last year.
 */
function parseMonthDayDate(dateStr, now) {
  const currentYear = now.getFullYear();
  const parsed = new Date(`${dateStr} ${currentYear}`);

  if (isNaN(parsed.getTime())) {
    return null;
  }

  // If the date is more than 6 months in the future, it's probably from last year
  const sixMonthsFromNow = new Date(now);
  sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);

  if (parsed > sixMonthsFromNow) {
    parsed.setFullYear(currentYear - 1);
  }

  return parsed;
}

/**
 * Fetches the current US National Flag status from the Neon database.
 * Automatically resets expired half-mast orders to full staff.
 */
export default async function handler(req, res) {
  try {
    const sql = neon(process.env.DATABASE_URL);

    // STEP 1: Clean up expired orders and check start dates
    const allOrders = await sql`
        SELECT id, start_date, end_date
        FROM flag_status
        WHERE half_mast = true
        AND country_code = 'US'
        AND state_code IS NULL
    `;

    const now = new Date();

    for (const order of allOrders) {
        try {
            // Check if order has started yet
            if (order.start_date) {
                const startDate = parseMonthDayDate(order.start_date, now);
                if (startDate) {
                    startDate.setHours(0, 0, 0, 0); // Start of day

                    if (now < startDate) {
                        await sql`
                            UPDATE flag_status
                            SET half_mast = false, updated_at = NOW()
                            WHERE id = ${order.id}
                        `;
                        continue;
                    }
                }
            }

            // Check if order has expired
            if (order.end_date && order.end_date !== '' && order.end_date !== 'TBD') {
                const endDate = parseMonthDayDate(order.end_date, now);

                if (!endDate) {
                    continue;
                }

                // Set to end of day (11:59:59 PM) so flags stay at half-mast through the entire end date
                endDate.setHours(23, 59, 59, 999);

                // If the date is in the past, reset to full staff
                if (endDate < now) {
                    await sql`
                        UPDATE flag_status
                        SET half_mast = false, updated_at = NOW()
                        WHERE id = ${order.id}
                    `;
                }
            }
        } catch (e) {
            // Date parsing errors are non-fatal, continue processing other orders
        }
    }

    // STEP 2: Query for the US National Flag status (state_code is NULL)
    const result = await sql`
        SELECT reason, reason_detail, end_date, half_mast
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

    // If a record exists, check the half_mast value
    if (result.length > 0) {
        const record = result[0];

        // Explicitly check if half_mast is true
        if (record.half_mast === true) {
            // Use the end_date string directly (already in "Month Day" format)
            const duration = record.end_date 
                ? `Until ${record.end_date}` 
                : "Until further notice";
            
            usStatusData = {
                status: "HALF",
                reason: record.reason || "Presidential Proclamation",
                reason_detail: record.reason_detail || null,
                duration: duration
            };
        } else {
            // Explicitly set to FULL when half_mast is false
            usStatusData = {
                status: "FULL",
                reason: record.reason || "Standard Protocols",
                reason_detail: null,
                duration: "Indefinite"
            };
        }
    }

    return res.status(200).json(usStatusData);
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch US flag status" });
  }
}