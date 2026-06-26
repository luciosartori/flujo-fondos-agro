// api/futuros-agro.js
// Fuente: Primary reMarkets (precio electrónico ROFX)
// Nota: precio puede diferir ~1-2 U$S del precio de cámara de A3
// IOL no tiene futuros agropecuarios en su API
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!global._agroCache) global._agroCache = { soja:{}, maiz:{}, ts:null };

  const FALLBACK = {
    soja: { "2026-07":329.2,"2026-09":333.5,"2026-11":337.5,"2027-05":329.0,"2027-07":335.5 },
    maiz: { "2026-07":179.5,"2026-08":179.0,"2026-09":182.4,"2026-11":181.0,"2026-12":187.0,"2027-01":190.0,"2027-04":183.5,"2027-07":179.0,"2027-09":180.0 },
  };

  const PRIMARY_USER = process.env.PRIMARY_USER;
  const PRIMARY_PASS = process.env.PRIMARY_PASS;
  const DEBUG = req.query.debug === "1";

  const CONTRATOS_SOJA = {
    "2026-07":"SOJ.ROS/JUL26",
    "2026-09":"SOJ.ROS/SEP26",
    "2026-11":"SOJ.ROS/NOV26",
    "2027-01":"SOJ.ROS/ENE27",
    "2027-03":"SOJ.ROS/ABR27",
    "2027-05":"SOJ.ROS/MAY27",
    "2027-07":"SOJ.ROS/JUL27",
  };
  const CONTRATOS_MAIZ = {
    "2026-07":"MAI.ROS/JUL26",
    "2026-09":"MAI.ROS/SEP26",
    "2026-12":"MAI.ROS/DIC26",
    "2027-04":"MAI.ROS/ABR27",
    "2027-07":"MAI.ROS/JUL27",
    "2027-09":"MAI.ROS/SEP27",
  };

  const sojaData = {}, maizData = {};
  const debugLog = {};

  if (PRIMARY_USER && PRIMARY_PASS) {
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

      if (tokenRes.ok) {
        const token = tokenRes.headers.get("X-Auth-Token");
        if (token) {
          const fetchSym = async (sym) => {
            try {
              const r = await fetch(
                `https://api.remarkets.primary.com.ar/rest/marketdata/get` +
                `?marketId=ROFX&symbol=${encodeURIComponent(sym)}&entries=LA,SE,CL,BI,OF`,
                { headers: { "X-Auth-Token": token }, signal: AbortSignal.timeout(7000) }
              );
              if (!r.ok) return null;
              const d = await r.json();
              if (d?.status === "ERROR") return null;
              const md = d?.marketData;
              if (!md) return null;

              const la = md?.LA?.price;
              const se = md?.SE?.price;
              const cl = md?.CL?.price;
              const bi = md?.BI?.price;
              const of = md?.OF?.price;
              const mid = (bi && of) ? Math.round(((bi+of)/2)*10)/10 : null;

              if (DEBUG) debugLog[sym] = { la, se, cl, bi, of, mid };

              // Durante mercado: LA o midpoint bid/offer
              // Fuera de mercado: SE (precio de ajuste del último cierre)
              return la ?? mid ?? se ?? cl ?? null;
            } catch(e) {
              if (DEBUG) debugLog[sym] = { error: e.message };
              return null;
            }
          };

          await Promise.allSettled([
            ...Object.entries(CONTRATOS_SOJA).map(async ([mesKey, sym]) => {
              const p = await fetchSym(sym);
              if (p && p > 0) sojaData[mesKey] = p;
            }),
            ...Object.entries(CONTRATOS_MAIZ).map(async ([mesKey, sym]) => {
              const p = await fetchSym(sym);
              if (p && p > 0) maizData[mesKey] = p;
            }),
          ]);
        }
      }
    } catch(e) {
      if (DEBUG) debugLog["_auth"] = { error: e.message };
    }
  }

  // Guardar en caché lo que llegó (para servir fuera de horario)
  const sojaOk = Object.keys(sojaData).length > 0;
  const maizOk = Object.keys(maizData).length > 0;
  if (sojaOk) { Object.assign(global._agroCache.soja, sojaData); global._agroCache.ts = new Date().toISOString(); }
  if (maizOk) { Object.assign(global._agroCache.maiz, maizData); global._agroCache.ts = new Date().toISOString(); }

  // Fuera de horario: usar caché del último cierre
  const cacheOk = global._agroCache.ts && Object.keys(global._agroCache.soja).length > 0;
  const sojaFuente = sojaOk ? sojaData : cacheOk ? global._agroCache.soja : null;
  const maizFuente = maizOk ? maizData : cacheOk ? global._agroCache.maiz : null;

  // Merge: fallback base → caché/live encima
  const sojaFinal = { ...FALLBACK.soja, ...(sojaFuente || {}) };
  const maizFinal = { ...FALLBACK.maiz, ...(maizFuente || {}) };

  const source =
    sojaOk && maizOk ? "Primary_reMarkets" :
    sojaOk           ? "Primary(soja)+fallback(maiz)" :
    maizOk           ? "Primary(maiz)+fallback(soja)" :
    cacheOk          ? "cache_ultimo_cierre" :
    "fallback_static";

  return res.status(200).json({
    ok: true, source,
    soja: sojaFinal,
    maiz: maizFinal,
    contratos_soja: Object.keys(sojaFinal).length,
    contratos_maiz: Object.keys(maizFinal).length,
    primary_soja: Object.keys(sojaData).length,
    primary_maiz: Object.keys(maizData).length,
    cache_ts: global._agroCache.ts,
    timestamp: new Date().toISOString(),
    ...(DEBUG ? { debug: debugLog } : {}),
  });
}
