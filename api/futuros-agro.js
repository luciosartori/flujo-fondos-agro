// api/futuros-agro.js — DEBUG: verificar permisos y símbolos exactos con marketId
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const FALLBACK = {
    soja: { "2026-07": 324, "2026-09": 331, "2026-11": 334, "2027-05": 326, "2027-07": 338 },
    maiz: { "2026-07": 178, "2026-09": 183, "2026-11": 183, "2027-01": 183, "2027-03": 183 },
  };

  const PRIMARY_USER = process.env.PRIMARY_USER;
  const PRIMARY_PASS = process.env.PRIMARY_PASS;
  const DEBUG = req.query.debug === "1";

  if (!PRIMARY_USER || !PRIMARY_PASS) {
    return res.status(200).json({ ok: true, source: "fallback_no_creds", ...FALLBACK });
  }

  try {
    const tokenRes = await fetch("https://api.remarkets.primary.com.ar/auth/getToken", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-Username": PRIMARY_USER,
        "X-Password": PRIMARY_PASS,
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!tokenRes.ok) throw new Error(`Auth HTTP ${tokenRes.status}`);
    const token = tokenRes.headers.get("X-Auth-Token");
    if (!token) throw new Error("Sin X-Auth-Token");

    // 1. Traer todos los instrumentos SIN filtro de marketId
    const allRes = await fetch(
      "https://api.remarkets.primary.com.ar/rest/instruments/all",
      { headers: { "X-Auth-Token": token }, signal: AbortSignal.timeout(15000) }
    );
    const allData = await allRes.json();
    const instruments = allData?.instruments || allData || [];

    // Extraer marketIds únicos disponibles en la cuenta
    const marketIds = [...new Set(
      instruments
        .map(i => i?.instrumentId?.marketId || i?.marketId || "")
        .filter(Boolean)
    )];

    // MAI con marketId exacto
    const maiInstruments = instruments
      .filter(i => (i?.instrumentId?.symbol || i?.symbol || "").startsWith("MAI"))
      .map(i => ({
        sym: i?.instrumentId?.symbol || i?.symbol,
        marketId: i?.instrumentId?.marketId || i?.marketId,
        cfi: i?.cficode,
      }))
      .filter(i => i.sym && i.marketId)
      .slice(0, 50);

    // SOJ con marketId exacto
    const sojInstruments = instruments
      .filter(i => (i?.instrumentId?.symbol || i?.symbol || "").startsWith("SOJ"))
      .map(i => ({
        sym: i?.instrumentId?.symbol || i?.symbol,
        marketId: i?.instrumentId?.marketId || i?.marketId,
        cfi: i?.cficode,
      }))
      .filter(i => i.sym && i.marketId)
      .slice(0, 30);

    // 2. Probar MAI.ROS/JUL26 Y SOJ.ROS/JUL26 con cada marketId disponible
    //    Entries: LA=último, SE=settlement/cierre oficial, CL=cierre anterior
    const tests = {};
    const ENTRIES = "LA,SE,CL,BI,OF";
    const TEST_SYMS = ["MAI.ROS/JUL26", "SOJ.ROS/JUL26", "MAI.ROS/SEP26", "MAI.ROS/DIC26"];

    await Promise.allSettled(
      marketIds.flatMap(mid =>
        TEST_SYMS.map(async sym => {
          try {
            const r = await fetch(
              `https://api.remarkets.primary.com.ar/rest/marketdata/get` +
              `?marketId=${mid}&symbol=${encodeURIComponent(sym)}&entries=${ENTRIES}`,
              { headers: { "X-Auth-Token": token }, signal: AbortSignal.timeout(5000) }
            );
            const d = await r.json();
            const key = `${mid}::${sym}`;
            if (d?.status === "OK" && d?.marketData) {
              const md = d.marketData;
              tests[key] = {
                OK: true,
                prices: Object.fromEntries(
                  Object.entries(md)
                    .filter(([,v]) => v?.price != null)
                    .map(([k,v]) => [k, v.price])
                ),
              };
            } else {
              tests[key] = { OK: false, desc: d?.description?.slice(0, 60) };
            }
          } catch(e) {
            tests[`${mid}::${sym}`] = { OK: false, error: e.message };
          }
        })
      )
    );

    // 3. También probar el endpoint de sesión para ver permisos
    let sessionInfo = null;
    try {
      const sessRes = await fetch(
        "https://api.remarkets.primary.com.ar/auth/validateToken",
        { headers: { "X-Auth-Token": token }, signal: AbortSignal.timeout(5000) }
      );
      sessionInfo = await sessRes.json();
    } catch(e) {
      sessionInfo = { error: e.message };
    }

    // Filtrar solo los tests que dieron OK para facilitar lectura
    const testsOK = Object.fromEntries(Object.entries(tests).filter(([,v]) => v.OK));
    const testsFail = Object.fromEntries(Object.entries(tests).filter(([,v]) => !v.OK));

    return res.status(200).json({
      ok: true,
      debug_mode: true,
      hora_servidor: new Date().toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }),
      available_market_ids: marketIds,
      tests_OK: testsOK,          // Los que funcionaron con precio
      tests_FAIL_count: Object.keys(testsFail).length,
      tests_FAIL: testsFail,      // Los que fallaron
      mai_instruments_with_marketId: maiInstruments,
      soj_instruments_with_marketId: sojInstruments,
      session_info: sessionInfo,
      soja: FALLBACK.soja,
      maiz: FALLBACK.maiz,
      source: "fallback_debug",
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
