import { test, expect } from '@playwright/test';

test.describe('Sentinel Ops Frontend E2E Suite', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        // Wait for system readiness gate to complete and main application shell to mount
        await expect(page.locator('main')).toBeVisible({ timeout: 20000 });
    });

    test('1. Initial Application Load & Core Shell Mount', async ({ page }) => {
        // Page title check
        await expect(page).toHaveTitle(/Sentinel Ops/i);

        // Ensure root container is mounted and not blank
        const root = page.locator('#root');
        await expect(root).toBeVisible();

        // Main content viewport should be present
        const main = page.locator('main');
        await expect(main).toBeVisible();

        // Check for brand identity or dashboard presence
        const brand = page.locator('text=Sentinel').first();
        await expect(brand).toBeVisible();

        const welcomeHeading = page.getByRole('heading', { name: /Welcome back/i });
        await expect(welcomeHeading).toBeVisible();
    });

    test('2. Theme Switching (Dark Mode / Light Mode)', async ({ page }) => {
        const themeBtn = page.getByRole('button', { name: /Ganti Tema Tampilan/i });
        await expect(themeBtn).toBeVisible();

        // Get initial theme attribute
        const html = page.locator('html');
        const initialTheme = await html.getAttribute('data-theme');

        // Click theme toggle
        await themeBtn.click();
        await page.waitForTimeout(300);

        // Verify data-theme has changed
        const toggledTheme = await html.getAttribute('data-theme');
        expect(toggledTheme).not.toBe(initialTheme);

        // Toggle back to original theme
        await themeBtn.click();
        await page.waitForTimeout(300);
        const revertedTheme = await html.getAttribute('data-theme');
        expect(revertedTheme).toBe(initialTheme);
    });

    test('3. Navigation across Primary & Lazy-Loaded Views', async ({ page }) => {
        // 1. Navigate to NetCut Targets View
        const netcutBtn = page.getByRole('button', { name: /NetCut/i }).first();
        await netcutBtn.click();
        await page.waitForTimeout(400);

        // Verify Search input or All Hosts tab appears in NetCut view
        const searchInput = page.getByPlaceholder(/Search Hostname, IP, MAC/i);
        await expect(searchInput).toBeVisible();

        // 2. Navigate to Smart Gateway View (Lazy-loaded chunk)
        const gatewayBtn = page.getByRole('button', { name: /Smart Gateway/i }).first();
        await gatewayBtn.click();
        await page.waitForTimeout(500);
        await expect(page.locator('main')).toBeVisible();

        // 3. Navigate to Security Arsenal View (Lazy-loaded chunk)
        const arsenalBtn = page.getByRole('button', { name: /Security Arsenal/i }).first();
        await arsenalBtn.click();
        await page.waitForTimeout(500);
        await expect(page.locator('main')).toBeVisible();

        // 4. Navigate to Mode Gaming View (Lazy-loaded chunk)
        const gamingBtn = page.getByRole('button', { name: /Mode Gaming/i }).first();
        await gamingBtn.click();
        await page.waitForTimeout(500);
        await expect(page.locator('main')).toBeVisible();

        // 5. Navigate to Sentinel Shield View (Lazy-loaded chunk)
        const shieldBtn = page.getByRole('button', { name: /Sentinel Shield/i }).first();
        await shieldBtn.click();
        await page.waitForTimeout(500);
        await expect(page.locator('main')).toBeVisible();

        // 6. Navigate to Aktivitas Langsung View (Lazy-loaded chunk)
        const activityBtn = page.getByRole('button', { name: /Aktivitas Langsung/i }).first();
        await activityBtn.click();
        await page.waitForTimeout(500);
        await expect(page.locator('main')).toBeVisible();

        // 7. Return to Dashboard
        const dashboardBtn = page.getByRole('button', { name: /Dashboard/i }).first();
        await dashboardBtn.click();
        await page.waitForTimeout(400);
        await expect(page.locator('main')).toBeVisible();
    });

    test('4. NetCut Filter Tabs & Search Query Interactions', async ({ page }) => {
        // Switch to NetCut view
        const netcutBtn = page.getByRole('button', { name: /NetCut/i }).first();
        await netcutBtn.click();
        await page.waitForTimeout(300);

        // Test search input
        const searchInput = page.getByPlaceholder(/Search Hostname, IP, MAC/i);
        await expect(searchInput).toBeVisible();
        await searchInput.fill('192.168.1.1');
        await expect(searchInput).toHaveValue('192.168.1.1');

        // Clear search using clear button
        const clearBtn = page.getByTitle(/Hapus Pencarian/i);
        await clearBtn.click();
        await expect(searchInput).toHaveValue('');

        // Test clicking Segment Filter Tabs
        const onlineTab = page.getByRole('tab', { name: /Online/i }).first();
        if (await onlineTab.isVisible()) {
            await onlineTab.click();
            await page.waitForTimeout(200);
        }

        const allTab = page.getByRole('tab', { name: /All Hosts/i }).first();
        if (await allTab.isVisible()) {
            await allTab.click();
            await page.waitForTimeout(200);
        }
    });

    test('5. ErrorBoundary Fallback Resilience', async ({ page }) => {
        // Verify page is rendered with error boundary intact
        const hasErrorBoundaryMarkup = await page.evaluate(() => {
            return document.body.innerText.includes('Gangguan Antarmuka Sentinel Terdeteksi');
        });
        expect(hasErrorBoundaryMarkup).toBe(false);

        // Ensure no unhandled syntax or runtime fatal white screens occurred
        const rootContent = await page.locator('#root').innerHTML();
        expect(rootContent.length).toBeGreaterThan(50);
    });

});
