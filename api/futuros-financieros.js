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

  // BUG 4 FIX: Los símbolos del dólar futuro en Primary reMarkets
  // son "DLR/MES26" sin el prefijo de mercado en el símbolo.
  // El marketId ya especifica ROFX. Agregamos más meses (hasta 2029).
  const MES_CODE = {
    "01":"ENE","02":"FEB","03":"MAR","04":"ABR","05":"MAY","06":"JUN",
    "07":"JUL","08":"AGO","09":"SEP","10":"OCT","11":"NOV","12":"DIC",
  };

  // Generar tickers dinámicamente para 2026-2029
  const TICKERS = {};
  const hoy = new Date();
  for (let y = hoy.getFullYear(); y <= 2029; y++) {
    for (let m = 1; m <= 12; m++) {
      // Saltar meses pasados
      if (y === hoy.getFullYear() && m < hoy.getMonth() + 1) continue;
      const mesKey = `${y}-${String(m).padStart(2,"0")}`;
      const mesCode = MES_CODE[String(m).padStart(2,"0")];
      const yr2 = String(y).slice(2);
      TICKERS[mesKey] = `DLR/${mesCode}${yr2}`;
    }
  }

  try {
    const tokenRes = await fetch("https://api.remarkets.primary.com.ar/auth/getToken", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-Username": PRIMARY_USER,
        "X-Password": PRIMARY_PASS,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!tokenRes.ok) throw new Error(`Auth Primary HTTP ${tokenRes.status}`);
    const token = tokenRes.headers.get("X-Auth-Token");
    if (!token) throw new Error("Sin X-Auth-Token");

    const dolarFuturo = {};
    const results = await Promise.allSettled(
      Object.entries(TICKERS).map(async ([mesKey, ticker]) => {
        const r = await fetch(
          // BUG 4b FIX: entries correctos — LA=último, CL=cierre, OF=oferta
          `https://api.remarkets.primary.com.ar/rest/marketdata/get` +
          `?marketId=ROFX&symbol=${encodeURIComponent(ticker)}&entries=LA,CL,OF,BI`,
          { headers: { "X-Auth-Token": token }, signal: AbortSignal.timeout(6000) }
        );
        if (!r.ok) return null;
        const d = await r.json();
        if (d?.status === "ERROR") return null;
        const md = d?.marketData;
        if (!md) return null;
        // Orden de prioridad para precio más representativo
        const precio = md?.LA?.price ?? md?.CL?.price ?? md?.OF?.price ?? md?.BI?.price ?? null;
        return precio != null && precio > 0 ? { mesKey, precio } : null;
      })
    );

    results.forEach(r => {
      if (r.status === "fulfilled" && r.value) {
        dolarFuturo[r.value.mesKey] = r.value.precio;
      }
    });

    const dolarFuturoLimpio = Object.fromEntries(
      Object.entries(dolarFuturo).filter(([, v]) => v != null && v > 0)
    );

    return res.status(200).json({
      ok: true,
      source: "Primary_reMarkets",
      dolar_futuro: dolarFuturoLimpio,
      contratos: Object.keys(dolarFuturoLimpio).length,
      tickers_consultados: Object.keys(TICKERS).length,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    return res.status(200).json({
      ok: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}
