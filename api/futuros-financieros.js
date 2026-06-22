// api/futuros-financieros.js — Vercel API Route
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const PRIMARY_USER = process.env.PRIMARY_USER;
  const PRIMARY_PASS = process.env.PRIMARY_PASS;

  if (!PRIMARY_USER || !PRIMARY_PASS) {
    return res.status(200).json({ ok: false, error: "Sin credenciales Primary" });
  }

  // Contratos DLR estándar y mini (M) — como se ven en A3 Real Time
  // Cubrimos desde hoy hasta 2028
  const MES = {
    "01":"ENE","02":"FEB","03":"MAR","04":"ABR","05":"MAY","06":"JUN",
    "07":"JUL","08":"AGO","09":"SEP","10":"OCT","11":"NOV","12":"DIC",
  };

  const hoy = new Date();
  const mesActual = hoy.getMonth() + 1;
  const anioActual = hoy.getFullYear();

  // Generar pares [mesKey, [ticker_std, ticker_mini]]
  const tickersPares = [];
  for (let y = anioActual; y <= 2028; y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === anioActual && m < mesActual) continue;
      const mesKey = `${y}-${String(m).padStart(2,"0")}`;
      const mm = MES[String(m).padStart(2,"0")];
      const yy = String(y).slice(2);
      tickersPares.push({
        mesKey,
        std:  `DLR/${mm}${yy}`,    // ej: DLR/JUN26
        mini: `DLR/${mm}${yy}M`,   // ej: DLR/JUN26M
      });
    }
  }

  try {
    // 1. Autenticar en Primary reMarkets
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

    // 2. Fetch de cada contrato — pedimos TODOS los entries disponibles
    //    La API de Primary devuelve los campos que tienen datos.
    //    Campos relevantes:
    //      LA  = último precio negociado (puede no existir si no hubo operaciones hoy)
    //      CL  = precio de cierre anterior
    //      SE  = precio de settlement / ajuste (SIEMPRE existe, es el oficial de ROFX)
    //      BI  = mejor compra (bid)
    //      OF  = mejor venta (offer)
    //      AP  = precio de apertura
    //      NV  = volumen nominal
    //      OI  = open interest
    const fetchTicker = async (ticker) => {
      try {
        const r = await fetch(
          `https://api.remarkets.primary.com.ar/rest/marketdata/get` +
          `?marketId=ROFX&symbol=${encodeURIComponent(ticker)}&entries=LA,CL,SE,BI,OF,AP,NV,OI`,
          {
            headers: { "X-Auth-Token": token },
            signal: AbortSignal.timeout(8000),
          }
        );
        if (!r.ok) return null;
        const d = await r.json();

        // Si el contrato no existe en ROFX devuelve status ERROR
        if (d?.status === "ERROR") return null;

        const md = d?.marketData;
        if (!md) return null;

        // Prioridad de precio:
        // 1. LA.price  — último negociado hoy (más fresco pero puede no existir)
        // 2. SE.price  — precio de ajuste oficial ROFX (siempre existe si el contrato está vivo)
        // 3. CL.price  — cierre del día anterior
        // 4. OF.price  — oferta (vendedor)
        // 5. BI.price  — compra (comprador)
        const precio =
          md?.LA?.price ??
          md?.SE?.price ??
          md?.CL?.price ??
          md?.OF?.price ??
          md?.BI?.price ??
          null;

        if (precio == null || precio <= 0) return null;

        const fuente =
          md?.LA?.price  ? "LA" :
          md?.SE?.price  ? "SE" :
          md?.CL?.price  ? "CL" :
          md?.OF?.price  ? "OF" : "BI";

        return {
          precio,
          fuente,
          volumen:      md?.NV?.size  ?? md?.LA?.size ?? 0,
          openInterest: md?.OI?.size  ?? 0,
          variacion:    md?.LA?.change ?? null,
        };
      } catch (e) {
        return null;
      }
    };

    // 3. Consultar std y mini en paralelo para cada mes
    const dolarFuturo = {};
    const debug = {};

    await Promise.allSettled(
      tickersPares.map(async ({ mesKey, std, mini }) => {
        // Consultar estándar y mini en paralelo
        const [resStd, resMini] = await Promise.all([
          fetchTicker(std),
          fetchTicker(mini),
        ]);

        // Usar el que tenga precio, priorizando estándar
        // Si ambos tienen precio, promediar (como hace A3)
        if (resStd && resMini) {
          // Tomar el último negociado si existe en alguno, si no el SE
          const precio = resStd.precio; // estándar tiene prioridad
          dolarFuturo[mesKey] = precio;
          debug[mesKey] = { std: resStd, mini: resMini, usado: "std" };
        } else if (resStd) {
          dolarFuturo[mesKey] = resStd.precio;
          debug[mesKey] = { std: resStd, usado: "std" };
        } else if (resMini) {
          dolarFuturo[mesKey] = resMini.precio;
          debug[mesKey] = { mini: resMini, usado: "mini" };
        }
        // Si ninguno tiene precio, el mes no se incluye (contrato inactivo)
      })
    );

    const limpio = Object.fromEntries(
      Object.entries(dolarFuturo)
        .filter(([, v]) => v != null && v > 0)
        .sort(([a], [b]) => a.localeCompare(b))
    );

    return res.status(200).json({
      ok: true,
      source: "Primary_reMarkets",
      dolar_futuro: limpio,
      contratos: Object.keys(limpio).length,
      timestamp: new Date().toISOString(),
      // debug: debug, // descomentar temporalmente para diagnosticar
    });

  } catch (error) {
    return res.status(200).json({
      ok: false,
      error: error.message,
      dolar_futuro: {},
      timestamp: new Date().toISOString(),
    });
  }
}
