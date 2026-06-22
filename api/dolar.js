// api/dolar.js — Vercel API Route
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const r = await fetch("https://dolarapi.com/v1/dolares", {
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();

    // BUG 5 FIX: el frontend llama a /api/futuros-agro y espera el TC de dolarapi.com
    // directamente en el browser (fetchTC llama a dolarapi.com sin pasar por Vercel).
    // Este endpoint /api/dolar.js NO es llamado desde el frontend — solo existe como
    // proxy de backup. El problema era que fetchTC en el frontend busca:
    //   d.casa === "oficial"   → venta  (TC minorista)
    //   d.casa === "mayorista" → compra (TC mayorista)
    // Pero dolarapi.com devuelve "minorista" (no "oficial") en algunos casos.
    // Este endpoint normaliza y expone ambos para que el frontend pueda usarlo.

    const oficial   = data.find(d => d.casa === "oficial");
    const mayorista = data.find(d => d.casa === "mayorista");
    const minorista = data.find(d => d.casa === "minorista") || oficial;

    // BUG 5b FIX: el campo correcto para TC minorista vendedor es "venta",
    // para mayorista comprador es "compra". El código anterior tomaba
    // mayorista?.venta en lugar de mayorista?.compra para el mayorista.
    return res.status(200).json({
      ok: true,
      // TC minorista: precio al que el banco vende dólares (el cliente compra)
      minorista: minorista?.venta ?? null,
      // TC mayorista: precio al que el banco compra dólares (para granos)
      mayorista: mayorista?.compra ?? null,
      // Array completo por si el frontend quiere procesar
      raw: data,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(200).json({ ok: false, error: error.message });
  }
}
