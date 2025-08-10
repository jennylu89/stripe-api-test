// api/echo.js
export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  let json = null;
  try { json = raw ? JSON.parse(raw) : null; } catch {}

  return res.status(200).json({
    ok: true,
    method: req.method,
    url: req.url,
    rawBody: raw || null,
    jsonBody: json,
    time: new Date().toISOString(),
  });
}
