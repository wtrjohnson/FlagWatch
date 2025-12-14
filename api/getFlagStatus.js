// api/getFlagStatus.js
import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  try {
    const sql = neon(process.env.DATABASE_URL);

    const { state } = req.query || {};
    const result = state
      ? await sql`SELECT * FROM flag_status WHERE state_code = ${state} OR (country_code = 'US' AND state_code IS NULL)`
      : await sql`SELECT * FROM flag_status WHERE country_code = 'US' AND state_code IS NULL`;

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
