import puppeteer from "puppeteer-core";

const url = process.argv[2] ?? "http://127.0.0.1:8030/";
const base = url.replace(/\/$/, "");
const edge =
  process.env.EDGE_PATH ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

async function points() {
  const res = await fetch(`${base}/api/points`);
  const body = await res.json();
  return new Map(body.points.map((p) => [p.id, p]));
}

async function put(id, body) {
  await fetch(`${base}/api/points/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** 用键盘把第 index 个滑杆设到 value（Radix 滑杆支持 Home/方向键）。 */
async function setSlider(page, index, value) {
  const thumbs = await page.$$('[role="slider"]');
  const thumb = thumbs[index];
  if (!thumb) throw new Error(`slider ${index} not found`);
  await thumb.focus();
  await page.keyboard.press("Home");
  for (let i = 0; i < value; i += 1) {
    await page.keyboard.press("ArrowRight");
  }
}

const browser = await puppeteer.launch({
  executablePath: edge,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"],
});

let failed = 0;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle2", timeout: 20000 });
  await page.waitForFunction(() => document.body.innerText.includes("T22"), { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 1200));

  // 先复位到停泵状态，保证测试可重复
  await put("PUMP1_RUN_CMD", { on: false });
  await put("PUMP2_RUN_CMD", { on: false });
  await put("PUMP1_SPEED_CMD", { value: 0 });
  await put("PUMP2_SPEED_CMD", { value: 0 });
  await new Promise((r) => setTimeout(r, 2500));

  const before = await points();
  const q2Before = before.get("Q2").v;
  console.log(`Q2 before = ${q2Before.toFixed(2)}`);

  // 点「启动」启动泵 2（两个泵都停止时有两个启动按钮，取最后一个）
  const clicked = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")].filter(
      (b) => (b.textContent ?? "").trim() === "启动",
    );
    const btn = buttons[buttons.length - 1];
    btn?.click();
    return Boolean(btn);
  });
  console.log(`clicked start button: ${clicked}`);

  await new Promise((r) => setTimeout(r, 2500));
  const afterStart = await points();
  console.log(
    `PUMP2_RUN_CMD=${afterStart.get("PUMP2_RUN_CMD").v} PUMP2_RUN=${afterStart.get("PUMP2_RUN").v} Q2=${afterStart.get("Q2").v.toFixed(2)}`,
  );
  if (afterStart.get("PUMP2_RUN_CMD").v === 1 && afterStart.get("PUMP2_RUN").v === 1) {
    console.log("PASS pump 2 start via UI");
  } else {
    failed++;
    console.log("FAIL pump 2 start via UI");
  }

  if (Math.abs(afterStart.get("Q2").v - q2Before) < 1) {
    console.log("PASS pump running at 0% adds no flow");
  } else {
    failed++;
    console.log("FAIL pump running at 0% adds no flow");
  }

  // 泵 2 转速滑杆（第 3 个）拖到 80%
  await setSlider(page, 2, 80);
  await new Promise((r) => setTimeout(r, 2200));
  const afterSpeed = await points();
  const q2After = afterSpeed.get("Q2").v;
  console.log(`PUMP2_SPEED_CMD=${afterSpeed.get("PUMP2_SPEED_CMD").v} Q2=${q2After.toFixed(2)}`);
  if (q2After > q2Before + 1) {
    console.log("PASS pump speed affects Q2 via UI");
  } else {
    failed++;
    console.log("FAIL pump speed affects Q2 via UI");
  }

  // 比例阀滑杆（第 1 个）拖到 60%
  await setSlider(page, 0, 60);
  await new Promise((r) => setTimeout(r, 1500));
  const afterValve = await points();
  const valveCmd = afterValve.get("VALVE_CMD").v;
  console.log(`VALVE_CMD=${valveCmd}`);
  if (Math.abs(valveCmd - 60) < 1) {
    console.log("PASS valve slider via UI");
  } else {
    failed++;
    console.log("FAIL valve slider via UI");
  }
} finally {
  await browser.close();
}

console.log(failed === 0 ? "ALL PASSED" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
