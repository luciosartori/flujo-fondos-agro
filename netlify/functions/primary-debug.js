// netlify/functions/primary-debug.js
// Diagnóstico: lista todos los instrumentos de soja y maíz disponibles en Primary reMarkets
// BORRAR después de usar

export async function handler(event, context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  const PRIMARY_USER = process.env.PRIMARY_USER;
  const PRIMARY_PASS = process.env.PRIMARY_PASS;

  if (!PRIMARY_USER || !PRIMARY_PASS) {
    return { statusCode: 200, headers, body: JSON.stringify({ error: "Sin credenciales" }) };
  }

  try {
    // Token
    const tokenRes = await fetch("https://api.remarkets.primary.com.ar/auth/getToken", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-Username": PRIMARY_USER,
        "X-Password": PRIMARY_PASS,
      },
      signal: AbortSignal.timeout(8000),
    });
    const token = tokenRes.headers.get("X-Auth-Token");
    if (!token) throw new Error("Sin token");

    const resultados = {};

    // Probar tickers de soja con distintos formatos
    const tickersSoja = [
      "SOJ.ROS/JUL26","SOJ.ROS/SEP26","SOJ.ROS/NOV26","SOJ.ROS/ENE27","SOJ.ROS/MAR27","SOJ.ROS/MAY27","SOJ.ROS/JUL27",
      "SOJA/JUL26","SOJA/SEP26","SOJA.ROS/JUL26",
      "SRO/JUL26","SRO/SEP26",
    ];
    const tickersMaiz = [
      "MAI.ROS/JUL26","MAI.ROS/SEP26","MAI.ROS/NOV26","MAI.ROS/ENE27","MAI.ROS/MAR27","MAI.ROS/MAY27",
      "MAIZ/JUL26","MAIZ.ROS/JUL26",
      "MRO/JUL26","MRO/SEP26",
    ];

    const probar = async (ticker) => {
      try {
        const r = await fetch(
          `https://api.remarkets.primary.com.ar/rest/marketdata/get?marketId=ROFX&symbol=${encodeURIComponent(ticker)}&entries=LA,CL,SE,BI`,
          { headers: { "X-Auth-Token": token }, signal: AbortSignal.timeout(5000) }
        );
        if (!r.ok) return { status: r.status, data: null };
        const d = await r.json();
        const precio = d?.marketData?.LA?.price || d?.marketData?.CL?.price || d?.marketData?.SE?.price || null;
        return { status: r.status, precio, raw: JSON.stringify(d).slice(0, 200) };
      } catch(e) {
        return { error: e.message };
      }
    };

    // Probar todos en paralelo
    const [resSoja, resMaiz] = await Promise.all([
      Promise.all(tickersSoja.map(async t => ({ ticker: t, ...(await probar(t)) }))),
      Promise.all(tickersMaiz.map(async t => ({ ticker: t, ...(await probar(t)) }))),
    ]);

    resultados.soja = resSoja;
    resultados.maiz = resMaiz;

    // Filtrar los que funcionaron
    resultados.soja_ok = resSoja.filter(r => r.precio != null).map(r => `${r.ticker} = ${r.precio}`);
    resultados.maiz_ok = resMaiz.filter(r => r.precio != null).map(r => `${r.ticker} = ${r.precio}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(resultados, null, 2),
    };
  } catch (error) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
}
