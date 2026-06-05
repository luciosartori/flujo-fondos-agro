// api/futuros-financieros.js — Vercel API Route
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const PRIMARY_USER = process.env.PRIMARY_USER;
  const PRIMARY_PASS = process.env.PRIMARY_PASS;

  if (!PRIMARY_USER || !PRIMARY_PASS) {
    return res.status(200).json({ ok: false, error: "Sin credenciales Primary" });
  }

  const TICKERS = {
    "2026-06": "DLR/JUN26", "2026-07": "DLR/JUL26", "2026-08": "DLR/AGO26",
    "2026-09": "DLR/SEP26", "2026-10": "DLR/OCT26", "2026-11": "DLR/NOV26",
    "2026-12": "DLR/DIC26", "2027-01": "DLR/ENE27", "2027-02": "DLR/FEB27",
    "2027-03": "DLR/MAR27", "2027-04": "DLR/ABR27", "2027-05": "DLR/MAY27",
    "2027-06": "DLR/JUN27", "2027-07": "DLR/JUL27", "2027-08": "DLR/AGO27",
    "2027-09": "DLR/SEP27", "2027-10": "DLR/OCT27", "2027-11": "DLR/NOV27",
    "2027-12": "DLR/DIC27",
  };

  try {
    const tokenRes = await fetch("https://api.remarkets.primary.com.ar/auth/getToken", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", "X-Username": PRIMARY_USER, "X-Password": PRIMARY_PASS },
      signal: AbortSignal.timeout(8000),
    });
    if (!tokenRes.ok) throw new Error(`Auth Primary HTTP ${tokenRes.status}`);
    const token = tokenRes.headers.get("X-Auth-Token");
    if (!token) throw new Error("Sin X-Auth-Token");

    const dolarFuturo = {};
    const results = await Promise.allSettled(
      Object.entries(TICKERS).map(async ([mesKey, ticker]) => {
        const r = await fetch(
          `https://api.remarkets.primary.com.ar/rest/marketdata/get?marketId=ROFX&symbol=${encodeURIComponent(ticker)}&entries=LA,CL,SE`,
          { headers: { "X-Auth-Token": token }, signal: AbortSignal.timeout(6000) }
        );
        if (!r.ok) return null;
        const d = await r.json();
        if (d?.status === "ERROR") return null;
        const md = d?.marketData;
        const precio = md?.LA?.price || md?.CL?.price || md?.SE?.price || null;
        return precio ? { mesKey, precio } : null;
      })
    );
    results.forEach(r => { if (r.status === "fulfilled" && r.value) dolarFuturo[r.value.mesKey] = r.value.precio; });

    // Filtrar valores null — no enviar JUN26 si no hay precio
    const dolarFuturoLimpio = Object.fromEntries(Object.entries(dolarFuturo).filter(([,v])=>v!=null&&v>0));

    return res.status(200).json({
      ok: true, source: "Primary_reMarkets",
      dolar_futuro: dolarFuturoLimpio,
      contratos: Object.keys(dolarFuturoLimpio).length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(200).json({ ok: false, error: error.message, timestamp: new Date().toISOString() });
  }
}
