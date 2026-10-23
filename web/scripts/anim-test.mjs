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
  await page.setViewport({ width: 1600, height: 1000 });
  await page.goto(url, { waitUntil: "networkidle2", timeout: 20000 });
  await page.waitForFunction(() => document.body.innerText.includes("T22"), { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 1000));

  const result = await page.evaluate(async () => {
    const paths = [...document.querySelectorAll('path[stroke-dasharray="5 17"]')];
    const animations = paths.map((p) => getComputedStyle(p).animationName);
    const samples = [];
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 40));
      samples.push({
        t: performance.now(),
        values: paths.map((p) => Number(p.style.strokeDashoffset || 0)),
      });
    }
    return { count: paths.length, animations, samples };
  });

  console.log(`paths=${result.count} cssAnimations=${result.animations.join(",")}`);

  for (let j = 0; j < result.count; j++) {
    const speeds = [];
    for (let i = 1; i < result.samples.length; i++) {
      const dt = (result.samples[i].t - result.samples[i - 1].t) / 1000;
      const dv =
        (result.samples[i - 1].values[j] - result.samples[i].values[j] + 22) % 22;
      if (dt > 0) speeds.push(dv / dt);
    }
    const min = Math.min(...speeds);
    const max = Math.max(...speeds);
    console.log(
      `pipe ${j}: ${min.toFixed(1)}..${max.toFixed(1)} px/s (target ${(12 + Math.min(48, Math.sqrt(25) * 9)).toFixed(0)} for Q2≈25)`,
    );
    if (min < 1) {
      console.log(`  FAIL pipe ${j} appears frozen`);
      process.exitCode = 1;
    }
  }
} finally {
  await browser.close();
}
