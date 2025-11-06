import metascraper from 'metascraper';
import metascraperTitle from 'metascraper-title';
import metascraperImage from 'metascraper-image';
import metascraperDescription from 'metascraper-description';
import metascraperPrice from 'metascraper-price';
import metascraperLogo from 'metascraper-logo';
import got from 'got';

const scraper = metascraper([
  metascraperTitle(),
  metascraperImage(),
  metascraperDescription(),
  metascraperPrice(),
  metascraperLogo()
]);

// Cache for metadata to avoid repeated requests
const metadataCache = new Map();
const CACHE_DURATION = 1000 * 60 * 30; // 30 minutes

// Enhanced price extraction from text
function extractPriceFromText(text) {
  const priceRegex = /(\$|€|£|¥)?\s*(\d+[.,]\d{2})/g;
  const matches = text.match(priceRegex);
  if (matches && matches.length > 0) {
    // Get the first price match and clean it
    const priceStr = matches[0].replace(/[^\d.,]/g, '').replace(',', '.');
    const price = parseFloat(priceStr);
    return isNaN(price) ? null : price;
  }
  return null;
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.query;

  // Validate URL parameter
  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  // Validate URL format
  try {
    new URL(url);
  } catch (error) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  // Check cache first
  const cacheKey = url.toLowerCase();
  const cached = metadataCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log('Serving from cache:', url);
    return res.status(200).json(cached.data);
  }

  try {
    console.log('Fetching metadata for:', url);
    
    // Set timeout and size limits for security
    const { body: html, url: finalUrl } = await got(url, {
      timeout: 10000, // 10 second timeout
      retry: 1,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ShukkuListBot/1.0; +https://github.com/shukkulist)'
      }
    });

    // Validate HTML size (prevent DoS)
    if (html.length > 5000000) { // 5MB limit
      throw new Error('Page too large');
    }

    const metadata = await scraper({ html, url: finalUrl });
    
    // Enhanced price detection
    let detectedPrice = metadata.price;
    if (!detectedPrice) {
      // Try to extract price from title or description
      detectedPrice = extractPriceFromText(metadata.title || '') || 
                     extractPriceFromText(metadata.description || '');
    }

    // Clean and format price if found
    if (detectedPrice) {
      if (typeof detectedPrice === 'string') {
        detectedPrice = parseFloat(detectedPrice.replace(/[^\d.,]/g, '').replace(',', '.'));
      }
      detectedPrice = isNaN(detectedPrice) ? null : Math.round(detectedPrice * 100) / 100;
    }

    // Validate and clean metadata
    const cleanMetadata = {
      title: metadata.title ? metadata.title.trim() : null,
      description: metadata.description ? metadata.description.trim() : null,
      image: metadata.image || null,
      logo: metadata.logo || null,
      price: detectedPrice,
      url: finalUrl,
      site: new URL(finalUrl).hostname.replace('www.', '')
    };

    // Remove empty values
    Object.keys(cleanMetadata).forEach(key => {
      if (!cleanMetadata[key]) delete cleanMetadata[key];
    });

    // Cache the result
    metadataCache.set(cacheKey, {
      data: cleanMetadata,
      timestamp: Date.now()
    });

    // Limit cache size
    if (metadataCache.size > 100) {
      const firstKey = metadataCache.keys().next().value;
      metadataCache.delete(firstKey);
    }

    res.status(200).json(cleanMetadata);

  } catch (error) {
    console.error('Metadata fetch error:', error.message);

    // Provide specific error messages based on error type
    if (error.name === 'TimeoutError') {
      return res.status(408).json({ error: 'Request timeout' });
    } else if (error.code === 'ENOTFOUND') {
      return res.status(404).json({ error: 'Website not found' });
    } else if (error.response?.statusCode === 404) {
      return res.status(404).json({ error: 'Page not found' });
    } else if (error.response?.statusCode === 403) {
      return res.status(403).json({ error: 'Access forbidden' });
    } else {
      return res.status(500).json({ error: 'Failed to fetch metadata' });
    }
  }
}