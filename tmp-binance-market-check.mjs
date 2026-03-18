import { chromium } from 'playwright';
import fs from 'node:fs';
const outDir = '/Users/tommy/clawd/generative-agents-ts/output/binance-market-page';
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 1600 } });
await page.goto('http://127.0.0.1:5901/map', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1400);
const advanced = page.getByRole('button', { name: /advanced|高级面板/i });
if (await advanced.count()) {
  await advanced.first().click();
  await page.waitForTimeout(900);
}
const state = await page.evaluate(() => window.render_game_to_text ? window.render_game_to_text() : '{}');
fs.writeFileSync(`${outDir}/state.json`, state);
await page.screenshot({ path: `${outDir}/page.png`, fullPage: true });
await browser.close();
