// api/futuros-agro.js — Vercel API Route
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const FALLBACK = {
    soja: { "2026-07": 324, "2026-09": 331, "2026-11": 334, "2027-05": 326, "2027-07": 338 },
    maiz: { "2026-07": 178, "2026-09": 183 },
  };

  const PRIMARY_USER = process.env.PRIMARY_USER;
  const PRIMARY_PASS = process.env.PRIMARY_PASS;
  const IOL_USER = process.env.IOL_USUARIO;
  const IOL_PASS = process.env.IOL_CONTRASENA;

  // Intentar Primary primero
  try {
    const tokenRes = await fetch("https://api.remarkets.primary.com.ar/auth/getToken", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", "X-Username": PRIMARY_USER, "X-Password": PRIMARY_PASS },
      signal: AbortSignal.timeout(8000),
    });
    if (!tokenRes.ok) throw new Error(`Primary auth HTTP ${tokenRes.status}`);
    const token = tokenRes.headers.get("X-Auth-Token");
    if (!token) throw new Error("Sin X-Auth-Token");

    const TICKERS_SOJA = {
      "2026-07": "SOJ.ROS/JUL26", "2026-09": "SOJ.ROS/SEP26", "2026-11": "SOJ.ROS/NOV26",
      "2027-05": "SOJ.ROS/MAY27", "2027-07": "SOJ.ROS/JUL27",
    };
    const TICKERS_MAIZ = {
      "2026-07": "MAI.ROS/JUL26", "2026-09": "MAI.ROS/SEP26",
    };

    const fetchTicker = async (ticker) => {
      const r = await fetch(
        `https://api.remarkets.primary.com.ar/rest/marketdata/get?marketId=ROFX&symbol=${encodeURIComponent(ticker)}&entries=LA,CL,SE`,
        { headers: { "X-Auth-Token": token }, signal: AbortSignal.timeout(6000) }
      );
      if (!r.ok) return null;
      const d = await r.json();
      if (d?.status === "ERROR") return null;
      const md = d?.marketData;
      return md?.LA?.price || md?.CL?.price || md?.SE?.price || null;
    };

    const sojaData = {}, maizData = {};
    const all = [
      ...Object.entries(TICKERS_SOJA).map(([mes, ticker]) => ({ mes, ticker, grano: "soja" })),
      ...Object.entries(TICKERS_MAIZ).map(([mes, ticker]) => ({ mes, ticker, grano: "maiz" })),
    ];
    const results = await Promise.allSettled(all.map(async ({ mes, ticker, grano }) => {
      const precio = await fetchTicker(ticker);
      return precio ? { mes, grano, precio } : null;
    }));
    results.forEach(r => {
      if (r.status === "fulfilled" && r.value) {
        const { mes, grano, precio } = r.value;
        if (grano === "soja") sojaData[mes] = precio;
        else maizData[mes] = precio;
      }
    });

    // Si Primary trajo datos, intentar completar con IOL los meses faltantes
    if (IOL_USER && IOL_PASS && Object.keys(sojaData).length > 0) {
      try {
        const iolBody = `username=${encodeURIComponent(IOL_USER)}&password=${encodeURIComponent(IOL_PASS)}&grant_type=password`;
        const iolToken = await fetch("https://api.invertironline.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: iolBody,
          signal: AbortSignal.timeout(8000),
        });
        if (iolToken.ok) {
          const { access_token } = await iolToken.json();
          if (access_token) {
            // Meses faltantes de soja
            const IOL_SOJA = { "2027-01": "SOJENE27", "2027-03": "SOJMAR27" };
            const IOL_MAIZ = { "2026-11": "MAINOV26", "2027-01": "MAIENE27", "2027-03": "MAIMAR27", "2027-05": "MAIMAY27" };
            await Promise.allSettled([
              ...Object.entries(IOL_SOJA).map(async ([mes, ticker]) => {
                if (sojaData[mes]) return;
                const r = await fetch(`https://api.invertironline.com/api/v2/ROFX/Titulos/${ticker}/Cotizacion`,
                  { headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(5000) });
                if (!r.ok) return;
                const d = await r.json();
                const p = d?.ultimoPrecio || d?.precioAjuste || d?.cierreAnterior;
                if (p) sojaData[mes] = p;
              }),
              ...Object.entries(IOL_MAIZ).map(async ([mes, ticker]) => {
                if (maizData[mes]) return;
                const r = await fetch(`https://api.invertironline.com/api/v2/ROFX/Titulos/${ticker}/Cotizacion`,
                  { headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(5000) });
                if (!r.ok) return;
                const d = await r.json();
                const p = d?.ultimoPrecio || d?.precioAjuste || d?.cierreAnterior;
                if (p) maizData[mes] = p;
              }),
            ]);
          }
        }
      } catch(e) { /* IOL fallback falló, continuar con Primary solo */ }
    }

    const sojaFinal = Object.keys(sojaData).length > 0 ? sojaData : FALLBACK.soja;
    const maizFinal = Object.keys(maizData).length > 0 ? maizData : FALLBACK.maiz;

    return res.status(200).json({
      ok: true,
      source: Object.keys(sojaData).length > 0 ? "Primary+IOL" : "fallback_static",
      soja: sojaFinal, maiz: maizFinal,
      contratos_soja: Object.keys(sojaFinal).length,
      contratos_maiz: Object.keys(maizFinal).length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(200).json({
      ok: true, source: "fallback_error",
      soja: FALLBACK.soja, maiz: FALLBACK.maiz,
      error: error.message, timestamp: new Date().toISOString(),
    });
  }
}
