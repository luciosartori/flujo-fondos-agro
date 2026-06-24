// api/futuros-agro.js — Producción
// Soja: Primary reMarkets (ROFX) — campo SE para precio de cierre fuera de horario
// Maíz: IOL (InvertirOnline) — cuenta Primary no tiene segmento MAI habilitado
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
  const IOL_USER     = process.env.IOL_USUARIO;
  const IOL_PASS     = process.env.IOL_CONTRASENA;

  // Contratos de soja — símbolos confirmados en ROFX
  const CONTRATOS_SOJA = [
    { mesKey: "2026-07", sym: "SOJ.ROS/JUL26" },
    { mesKey: "2026-09", sym: "SOJ.ROS/SEP26" },
    { mesKey: "2026-11", sym: "SOJ.ROS/NOV26" },
    { mesKey: "2027-01", sym: "SOJ.ROS/ENE27" },
    { mesKey: "2027-03", sym: "SOJ.ROS/ABR27" },
    { mesKey: "2027-05", sym: "SOJ.ROS/MAY27" },
    { mesKey: "2027-07", sym: "SOJ.ROS/JUL27" },
  ];

  // Contratos de maíz — tickers IOL (formato MAIXXXXX)
  const MES_IOL = {
    "01":"ENE","02":"FEB","03":"MAR","04":"ABR","05":"MAY","06":"JUN",
    "07":"JUL","08":"AGO","09":"SEP","10":"OCT","11":"NOV","12":"DIC",
  };
  const CONTRATOS_MAIZ_IOL = [
    { mesKey: "2026-07", ticker: "MAIJUL26" },
    { mesKey: "2026-08", ticker: "MAIAGО26" },  // AGO en IOL
    { mesKey: "2026-09", ticker: "MAISEP26" },
    { mesKey: "2026-11", ticker: "MAINOV26" },
    { mesKey: "2026-12", ticker: "MAIDIC26" },
    { mesKey: "2027-01", ticker: "MAIENE27" },
    { mesKey: "2027-04", ticker: "MAIABR27" },
    { mesKey: "2027-07", ticker: "MAIJUL27" },
  ];

  const sojaData = {};
  const maizData = {};
  const sources = {};

  // ══════════════════════════════════════════════
  // SOJA — Primary reMarkets
  // Pide LA (último), SE (settlement=cierre oficial), CL (cierre ant.), BI, OF
  // SE siempre tiene precio aunque el mercado esté cerrado
  // ══════════════════════════════════════════════
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
          await Promise.allSettled(
            CONTRATOS_SOJA.map(async ({ mesKey, sym }) => {
              try {
                const r = await fetch(
                  `https://api.remarkets.primary.com.ar/rest/marketdata/get` +
                  `?marketId=ROFX&symbol=${encodeURIComponent(sym)}&entries=LA,SE,CL,BI,OF`,
                  { headers: { "X-Auth-Token": token }, signal: AbortSignal.timeout(7000) }
                );
                if (!r.ok) return;
                const d = await r.json();
                if (d?.status === "ERROR") return;
                const md = d?.marketData;
                if (!md) return;

                // LA = último negociado (solo en horario)
                // SE = settlement/ajuste oficial ROFX (siempre disponible, precio de cierre)
                // CL = cierre sesión anterior
                const precio =
                  md?.LA?.price ??  // Último negociado (horario de mercado)
                  md?.SE?.price ??  // Precio de ajuste/cierre oficial
                  md?.CL?.price ??  // Cierre sesión anterior
                  md?.OF?.price ??
                  md?.BI?.price ?? null;

                if (precio && precio > 0) {
                  sojaData[mesKey] = precio;
                  sources[`soja_${mesKey}`] = md?.LA?.price ? "Primary_LA" : md?.SE?.price ? "Primary_SE" : "Primary_CL";
                }
              } catch (e) { /* ignorar timeout individual */ }
            })
          );
        }
      }
    } catch (e) { /* Primary falló, continuar */ }
  }

  // ══════════════════════════════════════════════
  // MAÍZ — IOL (InvertirOnline) como fuente principal
  // Primary no tiene el segmento MAI habilitado para esta cuenta
  // ══════════════════════════════════════════════
  // También usar IOL para soja si Primary no trajo todos los contratos
  if (IOL_USER && IOL_PASS) {
    try {
      const iolBody = `username=${encodeURIComponent(IOL_USER)}&password=${encodeURIComponent(IOL_PASS)}&grant_type=password`;
      const iolTokenRes = await fetch("https://api.invertironline.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: iolBody,
        signal: AbortSignal.timeout(10000),
      });

      if (iolTokenRes.ok) {
        const tokenData = await iolTokenRes.json();
        const access_token = tokenData?.access_token;

        if (access_token) {
          const iolFetch = async (ticker) => {
            try {
              const r = await fetch(
                `https://api.invertironline.com/api/v2/ROFX/Titulos/${ticker}/Cotizacion`,
                { headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(6000) }
              );
              if (!r.ok) return null;
              const d = await r.json();
              // precioAjuste = precio oficial de cierre ROFX (equivalente al SE de Primary)
              // ultimoPrecio puede ser 0 si no hubo operaciones
              const p = d?.precioAjuste || (d?.ultimoPrecio > 0 ? d.ultimoPrecio : null) || d?.cierreAnterior || null;
              return p > 0 ? p : null;
            } catch (e) { return null; }
          };

          await Promise.allSettled([
            // Maíz completo desde IOL
            ...CONTRATOS_MAIZ_IOL.map(async ({ mesKey, ticker }) => {
              const p = await iolFetch(ticker);
              if (p) {
                maizData[mesKey] = p;
                sources[`maiz_${mesKey}`] = "IOL";
              }
            }),
            // Soja: completar meses que Primary no trajo
            ...CONTRATOS_SOJA.filter(c => !sojaData[c.mesKey]).map(async ({ mesKey }) => {
              const [y, m] = mesKey.split("-");
              const ticker = `SOJ${MES_IOL[m]}${y.slice(2)}`;
              const p = await iolFetch(ticker);
              if (p) {
                sojaData[mesKey] = p;
                sources[`soja_${mesKey}`] = "IOL_fallback";
              }
            }),
          ]);
        }
      }
    } catch (e) { /* IOL falló */ }
  }

  // ══════════════════════════════════════════════
  // RESULTADO FINAL
  // Combinar datos live con fallback para meses sin datos
  // ══════════════════════════════════════════════
  const sojaOk = Object.keys(sojaData).length > 0;
  const maizOk = Object.keys(maizData).length > 0;

  const sojaFinal = sojaOk ? { ...FALLBACK.soja, ...sojaData } : FALLBACK.soja;
  const maizFinal = maizOk ? { ...FALLBACK.maiz, ...maizData } : FALLBACK.maiz;

  const sourceStr =
    sojaOk && maizOk ? "Primary(soja)+IOL(maiz)" :
    sojaOk           ? "Primary(soja)+fallback(maiz)" :
    maizOk           ? "fallback(soja)+IOL(maiz)" :
    "fallback_static";

  return res.status(200).json({
    ok: true,
    source: sourceStr,
    soja: sojaFinal,
    maiz: maizFinal,
    contratos_soja: Object.keys(sojaFinal).length,
    contratos_maiz: Object.keys(maizFinal).length,
    nota: sojaOk ? undefined : "Soja sin datos live — mercado cerrado o fuera de horario (13:00-21:00 UTC)",
    timestamp: new Date().toISOString(),
  });
}
