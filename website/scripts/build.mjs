import { cp, mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const outputRoot = path.join(siteRoot, 'dist');
export const aboutFile = path.resolve(siteRoot, '..', '01_About_Me_中英文草稿.md');
const languages = ['en', 'zh'];
const pages = ['about', 'research', 'sharing'];
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[character]));

function extractSection(markdown, heading) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex(line => line.trim() === `## ${heading}`);
  if (start < 0) throw new Error(`About Me source is missing the heading: ## ${heading}`);
  const next = lines.findIndex((line, index) => index > start && /^#{1,2}\s/.test(line));
  const text = lines.slice(start + 1, next < 0 ? lines.length : next).join('\n').trim();
  const paragraphs = text.split(/\n\s*\n/).map(paragraph => paragraph.replace(/\n/g, ' ').trim()).filter(Boolean);
  if (!paragraphs.length) throw new Error(`About Me source contains no text under: ## ${heading}`);
  return paragraphs;
}

function extractRecommendation(markdown, heading, filename) {
  const lines = markdown.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex(line => line.trim() === `## ${heading}`);
  if (start < 0) throw new Error(`Recommendation source ${filename} is missing: ## ${heading}`);
  const next = lines.findIndex((line, index) => index > start && /^#{1,2}\s/.test(line));
  return lines.slice(start + 1, next < 0 ? lines.length : next).join('\n').trim()
    .split(/\n\s*\n/).map(paragraph => paragraph.replace(/\n/g, ' ').trim()).filter(Boolean);
}

function assetSetting(config, key) {
  const value = config[key];
  if (value == null || value === '') return null;
  return safeAssetPath(value, key);
}

function safeAssetPath(value, label) {
  if (typeof value !== 'string' || !/^assets\/[\p{L}\p{N}_\-./ ]+$/u.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`${label} must be a local assets/ path without traversal, query strings or fragments.`);
  }
  const publicRoot = path.join(siteRoot, 'public');
  const resolved = path.resolve(publicRoot, value);
  if (!resolved.startsWith(publicRoot + path.sep)) throw new Error(`${label} is outside the public assets directory.`);
  return value;
}

function renderTemplate(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (token, key) => {
    if (!Object.hasOwn(values, key)) throw new Error(`Unresolved template value: ${token}`);
    return values[key];
  });
}

function validateStory(story, label) {
  const text = (value, field, optional = false) => {
    if (optional && value === undefined) return;
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
  };
  const paragraphs = (value, field) => {
    if (!Array.isArray(value) || value.some(paragraph => typeof paragraph !== 'string' || !paragraph.trim())) {
      throw new Error(`${field} must contain non-empty text paragraphs.`);
    }
  };
  if (!story || typeof story !== 'object' || Array.isArray(story)) throw new Error(`${label} must be a story object.`);
  if (story.references !== undefined) {
    if (!Array.isArray(story.references)) throw new Error(`${label}.references must be an array.`);
    for (const reference of story.references) {
      if (!reference || typeof reference !== 'object' || Array.isArray(reference)) throw new Error(`${label}.references must contain reference objects.`);
      text(reference.label, `${label}.references.label`);
      text(reference.title, `${label}.references.title`);
      text(reference.url, `${label}.references.url`);
      let target;
      try { target = new URL(reference.url); }
      catch { throw new Error(`${label}.references.url must be a valid HTTPS URL.`); }
      if (target.protocol !== 'https:' || !target.hostname || target.username || target.password) throw new Error(`${label}.references.url must be an HTTPS URL without credentials.`);
    }
  }
  text(story.intro, `${label}.intro`);
  text(story.contentsLabel, `${label}.contentsLabel`, true);
  text(story.creditsTitle, `${label}.creditsTitle`, true);
  if (!Array.isArray(story.sections) || !story.sections.length) throw new Error(`${label}.sections must contain at least one section.`);
  const ids = new Set();
  for (const section of story.sections) {
    if (!section || typeof section !== 'object' || Array.isArray(section)) throw new Error(`${label}.sections must contain section objects.`);
    if (typeof section.id !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(section.id) || ids.has(section.id)) throw new Error(`${label} contains an invalid or duplicate section id.`);
    ids.add(section.id);
    const sectionLabel = `${label}.${section.id}`;
    text(section.title, `${sectionLabel}.title`);
    text(section.eyebrow, `${sectionLabel}.eyebrow`, true);
    paragraphs(section.paragraphs, `${sectionLabel}.paragraphs`);
    if (section.layout !== undefined && !['wide', 'pair'].includes(section.layout)) throw new Error(`${sectionLabel}.layout must be wide or pair.`);
    if (section.points !== undefined) {
      if (!Array.isArray(section.points)) throw new Error(`${sectionLabel}.points must be an array.`);
      for (const point of section.points) {
        if (!point || typeof point !== 'object' || Array.isArray(point)) throw new Error(`${sectionLabel}.points must contain title/text objects.`);
        text(point.title, `${sectionLabel}.points.title`);
        text(point.text, `${sectionLabel}.points.text`);
      }
    }
    if (!Array.isArray(section.media)) throw new Error(`${sectionLabel}.media must be an array.`);
    for (const media of section.media) {
      if (!media || typeof media !== 'object' || Array.isArray(media) || !['image', 'video'].includes(media.type)) throw new Error(`${sectionLabel}.media type must be image or video.`);
      safeAssetPath(media.src, `${sectionLabel}.media.src`);
      const extension = media.type === 'image' ? /\.(png|jpe?g|webp|gif|svg|avif)$/i : /\.(mp4|webm)$/i;
      if (!extension.test(media.src)) throw new Error(`Unsupported story ${media.type}: ${media.src}`);
      text(media.alt, `${sectionLabel}.media.alt`);
      text(media.title, `${sectionLabel}.media.title`, true);
      text(media.caption, `${sectionLabel}.media.caption`, true);
      if (media.panels !== undefined) {
        if (media.type !== 'video' || !Array.isArray(media.panels) || !media.panels.length) throw new Error(`${sectionLabel}.media.panels must be a non-empty array on a video.`);
        for (const panel of media.panels) {
          if (!panel || typeof panel !== 'object' || Array.isArray(panel)) throw new Error(`${sectionLabel}.media.panels must contain title/text objects.`);
          text(panel.title, `${sectionLabel}.media.panels.title`);
          text(panel.text, `${sectionLabel}.media.panels.text`);
        }
      }
      if (media.readingNotes !== undefined) {
        if (!Array.isArray(media.readingNotes) || !media.readingNotes.length) throw new Error(`${sectionLabel}.media.readingNotes must be a non-empty array.`);
        for (const note of media.readingNotes) {
          if (!note || typeof note !== 'object' || Array.isArray(note)) throw new Error(`${sectionLabel}.media.readingNotes must contain title/text objects.`);
          text(note.title, `${sectionLabel}.media.readingNotes.title`);
          text(note.text, `${sectionLabel}.media.readingNotes.text`);
        }
      }
      if (media.span !== undefined && media.span !== 'wide') throw new Error(`${sectionLabel}.media.span must be wide when provided.`);
      if (media.width !== undefined || media.height !== undefined) {
        if (!Number.isInteger(media.width) || media.width < 1 || !Number.isInteger(media.height) || media.height < 1) {
          throw new Error(`${sectionLabel}.media dimensions must both be positive integers.`);
        }
      }
      if (media.poster !== undefined) {
        if (media.type !== 'video') throw new Error(`${sectionLabel}.media.poster is only supported for videos.`);
        safeAssetPath(media.poster, `${sectionLabel}.media.poster`);
        if (!/\.(png|jpe?g|webp|gif|svg|avif)$/i.test(media.poster)) throw new Error(`Unsupported video poster: ${media.poster}`);
      }
    }
  }
  if (story.credits !== undefined) paragraphs(story.credits, `${label}.credits`);
  if (story.references !== undefined) {
    const citedTexts = [story.intro, ...(story.credits || [])];
    for (const section of story.sections) {
      citedTexts.push(...section.paragraphs);
      for (const point of section.points || []) citedTexts.push(point.title, point.text);
      for (const media of section.media) {
        if (media.caption !== undefined) citedTexts.push(media.caption);
        for (const note of media.readingNotes || []) citedTexts.push(note.title, note.text);
      }
    }
    for (const value of citedTexts) for (const match of value.matchAll(/\[(\d+)\]/g)) {
      const number = Number(match[1]);
      if (!Number.isSafeInteger(number) || number < 1 || number > story.references.length) throw new Error(`${label} cites missing reference [${match[1]}].`);
    }
  }
}

function validateCopy(copy, language) {
  for (const key of ['meta', 'nav', 'profile', 'ui', 'about', 'research', 'sharing']) {
    if (!copy[key] || typeof copy[key] !== 'object') throw new Error(`${language}.json is missing ${key}.`);
  }
  if (!Array.isArray(copy.about.interests) || !Array.isArray(copy.research.projects) || !Array.isArray(copy.sharing.sections)) {
    throw new Error(`${language}.json must include about.interests, research.projects and sharing.sections arrays.`);
  }
  for (const [section, items] of [['research', copy.research.projects], ['sharing', copy.sharing.sections]]) {
    const ids = new Set();
    for (const item of items) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id) || ids.has(item.id)) throw new Error(`${language}.${section} contains an invalid or duplicate id: ${item.id}`);
      ids.add(item.id);
      if (typeof item.title !== 'string' || !item.title.trim()) throw new Error(`${language}.${section}.${item.id} is missing a title.`);
      if (section === 'research' && (!Array.isArray(item.bullets) || !item.bullets.length || !Array.isArray(item.metadata))) {
        throw new Error(`${language}.${section}.${item.id} must contain CV bullets and metadata arrays.`);
      }
      if (section === 'research' && item.thumbnail !== undefined) {
        const thumbnail = item.thumbnail;
        const label = `${language}.${section}.${item.id}.thumbnail`;
        if (!thumbnail || typeof thumbnail !== 'object' || Array.isArray(thumbnail)) throw new Error(`${label} must be an image object.`);
        safeAssetPath(thumbnail.src, `${label}.src`);
        if (!/\.(png|jpe?g|webp|gif|svg|avif)$/i.test(thumbnail.src)) throw new Error(`Unsupported thumbnail image: ${thumbnail.src}`);
        if (typeof thumbnail.alt !== 'string' || !thumbnail.alt.trim()) throw new Error(`Thumbnail alt text is required: ${label}`);
        if (!Number.isInteger(thumbnail.width) || thumbnail.width < 1 || !Number.isInteger(thumbnail.height) || thumbnail.height < 1) {
          throw new Error(`${label} must include positive integer width and height.`);
        }
      }
      if (item.story !== undefined) {
        if (section !== 'research') throw new Error(`${language}.${section}.${item.id}.story is only supported for research projects.`);
        validateStory(item.story, `${language}.${section}.${item.id}.story`);
      }
      if (section === 'sharing') {
        const label = `${language}.sharing.${item.id}`;
        if (item.books !== undefined) {
          if (!Array.isArray(item.books)) throw new Error(`${label}.books must be an array.`);
          const bookIds = new Set();
          for (const book of item.books) {
            if (!book || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(book.id) || bookIds.has(book.id)) throw new Error(`${label} contains an invalid or duplicate book id.`);
            bookIds.add(book.id);
            if (typeof book.title !== 'string' || !book.title.trim()) throw new Error(`${label}.${book.id} requires a title.`);
            if (typeof book.recommendationFile !== 'string' || !/^[\p{L}\p{N}_ -]+\.md$/u.test(book.recommendationFile)) throw new Error(`${label}.${book.id} requires a local recommendation filename.`);
            const cover = book.cover;
            if (!cover || typeof cover !== 'object') throw new Error(`${label}.${book.id} requires a cover.`);
            safeAssetPath(cover.src, `${label}.${book.id}.cover.src`);
            if (!/\.(png|jpe?g|webp|gif|svg|avif)$/i.test(cover.src) || typeof cover.alt !== 'string' || !cover.alt.trim()) throw new Error(`${label}.${book.id} requires a cover image with alt text.`);
            if (!Number.isInteger(cover.width) || cover.width < 1 || !Number.isInteger(cover.height) || cover.height < 1) throw new Error(`${label}.${book.id} cover dimensions are required.`);
          }
        }
        for (const [collection,images] of [['gallery',item.gallery],['stills',item.film?.stills]]) {
          if (images !== undefined && !Array.isArray(images)) throw new Error(`${label}.${collection} must be an array.`);
          for (const image of images || []) {
            safeAssetPath(image.src, `${label}.${collection}.src`);
            if (!/\.(png|jpe?g|webp|gif|svg|avif)$/i.test(image.src) || typeof image.alt !== 'string' || !image.alt.trim()) throw new Error(`${label}.${collection} requires images with alt text.`);
            if (!Number.isInteger(image.width) || image.width < 1 || !Number.isInteger(image.height) || image.height < 1) throw new Error(`${label}.${collection} requires positive image dimensions.`);
          }
        }
        if (item.film !== undefined) {
          const film = item.film;
          if (!film || typeof film !== 'object' || Array.isArray(film)) throw new Error(`${label}.film must be an object.`);
          for (const field of ['title','subtitle','credit','trailerTitle','aboutTitle','postersTitle','closeLabel','enlargeLabel','galleryLabel','videoFallback']) {
            if (typeof film[field] !== 'string' || !film[field].trim()) throw new Error(`${label}.film.${field} is required.`);
          }
          if (!Array.isArray(film.paragraphs) || film.paragraphs.some(value=>typeof value !== 'string' || !value.trim())) throw new Error(`${label}.film.paragraphs must contain text.`);
          for (const field of ['releaseNotice','stillsTitle','enlargeStillLabel']) {
            if (film[field] !== undefined && (typeof film[field] !== 'string' || !film[field].trim())) throw new Error(`${label}.film.${field} must contain text.`);
          }
          if (film.stills?.length && (!film.stillsTitle || !film.enlargeStillLabel)) throw new Error(`${label}.film stills require labels.`);
          const video = film.trailer;
          if (!video || typeof video !== 'object' || typeof video.alt !== 'string' || !video.alt.trim()) throw new Error(`${label}.film.trailer is required.`);
          safeAssetPath(video.src, `${label}.film.trailer.src`);
          safeAssetPath(video.poster, `${label}.film.trailer.poster`);
          if (!/\.(mp4|webm)$/i.test(video.src) || !/\.(png|jpe?g|webp|avif)$/i.test(video.poster)) throw new Error(`${label}.film.trailer has unsupported media.`);
          if (!Number.isInteger(video.width) || video.width < 1 || !Number.isInteger(video.height) || video.height < 1) throw new Error(`${label}.film.trailer dimensions are required.`);
          if (!item.gallery?.length) throw new Error(`${label}.film requires a poster gallery.`);
        }
      }
      for (const field of ['body', 'figures']) if (item[field] !== undefined && !Array.isArray(item[field])) throw new Error(`${language}.${section}.${item.id}.${field} must be an array.`);
      for (const field of ['body', 'bullets', 'metadata']) if (item[field]?.some(value => typeof value !== 'string')) throw new Error(`${language}.${section}.${item.id}.${field} must contain strings.`);
      if (item.resultsEmpty !== undefined && (typeof item.resultsEmpty !== 'string' || !item.resultsEmpty.trim())) throw new Error(`${language}.${section}.${item.id}.resultsEmpty must contain text.`);
      for (const figure of item.figures || []) {
        safeAssetPath(figure.src, `${language}.${section}.${item.id}.figures.src`);
        if (!/\.(png|jpe?g|webp|gif|svg|avif)$/i.test(figure.src)) throw new Error(`Unsupported figure image: ${figure.src}`);
        if (typeof figure.alt !== 'string' || !figure.alt.trim()) throw new Error(`Figure alt text is required: ${figure.src}`);
        if (figure.caption !== undefined && typeof figure.caption !== 'string') throw new Error(`Figure caption must be a string: ${figure.src}`);
      }
    }
  }
}

function renderParagraphs(paragraphs, className = '') {
  return (paragraphs || []).map(paragraph => `<p${className ? ` class="${className}"` : ''}>${escapeHtml(paragraph)}</p>`).join('\n');
}

function renderProjectMetadata(project) {
  return `<p class="project-period">${escapeHtml(project.period || '')}</p><div class="project-meta">${renderParagraphs(project.metadata)}</div>`;
}

function renderBullets(bullets) {
  return `<ul class="research-bullets">${bullets.map(bullet => `<li>${escapeHtml(bullet)}</li>`).join('\n')}</ul>`;
}

function renderResearchEntry(copy, project, href, rootPrefix) {
  const destination = href('research', undefined, project.id);
  const heading = `<div class="research-entry-heading"><h3><a class="entry-title-link" href="${destination}">${escapeHtml(project.title)} <span class="entry-arrow" aria-hidden="true">→</span></a></h3>${renderProjectMetadata(project)}</div>`;
  const bullets = renderBullets(project.bullets);
  if (!project.thumbnail) return `<li class="research-entry" id="${escapeHtml(project.id)}">${heading}${bullets}</li>`;
  const thumbnail = project.thumbnail;
  return `<li class="research-entry research-entry--illustrated" id="${escapeHtml(project.id)}"><a class="research-thumbnail" href="${destination}" aria-label="${escapeHtml(copy.research.openLabel + ': ' + project.title)}"><img src="${escapeHtml(rootPrefix + thumbnail.src)}" alt="${escapeHtml(thumbnail.alt)}" width="${thumbnail.width}" height="${thumbnail.height}" loading="lazy" decoding="async"></a><div class="research-entry-content">${heading}${bullets}</div></li>`;
}

function renderFigures(figures, rootPrefix) {
  return (figures || []).map(figure => `<figure class="result-figure"><img src="${escapeHtml(rootPrefix + figure.src)}" alt="${escapeHtml(figure.alt)}" loading="lazy">${figure.caption ? `<figcaption>${escapeHtml(figure.caption)}</figcaption>` : ''}</figure>`).join('\n');
}

function renderBackLink(label, target, bottom = false) {
  return `<a class="back-link${bottom ? ' back-link--bottom' : ''}" href="${escapeHtml(target)}"><span aria-hidden="true">←</span> ${escapeHtml(label)}</a>`;
}

function renderBookGallery(copy, section, href, rootPrefix) {
  return `<div class="sharing-gallery sharing-gallery--books">${section.books.map((book,index)=>`<a class="sharing-artwork sharing-artwork--${index+1}" href="${href('sharing',undefined,section.id)}" aria-label="${escapeHtml(copy.sharing.openLabel+': '+book.title)}"><img src="${rootPrefix}${escapeHtml(book.cover.src)}" alt="${escapeHtml(book.cover.alt)}" width="${book.cover.width}" height="${book.cover.height}" loading="lazy" decoding="async"></a>`).join('\n')}</div>`;
}

function renderReadingPage(copy, section, href, rootPrefix) {
  const parent = `${href('sharing')}#${section.id}`;
  const chinese = copy.localeLabel === '中文';
  const recommendationsTitle = chinese ? '网文推荐' : 'Web fiction recommendations';
  const currentlyReadingTitle = chinese ? '正在阅读' : 'Currently reading';
  const currentlyReadingBook = chinese ? '毛泽东选集·第二卷' : 'Selected Works of Mao Tse-tung, Volume II';
  const recommendationLabel = chinese ? '推荐语' : 'Recommendation';
  const books = section.books.map(book=>`<section class="book-layout reading-book" id="${escapeHtml(book.id)}" aria-labelledby="book-${escapeHtml(book.id)}-heading"><figure class="book-cover"><img src="${rootPrefix}${escapeHtml(book.cover.src)}" alt="${escapeHtml(book.cover.alt)}" width="${book.cover.width}" height="${book.cover.height}" loading="lazy" decoding="async"></figure><div class="book-recommendation"><h3 id="book-${escapeHtml(book.id)}-heading">${escapeHtml(book.title)}</h3><p class="book-recommendation-label">${escapeHtml(recommendationLabel)}</p><div class="book-recommendation-body">${renderParagraphs(book.recommendations)}</div></div></section>`).join('\n');
  return `<article class="detail-page detail-page--reading" aria-labelledby="detail-title">
    ${renderBackLink(copy.sharing.backLabel,parent)}
    <header class="detail-header"><h1 id="detail-title" class="page-title">${escapeHtml(section.title)}<span class="heading-period" aria-hidden="true">.</span></h1></header>
    <details class="reading-group" id="web-fiction" open><summary><h2>${escapeHtml(recommendationsTitle)}</h2></summary><div class="reading-group-content">${books}</div></details>
    <details class="reading-group reading-group--current" id="currently-reading" open><summary><h2>${escapeHtml(currentlyReadingTitle)}</h2></summary><div class="reading-group-content"><p>${escapeHtml(currentlyReadingBook)}</p></div></details>
    ${renderBackLink(copy.sharing.backLabel,parent,true)}
  </article>`;
}

function renderBookRedirect(copy, section, book) {
  const destination = `../#${book.id}`;
  return `<!doctype html><html lang="${copy.localeLabel==='中文'?'zh-CN':'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="0;url=${escapeHtml(destination)}"><title>${escapeHtml(section.title)} — ${escapeHtml(copy.profile.name)}</title></head><body><main><a href="${escapeHtml(destination)}">${escapeHtml(book.title)}</a></main><script>location.replace(new URL(${JSON.stringify(destination)},location.href));</script></body></html>\n`;
}

function renderStoryText(value, references) {
  const escaped = escapeHtml(value);
  if (references === undefined) return escaped;
  return escaped.replace(/\[(\d+)\]/g, (_match, digits) => {
    const number = Number(digits);
    const reference = references[number - 1];
    if (!reference) throw new Error(`Missing story reference [${digits}].`);
    return `<a class="story-citation" href="#story-reference-${number}" title="${escapeHtml(reference.label + ': ' + reference.title)}">[${number}]</a>`;
  });
}

function renderStoryParagraphs(paragraphs, references) {
  return (paragraphs || []).map(paragraph => `<p>${renderStoryText(paragraph, references)}</p>`).join('\n');
}

function renderStoryMedia(media, rootPrefix, references) {
  const src = escapeHtml(rootPrefix + media.src);
  const dimensions = media.width ? ` width="${media.width}" height="${media.height}"` : '';
  const image = `<a class="story-image-link" href="${src}" target="_blank" rel="noopener" aria-label="${escapeHtml(media.alt)}"><img src="${src}" alt="${escapeHtml(media.alt)}"${dimensions} loading="lazy" decoding="async"></a>`;
  const poster = media.poster ? ` poster="${escapeHtml(rootPrefix + media.poster)}"` : '';
  const video = `<video controls playsinline preload="metadata" aria-label="${escapeHtml(media.alt)}"${poster}${dimensions}><source src="${src}" type="${media.src.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4'}"><a href="${src}">${escapeHtml(media.alt)}</a></video>`;
  const panels = media.panels?.length ? `<dl class="story-panel-notes">${media.panels.map(panel => `<div><dt>${escapeHtml(panel.title)}</dt><dd>${escapeHtml(panel.text)}</dd></div>`).join('')}</dl>` : '';
  const readingNotes = media.readingNotes?.length ? `<dl class="story-reading-notes">${media.readingNotes.map(note => `<div><dt>${renderStoryText(note.title, references)}</dt><dd>${renderStoryText(note.text, references)}</dd></div>`).join('')}</dl>` : '';
  const caption = media.title || media.caption || panels || readingNotes ? `<figcaption>${media.title ? `<strong class="story-media-title">${escapeHtml(media.title)}</strong>` : ''}${media.caption ? `<span>${renderStoryText(media.caption, references)}</span>` : ''}${panels}${readingNotes}</figcaption>` : '';
  return `<figure class="story-media story-media--${media.type}${media.span === 'wide' ? ' story-media--wide' : ''}"><div class="story-media-stage story-media-stage--${media.type}">${media.type === 'image' ? image : video}</div>${caption}</figure>`;
}

function renderStory(copy, story, rootPrefix) {
  const chinese = copy.localeLabel === '中文';
  const contentsLabel = story.contentsLabel || (chinese ? '本页内容' : 'On this page');
  const creditsTitle = story.creditsTitle || (chinese ? '来源与合作' : 'Sources & collaboration');
  const navigation = `<nav class="story-contents" aria-label="${escapeHtml(contentsLabel)}"><ol>${story.sections.map((section, index) => `<li><a href="#story-${section.id}"><span class="story-contents-number" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span><span>${escapeHtml(section.title)}</span><span class="story-contents-arrow" aria-hidden="true">↓</span></a></li>`).join('')}</ol></nav>`;
  const sections = story.sections.map((section, index) => `<section class="story-section" id="story-${section.id}" aria-labelledby="story-${section.id}-heading">
    <header class="story-section-header"><div class="story-kicker"><span class="story-section-number" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>${section.eyebrow ? `<span>${escapeHtml(section.eyebrow)}</span>` : ''}</div><h2 id="story-${section.id}-heading">${escapeHtml(section.title)}</h2></header>
    <div class="story-prose">${renderStoryParagraphs(section.paragraphs, story.references)}</div>
    ${section.points?.length ? `<dl class="story-points">${section.points.map(point => `<div><dt>${renderStoryText(point.title, story.references)}</dt><dd>${renderStoryText(point.text, story.references)}</dd></div>`).join('')}</dl>` : ''}
    ${section.media.length ? `<div class="story-media-grid story-media-grid--${section.layout || 'wide'}">${section.media.map(media => renderStoryMedia(media, rootPrefix, story.references)).join('')}</div>` : ''}
  </section>`).join('\n');
  const credits = story.credits?.length ? `<footer class="story-credits"><h2>${escapeHtml(creditsTitle)}</h2>${renderStoryParagraphs(story.credits, story.references)}</footer>` : '';
  const references = story.references?.length ? `<section class="story-references" aria-labelledby="story-bibliography-heading"><h2 id="story-bibliography-heading">${chinese ? '参考文献' : 'References'}</h2><ol>${story.references.map((reference, index) => `<li id="story-reference-${index + 1}"><span class="story-reference-label">${escapeHtml(reference.label)}</span> <a href="${escapeHtml(reference.url)}" target="_blank" rel="noopener">${escapeHtml(reference.title)}</a></li>`).join('')}</ol></section>` : '';
  return navigation + sections + credits + references;
}

function renderDetailContent(copy, page, item, href, rootPrefix) {
  const parent = `${href(page)}#${item.id}`;
  const backLabel = copy[page].backLabel;
  const title = `<h1 id="detail-title" class="page-title">${escapeHtml(item.title)}<span class="heading-period" aria-hidden="true">.</span></h1>`;
  if (page === 'sharing' && item.books?.length) return renderReadingPage(copy,item,href,rootPrefix);
  if (page === 'sharing' && item.film) {
    const film = item.film;
    const video = film.trailer;
    const chinese = copy.localeLabel === '中文';
    const previousLabel = chinese ? '上一张' : 'Previous image';
    const nextLabel = chinese ? '下一张' : 'Next image';
    const pauseLabel = chinese ? '暂停轮播' : 'Pause slideshow';
    const playLabel = chinese ? '继续轮播' : 'Resume slideshow';
    const imageButtons = (images,label,className='',group='posters') => images.map((image,index)=>`<button class="film-poster-button${className?' '+className:''}" type="button" data-image-viewer data-image-group="${group}" data-image-src="${rootPrefix}${escapeHtml(image.src)}" data-image-alt="${escapeHtml(image.alt)}" aria-label="${escapeHtml(label)} ${index+1}"><img src="${rootPrefix}${escapeHtml(image.src)}" alt="${escapeHtml(image.alt)}" width="${image.width}" height="${image.height}" loading="lazy" decoding="async" draggable="false"></button>`).join('\n');
    const posters = imageButtons(item.gallery,film.enlargeLabel);
    const stills = film.stills?.length ? `<section class="film-stills" aria-labelledby="film-stills-heading"><h2 class="film-section-title" id="film-stills-heading">${escapeHtml(film.stillsTitle)}</h2><div class="film-still-carousel" data-still-carousel role="region" aria-label="${escapeHtml(film.stillsTitle)}"><div class="film-still-track" data-still-track>${imageButtons(film.stills,film.enlargeStillLabel,'film-still-button','stills')}</div><div class="film-still-controls"><button class="gallery-control" type="button" data-still-previous aria-label="${escapeHtml(previousLabel)}"><span aria-hidden="true">←</span></button><span class="gallery-count" data-still-count aria-live="off" aria-atomic="true">1 / ${film.stills.length}</span><button class="gallery-control" type="button" data-still-next aria-label="${escapeHtml(nextLabel)}"><span aria-hidden="true">→</span></button><button class="gallery-control gallery-control--autoplay" type="button" data-still-toggle data-pause-label="${escapeHtml(pauseLabel)}" data-play-label="${escapeHtml(playLabel)}" aria-label="${escapeHtml(pauseLabel)}" aria-pressed="false">${escapeHtml(pauseLabel)}</button></div></div></section>` : '';
    return `<article class="detail-page detail-page--film" aria-labelledby="detail-title">
      ${renderBackLink(backLabel,parent)}
      <header class="film-header"><h1 id="detail-title" class="page-title">${escapeHtml(film.title)}<span class="heading-period" aria-hidden="true">.</span></h1><p class="film-subtitle">${escapeHtml(film.subtitle)}</p><p class="film-credit">${escapeHtml(film.credit)}</p></header>
      <section class="film-trailer" id="trailer" aria-labelledby="trailer-heading"><h2 class="film-section-title" id="trailer-heading">${escapeHtml(film.trailerTitle)}</h2><div class="film-player"><video controls playsinline preload="metadata" width="${video.width}" height="${video.height}" poster="${rootPrefix}${escapeHtml(video.poster)}" aria-label="${escapeHtml(video.alt)}"><source src="${rootPrefix}${escapeHtml(video.src)}" type="${video.src.endsWith('.webm')?'video/webm':'video/mp4'}"><a href="${rootPrefix}${escapeHtml(video.src)}">${escapeHtml(film.videoFallback)}</a></video></div>${film.releaseNotice?`<p class="film-release">${escapeHtml(film.releaseNotice)}</p>`:''}</section>
      <section class="film-copy" aria-labelledby="film-about-heading"><h2 class="film-section-title" id="film-about-heading">${escapeHtml(film.aboutTitle)}</h2>${renderParagraphs(film.paragraphs)}</section>
      ${stills}
      <section class="film-posters" aria-labelledby="film-posters-heading"><h2 class="film-section-title" id="film-posters-heading">${escapeHtml(film.postersTitle)}</h2><div class="film-poster-grid">${posters}</div></section>
      ${renderBackLink(backLabel,parent,true)}
      <dialog class="image-viewer" aria-label="${escapeHtml(film.galleryLabel)}"><button class="image-viewer-close" type="button" aria-label="${escapeHtml(film.closeLabel)}"><span aria-hidden="true">×</span></button><div class="image-viewer-stage"><button class="image-viewer-nav image-viewer-previous" type="button" data-image-previous aria-label="${escapeHtml(previousLabel)}"><span aria-hidden="true">‹</span></button><img class="image-viewer-image" alt=""><button class="image-viewer-nav image-viewer-next" type="button" data-image-next aria-label="${escapeHtml(nextLabel)}"><span aria-hidden="true">›</span></button></div><span class="gallery-count image-viewer-count" data-image-count aria-live="polite" aria-atomic="true"></span></dialog>
    </article>`;
  }
  let contents;
  if (page === 'research' && item.story) {
    contents = `<header class="detail-header">${title}${renderProjectMetadata(item)}<p class="story-intro">${renderStoryText(item.story.intro, item.story.references)}</p></header>${renderStory(copy, item.story, rootPrefix)}`;
  } else if (page === 'research') {
    contents = `<header class="detail-header">${title}${renderProjectMetadata(item)}</header>
      <section class="content-section" aria-labelledby="overview-heading"><div class="section-heading"><h2 id="overview-heading">${escapeHtml(copy.research.overviewTitle)}</h2></div>${renderBullets(item.bullets)}${renderParagraphs(item.body, 'detail-copy')}</section>
      <section class="content-section results-section" aria-labelledby="results-heading"><div class="section-heading"><h2 id="results-heading">${escapeHtml(copy.research.resultsTitle)}</h2></div>${item.figures?.length ? renderFigures(item.figures, rootPrefix) : `<p class="empty-note">${escapeHtml(item.resultsEmpty || copy.research.resultsEmpty)}</p>`}</section>`;
  } else {
    const body = renderParagraphs(item.body, 'detail-copy');
    const figures = renderFigures(item.figures, rootPrefix);
    contents = `<header class="detail-header">${title}<p class="page-intro">${escapeHtml(item.description)}</p></header>
      <section class="content-section sharing-detail-content" aria-labelledby="collection-heading"><div class="section-heading"><h2 id="collection-heading">${escapeHtml(copy.sharing.contentTitle)}</h2></div>${body || figures ? body + figures : `<p class="empty-note">${escapeHtml(item.emptyDescription)}</p>`}</section>`;
  }
  return `<article class="detail-page${page === 'research' && item.story ? ' detail-page--story' : ''}" aria-labelledby="detail-title">${renderBackLink(backLabel, parent)}${contents}${renderBackLink(backLabel, parent, true)}</article>`;
}

function renderPageContent(copy, page, paragraphs, href, rootPrefix) {
  const title = `<h1 class="page-title">${escapeHtml(copy[page].title)}<span class="heading-period" aria-hidden="true">.</span></h1>`;
  if (page === 'about') {
    return `${title}
      <div class="about-copy">${paragraphs.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join('\n')}</div>
      <section class="content-section" aria-labelledby="research-interests-heading">
        <div class="section-heading"><h2 id="research-interests-heading">${escapeHtml(copy.about.researchInterests)}</h2><a href="${href('research')}">${escapeHtml(copy.about.moreResearch)} <span class="arrow" aria-hidden="true">↗</span></a></div>
        <ul class="interest-list">${copy.about.interests.map(interest => `<li>${escapeHtml(interest)}</li>`).join('')}</ul>
      </section>
      <section class="content-section" aria-labelledby="education-heading">
        <div class="section-heading"><h2 id="education-heading">${escapeHtml(copy.about.education)}</h2></div>
        <div class="education-entry"><div><p class="education-school">${escapeHtml(copy.about.school)}</p><p class="education-degree">${escapeHtml(copy.about.degree)}</p></div><span class="education-year">${escapeHtml(copy.about.year)}</span></div>
      </section>`;
  }
  if (page === 'research') {
    return `${title}<p class="page-intro">${escapeHtml(copy.research.intro)}</p>
      <section class="content-section" aria-labelledby="research-projects-heading">
        <div class="section-heading"><h2 id="research-projects-heading">${escapeHtml(copy.research.projectsTitle)}</h2></div>
        <ul class="research-list">${copy.research.projects.map(project => renderResearchEntry(copy, project, href, rootPrefix)).join('\n')}</ul>
      </section>
      <section class="content-section" aria-labelledby="publications-heading">
        <div class="section-heading"><h2 id="publications-heading">${escapeHtml(copy.research.publicationsTitle)}</h2></div>
        <p class="empty-note">${escapeHtml(copy.research.publicationsEmpty)}</p>
      </section>`;
  }
  const placeholders = {
    reading:'<div class="sharing-placeholder sharing-placeholder--reading" aria-hidden="true"><span class="book-object book-object--1"></span><span class="book-object book-object--2"></span><span class="book-object book-object--3"></span></div>',
    moments:'<div class="sharing-placeholder sharing-placeholder--moments" aria-hidden="true"><span class="moment-frame moment-frame--1"></span><span class="moment-frame moment-frame--2"></span><span class="moment-frame moment-frame--3"></span></div>'
  };
  return `${title}${copy.sharing.sections.map(section=>{
    const destination = href('sharing',undefined,section.id);
    const label = escapeHtml(copy.sharing.openLabel+': '+section.title);
    const gallery = section.books?.length ? renderBookGallery(copy,section,href,rootPrefix) : section.gallery?.length
      ? `<div class="sharing-gallery sharing-gallery--posters">${section.gallery.map((image,index)=>`<a class="sharing-artwork sharing-artwork--${index+1}" href="${destination}" aria-label="${label} — ${index+1}"><img src="${rootPrefix}${escapeHtml(image.src)}" alt="${escapeHtml(image.alt)}" width="${image.width}" height="${image.height}" loading="${index===0?'eager':'lazy'}" decoding="async"></a>`).join('\n')}</div>`
      : `<a class="sharing-placeholder-link sharing-artwork" href="${destination}" aria-label="${label}">${placeholders[section.id]||''}</a>`;
    return `<section class="sharing-section sharing-section--${escapeHtml(section.id)}" id="${escapeHtml(section.id)}" aria-labelledby="${escapeHtml(section.id)}-heading"><header class="sharing-section-heading"><h2 id="${escapeHtml(section.id)}-heading"><a class="section-title-link" href="${destination}">${escapeHtml(section.title)}</a></h2></header>${gallery}</section>`;
  }).join('\n')}`;
}

function renderLegacyRedirect(copy, language) {
  const destination = '../sharing/index.html';
  return `<!doctype html>
<html lang="${language === 'zh' ? 'zh-CN' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="0;url=${destination}"><title>${escapeHtml(copy.sharing.title)} — ${escapeHtml(copy.profile.name)}</title></head><body><main><p><a href="${destination}">${escapeHtml(copy.ui.legacyRedirect)}</a></p></main><script>const target = new URL(${JSON.stringify(destination)}, location.href); target.hash = location.hash; location.replace(target.href);</script></body></html>\n`;
}

export async function buildSite() {
  const [configText, template, markdown, english, chinese] = await Promise.all([
    readFile(path.join(siteRoot, 'site.config.json'), 'utf8'),
    readFile(path.join(siteRoot, 'src', 'template.html'), 'utf8'),
    readFile(aboutFile, 'utf8'),
    readFile(path.join(siteRoot, 'src', 'content', 'en.json'), 'utf8'),
    readFile(path.join(siteRoot, 'src', 'content', 'zh.json'), 'utf8')
  ]);
  const config = JSON.parse(configText.replace(/^\uFEFF/, ''));
  const copies = {en: JSON.parse(english), zh: JSON.parse(chinese)};
  const paragraphs = {en: extractSection(markdown, 'English text'), zh: extractSection(markdown, '中文正文')};
  if (!languages.includes(config.defaultLanguage)) throw new Error('defaultLanguage must be en or zh.');
  if (config.email != null && (typeof config.email !== 'string' || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(config.email))) {
    throw new Error('email must be null or a valid email address.');
  }
  const portrait = assetSetting(config, 'portrait');
  const cv = assetSetting(config, 'cv');
  for (const asset of [portrait, cv].filter(Boolean)) await access(path.join(siteRoot, 'public', asset));
  for (const language of languages) validateCopy(copies[language], language);
  for (const [key, collection] of [['research', 'projects'], ['sharing', 'sections']]) {
    const expected = copies.en[key][collection].map(item => item.id).sort().join(',');
    if (copies.zh[key][collection].map(item => item.id).sort().join(',') !== expected) throw new Error(`English and Chinese ${key} ids must match so language links remain valid.`);
  }
  for (const section of copies.en.sharing.sections) {
    const counterpart = copies.zh.sharing.sections.find(item=>item.id===section.id);
    if ((section.books||[]).map(book=>book.id).sort().join(',') !== (counterpart.books||[]).map(book=>book.id).sort().join(',')) throw new Error(`English and Chinese book ids must match in ${section.id}.`);
  }
  const recommendationSources = new Map();
  for (const language of languages) for (const section of copies[language].sharing.sections) for (const book of section.books || []) {
    const filename = path.join(siteRoot,'src/content/reading',book.recommendationFile);
    if (!recommendationSources.has(filename)) recommendationSources.set(filename,await readFile(filename,'utf8'));
    book.recommendations = extractRecommendation(recommendationSources.get(filename),language==='zh'?'中文推荐语':'English recommendation',book.recommendationFile);
  }
  const referencedFigures = languages.flatMap(language => [...copies[language].research.projects, ...copies[language].sharing.sections].flatMap(item => item.figures || []));
  for (const figure of referencedFigures) await access(path.join(siteRoot, 'public', figure.src));
  const referencedThumbnails = languages.flatMap(language => copies[language].research.projects.flatMap(project => project.thumbnail ? [project.thumbnail] : []));
  for (const thumbnail of referencedThumbnails) await access(path.join(siteRoot, 'public', thumbnail.src));
  const referencedStoryMedia = languages.flatMap(language => copies[language].research.projects.flatMap(project => project.story?.sections.flatMap(section => section.media) || []));
  const storyAssets = new Set(referencedStoryMedia.flatMap(media => [media.src, media.poster].filter(Boolean)));
  for (const asset of storyAssets) await access(path.join(siteRoot, 'public', asset));
  const sharingAssets = new Set(languages.flatMap(language=>copies[language].sharing.sections.flatMap(section=>[
    ...(section.gallery||[]).map(image=>image.src),
    ...(section.books||[]).map(book=>book.cover.src),
    ...(section.film?.stills||[]).map(image=>image.src),
    ...(section.film?[section.film.trailer.src,section.film.trailer.poster]:[])
  ])));
  for (const asset of sharingAssets) await access(path.join(siteRoot,'public',asset));

  const render = (language, page, {entry = false, detail = null} = {}) => {
    const copy = copies[language];
    const folder = entry ? '.' : path.posix.join(language, page === 'about' ? '' : page, detail?.id || '');
    const rootPrefix = `${path.posix.relative(folder, '.') || '.'}/`;
    const href = (targetPage, targetLanguage = language, detailId = '') => `${rootPrefix}${targetLanguage}/${targetPage === 'about' ? '' : `${targetPage}/`}${detailId ? `${detailId}/` : ''}`;
    const profileLinks = [
      config.email ? `<a class="profile-link" href="mailto:${escapeHtml(config.email)}">${escapeHtml(copy.profile.emailLabel)}<span class="arrow" aria-hidden="true">↗</span></a>` : `<span class="profile-link is-pending">${escapeHtml(copy.profile.emailLabel)}<span class="pending-note">${escapeHtml(copy.ui.comingSoon)}</span></span>`,
      cv ? `<a class="profile-link" href="${rootPrefix}${escapeHtml(cv)}" target="_blank" rel="noopener">${escapeHtml(copy.profile.cvLabel)}<span class="arrow" aria-hidden="true">↗</span></a>` : `<span class="profile-link is-pending">${escapeHtml(copy.profile.cvLabel)}<span class="pending-note">${escapeHtml(copy.ui.comingSoon)}</span></span>`
    ].join('\n');
    const portraitUrl = `${rootPrefix}${escapeHtml(portrait || 'assets/portrait-placeholder.svg')}`;
    const portraitAlt = escapeHtml(portrait ? copy.profile.name : copy.profile.portraitLabel);
    const portraitClass = portrait ? '' : ' is-placeholder';
    const profileSidebar = page === 'about' && !detail ? `<aside class="profile" aria-label="${escapeHtml(copy.profile.name)}">
        <img class="profile-portrait${portraitClass}" src="${portraitUrl}" alt="${portraitAlt}" width="220" height="275">
        <div class="profile-details">
          <p class="profile-name">${escapeHtml(copy.profile.name)}</p>
          <p class="profile-role">${escapeHtml(copy.profile.role)}</p>
          <p class="profile-institution">${escapeHtml(copy.profile.institution)}</p>
          <div class="profile-links">${profileLinks}</div>
        </div>
      </aside>` : '';
    return renderTemplate(template, {
      htmlLang: language === 'zh' ? 'zh-CN' : 'en',
      description: escapeHtml(copy.meta.description),
      pageTitle: `${escapeHtml(detail?.film?.title || detail?.title || copy[page].title)} — ${escapeHtml(copy.profile.name)}`,
      assetRoot: `${rootPrefix}assets`, rootPrefix, language, page,
      view: detail ? 'detail' : 'index',
      isEntry: String(entry), defaultLanguage: config.defaultLanguage,
      aboutHref: href('about'), aboutLabel: escapeHtml(copy.nav.about),
      layoutClass: page === 'about' ? 'page-layout page-layout--about' : `page-layout page-layout--full${detail ? ' page-layout--detail' : ''}`,
      profileSidebar,
      profileName: escapeHtml(copy.profile.name), profileRole: escapeHtml(copy.profile.role),
      profileInstitution: escapeHtml(copy.profile.institution), profileLinks,
      portraitUrl, portraitAlt, portraitClass,
      skipToContent: escapeHtml(copy.ui.skipToContent),
      primaryNavigation: escapeHtml(copy.ui.primaryNavigation),
      languageNavigation: escapeHtml(copy.ui.languageNavigation),
      mainNavigation: pages.map(item => `<a href="${href(item)}"${page === item ? ' aria-current="page"' : ''}>${escapeHtml(copy.nav[item])}</a>`).join('\n'),
      languageNavigationLinks: languages.map(item => `<a href="${href(page, item, detail?.id || '')}" lang="${item === 'zh' ? 'zh-CN' : 'en'}" hreflang="${item === 'zh' ? 'zh-CN' : 'en'}" data-language-switch="${item}"${language === item ? ' aria-current="true"' : ''}>${escapeHtml(copies[item].localeLabel)}</a>`).join('<span class="language-divider" aria-hidden="true">/</span>'),
      pageContent: detail ? renderDetailContent(copy, page, detail, href, rootPrefix) : renderPageContent(copy, page, paragraphs[language], href, rootPrefix),
      footer: escapeHtml(copy.ui.footer),
      footerNavigation: pages.map(item => escapeHtml(copy.nav[item])).join(' / ')
    });
  };

  const generated = [];
  for (const language of languages) for (const page of pages) {
    const directory = path.join(outputRoot, language, page === 'about' ? '' : page);
    generated.push({filename: path.join(directory, 'index.html'), html: render(language, page)});
    if (page === 'research' || page === 'sharing') {
      const items = page === 'research' ? copies[language].research.projects : copies[language].sharing.sections;
      for (const detail of items) {
        generated.push({filename: path.join(directory, detail.id, 'index.html'), html: render(language, page, {detail})});
        if (page === 'sharing') for (const book of detail.books || []) generated.push({filename:path.join(directory,detail.id,book.id,'index.html'),html:renderBookRedirect(copies[language],detail,book)});
      }
    }
  }
  generated.push({filename: path.join(outputRoot, 'index.html'), html: render(config.defaultLanguage, 'about', {entry: true})});
  for (const language of languages) generated.push({filename: path.join(outputRoot, language, 'life', 'index.html'), html: renderLegacyRedirect(copies[language], language)});
  const resolvedOutput = path.resolve(outputRoot);
  if (path.dirname(resolvedOutput) !== siteRoot || path.basename(resolvedOutput) !== 'dist') {
    throw new Error('Refusing to clear an output directory outside this website.');
  }
  // dist is generated exclusively from the source files above.
  await rm(resolvedOutput, {recursive: true, force: true});
  await mkdir(outputRoot, {recursive: true});
  await cp(path.join(siteRoot, 'public'), outputRoot, {recursive: true});
  await mkdir(path.join(outputRoot, 'assets'), {recursive: true});
  await Promise.all(['styles.css', 'app.js'].map(name => cp(path.join(siteRoot, 'src', name), path.join(outputRoot, 'assets', name))));
  for (const {filename, html} of generated) {
    await mkdir(path.dirname(filename), {recursive: true});
    await writeFile(filename, html, 'utf8');
  }
  return {pages: generated.length, canonicalPages: generated.length - languages.length, output: outputRoot, aboutSource: aboutFile};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildSite().then(result => console.log(`Built ${result.pages} pages in ${result.output}`)).catch(error => {
    console.error(`Build failed: ${error.message}`);
    process.exitCode = 1;
  });
}
