// netlify/functions/futuros-agro.js
// Trae futuros agropecuarios (soja y maíz Rosario) desde IOL invertironline

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

  const IOL_USER = process.env.IOL_USUARIO;
  const IOL_PASS = process.env.IOL_CONTRASENA;

  if (!IOL_USER || !IOL_PASS) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, source: "fallback_static", ...FALLBACK, timestamp: new Date().toISOString() }),
    };
  }

  // Tickers IOL para soja y maíz Rosario (mercado ROFX)
  const TICKER_MAP_SOJA = {
    "SOJJUL26": "2026-07", "SOJSEP26": "2026-09", "SOJNOV26": "2026-11",
    "SOJENE27": "2027-01", "SOJMAR27": "2027-03", "SOJMAY27": "2027-05", "SOJJUL27": "2027-07",
  };
  const TICKER_MAP_MAIZ = {
    "MAIJUL26": "2026-07", "MAISEP26": "2026-09", "MAINOV26": "2026-11",
    "MAIENE27": "2027-01", "MAIMAR27": "2027-03", "MAIMAY27": "2027-05",
  };

  try {
    // Token IOL
    const tokenRes = await fetch("https://api.invertironline.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: IOL_USER, password: IOL_PASS, grant_type: "password" }),
      signal: AbortSignal.timeout(8000),
    });
    if (!tokenRes.ok) throw new Error(`Token HTTP ${tokenRes.status}`);
    const { access_token: token } = await tokenRes.json();
    if (!token) throw new Error("Sin access_token");

    const sojaData = {};
    const maizData = {};
    const debug = [];

    // Intentar panel de soja y maíz primero
    for (const [panelName, tickerMap, dataObj] of [
      ["futuros_soja", TICKER_MAP_SOJA, sojaData],
      ["futuros_maiz", TICKER_MAP_MAIZ, maizData],
    ]) {
      try {
        const res = await fetch(
          `https://api.invertironline.com/api/v2/ROFX/Titulos/Panel/${panelName}`,
          { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) }
        );
        if (res.ok) {
          const panel = await res.json();
          const lista = Array.isArray(panel) ? panel : (panel?.titulos || panel?.instrumentos || []);
          debug.push(`panel ${panelName}: ${lista.length} items`);
          lista.forEach((t) => {
            const sym = (t.simbolo || t.ticker || "").toUpperCase().trim();
            const mesKey = tickerMap[sym];
            if (mesKey) {
              const precio = t.ultimoPrecio || t.precioAjuste || t.ultimo || null;
              if (precio > 0) dataObj[mesKey] = precio;
            }
          });
        }
      } catch (e) { debug.push(`panel ${panelName} error: ${e.message}`); }
    }

    // Si los paneles no trajeron datos, tickers individuales todos en paralelo
    if (Object.keys(sojaData).length === 0 && Object.keys(maizData).length === 0) {
      const allTickers = [
        ...Object.keys(TICKER_MAP_SOJA).map(t => ({ t, grano: 'soja', map: TICKER_MAP_SOJA })),
        ...Object.keys(TICKER_MAP_MAIZ).map(t => ({ t, grano: 'maiz', map: TICKER_MAP_MAIZ })),
      ];

      const results = await Promise.allSettled(
        allTickers.map(async ({ t, grano, map }) => {
          const res = await fetch(
            `https://api.invertironline.com/api/v2/ROFX/Titulos/${t}/Cotizacion`,
            { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) }
          );
          if (!res.ok) return null;
          const d = await res.json();
          const precio = d?.ultimoPrecio || d?.precioAjuste || d?.cierreAnterior || null;
          return precio ? { t, grano, mesKey: map[t], precio } : null;
        })
      );

      results.forEach(r => {
        if (r.status === "fulfilled" && r.value) {
          const { grano, mesKey, precio } = r.value;
          if (grano === 'soja') sojaData[mesKey] = precio;
          else maizData[mesKey] = precio;
        }
      });
    }

    const sojaFinal = Object.keys(sojaData).length > 0 ? sojaData : FALLBACK.soja;
    const maizFinal = Object.keys(maizData).length > 0 ? maizData : FALLBACK.maiz;
    const source = Object.keys(sojaData).length > 0 ? "IOL_invertironline" : "fallback_static";

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true, source,
        soja: sojaFinal, maiz: maizFinal,
        debug,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true, source: "fallback_error",
        soja: FALLBACK.soja, maiz: FALLBACK.maiz,
        error: error.message,
        timestamp: new Date().toISOString(),
      }),
    };
  }
}
