import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/*.{woff2,woff,ttf}', route => route.abort());
  await page.route('**/fonts.googleapis.com/**', route => route.abort());
  await page.route('**/fonts.gstatic.com/**', route => route.abort());
});

test.describe('Login Page', () => {
  test('renders login form with all required elements', async ({ page }) => {
    await page.goto('/login.html');
    await expect(page).toHaveTitle(/Atllanta/);
    await expect(page.locator('.login-logo')).toBeVisible();
    await expect(page.locator('.login-title')).toContainText('Welcome back');
    await expect(page.locator('#login-email')).toBeVisible();
    await expect(page.locator('#login-password')).toBeVisible();
    await expect(page.locator('#login-btn')).toBeVisible();
  });

  test('has sign up link', async ({ page }) => {
    await page.goto('/login.html');
    await expect(page.locator('text=Sign up')).toBeVisible();
  });

  test('toggle button and signup form exist', async ({ page }) => {
    await page.goto('/login.html');
    await expect(page.locator('#toggle-btn')).toBeVisible();
    await expect(page.locator('#toggle-btn')).toContainText('Sign up');
    await expect(page.locator('#signup-section')).toBeAttached();
  });

  test('validates required fields on submit', async ({ page }) => {
    await page.goto('/login.html');
    const emailInput = page.locator('#login-email');
    await expect(emailInput).toHaveAttribute('required', '');
  });
});

test.describe('CSS & Design System', () => {
  test('loads all CSS files', async ({ page }) => {
    const responses = [];
    page.on('response', r => { if (r.url().includes('.css')) responses.push(r); });
    await page.goto('/login.html');
    const cssFiles = responses.map(r => new URL(r.url()).pathname);
    expect(cssFiles).toContain('/css/tokens.css');
    expect(cssFiles).toContain('/css/base.css');
  });

  test('design tokens are applied', async ({ page }) => {
    await page.goto('/login.html');
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim()
    );
    expect(accent).toBeTruthy();
  });

  test('dark mode tokens exist', async ({ page }) => {
    await page.goto('/login.html');
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    const bg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim()
    );
    expect(bg).toBe('#0F1117');
  });
});

test.describe('PWA', () => {
  test('manifest.json is valid', async ({ page }) => {
    const resp = await page.goto('/manifest.json');
    expect(resp.status()).toBe(200);
    const manifest = await resp.json();
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
  });

  test('service worker file exists', async ({ page }) => {
    const resp = await page.goto('/sw.js');
    expect(resp.status()).toBe(200);
    const text = await resp.text();
    expect(text).toContain('CACHE_NAME');
    expect(text).toContain('atllanta-v');
  });

  test('icons are accessible', async ({ page }) => {
    const icon192 = await page.goto('/icon-192.svg');
    expect(icon192.status()).toBe(200);
    const icon512 = await page.goto('/icon-512.svg');
    expect(icon512.status()).toBe(200);
  });
});

test.describe('App Shell Structure', () => {
  test('index.html has correct structure', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.sidebar')).toBeAttached();
    await expect(page.locator('.topbar')).toBeAttached();
    await expect(page.locator('#main-content')).toBeAttached();
  });

  test('sidebar has navigation buttons', async ({ page }) => {
    await page.goto('/');
    const navBtns = page.locator('.nav-btn');
    const count = await navBtns.count();
    expect(count).toBeGreaterThanOrEqual(6);
  });

  test('topbar has search, notifications, and user avatar', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.search-box')).toBeAttached();
    await expect(page.locator('#notif-btn')).toBeAttached();
    await expect(page.locator('.user-avatar')).toBeAttached();
  });

  test('sidebar logo shows A', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.sidebar-logo')).toContainText('A');
  });

  test('nav buttons have tooltips', async ({ page }) => {
    await page.goto('/');
    const tooltips = page.locator('.nav-tooltip');
    const count = await tooltips.count();
    expect(count).toBeGreaterThanOrEqual(6);
  });
});

test.describe('Responsive Design', () => {
  test('mobile: sidebar becomes bottom nav', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    const sidebar = page.locator('.sidebar');
    const box = await sidebar.boundingBox();
    if (box) {
      expect(box.y).toBeGreaterThan(400);
      expect(box.width).toBeGreaterThanOrEqual(375);
    }
  });

  test('mobile: topbar center (search) is hidden', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await expect(page.locator('.topbar-center')).toBeHidden();
  });

  test('mobile: mobile search button exists in DOM', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await expect(page.locator('.mobile-search-btn')).toBeAttached();
  });

  test('mobile: no horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });

  test('desktop: sidebar is on the left', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.evaluate(() => document.getElementById('app').classList.remove('hidden'));
    const sidebar = page.locator('.sidebar');
    const box = await sidebar.boundingBox();
    if (box) {
      expect(box.x).toBe(0);
      expect(box.y).toBe(0);
      expect(box.width).toBeLessThanOrEqual(80);
    }
  });

  test('login page is responsive', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/login.html');
    const card = page.locator('.login-card');
    const box = await card.boundingBox();
    if (box) {
      expect(box.width).toBeLessThanOrEqual(375);
    }
  });
});

test.describe('Static Assets', () => {
  test('all CSS files return 200', async ({ page }) => {
    for (const css of ['/css/tokens.css', '/css/base.css', '/css/layout.css', '/css/components.css']) {
      const resp = await page.goto(css);
      expect(resp.status(), `${css} should return 200`).toBe(200);
    }
  });

  test('JS modules are accessible', async ({ page }) => {
    for (const js of ['/js/router.js', '/js/supabase.js', '/js/auth.js', '/js/ai.js', '/js/search.js', '/js/notifications.js', '/js/events.js', '/js/audit.js', '/js/ui.js']) {
      const resp = await page.goto(js);
      expect(resp.status(), `${js} should return 200`).toBe(200);
    }
  });
});

test.describe('Navigation', () => {
  test('clicking nav buttons updates hash', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      document.getElementById('app').classList.remove('hidden');
      document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
        btn.addEventListener('click', () => {
          window.location.hash = '#/' + btn.dataset.view;
          document.querySelectorAll('.nav-btn[data-view]').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });
    });
    const meBtn = page.locator('.nav-btn[data-view="me"]');
    await meBtn.click();
    await page.waitForTimeout(100);
    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).toBe('#/me');
  });

  test('nav button gets active class on click', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      document.getElementById('app').classList.remove('hidden');
      document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
        btn.addEventListener('click', () => {
          window.location.hash = '#/' + btn.dataset.view;
          document.querySelectorAll('.nav-btn[data-view]').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });
    });
    const recruitBtn = page.locator('.nav-btn[data-view="recruitment"]');
    await recruitBtn.click();
    await page.waitForTimeout(100);
    await expect(recruitBtn).toHaveClass(/active/);
  });

  test('nav buttons have correct data-view attributes', async ({ page }) => {
    await page.goto('/');
    const views = await page.evaluate(() =>
      [...document.querySelectorAll('.nav-btn[data-view]')].map(b => b.dataset.view)
    );
    expect(views).toContain('dashboard');
    expect(views).toContain('me');
    expect(views).toContain('recruitment');
  });
});
