// netlify/functions/getFlagStatus.js
import { neon } from "@neondatabase/serverless";

export async function handler(event) {
  try {
    const sql = neon(process.env.NETLIFY_DATABASE_URL);

    const { state } = event.queryStringParameters || {};
    const result = state
      ? await sql`SELECT * FROM flag_status WHERE state_code = ${state} OR (country_code = 'US' AND state_code IS NULL)`
      : await sql`SELECT * FROM flag_status WHERE country_code = 'US' AND state_code IS NULL`;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
}
