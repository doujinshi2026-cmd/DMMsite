const state = {
  articles: [],
  media: [],
  currentSlug: "",
  dirty: false,
};

const $ = (id) => document.getElementById(id);

const fields = {
  title: $("titleInput"),
  slug: $("slugInput"),
  status: $("articleStatusInput"),
  article_type: $("articleTypeInput"),
  published_at: $("publishedAtInput"),
  excerpt: $("excerptInput"),
  product_title: $("productTitleInput"),
  circle_name: $("circleNameInput"),
  author_name: $("authorNameInput"),
  source_url: $("sourceUrlInput"),
  affiliate_url: $("affiliateUrlInput"),
  thumbnail_url: $("thumbnailUrlInput"),
  sample_images: $("sampleImagesInput"),
  genres: $("genresInput"),
  emotions: $("emotionsInput"),
  rights_status: $("rightsStatusInput"),
  pr_label: $("prLabelInput"),
  weekly_pick: $("weeklyPickInput"),
  weekly_pick_order: $("weeklyPickOrderInput"),
  editor_note: $("editorNoteInput"),
  body: $("bodyInput"),
};

const draftKey = "dmm-blog-editor-working-draft";

init();

async function init() {
  bindEvents();
  await Promise.all([loadArticles(), loadMedia()]);
  if (state.articles.length) {
    await openArticle(state.articles[0].slug);
  } else {
    newArticle();
  }
  $("restoreDraftButton").hidden = !localStorage.getItem(draftKey);
  updatePreviewAndChecks();
}

function bindEvents() {
  $("newArticleButton").addEventListener("click", newArticle);
  $("saveButton").addEventListener("click", saveCurrentArticle);
  $("previewPageButton").addEventListener("click", openPreviewPage);
  $("restoreDraftButton").addEventListener("click", restoreLocalDraft);
  $("searchInput").addEventListener("input", renderArticleList);
  $("statusFilter").addEventListener("change", renderArticleList);
  $("sortFilter").addEventListener("change", renderArticleList);
  $("weeklyOnlyInput").addEventListener("change", renderArticleList);
  $("templateButton").addEventListener("click", insertReviewTemplate);
  $("prBlockButton").addEventListener("click", () => toast("公開ページ上部でPR表示を自動表示します。"));
  $("ctaButton").addEventListener("click", insertCtaBlock);
  $("uploadImageButton").addEventListener("click", uploadSelectedImage);

  document.querySelectorAll("[data-insert]").forEach((button) => {
    button.addEventListener("click", () => insertText(button.dataset.insert));
  });

  document.querySelectorAll("[data-wrap]").forEach((button) => {
    button.addEventListener("click", () => wrapSelection(button.dataset.wrap));
  });

  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  Object.values(fields).forEach((field) => {
    field.addEventListener("input", () => {
      if (field === fields.title && !state.currentSlug && !fields.slug.value.trim()) {
        fields.slug.value = slugify(fields.title.value);
      }
      markDirty();
      updatePreviewAndChecks();
    });
  });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json();
      message = payload.error || message;
    } catch {
      // Keep the HTTP status message.
    }
    throw new Error(message);
  }
  return response.json();
}

async function loadArticles() {
  const payload = await api("/api/articles");
  state.articles = payload.articles || [];
  renderArticleList();
}

async function loadMedia() {
  const payload = await api("/api/media");
  state.media = payload.media || [];
  renderMediaList();
}

function renderArticleList() {
  const query = $("searchInput").value.trim().toLowerCase();
  const status = $("statusFilter").value;
  const sort = $("sortFilter").value;
  const weeklyOnly = $("weeklyOnlyInput").checked;
  const list = $("articleList");
  list.innerHTML = "";

  const filtered = state.articles.filter((article) => {
    if (status !== "all" && article.status !== status) return false;
    if (weeklyOnly && !article.weekly_pick) return false;
    if (!query) return true;
    return [
      article.title,
      article.slug,
      article.excerpt,
      article.product_title,
      article.circle_name,
      article.author_name,
      ...(article.genres || []),
      ...(article.emotions || []),
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  }).sort((left, right) => compareArticles(left, right, sort));

  renderArticleStats(filtered);
  $("articleListMeta").textContent = `${filtered.length.toLocaleString("ja-JP")} / ${state.articles.length.toLocaleString("ja-JP")}件を表示`;

  if (!filtered.length) {
    list.innerHTML = '<p class="empty-list">条件に一致する記事がありません。</p>';
    return;
  }

  for (const article of filtered) {
    const button = document.createElement("button");
    button.className = `article-item${article.slug === state.currentSlug ? " active" : ""}`;
    button.type = "button";
    const dateLabel = formatDateLabel(article.updated_at || article.published_at || article.file_updated_at);
    const sampleCount = (article.sample_images || []).length;
    const hasBody = article.body_chars === undefined ? true : Number(article.body_chars || 0) > 0;
    button.innerHTML = `
      <span class="article-thumb">${article.thumbnail_url ? `<img src="${escapeHtml(article.thumbnail_url)}" alt="">` : ""}</span>
      <span class="article-item-main">
        <span class="article-title">${escapeHtml(article.title || "Untitled")}</span>
        <span class="article-subline">
          ${escapeHtml([article.circle_name, article.author_name].filter(Boolean).join(" / ") || "サークル未入力")}
        </span>
        <span class="article-slug">${escapeHtml(article.slug)}</span>
        <span class="article-badges">
          <span class="badge status-${escapeHtml(article.status || "draft")}">${statusLabel(article.status)}</span>
          ${article.weekly_pick ? '<span class="badge pick-badge">おすすめ</span>' : ""}
          ${sampleCount ? `<span class="badge asset-badge">試読${sampleCount}</span>` : '<span class="badge warn-badge">試読なし</span>'}
          ${hasBody ? "" : '<span class="badge warn-badge">本文なし</span>'}
          ${(article.genres || []).slice(0, 2).map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join("")}
        </span>
      </span>
      <span class="article-item-side">
        <span>${escapeHtml(dateLabel)}</span>
        <span>${escapeHtml(rightsShortLabel(article.rights_status))}</span>
      </span>
    `;
    button.addEventListener("click", () => openArticle(article.slug));
    list.appendChild(button);
  }
}

function renderArticleStats(filtered) {
  const counts = statusCounts(state.articles);
  const visibleCounts = statusCounts(filtered);
  const weeklyCount = state.articles.filter((article) => article.weekly_pick).length;
  $("articleStats").innerHTML = `
    <span><strong>${state.articles.length.toLocaleString("ja-JP")}</strong>全体</span>
    <span><strong>${counts.published.toLocaleString("ja-JP")}</strong>公開</span>
    <span><strong>${counts.ready.toLocaleString("ja-JP")}</strong>準備</span>
    <span><strong>${counts.draft.toLocaleString("ja-JP")}</strong>下書き</span>
    <span><strong>${weeklyCount.toLocaleString("ja-JP")}</strong>おすすめ</span>
    <span><strong>${filtered.length.toLocaleString("ja-JP")}</strong>表示中</span>
    ${visibleCounts.archived ? `<span><strong>${visibleCounts.archived.toLocaleString("ja-JP")}</strong>保管</span>` : ""}
  `;
}

function statusCounts(articles) {
  return articles.reduce(
    (counts, article) => {
      const key = article.status || "draft";
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    },
    { draft: 0, ready: 0, published: 0, archived: 0 }
  );
}

function compareArticles(left, right, sort) {
  if (sort === "title_asc") {
    return String(left.title || left.slug || "").localeCompare(String(right.title || right.slug || ""), "ja");
  }
  if (sort === "published_desc") {
    return String(right.published_at || right.updated_at || "").localeCompare(String(left.published_at || left.updated_at || ""));
  }
  if (sort === "weekly_first") {
    const pickDiff = Number(Boolean(right.weekly_pick)) - Number(Boolean(left.weekly_pick));
    if (pickDiff) return pickDiff;
    const orderDiff = Number(left.weekly_pick_order || 0) - Number(right.weekly_pick_order || 0);
    if (orderDiff) return orderDiff;
  }
  const leftDate = String(left.updated_at || left.published_at || left.file_updated_at || "");
  const rightDate = String(right.updated_at || right.published_at || right.file_updated_at || "");
  if (leftDate !== rightDate) return rightDate.localeCompare(leftDate);
  return String(left.title || left.slug || "").localeCompare(String(right.title || right.slug || ""), "ja");
}

async function openArticle(slug) {
  if (state.dirty && !confirm("未保存の変更があります。別の記事を開きますか？")) return;

  const article = await api(`/api/articles/${encodeURIComponent(slug)}`);
  state.currentSlug = article.metadata.slug || slug;
  fillForm(article.metadata, article.body || "");
  state.dirty = false;
  updateChrome(article.file_path);
  renderArticleList();
  updatePreviewAndChecks();
}

function fillForm(metadata, body) {
  fields.title.value = metadata.title || "";
  fields.slug.value = metadata.slug || "";
  fields.status.value = metadata.status || "draft";
  fields.article_type.value = metadata.article_type || "review";
  fields.published_at.value = toDatetimeLocal(metadata.published_at);
  fields.excerpt.value = metadata.excerpt || "";
  fields.product_title.value = metadata.product_title || "";
  fields.circle_name.value = metadata.circle_name || "";
  fields.author_name.value = metadata.author_name || "";
  fields.source_url.value = metadata.source_url || "";
  fields.affiliate_url.value = metadata.affiliate_url || "";
  fields.thumbnail_url.value = metadata.thumbnail_url || "";
  fields.sample_images.value = (metadata.sample_images || []).join("\n");
  fields.genres.value = (metadata.genres || []).join("\n");
  fields.emotions.value = (metadata.emotions || []).join(", ");
  fields.rights_status.value = metadata.rights_status || "pending_review";
  fields.pr_label.value = metadata.pr_label || "PR";
  fields.weekly_pick.checked = Boolean(metadata.weekly_pick);
  fields.weekly_pick_order.value = metadata.weekly_pick_order || "";
  fields.editor_note.value = metadata.editor_note || "";
  fields.body.value = articleBodyText(metadata, body);
}

function newArticle() {
  if (state.dirty && !confirm("未保存の変更があります。新規作成しますか？")) return;

  state.currentSlug = "";
  fillForm(
    {
      title: "",
      slug: "",
      status: "draft",
      article_type: "review",
      rights_status: "pending_review",
      pr_label: "PR",
      genres: [],
      emotions: [],
      sample_images: [],
      weekly_pick: false,
      weekly_pick_order: 0,
      editor_note: "",
      author_name: "",
    },
    ""
  );
  updateChrome("content/posts/new.md");
  state.dirty = false;
  renderArticleList();
  updatePreviewAndChecks();
}

async function saveCurrentArticle() {
  const article = collectArticle();
  if (!article.title.trim()) {
    toast("タイトルを入力してください。");
    fields.title.focus();
    return;
  }

  try {
    const saved = await api("/api/articles", {
      method: "POST",
      body: JSON.stringify(article),
    });
    state.currentSlug = saved.metadata.slug;
    fields.slug.value = saved.metadata.slug;
    fields.published_at.value = toDatetimeLocal(saved.metadata.published_at);
    state.dirty = false;
    localStorage.removeItem(draftKey);
    $("restoreDraftButton").hidden = true;
    updateChrome(saved.file_path);
    await loadArticles();
    toast("保存しました。");
  } catch (error) {
    toast(`保存できませんでした: ${error.message}`);
  }
}

function collectArticle() {
  return {
    old_slug: state.currentSlug,
    title: fields.title.value,
    slug: fields.slug.value || slugify(fields.title.value),
    status: fields.status.value,
    article_type: fields.article_type.value,
    published_at: fromDatetimeLocal(fields.published_at.value),
    excerpt: fields.excerpt.value,
    product_title: fields.product_title.value,
    circle_name: fields.circle_name.value,
    author_name: fields.author_name.value,
    source_url: fields.source_url.value,
    affiliate_url: fields.affiliate_url.value,
    thumbnail_url: fields.thumbnail_url.value,
    sample_images: splitUrlList(fields.sample_images.value),
    genres: splitList(fields.genres.value),
    emotions: splitList(fields.emotions.value),
    weekly_pick: fields.weekly_pick.checked,
    weekly_pick_order: fields.weekly_pick_order.value,
    editor_note: fields.editor_note.value,
    rights_status: fields.rights_status.value,
    pr_label: fields.pr_label.value || "PR",
    body: fields.body.value,
  };
}

function updateChrome(filePath) {
  $("screenTitle").textContent = fields.title.value || "新しい記事";
  $("filePath").textContent = filePath || `content/posts/${fields.slug.value || "new"}.md`;
}

function markDirty() {
  state.dirty = true;
  updateChrome(`content/posts/${fields.slug.value || "new"}.md`);
  localStorage.setItem(draftKey, JSON.stringify(collectArticle()));
  $("restoreDraftButton").hidden = false;
}

function restoreLocalDraft() {
  const raw = localStorage.getItem(draftKey);
  if (!raw) return;
  const draft = JSON.parse(raw);
  state.currentSlug = draft.old_slug || "";
  fillForm(
    {
      ...draft,
      genres: draft.genres || [],
      emotions: draft.emotions || [],
    },
    draft.body || ""
  );
  state.dirty = true;
  updatePreviewAndChecks();
  toast("ブラウザ内の下書きを復元しました。");
}

function openPreviewPage() {
  const slug = fields.slug.value || state.currentSlug;
  if (!slug) {
    toast("保存すると別画面プレビューを開けます。");
    return;
  }
  window.open(`/preview/${encodeURIComponent(slug)}`, "_blank", "noopener,noreferrer");
}

function insertReviewTemplate() {
  insertText(defaultArticleBody(collectArticle()));
}

function insertCtaBlock() {
  insertText(`## 続きが気になる場合

サンプルや販売ページで、絵柄・雰囲気・注意事項を確認してから判断してください。

`);
}

function defaultArticleBody(article = {}) {
  const title = article.product_title || article.title || "";
  const genres = Array.isArray(article.genres) ? article.genres : splitList(article.genres || "");
  const comment = String(article.excerpt || "").trim();
  const lines = [
    "## 作品コメント",
    "",
  ];

  if (comment) {
    lines.push(comment, "");
  }

  lines.push(
    "## 作品の基本情報",
    "",
    `- 作品名: ${title}`,
    `- サークル: ${article.circle_name || ""}`,
    `- 作者: ${article.author_name || ""}`,
    `- ジャンル: ${genres.join("、")}`,
    "",
    "## 続きが気になる場合",
    "",
    "サンプルや販売ページで、絵柄・雰囲気・注意事項を確認してから判断してください。",
    ""
  );

  return lines.join("\n");
}

function articleBodyText(article = {}, body = "") {
  const markdown = String(body || "");
  if (!markdown.trim()) return defaultArticleBody(article);

  const comment = String(article.excerpt || "").trim();
  if (!comment || hasWorkCommentSection(markdown)) return markdown;

  return insertWorkCommentSection(markdown, comment);
}

function hasWorkCommentSection(markdown) {
  return /^#{1,3}\s*作品コメント\s*$/mu.test(String(markdown || ""));
}

function insertWorkCommentSection(markdown, comment) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  while (index < lines.length && (!lines[index].trim() || lines[index].trimStart().startsWith(">"))) {
    index += 1;
  }

  lines.splice(index, 0, "## 作品コメント", "", comment, "");
  return lines.join("\n");
}

function insertText(text) {
  const input = fields.body;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
  input.focus();
  input.selectionStart = input.selectionEnd = start + text.length;
  markDirty();
  updatePreviewAndChecks();
}

function wrapSelection(wrapper) {
  const input = fields.body;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const selected = input.value.slice(start, end) || "強調するテキスト";
  const replacement = `${wrapper}${selected}${wrapper}`;
  input.value = `${input.value.slice(0, start)}${replacement}${input.value.slice(end)}`;
  input.focus();
  input.selectionStart = start + wrapper.length;
  input.selectionEnd = start + wrapper.length + selected.length;
  markDirty();
  updatePreviewAndChecks();
}

async function uploadSelectedImage() {
  const file = $("imageInput").files[0];
  if (!file) {
    toast("画像を選択してください。");
    return;
  }

  try {
    const dataUrl = await readFileAsDataUrl(file);
    const saved = await api("/api/media", {
      method: "POST",
      body: JSON.stringify({
        filename: file.name,
        data_url: dataUrl,
        alt: $("imageAltInput").value,
      }),
    });
    await loadMedia();
    insertText(`![${$("imageAltInput").value || saved.filename}](${saved.url})\n\n`);
    if (!fields.thumbnail_url.value.trim()) fields.thumbnail_url.value = saved.url;
    toast("画像を追加しました。");
  } catch (error) {
    toast(`画像を追加できませんでした: ${error.message}`);
  }
}

function renderMediaList() {
  const list = $("mediaList");
  list.innerHTML = "";
  if (!state.media.length) {
    list.innerHTML = '<p class="meta">画像はまだありません。</p>';
    return;
  }

  for (const item of state.media.slice(0, 24)) {
    const row = document.createElement("div");
    row.className = "media-item";
    row.innerHTML = `
      <img src="${escapeHtml(item.url)}" alt="">
      <div>
        <p>${escapeHtml(item.filename)}</p>
        <small>${Math.round(item.bytes / 1024)} KB</small>
        <button type="button">挿入</button>
      </div>
    `;
    row.querySelector("button").addEventListener("click", () => {
      insertText(`![${item.filename}](${item.url})\n\n`);
    });
    list.appendChild(row);
  }
}

function switchTab(tab) {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  document.querySelectorAll(".tab-page").forEach((page) => {
    page.classList.toggle("active", page.id === `${tab}Tab`);
  });
}

function updatePreviewAndChecks() {
  const article = collectArticle();
  const productLink = productPageUrl(article);
  const sampleImages = articleSampleImages(article);
  const sampleViewer = sampleImages.length ? renderSampleCarousel(article, productLink, "article") : "";
  const thumbnail = !sampleViewer && fields.thumbnail_url.value
    ? productLink
      ? `<a class="image-product-link hero-link" href="${escapeHtml(productLink)}" target="_blank" rel="sponsored noopener noreferrer" aria-label="商品ページを開く"><img class="hero-image" src="${escapeHtml(fields.thumbnail_url.value)}" alt=""></a>`
      : `<img src="${escapeHtml(fields.thumbnail_url.value)}" alt="">`
    : "";
  $("previewPane").innerHTML = `
    <h1>${escapeBreakableText(fields.title.value || "タイトル未入力")}</h1>
    ${fields.circle_name.value || fields.author_name.value ? `<p class="work-meta">${escapeHtml([fields.circle_name.value, fields.author_name.value].filter(Boolean).join(" / "))}</p>` : ""}
    ${sampleViewer || thumbnail}
    ${fields.weekly_pick.checked && fields.editor_note.value.trim() ? `<section class="editor-note-box"><h2>おすすめコメント</h2><p>${escapeHtml(fields.editor_note.value.trim())}</p></section>` : ""}
    ${markdownToHtml(fields.body.value, { imageLinkUrl: productLink })}
  `;
  refreshSampleCarousels($("previewPane"));
  $("writingStats").textContent = `${fields.body.value.length}文字`;
  renderChecks();
}

function renderWorkComment(value) {
  const comment = String(value || "").trim();
  if (!comment) return "";
  return `
    <section class="work-comment">
      <h2>作品コメント</h2>
      <p>${escapeHtml(comment)}</p>
    </section>
  `;
}

function renderSampleCarousel(article, productLink = "", variant = "") {
  const images = articleSampleImages(article).slice(0, 12);
  if (!images.length) return "";
  const link = String(productLink || "").trim();
  const className = ["sample-carousel", variant ? `sample-carousel-${variant}` : ""].filter(Boolean).join(" ");
  const imageItems = images
    .map((url, index) => {
      const image = `<img src="${escapeHtml(url)}" alt="${escapeHtml(`${article.title || "作品"} 試し読み ${index + 1}`)}" loading="lazy">`;
      return link
        ? `<a class="sample-slide" href="${escapeHtml(link)}" target="_blank" rel="sponsored noopener noreferrer">${image}</a>`
        : `<span class="sample-slide">${image}</span>`;
    })
    .join("");
  const controls = images.length > 1
    ? `
      <button class="sample-nav sample-nav-prev" type="button" aria-label="前の試し読み画像" data-sample-nav="-1">&#8249;</button>
      <button class="sample-nav sample-nav-next" type="button" aria-label="次の試し読み画像" data-sample-nav="1">&#8250;</button>
      <p class="sample-page-indicator"><span data-sample-page>1</span> / <span data-sample-total>${images.length}</span></p>
    `
    : "";
  return `
    <div class="sample-carousel-shell${variant ? ` sample-carousel-shell-${variant}` : ""}">
      <div class="${className}" aria-label="試し読み画像" tabindex="0">
        ${imageItems}
      </div>
      ${controls}
    </div>
  `;
}

function articleSampleImages(article) {
  return unique([article.thumbnail_url, ...(article.sample_images || [])].filter(Boolean));
}

function refreshSampleCarousels(root = document) {
  if (window.DmmSampleCarousel && typeof window.DmmSampleCarousel.refresh === "function") {
    window.DmmSampleCarousel.refresh(root);
  }
}

function renderChecks() {
  const article = collectArticle();
  const bodyLength = article.body.trim().length;
  const titleLength = article.title.trim().length;
  const excerptLength = article.excerpt.trim().length;
  const productLink = productPageUrl(article);
  const hasAffiliate = Boolean(article.affiliate_url.trim());
  const hasPr = Boolean(article.pr_label.trim());
  const usesImage = Boolean(
    article.thumbnail_url.trim() ||
      article.sample_images.length ||
      /!\[[^\]]*\]\([^)]+\)/u.test(article.body)
  );
  const readyOrPublished = ["ready", "published"].includes(article.status);

  const checks = [
    {
      label: "タイトル",
      detail: `${titleLength}文字`,
      state: titleLength >= 8 && titleLength <= 70 ? "pass" : "warn",
    },
    {
      label: "本文量",
      detail: `${bodyLength}文字`,
      state: bodyLength >= 800 ? "pass" : bodyLength >= 300 ? "warn" : "fail",
    },
    {
      label: "抜粋",
      detail: `${excerptLength}文字`,
      state: excerptLength >= 50 && excerptLength <= 160 ? "pass" : "warn",
    },
    {
      label: "PR表記",
      detail: hasPr ? article.pr_label : "未入力",
      state: hasPr ? "pass" : "fail",
    },
    {
      label: "商品リンク",
      detail: hasAffiliate ? "アフィリエイトURLを優先" : productLink ? "元ページURLを使用" : "未入力",
      state: productLink || !readyOrPublished ? "pass" : "warn",
    },
    {
      label: "画像権利",
      detail: rightsLabel(article.rights_status),
      state: !usesImage || article.rights_status !== "pending_review" ? "pass" : "warn",
    },
    {
      label: "試し読み画像",
      detail: `${article.sample_images.length}枚`,
      state: article.sample_images.length ? "pass" : "warn",
    },
  ];

  $("checkList").innerHTML = checks
    .map(
      (check) => `
        <div class="check-item ${check.state}">
          <strong>${escapeHtml(check.label)}</strong>
          <span>${escapeHtml(check.detail)}</span>
        </div>
      `
    )
    .join("");

  $("seoBox").innerHTML = `
    <h3>SEOプレビュー</h3>
    <p><strong>${escapeHtml(article.title || "タイトル未入力")}</strong></p>
    <p>${escapeHtml(article.excerpt || "抜粋が未入力です。")}</p>
    <p class="meta">/site/posts/${escapeHtml(article.slug || "new")}</p>
  `;
}

function markdownToHtml(markdown, options = {}) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let listOpen = false;
  let codeOpen = false;
  let codeLines = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${inlineMarkdown(paragraph.join(" "), options)}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!listOpen) return;
    html.push("</ul>");
    listOpen = false;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.startsWith("```")) {
      flushParagraph();
      closeList();
      if (codeOpen) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        codeOpen = false;
      } else {
        codeOpen = true;
      }
      continue;
    }

    if (codeOpen) {
      codeLines.push(raw);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/u);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2], options)}</h${level}>`);
      continue;
    }

    const listItem = line.match(/^[-*]\s+(.+)$/u);
    if (listItem) {
      flushParagraph();
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${inlineMarkdown(listItem[1], options)}</li>`);
      continue;
    }

    const quote = line.match(/^>\s?(.+)$/u);
    if (quote) {
      flushParagraph();
      closeList();
      html.push(`<blockquote>${inlineMarkdown(quote[1], options)}</blockquote>`);
      continue;
    }

    paragraph.push(line.trim());
  }

  if (codeOpen) html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  flushParagraph();
  closeList();
  return html.join("\n");
}

function inlineMarkdown(value, options = {}) {
  const imageLinkUrl = String(options.imageLinkUrl || "").trim();
  const imageReplacement = imageLinkUrl
    ? `<a class="image-product-link" href="${escapeHtml(imageLinkUrl)}" target="_blank" rel="sponsored noopener noreferrer"><img src="$2" alt="$1" loading="lazy"></a>`
    : '<img src="$2" alt="$1" loading="lazy">';

  return escapeHtml(value)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/gu, imageReplacement)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/gu, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>")
    .replace(/`([^`]+)`/gu, "<code>$1</code>");
}

function splitList(value) {
  return String(value || "")
    .split(/[\s\u3000,、，]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitUrlList(value) {
  return String(value || "")
    .split(/[\s\u3000]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

function slugify(value) {
  const slug = value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  if (slug) return slug;
  return `post-${new Date().toISOString().replace(/\D/gu, "").slice(0, 14)}`;
}

function toDatetimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromDatetimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function formatDateLabel(value) {
  if (!value) return "日時なし";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日時なし";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function statusLabel(status) {
  return {
    draft: "下書き",
    ready: "公開準備",
    published: "公開",
    archived: "保管",
  }[status] || "下書き";
}

function rightsLabel(value) {
  return {
    pending_review: "確認中",
    approved_ad_material: "広告素材として利用可",
    link_only: "リンクのみ",
  }[value] || "確認中";
}

function rightsShortLabel(value) {
  return {
    pending_review: "権利確認中",
    approved_ad_material: "広告素材",
    link_only: "リンクのみ",
  }[value] || "権利確認中";
}

function productPageUrl(article) {
  return String(article.affiliate_url || article.source_url || "").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#039;");
}

function escapeBreakableText(value) {
  return [...String(value ?? "")].map((character) => escapeHtml(character)).join("<wbr>");
}

let toastTimer = 0;
function toast(message) {
  const element = $("toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 2600);
}
