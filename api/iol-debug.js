// api/iol-debug.js — Buscar formato correcto de tickers en IOL
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const IOL_USER = process.env.IOL_USUARIO;
  const IOL_PASS = process.env.IOL_CONTRASENA || process.env.IOL_CONSTRASENA;

  if (!IOL_USER || !IOL_PASS) {
    return res.status(200).json({ error: "Sin credenciales" });
  }

  // Auth
  const body = `username=${encodeURIComponent(IOL_USER)}&password=${encodeURIComponent(IOL_PASS)}&grant_type=password`;
  const tkRes = await fetch("https://api.invertironline.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body, signal: AbortSignal.timeout(10000),
  });
  const { access_token } = await tkRes.json();
  if (!access_token) return res.status(200).json({ error: "Token fallido" });

  const headers = { Authorization: `Bearer ${access_token}` };

  // Probar múltiples formatos de ticker para soja julio 2026
  const tickersTest = [
    // Formato corto
    "SOJJUL26", "SOJ/JUL26", "SOJ-JUL26",
    // Con año completo
    "SOJJUL2026",
    // Formato IOL conocido para acciones (puede ser diferente para futuros)
    "SOJ0726", "SOJA0726",
    // Formato ROFX estándar
    "SOJ.ROS/JUL26",
    // Otros
    "ROSASOJ26JUL", "SOJROS26JUL",
  ];

  const results = {};
  await Promise.allSettled(
    tickersTest.map(async (ticker) => {
      try {
        // Probar con mercado ROFX
        const r1 = await fetch(
          `https://api.invertironline.com/api/v2/ROFX/Titulos/${ticker}/Cotizacion`,
          { headers, signal: AbortSignal.timeout(5000) }
        );
        results[`ROFX/${ticker}`] = {
          status: r1.status,
          data: r1.status === 200 ? await r1.json() : await r1.text().then(t=>t.slice(0,100)),
        };
      } catch(e) {
        results[`ROFX/${ticker}`] = { error: e.message };
      }
    })
  );

  // También buscar en el listado de instrumentos de ROFX
  let instrumentSearch = null;
  try {
    const r = await fetch(
      "https://api.invertironline.com/api/v2/ROFX/Titulos/SOJJUL26/Cotizacion",
      { headers, signal: AbortSignal.timeout(5000) }
    );
    // Si da 404, buscar por búsqueda
    const r2 = await fetch(
      "https://api.invertironline.com/api/v2/Titulos/Buscar?mercado=ROFX&texto=SOJ",
      { headers, signal: AbortSignal.timeout(8000) }
    );
    if (r2.ok) {
      const data = await r2.json();
      instrumentSearch = Array.isArray(data) ? data.slice(0,20) : data;
    } else {
      instrumentSearch = { status: r2.status, text: await r2.text().then(t=>t.slice(0,200)) };
    }
  } catch(e) {
    instrumentSearch = { error: e.message };
  }

  // Buscar también con endpoint de opciones/futuros
  let futuroSearch = null;
  try {
    const r = await fetch(
      "https://api.invertironline.com/api/v2/ROFX/Titulos/Cotizaciones?tipo=FUTUROS&paginaSize=50",
      { headers, signal: AbortSignal.timeout(8000) }
    );
    if (r.ok) {
      const d = await r.json();
      // Filtrar solo SOJ y MAI
      const items = (Array.isArray(d) ? d : d?.titulos || d?.items || [])
        .filter(t => {
          const s = (t?.simbolo || t?.ticker || t?.symbol || JSON.stringify(t)).toUpperCase();
          return s.includes('SOJ') || s.includes('MAI');
        }).slice(0,30);
      futuroSearch = { total_soj_mai: items.length, items };
    } else {
      futuroSearch = { status: r.status };
    }
  } catch(e) {
    futuroSearch = { error: e.message };
  }

  return res.status(200).json({
    token_ok: true,
    ticker_tests: results,
    instrument_search: instrumentSearch,
    futuro_search: futuroSearch,
    timestamp: new Date().toISOString(),
  });
}
