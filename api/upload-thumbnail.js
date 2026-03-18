/**
 * Vercel serverless: upload obrazu do repo GitHub (images/projects/).
 * Env: GITHUB_TOKEN (PAT z repo scope), GITHUB_REPO (owner/repo), GITHUB_PAGES_BASE (np. https://user.github.io/FusionHckVote)
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const baseUrl = process.env.GITHUB_PAGES_BASE || '';

  if (!token || !repo) {
    return res.status(500).json({ error: 'GITHUB_TOKEN and GITHUB_REPO must be set' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  } catch (_) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const dataUrl = body.image;
  const filename = body.filename || `thumb_${Date.now()}.jpg`;
  if (!dataUrl || !dataUrl.startsWith('data:image')) {
    return res.status(400).json({ error: 'Missing or invalid image (data URL)' });
  }

  const base64Match = dataUrl.match(/^data:image\/\w+;base64,(.+)$/);
  const base64Content = base64Match ? base64Match[1] : dataUrl.replace(/^data:[^;]+;base64,/, '');
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.(jpe?g|png|gif|webp)$/i, '.jpg') || 'image.jpg';
  const path = `images/projects/${safeName}`;

  const [owner, repoName] = repo.split('/').filter(Boolean);
  if (!owner || !repoName) {
    return res.status(500).json({ error: 'GITHUB_REPO must be owner/repo' });
  }

  const ghHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };

  try {
    const getRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${path}`, { headers: ghHeaders });
    let putBody = { message: `Update thumbnail ${safeName}`, content: base64Content };
    if (getRes.ok) {
      const existing = await getRes.json();
      if (existing.sha) putBody.sha = existing.sha;
    }

    const ghRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${path}`, {
      method: 'PUT',
      headers: ghHeaders,
      body: JSON.stringify(putBody),
    });

    if (!ghRes.ok) {
      const err = await ghRes.text();
      return res.status(ghRes.status).json({ error: 'GitHub API failed', detail: err });
    }

    const publicUrl = baseUrl
      ? `${baseUrl.replace(/\/$/, '')}/images/projects/${safeName}`
      : `https://${owner}.github.io/${repoName}/images/projects/${safeName}`;

    return res.status(200).json({ url: publicUrl, path });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Upload failed' });
  }
};
