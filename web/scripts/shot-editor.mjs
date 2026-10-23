import puppeteer from "puppeteer-core";

const url = process.argv[2] ?? "http://127.0.0.1:8030/";
const out = process.argv[3] ?? "../docs/ui-editor.png";
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
  await page.waitForFunction(() => document.body.innerText.includes("T22"), { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 1200));

  // 打开 P11（压力）的编辑框
  await page.evaluate(() => {
    const row = [...document.querySelectorAll("tr")].find((r) =>
      (r.textContent ?? "").includes("P11"),
    );
    row?.querySelector("button")?.click();
  });
  await page.waitForSelector("select", { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: out });
  console.log(`saved ${out}`);
} finally {
  await browser.close();
}
