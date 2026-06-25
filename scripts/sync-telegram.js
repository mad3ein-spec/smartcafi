const fs = require('fs');
const path = require('path');

// ─── تنظیمات ───────────────────────────────────────────────
const channelId    = 'smartcafi_news';
const postsPerPage = 10;
const archiveFile  = path.join(__dirname, '..', 'posts.json');
const pageFile     = path.join(__dirname, '..', 'announcements.html');
const configFile   = path.join(__dirname, '..', 'pinned-config.json');
const pagesDir     = path.join(__dirname, '..', 'announcements-pages');

const PIN_PREFIX    = 'اطلاعیه مهم';
const PIN_MAX_COUNT = 3;
const PIN_MAX_DAYS  = 5;

// ─── ابزارها ───────────────────────────────────────────────
function replaceBetween(source, startMarker, endMarker, replacement) {
  const startIndex = source.indexOf(startMarker);
  const endIndex   = source.indexOf(endMarker);
  if (startIndex === -1 || endIndex === -1) {
    console.log(`مارکر یافت نشد: ${startMarker}`);
    return source;
  }
  return (
    source.substring(0, startIndex + startMarker.length) +
    replacement +
    source.substring(endIndex)
  );
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function isImportant(text) {
  return text.trimStart().startsWith(PIN_PREFIX);
}

function isStillPinnable(isoDate) {
  const ageMs = Date.now() - new Date(isoDate).getTime();
  return ageMs < PIN_MAX_DAYS * 24 * 60 * 60 * 1000;
}

// اگه متن با PIN_PREFIX شروع شه، اون خط رو حذف می‌کنه
function stripPinPrefix(text) {
  const lines = text.split('\n');
  if (lines[0].trim().startsWith(PIN_PREFIX)) {
    return lines.slice(1).join('\n').trimStart();
  }
  return text;
}

// ─── دریافت یک صفحه از تلگرام ─────────────────────────────
async function fetchPosts(beforeId = null) {
  const url = beforeId
    ? `https://t.me/s/${channelId}?before=${beforeId}`
    : `https://t.me/s/${channelId}`;

  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error('درخواست به تلگرام ناموفق: ' + res.status);

  const html   = await res.text();
  const blocks = html.split('data-post="').slice(1);
  const posts  = [];

  for (const block of blocks) {
    const postIdMatch = block.match(/^([^"]+)"/);
    if (!postIdMatch) continue;
    const postId   = postIdMatch[1];
    const postLink = `https://t.me/${postId}`;
    const numId    = parseInt(postId.split('/')[1], 10);

    const textMatch = block.match(/tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (!textMatch) continue;

    const dateMatch = block.match(/<time[^>]*datetime="([^"]+)"/);
    const isoDate   = dateMatch ? dateMatch[1] : new Date().toISOString();

    let cleanText = textMatch[1]
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, '');
    cleanText = decodeEntities(cleanText).trim();
    if (!cleanText) continue;

    posts.push({ numId, postId, postLink, isoDate, text: cleanText });
  }

  return posts;
}

async function fetchAllLivePosts() {
  const allLive = new Map();
  let beforeId  = null;
  let page      = 0;

  while (true) {
    console.log(`دریافت صفحه ${++page} از تلگرام...`);
    const batch = await fetchPosts(beforeId);
    if (!batch.length) break;

    batch.forEach(p => allLive.set(p.postId, p));
    beforeId = batch[0].numId;
    await new Promise(r => setTimeout(r, 700));
  }

  return allLive;
}

// ─── HTML پست معمولی ──────────────────────────────────────
function postToHtml(post, dateFormatter) {
  const firstLine   = post.text.split('\n')[0].trim();
  const headline    = firstLine.length > 70 ? firstLine.slice(0, 70) + '…' : firstLine;
  const displayDate = dateFormatter.format(new Date(post.isoDate));

  return `<article class="info-card" style="display:block; border-right:4px solid #33417A; margin-bottom:16px; padding:16px;" itemscope itemtype="https://schema.org/SocialMediaPosting">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:8px; flex-wrap:wrap;">
                <h3 itemprop="headline" style="margin:0; font-size:1rem; color:#33417A;">${headline}</h3>
                <time itemprop="datePublished" datetime="${post.isoDate}" style="font-size:0.78rem; color:#888; white-space:nowrap;">${displayDate}</time>
            </div>
            <p itemprop="articleBody" style="line-height:1.8; white-space:pre-line; margin:0 0 10px 0;">${post.text}</p>
            <a itemprop="url" href="${post.postLink}" target="_blank" rel="nofollow noopener" style="font-size:0.8rem; color:#229ED9; text-decoration:none;">مشاهده پست اصلی در کانال تلگرام ←</a>
        </article>`;
}

// ─── HTML پست پین‌شده ─────────────────────────────────────
function pinnedPostToHtml(post, dateFormatter) {
  // خط «اطلاعیه مهم» را از متن و تیتر حذف می‌کنیم
  const cleanedText = stripPinPrefix(post.text);
  const firstLine   = cleanedText.split('\n')[0].trim();
  const headline    = firstLine.length > 70 ? firstLine.slice(0, 70) + '…' : firstLine;
  const displayDate = dateFormatter.format(new Date(post.isoDate));

  return `<article style="
              display:block; position:relative;
              background: linear-gradient(135deg, #fff8f0 0%, #fff3e8 100%);
              border: 1.5px solid #f0b070; border-right: 5px solid #e07000;
              border-radius: 10px; margin-bottom: 14px; padding: 18px 18px 14px;
              box-shadow: 0 2px 10px rgba(224,112,0,0.08); overflow: hidden;
            " itemscope itemtype="https://schema.org/SocialMediaPosting">
            <div style="position:absolute; top:0; left:0;
              background: linear-gradient(135deg, #e07000, #c45c00); color:#fff;
              font-size:0.65rem; font-weight:bold; padding: 4px 12px 4px 10px;
              border-radius: 0 0 10px 0; letter-spacing:0.04em;">📌 اطلاعیه مهم</div>
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:10px; flex-wrap:wrap; margin-top:16px;">
                <h3 itemprop="headline" style="margin:0; font-size:1rem; color:#7a3800; font-weight:700;">${headline}</h3>
                <time itemprop="datePublished" datetime="${post.isoDate}" style="font-size:0.75rem; color:#b07030; white-space:nowrap;">${displayDate}</time>
            </div>
            <p itemprop="articleBody" style="line-height:1.9; white-space:pre-line; margin:0 0 12px 0; color:#3d2000; font-size:0.95rem;">${cleanedText}</p>
            <a itemprop="url" href="${post.postLink}" target="_blank" rel="nofollow noopener"
               style="display:inline-flex; align-items:center; gap:6px; font-size:0.8rem; color:#fff;
                      background:#e07000; padding:5px 14px; border-radius:20px; text-decoration:none;">
              مشاهده در تلگرام ←
            </a>
        </article>`;
}

// ─── ناوبری صفحات ─────────────────────────────────────────
// pageNum: شماره صفحه فعلی | fromRoot: آیا فایل در root است؟
function buildPagination(currentPage, totalPages, fromRoot) {
  if (totalPages <= 1) return '';

  function pageHref(i) {
    if (i === 1) {
      // صفحه اول همیشه announcements.html است
      return fromRoot ? 'announcements.html' : '../announcements.html';
    }
    // صفحات بعدی در پوشه announcements-pages هستند
    return fromRoot ? `announcements-pages/page-${i}.html` : `page-${i}.html`;
  }

  let links = '';
  for (let i = 1; i <= totalPages; i++) {
    const active = i === currentPage
      ? 'background:#33417A;color:#fff;'
      : 'background:#f0f2f8;color:#33417A;';
    links += `<a href="${pageHref(i)}" style="${active} padding:6px 14px; border-radius:6px; text-decoration:none; font-size:0.9rem; margin:0 3px;">${i}</a>`;
  }

  return `<div style="text-align:center; margin: 24px 0; direction:rtl;">${links}</div>`;
}

// ─── اصلی ─────────────────────────────────────────────────
async function main() {

  if (!fs.existsSync(pagesDir)) fs.mkdirSync(pagesDir, { recursive: true });

  let archive = [];
  if (fs.existsSync(archiveFile)) {
    archive = JSON.parse(fs.readFileSync(archiveFile, 'utf8'));
  }
  console.log(`آرشیو قبلی: ${archive.length} پست`);

  let pinnedLinks = [];
  if (fs.existsSync(configFile)) {
    pinnedLinks = JSON.parse(fs.readFileSync(configFile, 'utf8')).pinned || [];
  }

  const livePosts = await fetchAllLivePosts();
  console.log(`پست‌های زنده در کانال: ${livePosts.size}`);

  const beforeCount = archive.length;
  archive = archive.filter(p => livePosts.has(p.postId));
  console.log(`حذف‌شده از کانال: ${beforeCount - archive.length} پست`);

  const archiveIds = new Set(archive.map(p => p.postId));
  const newPosts   = [...livePosts.values()].filter(p => !archiveIds.has(p.postId));
  console.log(`پست‌های جدید: ${newPosts.length}`);

  archive = [...newPosts, ...archive];
  archive.sort((a, b) => new Date(b.isoDate) - new Date(a.isoDate));
  fs.writeFileSync(archiveFile, JSON.stringify(archive, null, 2));
  console.log(`کل آرشیو: ${archive.length}`);

  const pinnedSet   = new Set(pinnedLinks);
  const pinnedPosts = archive
    .filter(p =>
      (isImportant(p.text) && isStillPinnable(p.isoDate)) ||
      pinnedSet.has(p.postLink)
    )
    .slice(0, PIN_MAX_COUNT);

  const pinnedPostIds = new Set(pinnedPosts.map(p => p.postId));
  const regularPosts  = archive.filter(p => !pinnedPostIds.has(p.postId));
  const totalPages    = Math.max(1, Math.ceil(regularPosts.length / postsPerPage));

  const dateFormatter = new Intl.DateTimeFormat('fa-IR', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const lastUpdatedText = `آخرین بروزرسانی: ${dateFormatter.format(new Date())}`;
  const baseTemplate    = fs.readFileSync(pageFile, 'utf8');

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const fromRoot   = pageNum === 1;
    const slice      = regularPosts.slice((pageNum - 1) * postsPerPage, pageNum * postsPerPage);
    const pagination = buildPagination(pageNum, totalPages, fromRoot);

    let postsHtml = '';

    if (pageNum === 1 && pinnedPosts.length > 0) {
      postsHtml += `<div style="margin-bottom:28px;">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:14px;">
          <span style="display:inline-block; width:4px; height:20px; background:#e07000; border-radius:2px;"></span>
          <h2 style="margin:0; font-size:1rem; color:#e07000;">اطلاعیه‌های مهم</h2>
        </div>`;
      pinnedPosts.forEach(p => { postsHtml += pinnedPostToHtml(p, dateFormatter) + '\n'; });
      postsHtml += `</div>
        <hr style="border:none; border-top:1px solid #e8eaf0; margin:24px 0;">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:14px;">
          <span style="display:inline-block; width:4px; height:20px; background:#33417A; border-radius:2px;"></span>
          <h2 style="margin:0; font-size:1rem; color:#33417A;">همه اطلاعیه‌ها</h2>
        </div>`;
    }

    if (slice.length === 0) {
      postsHtml += '<div class="info-card" style="display:block; text-align:center;"><p>در حال حاضر اطلاعیه‌ای ثبت نشده است.</p></div>\n';
    } else {
      slice.forEach(p => { postsHtml += postToHtml(p, dateFormatter) + '\n'; });
    }

    postsHtml += pagination;

    const schemaItems = slice.map((post, i) => ({
      '@type': 'ListItem',
      position: (pageNum - 1) * postsPerPage + i + 1,
      item: {
        '@type': 'SocialMediaPosting',
        headline: post.text.split('\n')[0].trim().slice(0, 70),
        articleBody: post.text,
        datePublished: post.isoDate,
        url: post.postLink,
        author: { '@type': 'Organization', name: 'کافی‌نت بیات' }
      }
    }));

    const schemaJson = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: schemaItems
    }, null, 2);

    const pageTitle = pageNum === 1
      ? 'اطلاعیه‌های ثبت‌نام - کافی‌نت بیات'
      : `اطلاعیه‌ها - صفحه ${pageNum} - کافی‌نت بیات`;

    let pageHtml = baseTemplate.replace(/<title>[^<]*<\/title>/, `<title>${pageTitle}</title>`);
    pageHtml = replaceBetween(pageHtml, '<!-- START_POSTS -->',        '<!-- END_POSTS -->',        '\n        ' + postsHtml);
    pageHtml = replaceBetween(pageHtml, '<!-- LAST_UPDATED_START -->', '<!-- LAST_UPDATED_END -->', lastUpdatedText);
    pageHtml = replaceBetween(pageHtml, '<!-- START_SCHEMA -->',       '<!-- END_SCHEMA -->',
      `\n    <script type="application/ld+json">\n${schemaJson}\n    </script>\n    `);

    // canonical و prev/next
    const canonical = fromRoot ? 'announcements.html' : `announcements-pages/page-${pageNum}.html`;
    const prevHref  = pageNum === 2 ? '../announcements.html' : `page-${pageNum - 1}.html`;
    const nextHref  = fromRoot ? `announcements-pages/page-${pageNum + 1}.html` : `page-${pageNum + 1}.html`;
    const prevLink  = pageNum > 1         ? `<link rel="prev" href="${prevHref}">` : '';
    const nextLink  = pageNum < totalPages ? `<link rel="next" href="${nextHref}">` : '';
    pageHtml = pageHtml.replace('</head>',
      `\n    <link rel="canonical" href="${canonical}">\n    ${prevLink}\n    ${nextLink}\n</head>`);

    const outFile = fromRoot
      ? path.join(__dirname, '..', 'announcements.html')
      : path.join(pagesDir, `page-${pageNum}.html`);

    fs.writeFileSync(outFile, pageHtml);
    console.log(`صفحه ${pageNum} ذخیره شد: ${path.relative(path.join(__dirname, '..'), outFile)}`);
  }

  console.log('✅ سایت با موفقیت بروزرسانی شد.');
}

main().catch(err => {
  console.error('خطا:', err);
  process.exit(1);
});
