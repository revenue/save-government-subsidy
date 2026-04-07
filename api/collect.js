const https = require('https');
const http = require('http');
const crypto = require('crypto');

// ===== 경량 수집기 (Node.js stdlib만 사용) =====

function fetchPage(url, timeout = 10000) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      },
      timeout,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchPage(res.headers.location, timeout).then(resolve);
      }
      if (res.statusCode !== 200) return resolve('');
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => data += c);
      res.on('end', () => resolve(data));
      res.on('error', () => resolve(''));
    });
    req.on('error', () => resolve(''));
    req.on('timeout', () => { req.destroy(); resolve(''); });
  });
}

function hashId(source, title) {
  const h = crypto.createHash('md5').update(`${title}_${source}`).digest('hex').slice(0, 12);
  return `${source}_${h}`;
}

function parseDate(text) {
  if (!text) return '';
  const m = text.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return '';
}

function stripTags(html) {
  return (html || '').replace(/<[^>]+>/g, '').trim();
}

// ----- 기업마당 HTML 스크래핑 (주요 데이터 소스) -----
async function collectBizinfo() {
  const items = [];
  const seen = new Set();

  for (let page = 1; page <= 5; page++) {
    const html = await fetchPage(
      `https://www.bizinfo.go.kr/web/lay1/bbs/S1T122C128/AS/74/list.do?rows=50&cpage=${page}`
    );
    if (!html) break;

    // <tbody> 내 <tr> 파싱
    const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
    if (!tbodyMatch) break;
    const tbody = tbodyMatch[1];

    const rows = tbody.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
    if (rows.length === 0) break;

    let pageCount = 0;
    for (const row of rows) {
      const tds = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
      if (tds.length < 7) continue;

      const category = stripTags(tds[1]);
      const titleTd = tds[2];

      // 제목 + 링크 추출
      const linkMatch = titleTd.match(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/i);
      if (!linkMatch) continue;
      const href = linkMatch[1];
      const title = stripTags(linkMatch[2]);
      if (!title || seen.has(title)) continue;
      seen.add(title);

      // pblancId 추출
      const idMatch = href.match(/pblancId=([A-Z0-9_]+)/);
      const externalId = idMatch ? idMatch[1] : hashId('bizinfo', title);

      // 신청기간
      const period = stripTags(tds[3]);
      let startDate = '', endDate = '';
      const dates = period.match(/(\d{4}-\d{2}-\d{2})/g);
      if (dates && dates.length >= 1) startDate = dates[0];
      if (dates && dates.length >= 2) endDate = dates[1];

      const organization = stripTags(tds[4]);
      const executor = stripTags(tds[5]);

      items.push({
        external_id: externalId,
        title,
        category: category || '기타',
        organization,
        executor,
        target: '',
        region: '전국',
        apply_start_date: startDate,
        apply_end_date: endDate,
        detail_url: href.startsWith('http') ? href : `https://www.bizinfo.go.kr${href}`,
        source: 'bizinfo',
      });
      pageCount++;
    }
    if (pageCount === 0) break;
  }
  return items;
}

// ----- 중소벤처24 -----
async function collectSmes() {
  const items = [];
  const seen = new Set();
  for (let page = 1; page <= 3; page++) {
    const html = await fetchPage(`https://www.smes.go.kr/bizApply/list?page=${page}&size=20`);
    if (!html) break;
    const links = [...(html.matchAll(/<a[^>]*href=["']([^"']*)['""][^>]*>\s*(?:<[^>]*>)*\s*([^<]{5,})/g) || [])];
    let count = 0;
    for (const m of links) {
      const title = m[2].trim();
      if (seen.has(title) || title.length > 200 || title.length < 5) continue;
      seen.add(title);
      let href = m[1].trim();
      if (!href.startsWith('http')) href = 'https://www.smes.go.kr' + href;
      items.push({
        external_id: hashId('smes', title),
        title, category: '중소기업', organization: '중소벤처24',
        executor: '', target: '중소기업', region: '전국',
        apply_start_date: '', apply_end_date: '',
        detail_url: href, source: 'smes',
      });
      count++;
    }
    if (count === 0) break;
  }
  return items;
}

// ----- K-스타트업 -----
async function collectKstartup() {
  const items = [];
  const seen = new Set();
  for (let page = 1; page <= 3; page++) {
    const html = await fetchPage(`https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?schPage=${page}&pbancEndYn=N`);
    if (!html) break;
    const links = [...(html.matchAll(/<a[^>]*href=["']([^"']*detail[^"']*)['""][^>]*>([\s\S]*?)<\/a>/g) || [])];
    let count = 0;
    for (const m of links) {
      const title = stripTags(m[2]);
      if (!title || title.length < 5 || seen.has(title)) continue;
      seen.add(title);
      let href = m[1].trim();
      if (!href.startsWith('http')) href = 'https://www.k-startup.go.kr' + href;
      items.push({
        external_id: hashId('kstartup', title),
        title, category: '창업', organization: 'K-스타트업',
        executor: '', target: '창업기업', region: '전국',
        apply_start_date: '', apply_end_date: '',
        detail_url: href, source: 'kstartup',
      });
      count++;
    }
    if (count === 0) break;
  }
  return items;
}

// ===== Vercel Serverless Handler =====
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.json({
      status: 'ready',
      message: '수집 API 준비됨. POST 요청으로 수집을 시작하세요.',
      sources: ['bizinfo', 'smes', 'kstartup'],
    });
  }

  // POST: 수집 실행
  const results = { timestamp: new Date().toISOString(), sources: {}, items: [], total: 0 };

  const collectors = [
    ['bizinfo', '기업마당', collectBizinfo],
    ['smes', '중소벤처24', collectSmes],
    ['kstartup', 'K-스타트업', collectKstartup],
  ];

  for (const [id, name, fn] of collectors) {
    try {
      const items = await fn();
      results.sources[id] = { name, count: items.length, status: 'success' };
      results.items.push(...items);
    } catch (e) {
      results.sources[id] = { name, count: 0, status: 'error', error: e.message };
    }
  }

  results.total = results.items.length;
  return res.json({ success: true, message: `수집 완료: ${results.total}건`, ...results });
};
