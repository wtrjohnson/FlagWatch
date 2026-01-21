// api/getFlagStatus.js
import { neon } from "@neondatabase/serverless";

const VALID_STATE_CODES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL',
  'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME',
  'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH',
  'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
  'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
];

export default async function handler(req, res) {
  try {
    const sql = neon(process.env.DATABASE_URL);

    const { state } = req.query || {};

    // Validate state code if provided
    if (state && !VALID_STATE_CODES.includes(state.toUpperCase())) {
      return res.status(400).json({ error: 'Invalid state code' });
    }

    const normalizedState = state ? state.toUpperCase() : null;
    const result = normalizedState
      ? await sql`SELECT * FROM flag_status WHERE state_code = ${normalizedState} OR (country_code = 'US' AND state_code IS NULL)`
      : await sql`SELECT * FROM flag_status WHERE country_code = 'US' AND state_code IS NULL`;

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
