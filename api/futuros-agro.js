// api/futuros-agro.js
// IOL precioAjuste = precio de ajuste oficial ROFX (coincide con A3)
// Primary SE = precio electrónico (distinto al de cámara, no coincide con A3)
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!global._agroCache) global._agroCache = { soja:{}, maiz:{}, ts:null };

  const FALLBACK = {
    soja: {"2026-07":329.2,"2026-09":333.5,"2026-11":337.5,"2027-01":0,"2027-03":0,"2027-05":329.0,"2027-07":335.5},
    maiz: {"2026-07":179.5,"2026-08":179.0,"2026-09":182.4,"2026-11":181.0,"2026-12":187.0,"2027-01":190.0,"2027-04":183.5,"2027-07":179.0,"2027-09":180.0},
  };

  const IOL_USER = process.env.IOL_USUARIO;
  const IOL_PASS = process.env.IOL_CONTRASENA;
  const DEBUG    = req.query.debug === "1";

  const MES = {
    "01":"ENE","02":"FEB","03":"MAR","04":"ABR","05":"MAY","06":"JUN",
    "07":"JUL","08":"AGO","09":"SEP","10":"OCT","11":"NOV","12":"DIC",
  };

  const MESES_SOJA = ["2026-07","2026-09","2026-11","2027-01","2027-03","2027-05","2027-07"];
  const MESES_MAIZ = ["2026-07","2026-08","2026-09","2026-11","2026-12","2027-01","2027-04","2027-07","2027-09"];

  const sojaData = {}, maizData = {};
  const debugLog = {};

  // IOL con reintento automático si el primer token falla
  const getIOLToken = async () => {
    if (!IOL_USER || !IOL_PASS) return null;
    const body = `username=${encodeURIComponent(IOL_USER)}&password=${encodeURIComponent(IOL_PASS)}&grant_type=password`;
    for (let intento = 0; intento < 2; intento++) {
      try {
        const r = await fetch("https://api.invertironline.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body, signal: AbortSignal.timeout(10000),
        });
        if (!r.ok) { if (DEBUG) debugLog[`_iol_auth_${intento}`] = `HTTP ${r.status}`; continue; }
        const d = await r.json();
        if (d?.access_token) return d.access_token;
        if (DEBUG) debugLog[`_iol_auth_${intento}`] = d;
      } catch (e) {
        if (DEBUG) debugLog[`_iol_auth_${intento}`] = e.message;
      }
    }
    return null;
  };

  const token = await getIOLToken();

  if (token) {
    const iolFetch = async (ticker) => {
      try {
        const r = await fetch(
          `https://api.invertironline.com/api/v2/ROFX/Titulos/${ticker}/Cotizacion`,
          { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) }
        );
        if (!r.ok) return null;
        const d = await r.json();

        if (DEBUG) debugLog[`IOL:${ticker}`] = {
          ultimoPrecio:    d?.ultimoPrecio,
          precioAjuste:    d?.precioAjuste,
          variacion:       d?.variacion,
          variacionPct:    d?.variacionPorcentual,
          puntaCompradora: d?.puntaCompradora?.precio,
          puntaVendedora:  d?.puntaVendedora?.precio,
        };

        // precioAjuste = ajuste oficial ROFX publicado al cierre (lo que muestra A3)
        // ultimoPrecio = último negociado (puede ser 0 si no hubo operaciones)
        // puntas = bid/ask actuales
        const ajuste = d?.precioAjuste > 0 ? d.precioAjuste : null;
        const ultimo = d?.ultimoPrecio  > 0 ? d.ultimoPrecio  : null;
        const comp   = d?.puntaCompradora?.precio;
        const vend   = d?.puntaVendedora?.precio;
        const mid    = (comp && vend) ? Math.round(((comp+vend)/2)*10)/10 : null;

        // Prioridad:
        // 1. precioAjuste — precio oficial ROFX (coincide con A3 columna "Ajuste")
        // 2. midpoint bid/ask — precio de mercado actual
        // 3. ultimoPrecio — último negociado
        return ajuste ?? mid ?? ultimo ?? null;
      } catch (e) {
        if (DEBUG) debugLog[`IOL:${ticker}`] = { error: e.message };
        return null;
      }
    };

    await Promise.allSettled([
      ...MESES_SOJA.map(async (mesKey) => {
        const [y, m] = mesKey.split("-");
        const p = await iolFetch(`SOJ${MES[m]}${y.slice(2)}`);
        if (p && p > 0) sojaData[mesKey] = p;
      }),
      ...MESES_MAIZ.map(async (mesKey) => {
        const [y, m] = mesKey.split("-");
        const p = await iolFetch(`MAI${MES[m]}${y.slice(2)}`);
        if (p && p > 0) maizData[mesKey] = p;
      }),
    ]);
  }

  // Caché
  const sojaOk = Object.keys(sojaData).length > 0;
  const maizOk = Object.keys(maizData).length > 0;
  if (sojaOk) { Object.assign(global._agroCache.soja, sojaData); global._agroCache.ts = new Date().toISOString(); }
  if (maizOk) { Object.assign(global._agroCache.maiz, maizData); global._agroCache.ts = new Date().toISOString(); }

  const cacheOk = global._agroCache.ts && Object.keys(global._agroCache.soja).length > 0;
  const sojaFuente = sojaOk ? sojaData : cacheOk ? global._agroCache.soja : null;
  const maizFuente = maizOk ? maizData : cacheOk ? global._agroCache.maiz : null;

  const sojaFinal = { ...FALLBACK.soja, ...(sojaFuente || {}) };
  const maizFinal = { ...FALLBACK.maiz, ...(maizFuente || {}) };

  // Limpiar zeros del fallback
  Object.keys(sojaFinal).forEach(k => { if (!sojaFinal[k]) delete sojaFinal[k]; });
  Object.keys(maizFinal).forEach(k => { if (!maizFinal[k]) delete maizFinal[k]; });

  const source =
    sojaOk && maizOk ? "IOL_ajuste_oficial" :
    sojaOk           ? "IOL(soja)+fallback(maiz)" :
    maizOk           ? "IOL(maiz)+fallback(soja)" :
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
    iol_token: token ? "OK" : "FAILED",
    cache_ts: global._agroCache.ts,
    timestamp: new Date().toISOString(),
    ...(DEBUG ? { debug: debugLog } : {}),
  });
}
