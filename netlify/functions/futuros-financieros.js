// netlify/functions/futuros-financieros.js
// Proxy para traer futuros financieros (dólar futuro Rofex) de A3 Mercados

export async function handler(event, context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const BASE = "https://matbarofex.primary.ventures";

    const pageRes = await fetch(`${BASE}/fyo/futurosfinancieros`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-AR,es;q=0.9",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!pageRes.ok) throw new Error(`A3 financieros returned ${pageRes.status}`);

    const html = await pageRes.text();

    // Extraer filas de dólar futuro
    // Formato: DLR/MMMYY con precio de ajuste
    const dolarData = {};

    const rows = html.match(/DLR[^<]{0,300}/g) || [];

    const extractPrice = (text) => {
      const nums = text.match(/\b(\d{3,5}[.,]\d{1,2})\b/g);
      if (nums && nums.length > 0) {
        return parseFloat(nums[nums.length - 1].replace(",", "."));
      }
      return null;
    };

    // Mapeo de meses abreviados a AAAA-MM
    const mesMap = {
      ENE: "01", FEB: "02", MAR: "03", ABR: "04",
      MAY: "05", JUN: "06", JUL: "07", AGO: "08",
      SEP: "09", OCT: "10", NOV: "11", DIC: "12",
    };

    rows.forEach((row) => {
      const price = extractPrice(row);
      if (!price || price < 500 || price > 50000) return;

      // Buscar patrón de mes/año en la fila
      for (const [mes, num] of Object.entries(mesMap)) {
        const match26 = row.match(new RegExp(`${mes}2?6`, "i"));
        const match27 = row.match(new RegExp(`${mes}2?7`, "i"));
        const match28 = row.match(new RegExp(`${mes}2?8`, "i"));
        const match29 = row.match(new RegExp(`${mes}2?9`, "i"));
        const match30 = row.match(new RegExp(`${mes}3?0`, "i"));

        if (match26) dolarData[`2026-${num}`] = price;
        if (match27) dolarData[`2027-${num}`] = price;
        if (match28) dolarData[`2028-${num}`] = price;
        if (match29) dolarData[`2029-${num}`] = price;
        if (match30) dolarData[`2030-${num}`] = price;
      }
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        source: "html_scraping",
        dolar_futuro: dolarData,
        htmlLength: html.length,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      }),
    };
  }
}
