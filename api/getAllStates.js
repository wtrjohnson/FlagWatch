// api/getAllStates.js
import { neon } from "@neondatabase/serverless";

// Static reference data for all 50 states + DC (Only Code and Name are critical)
const STATE_LOOKUP = [
    { code: "AL", name: "ALABAMA" }, { code: "AK", name: "ALASKA" }, 
    { code: "AZ", name: "ARIZONA" }, { code: "AR", name: "ARKANSAS" }, 
    { code: "CA", name: "CALIFORNIA" }, { code: "CO", name: "COLORADO" }, 
    { code: "CT", name: "CONNECTICUT" }, { code: "DE", name: "DELAWARE" },
    { code: "DC", name: "WASHINGTON DC" },
    { code: "FL", name: "FLORIDA" }, { code: "GA", name: "GEORGIA" }, 
    { code: "HI", name: "HAWAII" }, { code: "ID", name: "IDAHO" }, 
    { code: "IL", name: "ILLINOIS" }, { code: "IN", name: "INDIANA" }, 
    { code: "IA", name: "IOWA" }, { code: "KS", name: "KANSAS" }, 
    { code: "KY", name: "KENTUCKY" }, { code: "LA", name: "LOUISIANA" }, 
    { code: "ME", name: "MAINE" }, { code: "MD", name: "MARYLAND" }, 
    { code: "MA", name: "MASSACHUSETTS" }, { code: "MI", name: "MICHIGAN" }, 
    { code: "MN", name: "MINNESOTA" }, { code: "MS", name: "MISSISSIPPI" }, 
    { code: "MO", name: "MISSOURI" }, { code: "MT", name: "MONTANA" }, 
    { code: "NE", name: "NEBRASKA" }, { code: "NV", name: "NEVADA" }, 
    { code: "NH", name: "NEW HAMPSHIRE" }, { code: "NJ", name: "NEW JERSEY" }, 
    { code: "NM", name: "NEW MEXICO" }, { code: "NY", name: "NEW YORK" }, 
    { code: "NC", name: "NORTH CAROLINA" }, { code: "ND", name: "NORTH DAKOTA" }, 
    { code: "OH", name: "OHIO" }, { code: "OK", name: "OKLAHOMA" }, 
    { code: "OR", name: "OREGON" }, { code: "PA", name: "PENNSYLVANIA" }, 
    { code: "RI", name: "RHODE ISLAND" }, { code: "SC", name: "SOUTH CAROLINA" }, 
    { code: "SD", name: "SOUTH DAKOTA" }, { code: "TN", name: "TENNESSEE" }, 
    { code: "TX", name: "TEXAS" }, { code: "UT", name: "UTAH" }, 
    { code: "VT", name: "VERMONT" }, { code: "VA", name: "VIRGINIA" }, 
    { code: "WA", name: "WASHINGTON" }, { code: "WV", name: "WEST VIRGINIA" }, 
    { code: "WI", name: "WISCONSIN" }, { code: "WY", name: "WYOMING" }
];

export default async function handler(req, res) {
  try {
    const sql = neon(process.env.DATABASE_URL);

    // STEP 1: Clean up expired orders AND check start dates
    const allOrders = await sql`
        SELECT id, start_date, end_date, state_code
        FROM flag_status
        WHERE half_mast = true 
        AND state_code IS NOT NULL
    `;

    const now = new Date();
    console.log(`Current time: ${now.toString()} (${now.toISOString()})`);
    
    for (const order of allOrders) {
        try {
            // Check if order has started yet
            if (order.start_date) {
                const startDate = new Date(`${order.start_date} ${now.getFullYear()}`);
                startDate.setHours(0, 0, 0, 0); // Start of day
                
                if (now < startDate) {
                    console.log(`State ${order.state_code}: Order hasn't started yet (starts ${order.start_date}), setting to FULL`);
                    await sql`
                        UPDATE flag_status
                        SET half_mast = false, updated_at = NOW()
                        WHERE id = ${order.id}
                    `;
                    continue;
                }
            }
            
            // Check if order has expired
            if (order.end_date && order.end_date !== '' && order.end_date !== 'TBD') {
                const dateStr = `${order.end_date} ${now.getFullYear()}`;
                const endDate = new Date(dateStr);
                
                console.log(`State ${order.state_code}: Parsing "${dateStr}"`);
                
                if (isNaN(endDate.getTime())) {
                    console.error(`  -> Invalid date! Skipping.`);
                    continue;
                }
                
                endDate.setHours(23, 59, 59, 999);
                console.log(`  -> Expired? ${endDate < now}`);
                
                if (endDate < now) {
                    console.log(`  -> RESETTING to full staff`);
                    await sql`
                        UPDATE flag_status
                        SET half_mast = false, updated_at = NOW()
                        WHERE id = ${order.id}
                    `;
                }
            }
        } catch (e) {
            console.error(`ERROR parsing date: ${order.end_date} for state ${order.state_code}:`, e);
        }
    }

    // STEP 2: Fetch all active half-mast orders for states
    const activeOrders = await sql`
        SELECT state_code, reason, reason_detail, end_date, half_mast
        FROM flag_status
        WHERE state_code IS NOT NULL AND half_mast = true;
    `;

    const activeMap = new Map();
    activeOrders.forEach(order => {
        // Use the end_date string directly (already in "Month Day" format)
        const duration = order.end_date 
            ? `Until ${order.end_date}` 
            : "Until further notice";
        
        activeMap.set(order.state_code, {
            status: order.half_mast ? "HALF" : "FULL",
            reason: order.reason || "Governor's Order",
            reason_detail: order.reason_detail || null,
            duration: duration
        });
    });

    // Merge static data with dynamic status
    const finalData = STATE_LOOKUP.map(state => {
        const activeOrder = activeMap.get(state.code);
        
        // If an active order exists, use its status/reason. Otherwise, default to FULL.
        if (activeOrder) {
            return {
                ...state,
                ...activeOrder,
            };
        } 
        else {
            return {
                ...state,
                status: "FULL",
                reason: "No active orders",
                reason_detail: null,
                duration: "Indefinite"
            };
        }
    });

    return res.status(200).json(finalData);
  } catch (err) {
    console.error("Error in getAllStates function:", err);
    return res.status(500).json({ error: "Failed to fetch state list" });
  }
}
