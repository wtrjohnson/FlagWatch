// netlify/functions/ingestEmail.js

export async function handler(event) {
  console.log("=== ingestEmail function triggered ===");

  return {
    statusCode: 200,
    body: JSON.stringify({ message: "OK" })
  };
}
