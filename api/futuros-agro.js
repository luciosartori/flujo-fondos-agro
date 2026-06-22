// api/futuros-agro.js — Vercel API Route
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const FALLBACK = {
    soja: { "2026-07": 324, "2026-09": 331, "2026-11": 334, "2027-05": 326, "2027-07": 338 },
    maiz: { "2026-07": 178, "2026-09": 183, "2026-11": 183, "2027-01": 183, "2027-03": 183, "2027-05": 183 },
  };

  const PRIMARY_USER = process.env.PRIMARY_USER;
  const PRIMARY_PASS = process.env.PRIMARY_PASS;
  const IOL_USER     = process.env.IOL_USUARIO;
  const IOL_PASS     = process.env.IOL_CONTRASENA;

  // BUG 1 FIX: Los símbolos de Primary usan punto (SOJ.ROS) pero la API
  // de reMarkets espera la barra como separador de mercado/contrato.
  // El formato correcto es: instrumento/vencimiento SIN el prefijo de mercado
  // en el símbolo. Probamos las dos variantes.
  const TICKERS_SOJA = {
    "2026-05": "SOJ/MAY26",
    "2026-07": "SOJ/JUL26",
    "2026-09": "SOJ/SEP26",
    "2026-11": "SOJ/NOV26",
    "2027-01": "SOJ/ENE27",
    "2027-03": "SOJ/MAR27",
    "2027-05": "SOJ/MAY27",
    "2027-07": "SOJ/JUL27",
    "2027-09": "SOJ/SEP27",
    "2027-11": "SOJ/NOV27",
    "2028-05": "SOJ/MAY28",
  };
  const TICKERS_MAIZ = {
    "2026-07": "MAI/JUL26",
    "2026-09": "MAI/SEP26",
    "2026-11": "MAI/NOV26",
    "2027-01": "MAI/ENE27",
    "2027-03": "MAI/MAR27",
    "2027-05": "MAI/MAY27",
    "2027-07": "MAI/JUL27",
    "2027-09": "MAI/SEP27",
    "2027-11": "MAI/NOV27",
    "2028-03": "MAI/MAR28",
  };

  // Intentar Primary
  try {
    if (!PRIMARY_USER || !PRIMARY_PASS) throw new Error("Sin credenciales Primary");

    const tokenRes = await fetch("https://api.remarkets.primary.com.ar/auth/getToken", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-Username": PRIMARY_USER,
        "X-Password": PRIMARY_PASS,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!tokenRes.ok) throw new Error(`Primary auth HTTP ${tokenRes.status}`);
    const token = tokenRes.headers.get("X-Auth-Token");
    if (!token) throw new Error("Sin X-Auth-Token en respuesta");

    // BUG 2 FIX: entries=LA,CL,SE — "SE" no existe en Primary reMarkets.
    // Los campos correctos son: LA (last), CL (close), BI (bid), OF (offer), OP (open).
    // También: el precio de ajuste viene en "SE" solo en algunos contratos.
    // Usamos LA,CL,BI,OF para máxima cobertura.
    const fetchTicker = async (ticker) => {
      const url = `https://api.remarkets.primary.com.ar/rest/marketdata/get` +
        `?marketId=ROFX&symbol=${encodeURIComponent(ticker)}&entries=LA,CL,BI,OF`;
      const r = await fetch(url, {
        headers: { "X-Auth-Token": token },
        signal: AbortSignal.timeout(6000),
      });
      if (!r.ok) return null;
      const d = await r.json();
      if (d?.status === "ERROR") return null;
      const md = d?.marketData;
      if (!md) return null;
      // Orden de prioridad: último precio → cierre → oferta → compra
      return md?.LA?.price ?? md?.CL?.price ?? md?.OF?.price ?? md?.BI?.price ?? null;
    };

    const sojaData = {}, maizData = {};
    const allTickers = [
      ...Object.entries(TICKERS_SOJA).map(([mes, ticker]) => ({ mes, ticker, grano: "soja" })),
      ...Object.entries(TICKERS_MAIZ).map(([mes, ticker]) => ({ mes, ticker, grano: "maiz" })),
    ];

    const results = await Promise.allSettled(
      allTickers.map(async ({ mes, ticker, grano }) => {
        const precio = await fetchTicker(ticker);
        return precio != null ? { mes, grano, precio } : null;
      })
    );

    results.forEach(r => {
      if (r.status === "fulfilled" && r.value) {
        const { mes, grano, precio } = r.value;
        if (grano === "soja") sojaData[mes] = precio;
        else maizData[mes] = precio;
      }
    });

    // Completar meses faltantes con IOL si está disponible
    if (IOL_USER && IOL_PASS) {
      try {
        const iolBody = `username=${encodeURIComponent(IOL_USER)}&password=${encodeURIComponent(IOL_PASS)}&grant_type=password`;
        const iolTokenRes = await fetch("https://api.invertironline.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: iolBody,
          signal: AbortSignal.timeout(8000),
        });
        if (iolTokenRes.ok) {
          const { access_token } = await iolTokenRes.json();
          if (access_token) {
            // BUG 3 FIX: los tickers IOL para ROFX usan formato distinto.
            // Formato correcto: SOJXXX27 / MAIXXX27 con mes en 3 letras español
            const MES_IOL = { "01":"ENE","02":"FEB","03":"MAR","04":"ABR","05":"MAY",
                              "06":"JUN","07":"JUL","08":"AGO","09":"SEP","10":"OCT","11":"NOV","12":"DIC" };
            const iolFetch = async (ticker) => {
              const r = await fetch(
                `https://api.invertironline.com/api/v2/ROFX/Titulos/${ticker}/Cotizacion`,
                { headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(5000) }
              );
              if (!r.ok) return null;
              const d = await r.json();
              // BUG 3b: "ultimoPrecio" puede ser 0 cuando no hubo operaciones.
              // Usar precioAjuste como primera opción (precio oficial de cierre ROFX)
              return d?.precioAjuste || d?.ultimoPrecio || d?.cierreAnterior || null;
            };

            // Meses de soja faltantes
            const sojaFaltantes = Object.keys(TICKERS_SOJA).filter(m => !sojaData[m]);
            const maizFaltantes  = Object.keys(TICKERS_MAIZ).filter(m => !maizData[m]);

            await Promise.allSettled([
              ...sojaFaltantes.map(async (mes) => {
                const [y, m] = mes.split("-");
                const ticker = `SOJ${MES_IOL[m]}${y.slice(2)}`;
                const p = await iolFetch(ticker);
                if (p) sojaData[mes] = p;
              }),
              ...maizFaltantes.map(async (mes) => {
                const [y, m] = mes.split("-");
                const ticker = `MAI${MES_IOL[m]}${y.slice(2)}`;
                const p = await iolFetch(ticker);
                if (p) maizData[mes] = p;
              }),
            ]);
          }
        }
      } catch (e) { /* IOL falló — continuar con Primary solo */ }
    }

    const sojaFinal = Object.keys(sojaData).length > 0 ? sojaData : FALLBACK.soja;
    const maizFinal = Object.keys(maizData).length > 0 ? maizData : FALLBACK.maiz;
    const source = Object.keys(sojaData).length > 0
      ? (IOL_USER ? "Primary+IOL" : "Primary")
      : "fallback_static";

    return res.status(200).json({
      ok: true,
      source,
      soja: sojaFinal,
      maiz: maizFinal,
      contratos_soja: Object.keys(sojaFinal).length,
      contratos_maiz: Object.keys(maizFinal).length,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    // Primary falló completamente — intentar IOL directo
    if (IOL_USER && IOL_PASS) {
      try {
        const iolBody = `username=${encodeURIComponent(IOL_USER)}&password=${encodeURIComponent(IOL_PASS)}&grant_type=password`;
        const iolTokenRes = await fetch("https://api.invertironline.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: iolBody,
          signal: AbortSignal.timeout(8000),
        });
        if (iolTokenRes.ok) {
          const { access_token } = await iolTokenRes.json();
          const MES_IOL = { "01":"ENE","02":"FEB","03":"MAR","04":"ABR","05":"MAY",
                            "06":"JUN","07":"JUL","08":"AGO","09":"SEP","10":"OCT","11":"NOV","12":"DIC" };
          const iolFetch = async (ticker) => {
            const r = await fetch(
              `https://api.invertironline.com/api/v2/ROFX/Titulos/${ticker}/Cotizacion`,
              { headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(5000) }
            );
            if (!r.ok) return null;
            const d = await r.json();
            return d?.precioAjuste || d?.ultimoPrecio || d?.cierreAnterior || null;
          };
          const sojaData = {}, maizData = {};
          await Promise.allSettled([
            ...Object.keys(TICKERS_SOJA).map(async (mes) => {
              const [y,m]=mes.split("-");
              const p = await iolFetch(`SOJ${MES_IOL[m]}${y.slice(2)}`);
              if(p) sojaData[mes]=p;
            }),
            ...Object.keys(TICKERS_MAIZ).map(async (mes) => {
              const [y,m]=mes.split("-");
              const p = await iolFetch(`MAI${MES_IOL[m]}${y.slice(2)}`);
              if(p) maizData[mes]=p;
            }),
          ]);
          if (Object.keys(sojaData).length > 0 || Object.keys(maizData).length > 0) {
            return res.status(200).json({
              ok: true, source: "IOL_only",
              soja: Object.keys(sojaData).length > 0 ? sojaData : FALLBACK.soja,
              maiz: Object.keys(maizData).length > 0 ? maizData : FALLBACK.maiz,
              contratos_soja: Object.keys(sojaData).length,
              contratos_maiz: Object.keys(maizData).length,
              timestamp: new Date().toISOString(),
            });
          }
        }
      } catch (e2) { /* IOL también falló */ }
    }

    return res.status(200).json({
      ok: true, source: "fallback_error",
      soja: FALLBACK.soja, maiz: FALLBACK.maiz,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}
