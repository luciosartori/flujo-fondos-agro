// netlify/functions/iol-agro-debug.js
// Diagnóstico: encuentra los tickers exactos de soja y maíz en IOL/ROFX
// BORRAR después de usar

export async function handler(event, context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  const IOL_USER = process.env.IOL_USUARIO;
  const IOL_PASS = process.env.IOL_CONTRASENA;

  if (!IOL_USER || !IOL_PASS) {
    return { statusCode: 200, headers, body: JSON.stringify({ error: "Sin credenciales IOL" }) };
  }

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

    const probar = async (ticker) => {
      try {
        const r = await fetch(
          `https://api.invertironline.com/api/v2/ROFX/Titulos/${ticker}/Cotizacion`,
          { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(6000) }
        );
        if (!r.ok) return { status: r.status, error: `HTTP ${r.status}` };
        const d = await r.json();
        // Mostrar toda la estructura para entender qué campos vienen
        const precio = d?.ultimoPrecio || d?.precioAjuste || d?.cierreAnterior || null;
        return {
          status: r.status,
          precio,
          ultimoPrecio: d?.ultimoPrecio,
          precioAjuste: d?.precioAjuste,
          cierreAnterior: d?.cierreAnterior,
          raw: JSON.stringify(d).slice(0, 300),
        };
      } catch (e) {
        return { error: e.message };
      }
    };

    // Tickers posibles para soja en IOL/ROFX
    // Formato A: SOJ + MES3 + AÑO2  (igual que DLR)
    // Formato B: SOJA + MES3 + AÑO2
    // Formato C: como aparece en A3: SOJ.ROS/JUL26 → IOL podría ser SOJROS + MES
    const MESES = ['JUN','JUL','AGO','SEP','OCT','NOV','DIC','ENE','FEB','MAR','ABR','MAY'];
    const ANOS = ['26','27'];

    const tickersSoja = [];
    const tickersMaiz = [];
    for (const ano of ANOS) {
      for (const mes of MESES) {
        tickersSoja.push(`SOJ${mes}${ano}`);
        tickersMaiz.push(`MAI${mes}${ano}`);
      }
    }

    // También probar formatos alternativos para JUL26
    const extras = [
      'SOJJUL26','SOJROS JUL26','SOJAROS JUL26',
      'MAI JUL26','MAIJUL26','MAIZJUL26',
      'MSOJJUL26','MMAIJUL26',
    ];

    // Probar todos en paralelo (soja y maíz JUL26 y SEP26 para encontrar formato)
    const tickersPrueba = [
      ...tickersSoja.filter(t => t.includes('JUL26') || t.includes('SEP26') || t.includes('NOV26')),
      ...tickersMaiz.filter(t => t.includes('JUL26') || t.includes('SEP26') || t.includes('NOV26')),
      ...extras,
    ];

    const results = await Promise.allSettled(
      tickersPrueba.map(async t => ({ ticker: t, ...(await probar(t)) }))
    );

    const todos = results.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason?.message });
    const funcionan = todos.filter(r => r.precio != null);
    const conAjuste = todos.filter(r => r.precioAjuste != null);

    // Si no encontramos con formato A, intentar listar el panel de futuros agro
    let panel = null;
    try {
      const panelRes = await fetch(
        'https://api.invertironline.com/api/v2/ROFX/Titulos/Panel/futuros_agropecuarios',
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) }
      );
      if (panelRes.ok) {
        const pd = await panelRes.json();
        panel = { status: panelRes.status, muestra: JSON.stringify(pd).slice(0, 800) };
      } else {
        panel = { status: panelRes.status };
      }
    } catch (e) { panel = { error: e.message }; }

    // Intentar también panel genérico
    let panelGen = null;
    try {
      const r = await fetch(
        'https://api.invertironline.com/api/v2/ROFX/Titulos/Panel/futuros_granos',
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) }
      );
      panelGen = { status: r.status, muestra: r.ok ? JSON.stringify(await r.json()).slice(0,500) : '' };
    } catch(e) { panelGen = { error: e.message }; }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        token_ok: true,
        tickers_que_funcionan: funcionan.map(r => `${r.ticker} → precio: ${r.precio}, ajuste: ${r.precioAjuste}`),
        tickers_con_ajuste: conAjuste.map(r => `${r.ticker} → ajuste: ${r.precioAjuste}`),
        panel_futuros_agropecuarios: panel,
        panel_futuros_granos: panelGen,
        detalle_completo: todos,
      }, null, 2),
    };
  } catch (error) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: false, error: error.message }),
    };
  }
}
