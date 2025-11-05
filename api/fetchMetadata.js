import metascraper from 'metascraper';
import metascraperTitle from 'metascraper-title';
import metascraperImage from 'metascraper-image';
import metascraperDescription from 'metascraper-description';
import got from 'got';

const scraper = metascraper([
  metascraperTitle(),
  metascraperImage(),
  metascraperDescription()
]);

export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "URL is required" });

  try {
    const { body: html, url: finalUrl } = await got(url);
    const metadata = await scraper({ html, url: finalUrl });
    res.status(200).json(metadata);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch metadata" });
  }
}
