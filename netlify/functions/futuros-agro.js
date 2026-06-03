// netlify/functions/futuros-agro.js
// Futuros agropecuarios (soja y maíz Rosario) desde Primary/reMarkets API
// Credenciales: PRIMARY_USER y PRIMARY_PASS en Netlify environment variables

export async function handler(event, context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  // Precios fallback (referencia) por si falla la API
  const FALLBACK = {
    soja: {
      "2026-07": 335, "2026-09": 337.7, "2026-11": 343,
      "2027-05": 336, "2027-07": 345,
    },
    maiz: {
      "2026-07": 168, "2026-09": 170, "2026-11": 172,
      "2027-01": 174, "2027-03": 176, "2027-05": 178,
    },
  };

  const PRIMARY_USER = process.env.PRIMARY_USER;
  const PRIMARY_PASS = process.env.PRIMARY_PASS;

  if (!PRIMARY_USER || !PRIMARY_PASS) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        source: "fallback_static",
        soja: FALLBACK.soja,
        maiz: FALLBACK.maiz,
        nota: "Sin credenciales Primary — usando precios de referencia.",
        timestamp: new Date().toISOString(),
      }),
    };
  }

  // Tickers en Primary/reMarkets
  // Soja Rosario: SOJ.ROS/MES26
  // Maíz Rosario: MAI.ROS/MES26
  const TICKERS_SOJA = {
    "2026-07": "SOJ.ROS/JUL26",
    "2026-09": "SOJ.ROS/SEP26",
    "2026-11": "SOJ.ROS/NOV26",
    "2027-01": "SOJ.ROS/ENE27",
    "2027-03": "SOJ.ROS/MAR27",
    "2027-05": "SOJ.ROS/MAY27",
    "2027-07": "SOJ.ROS/JUL27",
  };
  const TICKERS_MAIZ = {
    "2026-07": "MAI.ROS/JUL26",
    "2026-09": "MAI.ROS/SEP26",
    "2026-11": "MAI.ROS/NOV26",
    "2027-01": "MAI.ROS/ENE27",
    "2027-03": "MAI.ROS/MAR27",
    "2027-05": "MAI.ROS/MAY27",
  };

  try {
    // PASO 1 — Token Primary (viene en header X-Auth-Token)
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
    if (!token) throw new Error("Primary no devolvió X-Auth-Token");

    // PASO 2 — Consultar soja y maíz en paralelo (todos los tickers a la vez)
    const allTickers = [
      ...Object.entries(TICKERS_SOJA).map(([mes, ticker]) => ({ mes, ticker, grano: "soja" })),
      ...Object.entries(TICKERS_MAIZ).map(([mes, ticker]) => ({ mes, ticker, grano: "maiz" })),
    ];

    const sojaData = {};
    const maizData = {};

    const results = await Promise.allSettled(
      allTickers.map(async ({ mes, ticker, grano }) => {
        const res = await fetch(
          `https://api.remarkets.primary.com.ar/rest/marketdata/get?marketId=ROFX&symbol=${encodeURIComponent(ticker)}&entries=LA,CL,SE`,
          {
            headers: { "X-Auth-Token": token },
            signal: AbortSignal.timeout(6000),
          }
        );
        if (!res.ok) return null;
        const d = await res.json();
        const entries = d?.marketData;
        if (!entries) return null;
        const precio = entries.LA?.price || entries.CL?.price || entries.SE?.price || null;
        return precio ? { mes, grano, precio } : null;
      })
    );

    results.forEach((r) => {
      if (r.status === "fulfilled" && r.value) {
        const { mes, grano, precio } = r.value;
        if (grano === "soja") sojaData[mes] = precio;
        else maizData[mes] = precio;
      }
    });

    const sojaFinal = Object.keys(sojaData).length > 0 ? sojaData : FALLBACK.soja;
    const maizFinal = Object.keys(maizData).length > 0 ? maizData : FALLBACK.maiz;
    const source = Object.keys(sojaData).length > 0 ? "Primary_reMarkets" : "fallback_static";

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        source,
        soja: sojaFinal,
        maiz: maizFinal,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        source: "fallback_error",
        soja: FALLBACK.soja,
        maiz: FALLBACK.maiz,
        error: error.message,
        timestamp: new Date().toISOString(),
      }),
    };
  }
}
