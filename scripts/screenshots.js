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
  // Software rendering is slow; give the camera ample time to finish swinging to Dark's side.
  await page.waitForTimeout(3500);
}

// Presses a Dark piece and pulls it back towards the viewer by `pull` pixels, slightly to the side.
async function aimWith(page, pull) {
  const id = await page.evaluate(
    () => window.checkersSumo.getState().pieces.find((p) => p.color === 'dark' && p.x === 1.5).id,
  );
  const { x, y } = await page.evaluate((id) => window.checkersSumo.screenOf(id), id);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + pull * 0.35, y + pull, { steps: 12 });
  await page.waitForTimeout(200);
}

const desktop = await open({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await setUpAiming(desktop);
await aimWith(desktop, 120);
await desktop.screenshot({ path: `${OUT}/desktop.png` });

const phone = await open({ ...devices['iPhone 13'], hasTouch: false, isMobile: false });
await setUpAiming(phone);
await aimWith(phone, 80);
await phone.screenshot({ path: `${OUT}/mobile.png` });

await browser.close();
await new Promise((resolve) => server.httpServer.close(resolve));
console.log(`Screenshots written to ${OUT}/`);
