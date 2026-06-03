// netlify/functions/futuros-iol.js
// Proxy para futuros financieros (dólar Rofex) desde IOL invertironline
// Estrategia: 1 llamada al panel completo → mucho más rápido que tickers individuales

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

  if (!IOL_USER || !IOL_PASS) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: false,
        error: "Credenciales IOL no configuradas.",
        timestamp: new Date().toISOString(),
      }),
    };
  }

  // Mapeo de ticker IOL → clave YYYY-MM
  // Formato IOL para dólar futuro: DO + MES3 + AÑO2
  const TICKER_MAP = {
    "DOJUN26": "2026-06", "DOJUL26": "2026-07", "DOAGO26": "2026-08",
    "DOSEP26": "2026-09", "DOOCT26": "2026-10", "DONOV26": "2026-11",
    "DODIC26": "2026-12", "DOENE27": "2027-01", "DOFEB27": "2027-02",
    "DOMAR27": "2027-03", "DOABR27": "2027-04", "DOMAY27": "2027-05",
    "DOJUN27": "2027-06", "DOJUL27": "2027-07", "DOAGO27": "2027-08",
    "DOSEP27": "2027-09", "DOOCT27": "2027-10", "DONOV27": "2027-11",
    "DODIC27": "2027-12",
  };

  // Solo los 6 vencimientos más próximos para evitar timeout
  const TICKERS_PRIORITARIOS = [
    "DOJUN26","DOJUL26","DOAGO26","DOSEP26","DOOCT26","DONOV26","DODIC26",
    "DOENE27","DOFEB27","DOMAR27","DOABR27","DOMAY27",
  ];

  try {
    // PASO 1 — Token IOL
    const tokenRes = await fetch("https://api.invertironline.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username: IOL_USER,
        password: IOL_PASS,
        grant_type: "password",
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!tokenRes.ok) {
      throw new Error(`Token IOL HTTP ${tokenRes.status}`);
    }
    const tokenData = await tokenRes.json();
    const token = tokenData.access_token;
    if (!token) throw new Error("Sin access_token de IOL");

    const dolarFuturo = {};

    // PASO 2A — Intentar con el panel de futuros (1 sola llamada, muy eficiente)
    try {
      const panelRes = await fetch(
        "https://api.invertironline.com/api/v2/ROFX/Titulos/Panel/futuros_dolar",
        {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          signal: AbortSignal.timeout(6000),
        }
      );
      if (panelRes.ok) {
        const panel = await panelRes.json();
        // El panel puede venir como array directo o como { titulos: [...] }
        const lista = Array.isArray(panel) ? panel : (panel?.titulos || panel?.instrumentos || []);
        lista.forEach((t) => {
          const sym = (t.simbolo || t.ticker || t.instrumento || "").toUpperCase().trim();
          const mesKey = TICKER_MAP[sym];
          if (mesKey) {
            const precio = t.ultimoPrecio || t.precioAjuste || t.ultimo || t.price || null;
            if (precio && precio > 0) dolarFuturo[mesKey] = precio;
          }
        });
      }
    } catch (e) { /* panel no disponible, continúa */ }

    // PASO 2B — Si el panel no trajo datos, consultar tickers individuales (todos en paralelo)
    if (Object.keys(dolarFuturo).length === 0) {
      const results = await Promise.allSettled(
        TICKERS_PRIORITARIOS.map(async (ticker) => {
          const res = await fetch(
            `https://api.invertironline.com/api/v2/ROFX/Titulos/${ticker}/Cotizacion`,
            {
              headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
              signal: AbortSignal.timeout(5000),
            }
          );
          if (!res.ok) return null;
          const d = await res.json();
          const precio = d?.ultimoPrecio || d?.precioAjuste || d?.cierreAnterior || null;
          return precio ? { ticker, precio } : null;
        })
      );

      results.forEach((r) => {
        if (r.status === "fulfilled" && r.value) {
          const mesKey = TICKER_MAP[r.value.ticker];
          if (mesKey) dolarFuturo[mesKey] = r.value.precio;
        }
      });
    }

    // PASO 2C — Si sigue vacío, intentar endpoint alternativo de cotizacion
    if (Object.keys(dolarFuturo).length === 0) {
      const results2 = await Promise.allSettled(
        TICKERS_PRIORITARIOS.slice(0, 6).map(async (ticker) => {
          const res = await fetch(
            `https://api.invertironline.com/api/v2/Titulos/ROFX/${ticker}/Cotizacion`,
            {
              headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
              signal: AbortSignal.timeout(5000),
            }
          );
          if (!res.ok) return null;
          const d = await res.json();
          const precio = d?.ultimoPrecio || d?.precioAjuste || d?.cierreAnterior || null;
          return precio ? { ticker, precio } : null;
        })
      );
      results2.forEach((r) => {
        if (r.status === "fulfilled" && r.value) {
          const mesKey = TICKER_MAP[r.value.ticker];
          if (mesKey) dolarFuturo[mesKey] = r.value.precio;
        }
      });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        source: "IOL_invertironline",
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
