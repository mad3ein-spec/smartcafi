const fs = require('fs');
const path = require('path');

// ─── تنظیمات ───────────────────────────────────────────────
const channelId      = 'smartcafi_news';
const postsPerPage   = 15;
const archiveFile    = path.join(__dirname, '..', 'posts.json');
const pageFile       = path.join(__dirname, '..', 'announcements.html');
const configFile     = path.join(__dirname, '..', 'pinned-config.json');

// کلمات کلیدی که پست را خودکار پین می‌کنند
const AUTO_PIN_KEYWORDS = [
  'ایران خودرو', 'ایران‌خودرو', 'سایپا', 'کنکور', 'کارشناسی ارشد',
  'دکتری', 'وام', 'یارانه', 'ثبت‌نام', 'ثبت نام', 'استخدام',
  'آزمون', 'مهلت', 'فوری', 'مهم'
];

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
  return AUTO_PIN_KEYWORDS.some(kw => text.includes(kw));
}

// ─── دریافت پست‌ها از تلگرام (با pagination) ──────────────
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

// همه پست‌های موجود در تلگرام را جمع‌آوری می‌کند
async function fetchAllNew(knownIds) {
  let allNew   = [];
  let beforeId = null;
  let page     = 0;

  while (true) {
    console.log(`صفحه ${++page} از تلگرام...`);
    const batch = await fetchPosts(beforeId);
    if (!batch.length) break;

    const newOnes = batch.filter(p => !knownIds.has(p.postId));
    allNew = allNew.concat(newOnes);

    // اگر به پست‌های قدیمی رسیدیم، متوقف می‌شویم
    if (newOnes.length < batch.length) break;

    beforeId = batch[0].numId; // قدیمی‌ترین آیتم این دسته
    await new Promise(r => setTimeout(r, 700)); // throttle
  }

  return allNew;
}

// ─── ساخت HTML یک پست ─────────────────────────────────────
function postToHtml(post, dateFormatter, pinned = false) {
  const firstLine = post.text.split('\n')[0].trim();
  const headline  = firstLine.length > 70 ? firstLine.slice(0, 70) + '…' : firstLine;
  const displayDate = dateFormatter.format(new Date(post.isoDate));

  const pinnedBadge = pinned
    ? `<span style="background:#33417A;color:#fff;font-size:0.7rem;padding:2px 8px;border-radius:4px;margin-right:8px;">📌 مهم</span>`
    : '';

  return `<article class="info-card" style="display:block; border-right:4px solid ${pinned ? '#e63946' : '#33417A'}; margin-bottom:16px; padding:16px;" itemscope itemtype="https://schema.org/SocialMediaPosting">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:8px; flex-wrap:wrap;">
                <h3 itemprop="headline" style="margin:0; font-size:1rem; color:#33417A;">${pinnedBadge}${headline}</h3>
                <time itemprop="datePublished" datetime="${post.isoDate}" style="font-size:0.78rem; color:#888; white-space:nowrap;">${displayDate}</time>
            </div>
            <p itemprop="articleBody" style="line-height:1.8; white-space:pre-line; margin:0 0 10px 0;">${post.text}</p>
            <a itemprop="url" href="${post.postLink}" target="_blank" rel="nofollow noopener" style="font-size:0.8rem; color:#229ED9; text-decoration:none;">مشاهده پست اصلی در کانال تلگرام ←</a>
        </article>`;
}

// ─── ساخت ناوبری صفحات ─────────────────────────────────────
function buildPagination(currentPage, totalPages) {
  if (totalPages <= 1) return '';

  let links = '';
  for (let i = 1; i <= totalPages; i++) {
    const href   = i === 1 ? 'announcements.html' : `announcements-page-${i}.html`;
    const active = i === currentPage
      ? 'background:#33417A;color:#fff;'
      : 'background:#f0f2f8;color:#33417A;';
    links += `<a href="${href}" style="${active} padding:6px 14px; border-radius:6px; text-decoration:none; font-size:0.9rem; margin:0 3px;">${i}</a>`;
  }

  return `<div style="text-align:center; margin: 24px 0; direction:rtl;">
      ${links}
    </div>`;
}

// ─── اصلی ─────────────────────────────────────────────────
async function main() {

  // بارگذاری آرشیو موجود
  let archive = [];
  if (fs.existsSync(archiveFile)) {
    archive = JSON.parse(fs.readFileSync(archiveFile, 'utf8'));
  }
  const knownIds = new Set(archive.map(p => p.postId));
  console.log(`پست‌های موجود در آرشیو: ${archive.length}`);

  // بارگذاری config پین دستی
  let pinnedLinks = [];
  if (fs.existsSync(configFile)) {
    pinnedLinks = JSON.parse(fs.readFileSync(configFile, 'utf8')).pinned || [];
  }

  // دریافت پست‌های جدید
  const newPosts = await fetchAllNew(knownIds);
  console.log(`پست‌های جدید دریافت‌شده: ${newPosts.length}`);

  // افزودن به آرشیو و مرتب‌سازی بر اساس تاریخ (جدید به قدیم)
  archive = [...newPosts, ...archive];
  archive.sort((a, b) => new Date(b.isoDate) - new Date(a.isoDate));

  // ذخیره آرشیو
  fs.writeFileSync(archiveFile, JSON.stringify(archive, null, 2));
  console.log(`آرشیو ذخیره شد. کل پست‌ها: ${archive.length}`);

  // ─── تعیین پست‌های پین‌شده ───────────────────────────────
  const pinnedSet   = new Set(pinnedLinks);
  const pinnedPosts = archive.filter(
    p => pinnedSet.has(p.postLink) || isImportant(p.text)
  ).slice(0, 10);

  // پست‌های غیرپین برای آرشیو
  const pinnedPostIds = new Set(pinnedPosts.map(p => p.postId));
  const regularPosts  = archive.filter(p => !pinnedPostIds.has(p.postId));

  // ─── صفحه‌بندی ─────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(regularPosts.length / postsPerPage));

  const dateFormatter = new Intl.DateTimeFormat('fa-IR', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const lastUpdatedText = `آخرین بروزرسانی: ${dateFormatter.format(new Date())}`;
  const baseTemplate    = fs.readFileSync(pageFile, 'utf8');

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const slice      = regularPosts.slice((pageNum - 1) * postsPerPage, pageNum * postsPerPage);
    const pagination = buildPagination(pageNum, totalPages);

    let postsHtml = '';

    // پین‌ها فقط در صفحه اول
    if (pageNum === 1 && pinnedPosts.length > 0) {
      postsHtml += `<div style="margin-bottom:24px;">
        <h2 style="font-size:1rem; color:#e63946; border-bottom:2px solid #e63946; padding-bottom:6px; margin-bottom:12px;">📌 اطلاعیه‌های مهم</h2>`;
      pinnedPosts.forEach(p => { postsHtml += postToHtml(p, dateFormatter, true) + '\n'; });
      postsHtml += `</div><hr style="border:none;border-top:1px solid #e8eaf0;margin:24px 0;">
        <h2 style="font-size:1rem; color:#33417A; margin-bottom:12px;">📋 همه اطلاعیه‌ها</h2>`;
    }

    if (slice.length === 0) {
      postsHtml += '<div class="info-card" style="display:block; text-align:center;"><p>در حال حاضر اطلاعیه‌ای ثبت نشده است.</p></div>\n';
    } else {
      slice.forEach(p => { postsHtml += postToHtml(p, dateFormatter, false) + '\n'; });
    }

    postsHtml += pagination;

    // schema برای پست‌های این صفحه
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

    let pageHtml = baseTemplate
      .replace(/<title>[^<]*<\/title>/, `<title>${pageTitle}</title>`);

    pageHtml = replaceBetween(pageHtml, '<!-- START_POSTS -->',       '<!-- END_POSTS -->',         '\n        ' + postsHtml);
    pageHtml = replaceBetween(pageHtml, '<!-- LAST_UPDATED_START -->', '<!-- LAST_UPDATED_END -->',  lastUpdatedText);
    pageHtml = replaceBetween(pageHtml, '<!-- START_SCHEMA -->',      '<!-- END_SCHEMA -->',
      `\n    <script type="application/ld+json">\n${schemaJson}\n    </script>\n    `);

    // canonical + prev/next برای سئو
    const canonical = pageNum === 1 ? 'announcements.html' : `announcements-page-${pageNum}.html`;
    const prevLink  = pageNum > 1
      ? `<link rel="prev" href="${pageNum === 2 ? 'announcements.html' : `announcements-page-${pageNum - 1}.html`}">`
      : '';
    const nextLink  = pageNum < totalPages
      ? `<link rel="next" href="announcements-page-${pageNum + 1}.html">`
      : '';
    const seoTags = `\n    <link rel="canonical" href="${canonical}">\n    ${prevLink}\n    ${nextLink}`;
    pageHtml = pageHtml.replace('</head>', seoTags + '\n</head>');

    const outFile = pageNum === 1
      ? path.join(__dirname, '..', 'announcements.html')
      : path.join(__dirname, '..', `announcements-page-${pageNum}.html`);

    fs.writeFileSync(outFile, pageHtml);
    console.log(`صفحه ${pageNum} ذخیره شد: ${path.basename(outFile)}`);
  }

  console.log('✅ سایت با موفقیت بروزرسانی شد.');
}

main().catch(err => {
  console.error('خطا:', err);
  process.exit(1);
});
