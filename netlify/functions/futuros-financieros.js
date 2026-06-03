// netlify/functions/futuros-financieros.js
// Futuros financieros (dólar Rofex) desde Primary/reMarkets API
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

  const PRIMARY_USER = process.env.PRIMARY_USER;
  const PRIMARY_PASS = process.env.PRIMARY_PASS;

  if (!PRIMARY_USER || !PRIMARY_PASS) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: false,
        error: "Credenciales Primary no configuradas. Agregá PRIMARY_USER y PRIMARY_PASS en Netlify.",
        timestamp: new Date().toISOString(),
      }),
    };
  }

  // Tickers de dólar futuro en Primary/reMarkets
  // Formato: DLR/MES26 donde MES = ENE,FEB,MAR,ABR,MAY,JUN,JUL,AGO,SEP,OCT,NOV,DIC
  const TICKERS = {
    "2026-06": "DLR/JUN26",
    "2026-07": "DLR/JUL26",
    "2026-08": "DLR/AGO26",
    "2026-09": "DLR/SEP26",
    "2026-10": "DLR/OCT26",
    "2026-11": "DLR/NOV26",
    "2026-12": "DLR/DIC26",
    "2027-01": "DLR/ENE27",
    "2027-02": "DLR/FEB27",
    "2027-03": "DLR/MAR27",
    "2027-04": "DLR/ABR27",
    "2027-05": "DLR/MAY27",
    "2027-06": "DLR/JUN27",
    "2027-07": "DLR/JUL27",
    "2027-08": "DLR/AGO27",
    "2027-09": "DLR/SEP27",
    "2027-10": "DLR/OCT27",
    "2027-11": "DLR/NOV27",
    "2027-12": "DLR/DIC27",
  };

  try {
    // PASO 1 — Obtener token de Primary
    // El token viene en el header X-Auth-Token, no en el body
    const tokenRes = await fetch("https://api.remarkets.primary.com.ar/auth/getToken", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-Username": PRIMARY_USER,
        "X-Password": PRIMARY_PASS,
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!tokenRes.ok) {
      throw new Error(`Auth Primary HTTP ${tokenRes.status}`);
    }

    const token = tokenRes.headers.get("X-Auth-Token");
    if (!token) throw new Error("Primary no devolvió X-Auth-Token");

    // PASO 2 — Consultar todos los tickers en paralelo
    const dolarFuturo = {};

    const results = await Promise.allSettled(
      Object.entries(TICKERS).map(async ([mesKey, ticker]) => {
        const res = await fetch(
          `https://api.remarkets.primary.com.ar/rest/marketdata/get?marketId=ROFX&symbol=${encodeURIComponent(ticker)}&entries=LA,BI,OF,OP,CL,SE,OI`,
          {
            headers: {
              "X-Auth-Token": token,
              "Content-Type": "application/json",
            },
            signal: AbortSignal.timeout(6000),
          }
        );
        if (!res.ok) return null;
        const d = await res.json();
        // Buscar precio: último (LA), cierre (CL), settlement (SE)
        const entries = d?.marketData;
        if (!entries) return null;
        const precio =
          entries.LA?.price ||
          entries.CL?.price ||
          entries.SE?.price ||
          entries.BI?.price ||
          null;
        return precio ? { mesKey, precio } : null;
      })
    );

    results.forEach((r) => {
      if (r.status === "fulfilled" && r.value) {
        dolarFuturo[r.value.mesKey] = r.value.precio;
      }
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        source: "Primary_reMarkets",
        dolar_futuro: dolarFuturo,
        contratos: Object.keys(dolarFuturo).length,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      }),
    };
  }
}
