const fs = require('fs');
const path = require('path');

const channelId = 'smartcafi_news';
const pageFile = path.join(__dirname, '..', 'announcements.html');

function replaceBetween(source, startMarker, endMarker, replacement) {
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker);
  if (startIndex === -1 || endIndex === -1) {
    console.log(`مارکر یافت نشد: ${startMarker} / ${endMarker}`);
    return source;
  }
  const before = source.substring(0, startIndex + startMarker.length);
  const after = source.substring(endIndex);
  return before + replacement + after;
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function main() {
  const res = await fetch(`https://t.me/s/${channelId}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  console.log('HTTP Status:', res.status);
  if (!res.ok) {
    throw new Error('درخواست به تلگرام ناموفق بود: ' + res.status);
  }

  const html = await res.text();
  console.log('طول HTML دریافتی:', html.length);

  // هر پست تلگرام با یک ویژگی data-post="channel/id" شروع می‌شود
  const blocks = html.split('data-post="').slice(1);
  console.log('تعداد بلوک‌های پیدا شده:', blocks.length);

  const posts = [];

  for (const block of blocks) {
    const postIdMatch = block.match(/^([^"]+)"/);
    if (!postIdMatch) continue;
    const postId = postIdMatch[1]; // مثل smartcafi_news/123
    const postLink = `https://t.me/${postId}`;

    const textMatch = block.match(/tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (!textMatch) continue; // پست‌های فقط-عکس بدون متن رد می‌شوند

    const dateMatch = block.match(/<time[^>]*datetime="([^"]+)"/);
    const isoDate = dateMatch ? dateMatch[1] : new Date().toISOString();

    let cleanText = textMatch[1]
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, '');
    cleanText = decodeEntities(cleanText).trim();

    if (!cleanText) continue;

    posts.push({ postId, postLink, isoDate, text: cleanText });
  }

  console.log('تعداد پست‌های معتبر استخراج‌شده:', posts.length);

  const latestPosts = posts.slice(-5).reverse();

  const dateFormatter = new Intl.DateTimeFormat('fa-IR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  let postsHtml = '';
  const schemaItems = [];

  latestPosts.forEach((post) => {
    const firstLine = post.text.split('\n')[0].trim();
    const headline = firstLine.length > 70 ? firstLine.slice(0, 70) + '…' : firstLine;
    const displayDate = dateFormatter.format(new Date(post.isoDate));

    postsHtml += `<article class="info-card" style="display:block; border-right:4px solid #33417A; margin-bottom:16px; padding:16px;" itemscope itemtype="https://schema.org/SocialMediaPosting">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:8px; flex-wrap:wrap;">
                <h3 itemprop="headline" style="margin:0; font-size:1rem; color:#33417A;">${headline}</h3>
                <time itemprop="datePublished" datetime="${post.isoDate}" style="font-size:0.78rem; color:#888; white-space:nowrap;">${displayDate}</time>
            </div>
            <p itemprop="articleBody" style="line-height:1.8; white-space:pre-line; margin:0 0 10px 0;">${post.text}</p>
            <a itemprop="url" href="${post.postLink}" target="_blank" rel="nofollow noopener" style="font-size:0.8rem; color:#229ED9; text-decoration:none;">مشاهده پست اصلی در کانال تلگرام ←</a>
        </article>
        `;

    schemaItems.push({
      '@type': 'SocialMediaPosting',
      headline: headline,
      articleBody: post.text,
      datePublished: post.isoDate,
      url: post.postLink,
      author: { '@type': 'Organization', name: 'کافی‌نت بیات' }
    });
  });

  if (!postsHtml) {
    postsHtml = '<div class="info-card" style="display:block; text-align:center;"><p>در حال حاضر اطلاعیه جدیدی ثبت نشده است.</p></div>\n        ';
  }

  const schemaJson = JSON.stringify(
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: schemaItems.map((item, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: item
      }))
    },
    null,
    2
  );

  const lastUpdatedText = `آخرین بروزرسانی: ${dateFormatter.format(new Date())}`;

  let pageHtml = fs.readFileSync(pageFile, 'utf8');

  pageHtml = replaceBetween(pageHtml, '<!-- START_POSTS -->', '<!-- END_POSTS -->', '\n        ' + postsHtml);
  pageHtml = replaceBetween(pageHtml, '<!-- LAST_UPDATED_START -->', '<!-- LAST_UPDATED_END -->', lastUpdatedText);
  pageHtml = replaceBetween(
    pageHtml,
    '<!-- START_SCHEMA -->',
    '<!-- END_SCHEMA -->',
    `\n    <script type="application/ld+json">\n${schemaJson}\n    </script>\n    `
  );

  fs.writeFileSync(pageFile, pageHtml);
  console.log('سایت با موفقیت بروزرسانی شد.');
}

main().catch((err) => {
  console.error('خطا رخ داد:', err);
  process.exit(1);
});
