import fetch from "node-fetch";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: "Missing URL" });
  }

  try {
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    const html = await response.text();
    const $ = cheerio.load(html);

    const metadata = {
      title: $('meta[property="og:title"]').attr('content') || $('title').text() || '',
      image: $('meta[property="og:image"]').attr('content') || '',
      price: $('meta[property="product:price:amount"]').attr('content') || '',
      site: $('meta[property="og:site_name"]').attr('content') || new URL(url).hostname,
      url,
    };

    return res.status(200).json(metadata);
  } catch (error) {
    console.error("OG Fetch Error:", error);
    return res.status(500).json({ error: "Failed to fetch metadata" });
  }
}
