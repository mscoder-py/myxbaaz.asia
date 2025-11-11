const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static('.'));

// MySQL Config
const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: 'Dorado',
  database: 'desi',
  port: 3306,
  waitForConnections: true,
  connectionLimit: 10,
};

let pool;
let dbConnected = false;

// Trim trailing slash
function trimTrailingSlash(str) {
  return str ? str.replace(/\/$/, '') : '';
}

// Default video
const DEFAULT_VIDEO_URL = 'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_1mb.mp4';

// Convert full URL to local path
function convertToLocalPath(url) {
  if (!url || typeof url !== 'string') return null;

  try {
    if (url.startsWith('./images/') || url.startsWith('/images/')) return url;

    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');
    const filename = pathParts.pop();
    const monthStr = pathParts.pop();
    const year = pathParts.pop();

    const month = monthStr ? String(parseInt(monthStr, 10)) : '1';

    if (/\.(jpe?g|png|webp|gif)$/i.test(filename)) {
      return `./images/${year}_${month}_${filename}`;
    }
  } catch (e) {
    if (/\.(jpe?g|png|webp|gif)$/i.test(url)) {
      return `./images/${url}`;
    }
  }
  return null;
}

// Init DB
async function initDB() {
  try {
    pool = await mysql.createPool(dbConfig);
    const [rows] = await pool.execute('SELECT 1 as test');
    if (rows[0].test === 1) {
      dbConnected = true;
      console.log('MySQL Connected Successfully');

      const [count] = await pool.execute('SELECT COUNT(*) as total FROM cards WHERE id <= 400');
      console.log(`Total Cards (id <= 400): ${count[0].total}`);

      const [sample] = await pool.execute('SELECT title, image_link, number_views FROM cards WHERE id <= 400 ORDER BY number_views DESC LIMIT 1');
      if (sample.length > 0) {
        const localPath = convertToLocalPath(sample[0].image_link);
        console.log('Top Viewed Thumbnail →', localPath || 'None');
      }
    }
  } catch (error) {
    console.error('DB Connection Failed:', error.message);
    dbConnected = false;
  }
}

// Proxy
async function proxyResource(req, res, externalUrl) {
  try {
    const protocol = externalUrl.startsWith('https') ? https : http;
    const urlObj = new URL(externalUrl);
    const proxyReq = protocol.request({
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0', ...req.headers }
    }, (proxyRes) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'application/octet-stream');
      proxyRes.pipe(res);
    });
    proxyReq.on('error', () => res.status(500).send('Proxy failed'));
    proxyReq.end();
  } catch {
    res.status(500).json({ error: 'Proxy failed' });
  }
}

app.get('/proxy/image', (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });
  proxyResource(req, res, url);
});

app.get('/proxy/video', (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });
  proxyResource(req, res, url);
});

// Format Views
function formatViews(views) {
  const num = parseInt(views) || 0;
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

// /api/cards - List (id <= 400, sorted by views DESC)
app.get('/api/cards', async (req, res) => {
  let { category = 'all', search = '', limit = 20, offset = 0 } = req.query;

  limit = Math.min(parseInt(limit, 10) || 20, 100);
  offset = Math.max(parseInt(offset, 10) || 0, 0);

  try {
    if (!dbConnected) return res.status(503).json({ success: false, error: 'DB not connected' });

    let whereClause = ' WHERE id <= 400 ';
    let params = [];
    const conditions = [];

    if (category !== 'all') { conditions.push('category LIKE ?'); params.push(`%${category}%`); }
    if (search) { conditions.push('(title LIKE ? OR category LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }

    if (conditions.length > 0) {
      whereClause += 'AND ' + conditions.join(' AND ');
    }

    const [countRows] = await pool.execute(`SELECT COUNT(*) as total FROM cards${whereClause}`, params);
    const total = countRows[0].total;

    const mainQuery = `
      SELECT id, title, image_link, number_views, real_slug, my_slug, category 
      FROM cards${whereClause} 
      ORDER BY number_views DESC, id ASC 
      LIMIT ${limit} OFFSET ${offset}
    `;

    const [rows] = await pool.execute(mainQuery, params);

    const data = rows.map(row => ({
      ...row,
      formattedViews: formatViews(row.number_views),
      thumbnail_url: convertToLocalPath(row.image_link) || './images/default-thumb.jpg'
    }));

    res.json({ success: true, data, total });
  } catch (error) {
    console.error('API /cards Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// /api/cards/:slug - Detail + Related (id <= 400, high views first)
app.get('/api/cards/:slug', async (req, res) => {
  let { slug } = req.params;
  let { my_slug: queryMySlug } = req.query;
  slug = trimTrailingSlash(slug);
  queryMySlug = queryMySlug ? trimTrailingSlash(queryMySlug) : '';

  try {
    if (!dbConnected) return res.status(503).json({ success: false, error: 'DB not available' });

    // Step 1: Find current card (id <= 400)
    const [cardRows] = await pool.execute(
      `SELECT id, title, image_link, number_views, real_slug, my_slug, category 
       FROM cards 
       WHERE (real_slug LIKE ? OR my_slug = ? OR TRIM(TRAILING '/' FROM my_slug) = ?) 
       AND id <= 400`,
      [`%${slug}%`, queryMySlug, queryMySlug]
    );

    if (cardRows.length === 0) return res.status(404).json({ success: false, error: 'Video not found' });

    const card = cardRows[0];

    // Step 2: Get video source
    const [detailRows] = await pool.execute(
      'SELECT video_src FROM cards_detail WHERE my_slug = ? OR TRIM(TRAILING "/" FROM my_slug) = ?',
      [card.my_slug, trimTrailingSlash(card.my_slug)]
    );
    const video_src = detailRows[0]?.video_src || DEFAULT_VIDEO_URL;

    // Step 3: Extract keywords
    const keywords = card.title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 3)
      .slice(0, 5);

    let relatedVideos = [];

    // Priority 1: Same category + high views
    if (card.category) {
      const [sameCat] = await pool.execute(
        `SELECT my_slug, title, number_views, image_link, category 
         FROM cards 
         WHERE category LIKE ? AND id != ? AND id <= 400 
         ORDER BY number_views DESC 
         LIMIT 12`,
        [`%${card.category}%`, card.id]
      );
      relatedVideos = sameCat;
    }

    // Priority 2: Keyword match + high views
    if (relatedVideos.length < 6 && keywords.length > 0) {
      const likeClauses = keywords.map(() => 'LOWER(title) LIKE ?').join(' OR ');
      const likeParams = keywords.map(k => `%${k}%`);
      const [keywordMatches] = await pool.execute(
        `SELECT my_slug, title, number_views, image_link, category 
         FROM cards 
         WHERE (${likeClauses}) AND id != ? AND id <= 400 
         ORDER BY number_views DESC 
         LIMIT ${12 - relatedVideos.length}`,
        [...likeParams, card.id]
      );
      relatedVideos = [...relatedVideos, ...keywordMatches];
    }

    // Priority 3: Top viewed overall (id <= 400)
    if (relatedVideos.length < 12) {
      const [topViewed] = await pool.execute(
        `SELECT my_slug, title, number_views, image_link, category 
         FROM cards 
         WHERE id != ? AND id <= 400 
         ORDER BY number_views DESC 
         LIMIT ${12 - relatedVideos.length}`,
        [card.id]
      );
      relatedVideos = [...relatedVideos, ...topViewed];
    }

    relatedVideos = relatedVideos.slice(0, 12);

    const formattedRelated = relatedVideos.map(r => ({
      my_slug: trimTrailingSlash(r.my_slug),
      title: r.title,
      number_views: r.number_views,
      category: r.category || 'Uncategorized',
      rating: 'N/A',
      thumbnail_url: convertToLocalPath(r.image_link) || './images/default-thumb.jpg'
    }));

    const response = {
      ...card,
      video_url: video_src,
      formattedViews: formatViews(card.number_views),
      relatedVideos: formattedRelated,
      thumbnail_url: convertToLocalPath(card.image_link) || './images/default-thumb.jpg'
    };

    res.json({ success: true, data: response });
  } catch (error) {
    console.error('API /cards/:slug Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health & Test
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    dbConnected,
    time: new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi' }),
    filter: 'id <= 400',
    sort: 'number_views DESC',
    serverTime: 'November 11, 2025 01:40 AM PKT'
  });
});

app.get('/api/test-db', async (req, res) => {
  if (!dbConnected) return res.json({ success: false, error: 'DB not connected' });
  const [sample] = await pool.execute('SELECT title, image_link, number_views, category FROM cards WHERE id <= 400 ORDER BY number_views DESC LIMIT 1');
  const local = convertToLocalPath(sample[0]?.image_link);
  res.json({ success: true, sample: { ...sample[0], localPath: local } });
});

// Start Server
async function start() {
  await initDB();
  app.listen(PORT, () => {
    console.log(`Server Running: http://localhost:${PORT}`);
    console.log(`API Test: http://localhost:${PORT}/api/cards?limit=5`);
    console.log(`Filter: id <= 400 | Sort: number_views DESC`);
    console.log(`Time: November 11, 2025 01:40 AM PKT`);
  });
}

start();