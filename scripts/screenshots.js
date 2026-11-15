import { chromium, devices } from 'playwright';
import { preview } from 'vite';

// Regenerates the images in docs/screenshots from a production build (run `npm run build` first).
const OUT = 'docs/screenshots';
const server = await preview({ preview: { port: 4174, strictPort: true } });
const url = server.resolvedUrls.local[0];
// Software WebGL, so the script also works on machines and CI runners without a GPU.
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function open(options) {
  const page = await browser.newPage(options);
  await page.goto(url);
  await page.waitForFunction(() => window.checkersSumo);
  await page.waitForTimeout(1500);
  return page;
}

// Light nudges a piece forward, then Dark lines up a shot: shows a game under way and the aim arrow.
async function setUpAiming(page) {
  await page.evaluate(() => window.checkersSumo.shoot({ pieceId: 2, vx: 0.6, vz: -3.2 }));
  await page.waitForFunction(() => window.checkersSumo.getState().turn === 'dark');
  await page.waitForTimeout(1500);
}

async function dragFrom(page, from, to) {
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 12 });
  await page.waitForTimeout(200);
}

const desktop = await open({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await setUpAiming(desktop);
await dragFrom(desktop, [512, 600], [560, 730]);
await desktop.screenshot({ path: `${OUT}/desktop.png` });

const phone = await open({ ...devices['iPhone 13'], hasTouch: false, isMobile: false });
await setUpAiming(phone);
await dragFrom(phone, [137, 450], [150, 540]);
await phone.screenshot({ path: `${OUT}/mobile.png` });

await browser.close();
await new Promise((resolve) => server.httpServer.close(resolve));
console.log(`Screenshots written to ${OUT}/`);
