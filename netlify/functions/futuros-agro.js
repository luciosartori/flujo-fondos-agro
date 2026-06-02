// netlify/functions/futuros-agro.js
// Trae futuros agropecuarios (soja y maíz Rosario) desde IOL invertironline
// Fallback: precios estáticos de referencia de la última captura conocida

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

  const IOL_USER = process.env.IOL_USUARIO;
  const IOL_PASS = process.env.IOL_CONTRASENA;

  // Precios de referencia (captura 27/05/2026) usados como fallback
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

  // Si no hay credenciales IOL, devolver fallback
  if (!IOL_USER || !IOL_PASS) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        source: "fallback_static",
        soja: FALLBACK.soja,
        maiz: FALLBACK.maiz,
        timestamp: new Date().toISOString(),
      }),
    };
  }

  try {
    // Obtener token IOL
    const tokenRes = await fetch("https://api.invertironline.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username: IOL_USER,
        password: IOL_PASS,
        grant_type: "password",
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!tokenRes.ok) throw new Error(`Token IOL error: ${tokenRes.status}`);
    const tokenData = await tokenRes.json();
    const token = tokenData.access_token;
    if (!token) throw new Error("Sin access_token");

    // Tickers de soja y maíz Rosario en IOL (mercado ROFX)
    // Soja: SOJA + MES + AÑO, Maíz: MAIZ + MES + AÑO
    const TICKERS_SOJA = {
      "2026-05": "SOJMAY26", "2026-07": "SOJJUL26", "2026-09": "SOJSEP26",
      "2026-11": "SOJNOV26", "2027-01": "SOJENE27", "2027-03": "SOJMAR27",
      "2027-05": "SOJMAY27", "2027-07": "SOJJUL27",
    };
    const TICKERS_MAIZ = {
      "2026-05": "MAIMAY26", "2026-07": "MAIJUL26", "2026-09": "MAISEP26",
      "2026-11": "MAINOV26", "2027-01": "MAIENE27", "2027-03": "MAIMAR27",
      "2027-05": "MAIMAY27",
    };

    const fetchTicker = async (ticker) => {
      const res = await fetch(
        `https://api.invertironline.com/api/v2/ROFX/Titulos/${ticker}/Cotizacion`,
        {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          signal: AbortSignal.timeout(6000),
        }
      );
      if (!res.ok) return null;
      const d = await res.json();
      return d?.ultimoPrecio || d?.precioAjuste || d?.cierreAnterior || null;
    };

    // Consultar todos los tickers en paralelo
    const sojaData = {};
    const maizData = {};

    const [sojaResults, maizResults] = await Promise.all([
      Promise.allSettled(
        Object.entries(TICKERS_SOJA).map(async ([mes, ticker]) => ({
          mes, precio: await fetchTicker(ticker),
        }))
      ),
      Promise.allSettled(
        Object.entries(TICKERS_MAIZ).map(async ([mes, ticker]) => ({
          mes, precio: await fetchTicker(ticker),
        }))
      ),
    ]);

    sojaResults.forEach((r) => {
      if (r.status === "fulfilled" && r.value.precio)
        sojaData[r.value.mes] = r.value.precio;
    });
    maizResults.forEach((r) => {
      if (r.status === "fulfilled" && r.value.precio)
        maizData[r.value.mes] = r.value.precio;
    });

    // Si IOL devolvió datos, usarlos; si no, usar fallback
    const sojaFinal = Object.keys(sojaData).length > 0 ? sojaData : FALLBACK.soja;
    const maizFinal = Object.keys(maizData).length > 0 ? maizData : FALLBACK.maiz;
    const source = Object.keys(sojaData).length > 0 ? "IOL_invertironline" : "fallback_static";

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
    // En caso de error, devolver fallback estático
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
