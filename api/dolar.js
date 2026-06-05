// api/dolar.js — Vercel API Route (mismo que el actual pero en formato Vercel)
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const r = await fetch("https://dolarapi.com/v1/dolares", { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const mayorista = data.find(d => d.casa === "mayorista") || data.find(d => d.casa === "oficial");
    const minorista = data.find(d => d.casa === "minorista") || data.find(d => d.casa === "oficial");
    return res.status(200).json({
      ok: true,
      mayorista: mayorista?.venta || mayorista?.compra || null,
      minorista: minorista?.venta || minorista?.compra || null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(200).json({ ok: false, error: error.message });
  }
}
