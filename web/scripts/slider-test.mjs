import puppeteer from "puppeteer-core";

const url = process.argv[2] ?? "http://127.0.0.1:8030/";
const base = url.replace(/\/$/, "");

async function state() {
  const res = await fetch(`${base}/api/points`);
  return res.json();
}

const browser = await puppeteer.launch({
  executablePath:
    process.env.EDGE_PATH ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"],
});

let failed = 0;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  await page.goto(url, { waitUntil: "networkidle2", timeout: 20000 });
  await page.waitForFunction(() => document.body.innerText.includes("T22"), { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 1500));

  // 先设一个已知状态
  await fetch(`${base}/api/plant`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ facility_c: 20, return_c: 50, ua_kw_per_k: 40 }),
  });
  await new Promise((r) => setTimeout(r, 800));

  // 边界条件默认折叠，先展开再操作
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").trim().startsWith("边界条件"),
    );
    btn?.click();
  });
  await new Promise((r) => setTimeout(r, 300));

  const thumbs = await page.$$('[role="slider"]');
  console.log(`sliders found: ${thumbs.length}`);
  const labels = await page.$$eval('[role="slider"]', (els) =>
    els.map((el) => el.getAttribute("aria-valuenow")),
  );
  console.log(`aria-valuenow: ${labels.join(", ")}`);

  // 第 4 个是 T11，第 6 个是 UA
  await thumbs[3].focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await new Promise((r) => setTimeout(r, 1200));

  await thumbs[5].focus();
  await page.keyboard.press("ArrowRight");
  await new Promise((r) => setTimeout(r, 1200));

  const after = await state();
  console.log(`facility_c=${after.boundary.facility_c} ua=${after.boundary.ua_kw_per_k}`);
  if (after.boundary.facility_c >= 21 && after.boundary.ua_kw_per_k >= 41) {
    console.log("PASS boundary sliders write values");
  } else {
    failed++;
    console.log("FAIL boundary sliders write values");
  }

  // 自动按钮清空
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === "自动",
    );
    btn?.click();
  });
  await new Promise((r) => setTimeout(r, 1200));
  const cleared = await state();
  console.log(`after auto: facility=${cleared.boundary.facility_c} ua=${cleared.boundary.ua_kw_per_k}`);
  if (cleared.boundary.facility_c === null && cleared.boundary.ua_kw_per_k === null) {
    console.log("PASS auto clears overrides");
  } else {
    failed++;
    console.log("FAIL auto clears overrides");
  }

  // 比例阀滑杆（第 1 个）
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === "启动",
    );
    btn?.click();
  });
  await new Promise((r) => setTimeout(r, 500));

  await (await page.$$('[role="slider"]'))[0].focus();
  await page.keyboard.press("ArrowRight");
  await new Promise((r) => setTimeout(r, 800));
  const p = await state();
  const valve = p.points.find((x) => x.id === "VALVE_CMD").v;
  console.log(`VALVE_CMD=${valve}`);
  if (valve > 0) {
    console.log("PASS valve slider");
  } else {
    failed++;
    console.log("FAIL valve slider");
  }
} finally {
  await browser.close();
}

console.log(failed === 0 ? "ALL PASSED" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
