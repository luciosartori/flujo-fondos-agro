// netlify/functions/futuros-iol.js
// Proxy para traer futuros financieros (dólar Rofex) desde IOL invertironline
// Las credenciales se guardan como variables de entorno en Netlify (nunca en el código)

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

  // Credenciales desde variables de entorno de Netlify
  const IOL_USER = process.env.IOL_USUARIO;
  const IOL_PASS = process.env.IOL_CONTRASENA;

  if (!IOL_USER || !IOL_PASS) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: false,
        error: "Credenciales IOL no configuradas en Netlify",
        timestamp: new Date().toISOString(),
      }),
    };
  }

  try {
    // PASO 1 — Obtener bearer token de IOL
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

    if (!tokenRes.ok) {
      throw new Error(`Token IOL error: ${tokenRes.status}`);
    }

    const tokenData = await tokenRes.json();
    const bearerToken = tokenData.access_token;

    if (!bearerToken) {
      throw new Error("No se obtuvo access_token de IOL");
    }

    // PASO 2 — Consultar panel de futuros ROFX (dólar futuro)
    // Tickers de dólar futuro en IOL: DOJUN26, DOJUL26, DOAGO26, etc.
    // Formato: DO + 3 letras mes en español + 2 dígitos año
    const MESES_IOL = {
      "2026-06": "DOJUN26", "2026-07": "DOJUL26", "2026-08": "DOAGO26",
      "2026-09": "DOSEP26", "2026-10": "DOOCT26", "2026-11": "DONOV26",
      "2026-12": "DODIC26", "2027-01": "DOENE27", "2027-02": "DOFEB27",
      "2027-03": "DOMAR27", "2027-04": "DOABR27", "2027-05": "DOMAY27",
      "2027-06": "DOJUN27", "2027-07": "DOJUL27", "2027-08": "DOAGO27",
      "2027-09": "DOSEP27", "2027-10": "DOOCT27", "2027-11": "DONOV27",
      "2027-12": "DODIC27",
    };

    const dolarFuturo = {};
    const errores = [];

    // Consultar cada vencimiento en paralelo (máximo 6 a la vez para no saturar)
    const entries = Object.entries(MESES_IOL);
    const BATCH = 6;

    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map(async ([mesKey, ticker]) => {
          const res = await fetch(
            `https://api.invertironline.com/api/v2/ROFX/Titulos/${ticker}/Cotizacion`,
            {
              headers: {
                Authorization: `Bearer ${bearerToken}`,
                Accept: "application/json",
              },
              signal: AbortSignal.timeout(8000),
            }
          );
          if (!res.ok) throw new Error(`${ticker}: HTTP ${res.status}`);
          const data = await res.json();
          // El precio de ajuste o último precio disponible
          const precio =
            data?.ultimoPrecio ||
            data?.precioAjuste ||
            data?.cierreAnterior ||
            null;
          return { mesKey, ticker, precio };
        })
      );

      results.forEach((r) => {
        if (r.status === "fulfilled" && r.value.precio) {
          dolarFuturo[r.value.mesKey] = r.value.precio;
        } else if (r.status === "rejected") {
          errores.push(r.reason?.message || "error desconocido");
        }
      });
    }

    // PASO 3 — Intentar también el panel completo de futuros como alternativa
    if (Object.keys(dolarFuturo).length === 0) {
      try {
        const panelRes = await fetch(
          "https://api.invertironline.com/api/v2/ROFX/Titulos/Panel/futuros_dolar",
          {
            headers: {
              Authorization: `Bearer ${bearerToken}`,
              Accept: "application/json",
            },
            signal: AbortSignal.timeout(8000),
          }
        );
        if (panelRes.ok) {
          const panelData = await panelRes.json();
          // Parsear según estructura de respuesta del panel
          if (Array.isArray(panelData?.titulos)) {
            panelData.titulos.forEach((t) => {
              const sym = t.simbolo || t.ticker || "";
              // Mapear ticker a mes
              const found = Object.entries(MESES_IOL).find(
                ([, tk]) => tk === sym
              );
              if (found && (t.ultimoPrecio || t.precioAjuste)) {
                dolarFuturo[found[0]] =
                  t.ultimoPrecio || t.precioAjuste;
              }
            });
          }
        }
      } catch (e) {
        errores.push("panel: " + e.message);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        source: "IOL_invertironline",
        dolar_futuro: dolarFuturo,
        contratos: Object.keys(dolarFuturo).length,
        errores: errores.length > 0 ? errores : undefined,
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
