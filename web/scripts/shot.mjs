import puppeteer from "puppeteer-core";

const url = process.argv[2] ?? "http://127.0.0.1:8030/";
const out = process.argv[3] ?? "../docs/ui.png";
const edge =
  process.env.EDGE_PATH ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const browser = await puppeteer.launch({
  executablePath: edge,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle2", timeout: 20000 });

  // 等第一帧快照到达（点位表出现点位）
  await page.waitForFunction(
    () => document.body.innerText.includes("点位表") && document.body.innerText.includes("T22"),
    { timeout: 15000 },
  );
  await new Promise((r) => setTimeout(r, 4000));

  await page.screenshot({ path: out });
  console.log(`saved ${out}`);
} finally {
  await browser.close();
}
