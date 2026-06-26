// api/futuros-agro.js — IOL como fuente principal (precio de cámara ROFX)
// Primary reMarkets solo tiene mercado electrónico, precio distinto al de cámara
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!global._agroCache) global._agroCache = { soja: {}, maiz: {}, ts: null };

  const FALLBACK = {
    soja: { "2026-07": 329.0, "2026-09": 333.5, "2026-11": 337.7, "2027-05": 329.0, "2027-07": 335.0 },
    maiz: { "2026-07": 179.6, "2026-08": 179.0, "2026-09": 182.4, "2026-11": 181.0, "2026-12": 186.9, "2027-01": 190.0, "2027-04": 183.4, "2027-07": 179.0, "2027-09": 180.0 },
  };

  const IOL_USER = process.env.IOL_USUARIO;
  const IOL_PASS = process.env.IOL_CONTRASENA;
  const PRIMARY_USER = process.env.PRIMARY_USER;
  const PRIMARY_PASS = process.env.PRIMARY_PASS;
  const DEBUG = req.query.debug === "1";

  // Tickers IOL para ROFX — formato confirmado: SOJxxxYY / MAIxxxYY
  const MES = {
    "01":"ENE","02":"FEB","03":"MAR","04":"ABR","05":"MAY","06":"JUN",
    "07":"JUL","08":"AGO","09":"SEP","10":"OCT","11":"NOV","12":"DIC",
  };

  const CONTRATOS_SOJA = [
    "2026-07","2026-09","2026-11",
    "2027-01","2027-03","2027-05","2027-07",
  ];
  const CONTRATOS_MAIZ = [
    "2026-07","2026-08","2026-09","2026-11","2026-12",
    "2027-01","2027-04","2027-07","2027-09",
  ];

  const sojaData = {}, maizData = {};
  const debugLog = {};

  // ══════════════════════════════════════════════
  // 1. IOL — fuente principal (precio de cámara ROFX)
  // ══════════════════════════════════════════════
  if (IOL_USER && IOL_PASS) {
    try {
      const iolBody = `username=${encodeURIComponent(IOL_USER)}&password=${encodeURIComponent(IOL_PASS)}&grant_type=password`;
      const iolTokenRes = await fetch("https://api.invertironline.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: iolBody, signal: AbortSignal.timeout(10000),
      });

      if (iolTokenRes.ok) {
        const { access_token } = await iolTokenRes.json();
        if (access_token) {
          const iolFetch = async (ticker) => {
            try {
              const r = await fetch(
                `https://api.invertironline.com/api/v2/ROFX/Titulos/${ticker}/Cotizacion`,
                { headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(6000) }
              );
              if (!r.ok) return null;
              const d = await r.json();

              if (DEBUG) debugLog[`IOL:${ticker}`] = {
                ultimoPrecio:   d?.ultimoPrecio,
                precioAjuste:   d?.precioAjuste,
                variacion:      d?.variacion,
                variacionPct:   d?.variacionPorcentual,
                puntaCompradora: d?.puntaCompradora?.precio,
                puntaVendedora:  d?.puntaVendedora?.precio,
              };

              // Prioridad:
              // 1. ultimoPrecio > 0 → precio del último negocio hoy (cámara)
              // 2. Midpoint de puntas (bid/ask) → precio de mercado ahora
              // 3. precioAjuste → cierre oficial de ayer
              const ultimo = d?.ultimoPrecio > 0 ? d.ultimoPrecio : null;
              const comp   = d?.puntaCompradora?.precio;
              const vend   = d?.puntaVendedora?.precio;
              const mid    = (comp && vend) ? Math.round(((comp + vend) / 2) * 10) / 10 : null;
              const ajuste = d?.precioAjuste > 0 ? d.precioAjuste : null;

              return ultimo ?? mid ?? ajuste ?? null;
            } catch (e) {
              if (DEBUG) debugLog[`IOL:${ticker}`] = { error: e.message };
              return null;
            }
          };

          await Promise.allSettled([
            ...CONTRATOS_SOJA.map(async (mesKey) => {
              const [y, m] = mesKey.split("-");
              const p = await iolFetch(`SOJ${MES[m]}${y.slice(2)}`);
              if (p) sojaData[mesKey] = p;
            }),
            ...CONTRATOS_MAIZ.map(async (mesKey) => {
              const [y, m] = mesKey.split("-");
              const p = await iolFetch(`MAI${MES[m]}${y.slice(2)}`);
              if (p) maizData[mesKey] = p;
            }),
          ]);
        }
      }
    } catch (e) {
      if (DEBUG) debugLog["_iol_auth"] = { error: e.message };
    }
  }

  // ══════════════════════════════════════════════
  // 2. PRIMARY — solo para meses que IOL no trajo
  // Tiene mercado electrónico (precio puede diferir del de cámara)
  // ══════════════════════════════════════════════
  const sojaFaltantesPrimary = CONTRATOS_SOJA.filter(k => !sojaData[k]);
  const maizFaltantesPrimary = CONTRATOS_MAIZ.filter(k => !maizData[k]);

  if (PRIMARY_USER && PRIMARY_PASS && (sojaFaltantesPrimary.length || maizFaltantesPrimary.length)) {
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
          const PRIMARY_SOJA = {
            "2026-07":"SOJ.ROS/JUL26","2026-09":"SOJ.ROS/SEP26","2026-11":"SOJ.ROS/NOV26",
            "2027-01":"SOJ.ROS/ENE27","2027-03":"SOJ.ROS/ABR27","2027-05":"SOJ.ROS/MAY27","2027-07":"SOJ.ROS/JUL27",
          };
          const PRIMARY_MAIZ = {
            "2026-07":"MAI.ROS/JUL26","2026-09":"MAI.ROS/SEP26","2026-12":"MAI.ROS/DIC26",
            "2027-04":"MAI.ROS/ABR27","2027-07":"MAI.ROS/JUL27","2027-09":"MAI.ROS/SEP27",
          };
          const fetchPrimary = async (sym) => {
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
              const bi = md?.BI?.price, of = md?.OF?.price;
              const mid = (bi && of) ? (bi + of) / 2 : null;
              return md?.LA?.price ?? mid ?? md?.SE?.price ?? md?.CL?.price ?? null;
            } catch (e) { return null; }
          };
          await Promise.allSettled([
            ...sojaFaltantesPrimary.map(async (mesKey) => {
              const sym = PRIMARY_SOJA[mesKey]; if (!sym) return;
              const p = await fetchPrimary(sym);
              if (p) sojaData[mesKey] = p;
            }),
            ...maizFaltantesPrimary.map(async (mesKey) => {
              const sym = PRIMARY_MAIZ[mesKey]; if (!sym) return;
              const p = await fetchPrimary(sym);
              if (p) maizData[mesKey] = p;
            }),
          ]);
        }
      }
    } catch (e) { /* Primary falló */ }
  }

  // Caché en memoria
  const sojaOk = Object.keys(sojaData).length > 0;
  const maizOk = Object.keys(maizData).length > 0;
  if (sojaOk) { Object.assign(global._agroCache.soja, sojaData); global._agroCache.ts = new Date().toISOString(); }
  if (maizOk) { Object.assign(global._agroCache.maiz, maizData); global._agroCache.ts = new Date().toISOString(); }

  const cacheOk = global._agroCache.ts && Object.keys(global._agroCache.soja).length > 0;
  const sojaFuente = sojaOk ? sojaData : cacheOk ? global._agroCache.soja : null;
  const maizFuente = maizOk ? maizData : cacheOk ? global._agroCache.maiz : null;

  const sojaFinal = { ...FALLBACK.soja, ...(sojaFuente || {}) };
  const maizFinal = { ...FALLBACK.maiz, ...(maizFuente || {}) };

  const source =
    sojaOk && maizOk ? "IOL_camara" :
    sojaOk           ? "IOL(soja)+Primary(maiz)" :
    maizOk           ? "IOL(maiz)+Primary(soja)" :
    cacheOk          ? "cache_ultimo_cierre" :
    "fallback_static";

  return res.status(200).json({
    ok: true, source,
    soja: sojaFinal,
    maiz: maizFinal,
    contratos_soja: Object.keys(sojaFinal).length,
    contratos_maiz: Object.keys(maizFinal).length,
    iol_soja: Object.keys(sojaData).length,
    iol_maiz: Object.keys(maizData).length,
    cache_ts: global._agroCache.ts,
    timestamp: new Date().toISOString(),
    ...(DEBUG ? { debug: debugLog } : {}),
  });
}
