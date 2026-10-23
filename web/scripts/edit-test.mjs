import puppeteer from "puppeteer-core";

const url = process.argv[2] ?? "http://127.0.0.1:8030/";
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
  await new Promise((r) => setTimeout(r, 1500));

  // 打开第一个点（P10）的编辑框
  await page.click('button[title="编辑点位 / 信号类型"]');
  await page.waitForSelector("select", { timeout: 5000 });
  await page.select("select", "voltage");
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: "../docs/ui-editor.png" });

  // 保存，验证走后端
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("保存"),
    );
    btn?.click();
  });
  await new Promise((r) => setTimeout(r, 1500));
  console.log("saved from UI");
} finally {
  await browser.close();
}
