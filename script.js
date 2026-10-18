const heroForm = document.getElementById('heroForm');
const topForm = document.getElementById('topForm');
const heroInput = document.getElementById('heroInput');
const topInput = document.getElementById('topInput');
const empty = document.getElementById('empty');
const message = document.getElementById('message');
const results = document.getElementById('results');
const profileEl = document.getElementById('profile');
const analysisEl = document.getElementById('analysis');
const languagesEl = document.getElementById('languages');
const reposEl = document.getElementById('repos');
const themeToggle = document.getElementById('themeToggle');

let langChart = null;
let allRepos = [];
let currentSort = 'latest';

const LANG_COLORS = {
  JavaScript: '#f1c40f', TypeScript: '#3178c6', Python: '#3b82c4', Java: '#e67e22',
  HTML: '#e34c26', CSS: '#8e5cf7', C: '#6b7a90', 'C++': '#e0457b', 'C#': '#2e9e4f',
  Go: '#00add8', Rust: '#c97b4a', PHP: '#6c78b8', Ruby: '#cc342d', Shell: '#6cc24a',
  Kotlin: '#a97bff', Swift: '#f05138', Dart: '#00b4ab', 'Jupyter Notebook': '#da5b0b'
};
const FALLBACK = ['#4f8cff', '#2ec4b6', '#f4a261', '#e76f8b', '#9b7bff', '#8bc34a'];
const langColor = (name, i = 0) => LANG_COLORS[name] || FALLBACK[i % FALLBACK.length];

const esc = (str) => String(str ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const fmt = (n) => Number(n).toLocaleString('en-US');

/* ---------- Theme ---------- */

function applyTheme(light) {
  document.body.classList.toggle('light', light);
  themeToggle.textContent = light ? 'Dark' : 'Light';
}

applyTheme(localStorage.getItem('theme') === 'light');

themeToggle.addEventListener('click', () => {
  const light = !document.body.classList.contains('light');
  applyTheme(light);
  localStorage.setItem('theme', light ? 'light' : 'dark');
  if (allRepos.length && !results.hidden) renderLanguages(allRepos);
});

/* ---------- Search ---------- */

async function search(username) {
  heroInput.value = username;
  topInput.value = username;
  document.body.classList.add('searched');
  empty.hidden = true;
  message.innerHTML = '';
  results.hidden = false;
  showSkeleton();

  try {
    const [userRes, repoRes] = await Promise.all([
      fetch(`https://api.github.com/users/${encodeURIComponent(username)}`),
      fetch(`https://api.github.com/users/${encodeURIComponent(username)}/repos?sort=updated&per_page=100`)
    ]);

    if (userRes.status === 404) {
      return showMessage('error', 'User not found', `No GitHub account named "${esc(username)}". Check the spelling and try again.`);
    }
    if (userRes.status === 403 || userRes.status === 429) {
      return showMessage('error', 'Rate limit reached', 'GitHub allows a limited number of searches per hour. Wait a few minutes and try again.');
    }
    if (!userRes.ok) {
      return showMessage('error', 'Something went wrong', 'GitHub could not process this request. Try again.');
    }

    const user = await userRes.json();
    const repoData = repoRes.ok ? await repoRes.json() : [];
    allRepos = Array.isArray(repoData) ? repoData : [];
    currentSort = 'latest';

    renderProfile(user);
    renderAnalysis(user, analyze(user, allRepos));
    renderLanguages(allRepos);
    renderRepos();

    try { history.replaceState(null, '', `?user=${encodeURIComponent(user.login)}`); } catch (e) {}
  } catch (err) {
    showMessage('error', 'No connection', 'Check your internet connection and try again.');
  }
}

function showMessage(type, title, text) {
  results.hidden = true;
  message.innerHTML = `<div class="message ${type}"><strong>${title}</strong><span>${text}</span></div>`;
}

function showSkeleton() {
  profileEl.innerHTML = `
    <div class="skeleton" style="width:96px;height:96px;border-radius:50%;margin-bottom:18px"></div>
    <div class="skeleton" style="height:24px;width:70%;margin-bottom:10px"></div>
    <div class="skeleton" style="height:16px;width:40%;margin-bottom:24px"></div>
    <div class="skeleton" style="height:60px"></div>`;
  analysisEl.innerHTML = '<div class="skeleton" style="height:300px"></div>';
  languagesEl.innerHTML = '<div class="skeleton" style="height:190px"></div>';
  reposEl.innerHTML = '<div class="skeleton" style="height:240px"></div>';
}

/* ---------- Analysis engine ---------- */

function analyze(user, repos) {
  const own = repos.filter((r) => !r.fork);
  const n = own.length;
  const checks = [];

  const add = (name, max, pts, good, fix) => {
    const p = Math.round(pts);
    checks.push({
      name, max, pts: p,
      status: p >= max ? 'pass' : p > 0 ? 'part' : 'fail',
      detail: p >= max ? good : fix
    });
  };

  // 1. Bio
  add('Bio', 10, user.bio ? 10 : 0,
    'Your bio tells visitors who you are.',
    'Add a one-line bio describing your skills and goals.');

  // 2. Contact details
  const contact = [user.location, user.blog, user.company].filter(Boolean).length;
  add('Contact details', 5, contact >= 2 ? 5 : contact === 1 ? 3 : 0,
    'Location, website, or company is filled in.',
    'Add at least two of: location, website, company.');

  // 3. Profile README (repo named exactly like the username)
  const hasReadme = repos.some((r) => r.name.toLowerCase() === user.login.toLowerCase());
  add('Profile README', 15, hasReadme ? 15 : 0,
    'A profile README is set up.',
    `Create a public repository named "${user.login}" with a README to introduce yourself.`);

  // 4. Number of original projects
  add('Original projects', 15, (Math.min(n, 5) / 5) * 15,
    `${n} original repositories.`,
    `You have ${n} original ${n === 1 ? 'repository' : 'repositories'}. Aim for at least 5.`);

  // 5. Descriptions
  const withDesc = own.filter((r) => r.description).length;
  add('Repository descriptions', 15, n ? (withDesc / n) * 15 : 0,
    'Every repository has a description.',
    n ? `${withDesc} of ${n} repositories have a description. Add one to each.` : 'Create a repository and describe it.');

  // 6. Recent activity
  let days = Infinity;
  if (repos.length) {
    const latest = Math.max(...repos.map((r) => new Date(r.pushed_at).getTime()));
    days = (Date.now() - latest) / 864e5;
  }
  add('Recent activity', 15, days <= 90 ? 15 : days <= 180 ? 8 : 0,
    'Active in the last 3 months.',
    'No recent pushes. Commit to a project to show you are active.');

  // 7. Live demo links
  const hasDemo = own.some((r) => r.homepage);
  add('Live demo link', 10, hasDemo ? 10 : 0,
    'At least one project links to a live demo.',
    'Add a live demo URL to a project (repository settings, Website field).');

  // 8. Topics
  const withTopics = own.filter((r) => r.topics && r.topics.length).length;
  add('Repository topics', 5, n ? (Math.min(withTopics, 3) / 3) * 5 : 0,
    'Your repositories use topics.',
    'Add topics to your repositories so people can discover them.');

  // 9. Community stars
  const stars = repos.reduce((sum, r) => sum + r.stargazers_count, 0);
  add('Community stars', 5, (Math.min(stars, 10) / 10) * 5,
    `${stars} stars earned.`,
    `${stars} ${stars === 1 ? 'star' : 'stars'} so far. Share your projects to earn more.`);

  // 10. Language variety
  const langs = new Set(own.map((r) => r.language).filter(Boolean)).size;
  add('Language variety', 5, langs >= 3 ? 5 : langs === 2 ? 3 : langs === 1 ? 1 : 0,
    `${langs} languages across your projects.`,
    'Build projects in at least 3 different languages.');

  const total = checks.reduce((sum, c) => sum + c.pts, 0);
  const passed = checks.filter((c) => c.status === 'pass').length;
  const grade = total >= 85 ? 'Excellent' : total >= 70 ? 'Strong' : total >= 50 ? 'Good start' : 'Needs work';
  const color = total >= 70 ? 'var(--good)' : total >= 45 ? 'var(--warn)' : 'var(--error)';

  return { checks, total, passed, grade, color };
}

function renderAnalysis(user, result) {
  const { checks, total, passed, grade, color } = result;
  const C = 2 * Math.PI * 52;
  const marks = { pass: '✓', part: '!', fail: '✕' };

  analysisEl.innerHTML = `
    <div class="score-head">
      <div class="gauge">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r="52" class="g-bg"></circle>
          <circle cx="60" cy="60" r="52" class="g-fg" style="stroke:${color};stroke-dasharray:${(C * total) / 100} ${C}"></circle>
        </svg>
        <div class="g-num"><strong>${total}</strong><span>out of 100</span></div>
      </div>
      <div class="score-text">
        <h3>Profile score</h3>
        <p class="grade" style="color:${color}">${grade}</p>
        <p class="muted-text">${passed} of ${checks.length} checks fully passed.</p>
        <button class="copy-btn" id="copyBtn">Copy my score</button>
      </div>
    </div>
    <div class="checks">
      ${checks.map((c) => `
        <div class="check">
          <span class="mark ${c.status}">${marks[c.status]}</span>
          <div><b>${c.name}</b><p>${esc(c.detail)}</p></div>
          <span class="pts">${c.pts}/${c.max}</span>
        </div>`).join('')}
    </div>
  `;

  document.getElementById('copyBtn').addEventListener('click', async (e) => {
    const text = `My GitHub profile scored ${total}/100 on DevSeeker. Check yours!`;
    try {
      await navigator.clipboard.writeText(text);
      e.target.textContent = 'Copied';
    } catch (err) {
      e.target.textContent = 'Copy not supported here';
    }
    setTimeout(() => { e.target.textContent = 'Copy my score'; }, 2000);
  });
}

/* ---------- Profile ---------- */

function renderProfile(user) {
  const joined = new Date(user.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
  const blog = user.blog ? (user.blog.startsWith('http') ? user.blog : `https://${user.blog}`) : '';

  profileEl.innerHTML = `
    <img class="avatar" src="${esc(user.avatar_url)}" alt="${esc(user.login)}">
    <h2>${esc(user.name || user.login)}</h2>
    <a class="handle" href="${esc(user.html_url)}" target="_blank" rel="noopener">@${esc(user.login)}</a>
    <p class="bio ${user.bio ? '' : 'muted'}">${esc(user.bio || 'This user has not added a bio.')}</p>
    <a class="gh-btn" href="${esc(user.html_url)}" target="_blank" rel="noopener">View on GitHub</a>

    <div class="stats">
      <div><strong>${fmt(user.public_repos)}</strong><span>Repos</span></div>
      <div><strong>${fmt(user.followers)}</strong><span>Followers</span></div>
      <div><strong>${fmt(user.following)}</strong><span>Following</span></div>
    </div>

    <ul class="meta">
      ${user.location ? `<li><small>Location</small>${esc(user.location)}</li>` : ''}
      ${user.company ? `<li><small>Company</small>${esc(user.company)}</li>` : ''}
      ${blog ? `<li><small>Website</small><a href="${esc(blog)}" target="_blank" rel="noopener">${esc(user.blog)}</a></li>` : ''}
      ${user.twitter_username ? `<li><small>Twitter</small><a href="https://twitter.com/${esc(user.twitter_username)}" target="_blank" rel="noopener">@${esc(user.twitter_username)}</a></li>` : ''}
      <li><small>Joined</small>${joined}</li>
    </ul>
  `;
}

/* ---------- Languages ---------- */

function renderLanguages(list) {
  const counts = {};
  list.forEach((r) => { if (r.language) counts[r.language] = (counts[r.language] || 0) + 1; });

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const total = sorted.reduce((sum, item) => sum + item[1], 0);

  if (langChart) { langChart.destroy(); langChart = null; }

  if (total === 0) {
    languagesEl.innerHTML = '<h3>Top languages</h3><p class="muted-text">No language data yet. Languages appear once repositories contain code.</p>';
    return;
  }

  languagesEl.innerHTML = `
    <h3>Top languages</h3>
    <div class="lang-body">
      <div class="donut"><canvas id="langChart"></canvas></div>
      <div class="legend">
        ${sorted.map(([name, count], i) => `
          <div class="legend-row">
            <span class="dot" style="background:${langColor(name, i)}"></span>
            <b>${esc(name)}</b>
            <small>${Math.round((count / total) * 100)}% · ${count} repo${count > 1 ? 's' : ''}</small>
          </div>`).join('')}
      </div>
    </div>
  `;

  const gap = getComputedStyle(document.body).getPropertyValue('--surface').trim();

  langChart = new Chart(document.getElementById('langChart'), {
    type: 'doughnut',
    data: {
      labels: sorted.map((i) => i[0]),
      datasets: [{
        data: sorted.map((i) => i[1]),
        backgroundColor: sorted.map((item, i) => langColor(item[0], i)),
        borderColor: gap,
        borderWidth: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      plugins: { legend: { display: false } }
    }
  });
}

/* ---------- Repositories ---------- */

function renderRepos() {
  if (allRepos.length === 0) {
    reposEl.innerHTML = '<h3>Repositories</h3><p class="muted-text">No public repositories yet.</p>';
    return;
  }

  const list = [...allRepos];
  if (currentSort === 'stars') list.sort((a, b) => b.stargazers_count - a.stargazers_count);

  reposEl.innerHTML = `
    <div class="repo-head">
      <h3>Repositories</h3>
      <div class="tabs">
        <button class="tab ${currentSort === 'latest' ? 'active' : ''}" data-sort="latest">Latest</button>
        <button class="tab ${currentSort === 'stars' ? 'active' : ''}" data-sort="stars">Most starred</button>
      </div>
    </div>
    ${list.slice(0, 6).map((repo) => `
      <a class="repo" href="${esc(repo.html_url)}" target="_blank" rel="noopener">
        <div>
          <span class="repo-name">${esc(repo.name)}</span>
          ${repo.fork ? '<span class="badge">Fork</span>' : ''}
        </div>
        <p class="repo-desc">${esc(repo.description || 'No description')}</p>
        <div class="repo-meta">
          ${repo.language ? `<span><i class="dot" style="background:${langColor(repo.language)}"></i>${esc(repo.language)}</span>` : ''}
          <span>★ ${fmt(repo.stargazers_count)}</span>
          <span>Forks ${fmt(repo.forks_count)}</span>
        </div>
      </a>`).join('')}
  `;
}

reposEl.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  currentSort = tab.dataset.sort;
  renderRepos();
});

/* ---------- Events ---------- */

function handleSubmit(inputEl) {
  return (e) => {
    e.preventDefault();
    const username = inputEl.value.trim();
    if (username) search(username);
  };
}

heroForm.addEventListener('submit', handleSubmit(heroInput));
topForm.addEventListener('submit', handleSubmit(topInput));

document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => search(chip.dataset.user));
});

// Open a profile directly from a link like index.html?user=torvalds
try {
  const preset = new URLSearchParams(location.search).get('user');
  if (preset) search(preset);
} catch (e) {}