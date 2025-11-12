
// app.js (updated)
// Base API
const API_BASE = "https://desi-worker.sunnyisbest1122.workers.dev/api";

// Pagination
const PER_PAGE = 20;
let currentPage = 1;
let totalVideos = 0;
let currentCategory = "all";
let currentSearch = "";

// Default fallback
const DEFAULT_IMAGE_PATH = "./images/default-thumb.jpg";

// Helper: thumbnail
function getThumbnailUrl(url) {
  return url && url.trim() !== '' ? url.trim() : DEFAULT_IMAGE_PATH;
}

// Format Views
function formatViews(views) {
  const num = Number.parseInt(views) || 0;
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
  return num.toString();
}

/**
 * loadVideos(category, search, page)
 * Renders video cards. Each card now includes a normal <a href="/slug"> for
 * middle-click/new-tab support. onclick still opens modal and updates history.
 */
async function loadVideos(category = "all", search = "", page = 1) {
  const grid = document.getElementById("videoGrid");
  const loading = document.getElementById("loading");
  if (!grid || !loading) return;

  currentCategory = category;
  currentSearch = search;
  currentPage = page;

  grid.innerHTML = "";
  loading.style.display = "block";
  loading.textContent = "Loading videos...";

  try {
    const offset = (page - 1) * PER_PAGE;
    const url = new URL(`${API_BASE}/cards`);
    if (category !== "all") url.searchParams.append("category", category);
    if (search) url.searchParams.append("search", search);
    url.searchParams.append("limit", PER_PAGE);
    url.searchParams.append("offset", offset);

    const res = await fetch(url);
    const result = await res.json();

    if (!result.success) throw new Error("API error");

    const videos = result.data || [];
    totalVideos = result.total || videos.length;

    loading.style.display = "none";

    if (videos.length === 0) {
      grid.innerHTML = '<div class="no-results">No videos found.</div>';
      updatePagination(0);
      updateFilterChips(category);
      return;
    }

    // Build cards: wrap in <a href="/slug"> so direct/new-tab works
    grid.innerHTML = videos.map(video => {
      const slugClean = (video.my_slug || "").replace(/\/$/, "");
      const thumb = getThumbnailUrl(video.thumbnail_url);
      const safeTitle = (video.title || "").replace(/"/g, '\\"');
      return `
        <div class="video-card" data-slug="${slugClean}">
          <a href="/${slugClean}" class="video-link" onclick="event.preventDefault(); openVideoModal('${slugClean}')">
            <div class="video-thumb" style="background-image: url('${thumb}')">
              <div class="play-overlay">
                <svg width="50" height="50" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
              </div>
            </div>
            <div class="video-info">
              <h3 class="video-title">${video.title}</h3>
              <p class="video-views">${formatViews(video.number_views)} views</p>
              <p class="video-category">${video.category || ""}</p>
            </div>
          </a>
        </div>
      `;
    }).join("");

    updatePagination(totalVideos);
    updateFilterChips(category);
  } catch (err) {
    console.error("Load Error:", err.message);
    loading.style.display = "none";
    grid.innerHTML = `<div class="error">Failed: ${err.message}</div>`;
    updatePagination(0);
  }
}

// Pagination
function updatePagination(total) {
  const container = document.getElementById("paginationContainer");
  if (!container) return;
  const totalPages = Math.ceil(total / PER_PAGE);
  const pageNumbers = document.getElementById("pageNumbers");
  const prevBtn = document.getElementById("prevPage");
  const nextBtn = document.getElementById("nextPage");
  const pageInfo = document.getElementById("pageInfo");

  if (totalPages <= 1) { container.style.display = "none"; return; }
  container.style.display = "flex";

  let pagesHtml = "";
  const maxVisible = 5;
  let startPage = Math.max(1, currentPage - 2);
  let endPage = Math.min(totalPages, startPage + maxVisible - 1);
  if (endPage - startPage < maxVisible - 1) startPage = Math.max(1, endPage - maxVisible + 1);

  for (let i = startPage; i <= endPage; i++) {
    pagesHtml += `<button class="page-num ${i === currentPage ? "active" : ""}" onclick="loadVideos('${currentCategory}', '${currentSearch}', ${i})">${i}</button>`;
  }
  if (endPage < totalPages) pagesHtml += `<span>...</span><button class="page-num" onclick="loadVideos('${currentCategory}', '${currentSearch}', ${totalPages})">${totalPages}</button>`;

  pageNumbers.innerHTML = pagesHtml;
  prevBtn.disabled = currentPage === 1;
  nextBtn.disabled = currentPage === totalPages;
  prevBtn.onclick = () => currentPage > 1 && loadVideos(currentCategory, currentSearch, currentPage - 1);
  nextBtn.onclick = () => currentPage < totalPages && loadVideos(currentCategory, currentSearch, currentPage + 1);
  pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${total} videos)`;
}

// Filter Chips
function updateFilterChips(active) {
  document.querySelectorAll(".filter-chip").forEach(chip => {
    chip.classList.toggle("active", chip.dataset.category === active);
  });
}

/**
 * openVideoModal(slug, opts)
 * - opts.pushState (default true): whether to call history.pushState for this open.
 * When opening we push state {modal:true, slug} so back button closes modal.
 */
async function openVideoModal(mySlug, opts = { pushState: true }) {
  const slug = (mySlug || "").replace(/\/$/, "");
  const modal = document.getElementById("videoModal");
  const title = document.getElementById("videoTitle");
  const views = document.getElementById("videoViews");
  const player = document.getElementById("videoPlayer");
  const categories = document.getElementById("videoCategories");
  const related = document.getElementById("relatedVideos");

  if (!modal) return;

  // If requested, push history state so Back closes modal instead of leaving site
  try {
    if (opts.pushState !== false) {
      history.pushState({ modal: true, slug }, '', `/${slug}`);
    }
  } catch (e) {
    // Some environments (file://) may throw — ignore
    console.warn("pushState failed", e);
  }

  const DEFAULT_VIDEO = "https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_1mb.mp4";

  modal.style.display = "block";
  player.style.display = "none";
  related.innerHTML = "<p>Loading...</p>";

  try {
    const res = await fetch(`${API_BASE}/cards/${slug}?my_slug=${encodeURIComponent(slug)}`);
    const result = await res.json();
    if (!result.success) throw new Error("Video not found");

    const video = result.data;

    player.src = video.video_url || DEFAULT_VIDEO;
    title.textContent = video.title || "Untitled";
    views.textContent = formatViews(video.number_views);
    categories.innerHTML = (video.category || "").split(" ").map(c => `<span class="cat-tag">${c}</span>`).join("");

    if (video.relatedVideos && video.relatedVideos.length > 0) {
      related.innerHTML = video.relatedVideos.slice(0, 6).map(r => {
        const rslug = (r.my_slug || "").replace(/\/$/, "");
        const rthumb = getThumbnailUrl(r.thumbnail_url);
        return `
          <div class="related-card" onclick="openVideoModal('${rslug}')">
            <div class="video-thumb" style="background-image: url('${rthumb}')">
              <div class="play-overlay">
                <svg width="50" height="50" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
              </div>
            </div>
            <div class="video-info">
              <h3 class="video-title">${r.title}</h3>
              <p class="video-views">${formatViews(r.number_views)} views</p>
              <p class="video-category">${r.rating || "N/A"} rating</p>
            </div>
          </div>
        `;
      }).join("");
    } else {
      related.innerHTML = "<p>No related videos.</p>";
    }

    player.load();
    player.style.display = "block";
    player.play().catch(() => {});
  } catch (err) {
    console.error("Modal Error:", err.message);
    player.src = DEFAULT_VIDEO;
    player.load();
    player.style.display = "block";
    related.innerHTML = `<p>Error: ${err.message}</p>`;
  }
}

// Close modal helper (tries to use history.back so popstate logic handles UI)
function closeModal() {
  const modal = document.getElementById("videoModal");
  const player = document.getElementById("videoPlayer");
  if (!modal) return;

  // If current history state is modal, go back to previous state which should close modal
  try {
    if (history.state && history.state.modal === true) {
      history.back();
      return;
    }
  } catch (e) {
    console.warn("history.back failed", e);
  }

  // Fallback: just hide modal and replace URL with root
  modal.style.display = "none";
  player?.pause();
  try {
    history.replaceState({ modal: false }, '', '/');
  } catch (e) {}
}

// Handle popstate: open/close modal based on state
window.addEventListener('popstate', (event) => {
  const state = event.state || {};
  if (state.modal === true && state.slug) {
    // open modal for slug without pushing new state (already handled by popstate)
    openVideoModal(state.slug, { pushState: false });
  } else {
    // close modal (if open)
    const modal = document.getElementById("videoModal");
    const player = document.getElementById("videoPlayer");
    if (modal && modal.style.display === "block") {
      modal.style.display = "none";
      player?.pause();
    }
  }
});

// DOM Loaded
document.addEventListener("DOMContentLoaded", async () => {
  // Replace initial state so we have a baseline to return to
  try {
    history.replaceState({ modal: false, url: location.pathname }, '', location.pathname);
  } catch (e) {
    console.warn("replaceState failed", e);
  }

  await loadVideos();

  const categories = ["all", "big ass", "big boobs", "blowjob", "desi", "fuck", "girlfriend", "horny", "mallu", "punjabi"];
  const filterChips = document.getElementById("filterChips");
  if (filterChips) {
    filterChips.innerHTML = categories.map(cat => `
      <button class="filter-chip ${cat === "all" ? "active" : ""}" data-category="${cat}" onclick="loadVideos('${cat}')">
        ${cat.charAt(0).toUpperCase() + cat.slice(1).replace(/\b\w/g, l => l.toUpperCase())}
      </button>
    `).join("");
    updateFilterChips("all");
  }

  [document.getElementById("searchInput"), document.getElementById("mobileSearchInput")].forEach(input => {
    if (input) {
      input.addEventListener("input", debounce(e => {
        loadVideos("all", e.target.value.trim(), 1);
      }, 300));
    }
  });

  document.getElementById("modalClose")?.addEventListener("click", () => {
    closeModal();
  });

  window.onclick = e => {
    if (e.target.id === "videoModal") {
      closeModal();
    }
  };

  // If page loaded directly on a /slug path (not root), open modal for that slug
  const path = (location.pathname || '/').replace(/^\/+|\/+$/g, ''); // strip leading/trailing slashes
  if (path && path !== '' && path !== 'index.html') {
    // Open modal but do NOT push another history entry (URL already correct).
    openVideoModal(path, { pushState: false });
    // Also update history state to reflect that modal is open (so back will close to root)
    try {
      history.replaceState({ modal: true, slug: path }, '', location.pathname);
    } catch (e) {}
  }
});

// Debounce
function debounce(func, wait) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}
