// api/futuros-agro.js
// Fuentes:
// 1. DURANTE MERCADO (10-18hs ARG): Primary reMarkets — precio electrónico ROFX (~1-2 U$S diff)
// 2. AL CIERRE / FUERA HORARIO: Scraper del Visor de Precios de MATBA-ROFEX — precio ajuste oficial
// 3. Caché en memoria — sirve último precio conocido si ambas fuentes fallan
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!global._agroCache) global._agroCache = { soja:{}, maiz:{}, ts:null, source:null };

  const FALLBACK = {
    soja: {"2026-07":329.2,"2026-09":333.5,"2026-11":337.5,"2027-05":329.0,"2027-07":335.5},
    maiz: {"2026-07":179.5,"2026-08":179.0,"2026-09":182.4,"2026-11":181.0,"2026-12":187.0,"2027-01":190.0,"2027-04":183.5,"2027-07":179.0,"2027-09":180.0},
  };

  const PRIMARY_USER = process.env.PRIMARY_USER;
  const PRIMARY_PASS = process.env.PRIMARY_PASS;
  const DEBUG = req.query.debug === "1";
  const debugLog = {};

  // Detectar si mercado está abierto (10:00-18:00 ARG = 13:00-21:00 UTC)
  const utcH = new Date().getUTCHours();
  const utcM = new Date().getUTCMinutes();
  const utcMin = utcH * 60 + utcM;
  const marketOpen  = 13 * 60;  // 13:00 UTC = 10:00 ARG
  const marketClose = 21 * 60;  // 21:00 UTC = 18:00 ARG
  const isMarketOpen = utcMin >= marketOpen && utcMin < marketClose;
  const isWeekday = new Date().getUTCDay() >= 1 && new Date().getUTCDay() <= 5;
  const mercadoAbierto = isMarketOpen && isWeekday;

  if (DEBUG) debugLog._horario = {
    utcH, utcM, mercadoAbierto,
    mensaje: mercadoAbierto ? "Mercado abierto — usando Primary" : "Mercado cerrado — usando scraper MATBA-ROFEX"
  };

  const sojaData = {}, maizData = {};

  // ══════════════════════════════════════════════
  // FUENTE 1: SCRAPER MATBA-ROFEX (precio de ajuste oficial)
  // Disponible siempre, se actualiza al cierre de cada rueda
  // URL del visor público de precios
  // ══════════════════════════════════════════════
  const scrapeMATBA = async () => {
    try {
      // Intentar endpoint de estadísticas públicas de MATBA-ROFEX
      // El visor de precios carga datos desde una API interna
      const urls = [
        "https://www.matbarofex.com.ar/visor-de-precios",
        "https://www.matbarofex.com.ar/estadistica-de-mercado",
      ];

      // Intentar el endpoint de datos JSON que usa el visor
      const apiAttempts = [
        "https://www.matbarofex.com.ar/api/v1/prices/agricultural",
        "https://www.matbarofex.com.ar/api/prices",
        "https://api.matbarofex.com.ar/v1/prices",
        "https://www.matbarofex.com.ar/cem/api/prices",
      ];

      for (const url of apiAttempts) {
        try {
          const r = await fetch(url, {
            headers: {
              "Accept": "application/json",
              "User-Agent": "Mozilla/5.0 (compatible; FlujoFondosAgro/1.0)",
            },
            signal: AbortSignal.timeout(8000),
          });
          if (r.ok) {
            const ct = r.headers.get("content-type") || "";
            if (ct.includes("json")) {
              const d = await r.json();
              if (DEBUG) debugLog[`matba_api_${url}`] = { ok: true, keys: Object.keys(d).slice(0,10) };
              return d;
            }
          }
          if (DEBUG) debugLog[`matba_api_${url}`] = { status: r.status };
        } catch(e) {
          if (DEBUG) debugLog[`matba_api_${url}`] = { error: e.message };
        }
      }

      // Si no hay API JSON, scrapear HTML del visor
      const r = await fetch("https://www.matbarofex.com.ar/visor-de-precios", {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) return null;
      const html = await r.text();
      if (DEBUG) debugLog["matba_html_length"] = html.length;
      if (DEBUG) debugLog["matba_html_sample"] = html.slice(0, 500);
      return { html };
    } catch(e) {
      if (DEBUG) debugLog["matba_scraper_error"] = e.message;
      return null;
    }
  };

  // ══════════════════════════════════════════════
  // FUENTE 2: PRIMARY reMarkets (precio electrónico)
  // Mejor durante horario de mercado
  // ══════════════════════════════════════════════
  const fetchPrimary = async () => {
    if (!PRIMARY_USER || !PRIMARY_PASS) return;
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
      if (!tokenRes.ok) return;
      const token = tokenRes.headers.get("X-Auth-Token");
      if (!token) return;

      const CONTRATOS = {
        soja: {"2026-07":"SOJ.ROS/JUL26","2026-09":"SOJ.ROS/SEP26","2026-11":"SOJ.ROS/NOV26",
               "2027-01":"SOJ.ROS/ENE27","2027-03":"SOJ.ROS/ABR27","2027-05":"SOJ.ROS/MAY27","2027-07":"SOJ.ROS/JUL27"},
        maiz: {"2026-07":"MAI.ROS/JUL26","2026-09":"MAI.ROS/SEP26","2026-12":"MAI.ROS/DIC26",
               "2027-04":"MAI.ROS/ABR27","2027-07":"MAI.ROS/JUL27","2027-09":"MAI.ROS/SEP27"},
      };

      const fetchSym = async (sym) => {
        try {
          const r = await fetch(
            `https://api.remarkets.primary.com.ar/rest/marketdata/get?marketId=ROFX&symbol=${encodeURIComponent(sym)}&entries=LA,SE,CL,BI,OF`,
            { headers: { "X-Auth-Token": token }, signal: AbortSignal.timeout(7000) }
          );
          if (!r.ok) return null;
          const d = await r.json();
          if (d?.status === "ERROR") return null;
          const md = d?.marketData;
          if (!md) return null;
          const la=md?.LA?.price, se=md?.SE?.price, cl=md?.CL?.price;
          const bi=md?.BI?.price, of=md?.OF?.price;
          const mid=(bi&&of)?Math.round(((bi+of)/2)*10)/10:null;
          if (DEBUG) debugLog[`PRM:${sym}`] = {la,se,cl,bi,of,mid};
          // Durante mercado: LA o midpoint; fuera: SE
          return mercadoAbierto ? (la ?? mid ?? se ?? cl) : (se ?? cl ?? la);
        } catch(e) { return null; }
      };

      await Promise.allSettled([
        ...Object.entries(CONTRATOS.soja).map(async ([k,sym])=>{const p=await fetchSym(sym);if(p&&p>0)sojaData[k]=p;}),
        ...Object.entries(CONTRATOS.maiz).map(async ([k,sym])=>{const p=await fetchSym(sym);if(p&&p>0)maizData[k]=p;}),
      ]);
    } catch(e) { if(DEBUG) debugLog["_primary_error"]=e.message; }
  };

  // Ejecutar ambas fuentes en paralelo
  const [matbaResult] = await Promise.all([
    scrapeMATBA(),
    fetchPrimary(),
  ]);

  // Intentar parsear datos de MATBA si viene HTML
  if (matbaResult?.html) {
    const html = matbaResult.html;
    // Buscar patrones de precio en el HTML: números tipo 329.2 o 329,2 asociados a SOJ o MAI
    // Patrón: SOJ.ROS/JUL26 ... 329.2
    const sojaPattern = /SOJ\.ROS\/(JUL|SEP|NOV|ENE|ABR|MAY)(2[0-9]).*?(\d{3}[.,]\d)/g;
    const maizPattern = /MAI\.ROS\/(JUL|AGO|SEP|NOV|DIC|ENE|ABR)(2[0-9]).*?(\d{3}[.,]\d)/g;
    const MES_MAP = {JUL:"07",AGO:"08",SEP:"09",OCT:"10",NOV:"11",DIC:"12",ENE:"01",FEB:"02",MAR:"03",ABR:"04",MAY:"05",JUN:"06"};

    let m;
    while((m=sojaPattern.exec(html))!==null){
      const mesKey=`20${m[2]}-${MES_MAP[m[1]]}`;
      const precio=parseFloat(m[3].replace(",","."));
      if(precio>100&&precio<1000&&!sojaData[mesKey]) sojaData[mesKey]=precio;
    }
    while((m=maizPattern.exec(html))!==null){
      const mesKey=`20${m[2]}-${MES_MAP[m[1]]}`;
      const precio=parseFloat(m[3].replace(",","."));
      if(precio>100&&precio<1000&&!maizData[mesKey]) maizData[mesKey]=precio;
    }
    if(DEBUG) debugLog["matba_parsed"] = {sojaExtraida:Object.keys(sojaData).length, maizExtraida:Object.keys(maizData).length};
  }

  // Caché
  const sojaOk = Object.keys(sojaData).length > 0;
  const maizOk = Object.keys(maizData).length > 0;
  if(sojaOk){Object.assign(global._agroCache.soja,sojaData);global._agroCache.ts=new Date().toISOString();}
  if(maizOk){Object.assign(global._agroCache.maiz,maizData);global._agroCache.ts=new Date().toISOString();}

  const cacheOk = global._agroCache.ts && Object.keys(global._agroCache.soja).length>0;
  const sojaFuente = sojaOk?sojaData:cacheOk?global._agroCache.soja:null;
  const maizFuente = maizOk?maizData:cacheOk?global._agroCache.maiz:null;

  const sojaFinal = {...FALLBACK.soja,...(sojaFuente||{})};
  const maizFinal = {...FALLBACK.maiz,...(maizFuente||{})};

  const source = sojaOk&&maizOk ? (mercadoAbierto?"Primary_rt+MATBA_cierre":"MATBA_cierre+Primary")
    : sojaOk ? "Primary_soja+fallback_maiz"
    : cacheOk ? "cache_ultimo_cierre"
    : "fallback_static";

  return res.status(200).json({
    ok:true, source, mercadoAbierto,
    soja:sojaFinal, maiz:maizFinal,
    contratos_soja:Object.keys(sojaFinal).length,
    contratos_maiz:Object.keys(maizFinal).length,
    primary_soja:Object.keys(sojaData).length,
    primary_maiz:Object.keys(maizData).length,
    cache_ts:global._agroCache.ts,
    timestamp:new Date().toISOString(),
    ...(DEBUG?{debug:debugLog}:{}),
  });
}
