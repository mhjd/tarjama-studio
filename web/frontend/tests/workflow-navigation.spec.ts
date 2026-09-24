import { test, expect, type Page } from "@playwright/test";
import type { Job, Project } from "../src/api";

// Deliberately hold the provider response: the ordinary fixture translates too
// quickly to exercise navigation, failures and cancellation during this window.
async function workflow(page: Page, initialStage = "arabic") {
  const project: Project = {
    id: "fixture",
    title: "Parcours de validation",
    stage: initialStage,
    version: 1,
    arabic_version: 1,
    translation_source: 0,
    duration_ms: 4000,
    media: "fixture.mp4",
    segments: Array.from({ length: 18 }, (_, i) => ({
      id: `flow-${i}`,
      start_ms: i * 200,
      end_ms: (i + 1) * 200,
      arabic: "السلام عليكم ورحمة الله",
      french: "",
      version: 1,
    })),
  };
  const job: Job = {
    id: "translate-held",
    kind: "translate",
    state: "queued",
    progress: 0,
    message: "Traduction en attente…",
    next_attempt_at: "",
    source_version: 1,
  };
  const writes: string[] = [];
  let rejectSave = false;
  await page.route("**/api/projects/fixture", (route) =>
    route.fulfill({
      json: { project, jobs: project.stage === "translating" ? [job] : [] },
    }),
  );
  await page.route("**/api/projects/fixture/segments/*", async (route) => {
    if (rejectSave) return route.abort();
    const body = route.request().postDataJSON();
    const segment = project.segments.find((s) =>
      route.request().url().endsWith(`/${s.id}`),
    )!;
    writes.push(`save:${body.field}`);
    if (body.field === "arabic") {
      segment.arabic = body.text;
      project.arabic_version++;
      project.stage = "arabic";
    } else {
      segment.french = body.text;
      if (project.stage === "ready") project.stage = "review";
    }
    segment.version++;
    project.version++;
    await route.fulfill({ json: project });
  });
  await page.route("**/api/projects/fixture/advance", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.version).toBe(project.version);
    expect(body.stage).toBe(project.stage);
    writes.push(`advance:${body.stage}`);
    project.stage = body.stage === "arabic" ? "translating" : "ready";
    await route.fulfill({ json: project });
  });
  await page.route("**/api/projects/fixture/jobs/*/*", async (route) => {
    job.state = route.request().url().endsWith("/cancel")
      ? "cancelled"
      : "queued";
    job.message =
      job.state === "cancelled"
        ? "Traitement annulé"
        : "Traduction en attente…";
    await route.fulfill({ status: 204 });
  });
  await page.goto(
    `/projets/fixture/${initialStage === "translating" ? "traduire" : "corriger"}`,
  );
  await page.getByRole("button", { name: "Compte test alice" }).click();
  return {
    project,
    job,
    writes,
    rejectSave: () => {
      rejectSave = true;
    },
    finish: () => {
      project.stage = "review";
      project.translation_source = project.arabic_version;
      project.segments.forEach((s) => {
        s.french = "Bonjour à toutes et à tous.";
      });
    },
  };
}
const step = (page: Page, n: number) =>
  page
    .locator(".steps")
    .getByRole("button")
    .nth(n - 1);
const arabic = (page: Page) => page.getByRole("textbox", { name: /^Arabe / });
const french = (page: Page) =>
  page.getByRole("textbox", { name: /^Français / });
async function atTop(page: Page) {
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
}

for (const [name, viewport] of Object.entries({
  "macbook-air-15": { width: 1710, height: 1107 },
  "pixel-6": { width: 412, height: 915 },
  "iphone-15": { width: 393, height: 852 },
})) {
  test(`${name}: validation, previous pages and invalidation respect the workflow`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const state = await workflow(page);
    await expect(step(page, 2)).toHaveAttribute("aria-current", "step");
    await expect(step(page, 3)).toBeDisabled();
    await expect(step(page, 4)).toBeDisabled();
    await arabic(page).last().fill("التصحيح الأخير قبل الترجمة");
    await page
      .getByRole("button", { name: "Valider et traduire", exact: true })
      .click();
    await expect(page).toHaveURL(/\/traduire$/);
    await atTop(page);
    expect(state.writes).toEqual(["save:arabic", "advance:arabic"]);
    await expect(arabic(page)).toHaveCount(0);
    await expect(french(page)).toHaveCount(0);
    await expect(step(page, 2)).toBeEnabled();
    await expect(step(page, 3)).toHaveAttribute("aria-current", "step");
    await expect(step(page, 4)).toBeDisabled();
    await page.screenshot({
      path: `test-results/workflow-${name}-waiting.png`,
      fullPage: true,
    });
    await step(page, 2).click();
    await expect(page).toHaveURL(/\/corriger$/);
    await expect(
      page.getByText("lecture seule", { exact: false }),
    ).toBeVisible();
    await expect(arabic(page)).toHaveCount(0);
    await expect(page.locator(".readonly-arabic")).toHaveCount(18);
    await expect(step(page, 3)).toBeEnabled();
    await page.reload();
    await expect(page).toHaveURL(/\/corriger$/);
    await expect(page.locator(".readonly-arabic")).toHaveCount(18);
    await page.screenshot({
      path: `test-results/workflow-${name}-readonly.png`,
    });
    state.finish();
    // Completion must not forcibly navigate away from the Arabic page being read.
    await expect(arabic(page)).toHaveCount(18);
    await expect(page).toHaveURL(/\/corriger$/);
    await expect(french(page)).toHaveCount(0);
    await step(page, 3).click();
    await atTop(page);
    await expect(french(page)).toHaveCount(18);
    await expect(step(page, 4)).toBeDisabled();
    await french(page).last().fill("Traduction relue avant validation.");
    await page
      .getByRole("button", { name: "Valider et exporter", exact: true })
      .click();
    await expect(page).toHaveURL(/\/exporter$/);
    await atTop(page);
    await expect(step(page, 4)).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Créer la vidéo", exact: true }),
    ).toBeVisible();
    // Editing French after approval revokes export, even via a previously valid URL.
    await step(page, 3).click();
    await french(page).first().fill("Une retouche après validation.");
    await french(page).first().blur();
    await expect(step(page, 4)).toBeDisabled();
    await page.goto("/projets/fixture/exporter");
    await expect(page).toHaveURL(/\/traduire$/);
    // Editing Arabic revokes BOTH later stages, even if old French text exists.
    await step(page, 2).click();
    await arabic(page).first().fill("تصحيح جديد بعد الترجمة");
    await arabic(page).first().blur();
    await expect(step(page, 3)).toBeDisabled();
    await expect(step(page, 4)).toBeDisabled();
    await expect(french(page)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Valider et traduire", exact: true }),
    ).toBeDisabled();
    await page.goto("/projets/fixture/traduire");
    await expect(page).toHaveURL(/\/corriger$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/corriger$/);
    expect(state.writes.filter((w) => w.startsWith("advance:"))).toEqual([
      "advance:arabic",
      "advance:review",
    ]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  });
}

test("translation waiting, failure, cancellation and retry never expose partial fields or export", async ({
  page,
}) => {
  const state = await workflow(page, "translating");
  for (const status of ["running", "waiting_provider", "failed"]) {
    state.job.state = status;
    state.job.message = `État de test : ${status}`;
    await expect(page.locator(".job")).toContainText(state.job.message);
    await expect(arabic(page)).toHaveCount(0);
    await expect(french(page)).toHaveCount(0);
    await expect(step(page, 4)).toBeDisabled();
  }
  await page.getByRole("button", { name: "Réessayer", exact: true }).click();
  await expect(page.locator(".job")).toContainText("Traduction en attente");
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(
    page.getByText("Traitement annulé.", { exact: false }),
  ).toBeVisible();
  await expect(arabic(page)).toHaveCount(0);
  await expect(french(page)).toHaveCount(0);
  await expect(step(page, 4)).toBeDisabled();
  await page.getByRole("button", { name: "Reprendre", exact: true }).click();
  state.finish();
  await expect(french(page)).toHaveCount(18);
  await expect(step(page, 4)).toBeDisabled();
});

test("step navigation flushes drafts and refuses to leave after a failed save", async ({
  page,
}) => {
  const state = await workflow(page);
  await arabic(page).first().fill("حفظ قبل تغيير الصفحة");
  await step(page, 1).click();
  await expect(page).toHaveURL(/\/preparer$/);
  expect(state.writes).toEqual(["save:arabic"]);
  await expect(
    page.getByRole("heading", { name: "Préparation terminée" }),
  ).toBeVisible();
  await expect(arabic(page)).toHaveCount(0);
  await expect(step(page, 3)).toBeDisabled();
  await page.goBack();
  await expect(page).toHaveURL(/\/corriger$/);
  await expect(arabic(page).first()).toHaveValue("حفظ قبل تغيير الصفحة");
  state.rejectSave();
  await arabic(page).first().fill("مسودة محفوظة في المتصفح");
  await step(page, 1).click();
  await expect(
    page.getByText("Navigation interrompue", { exact: false }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/corriger$/);
  await expect(arabic(page).first()).toHaveValue("مسودة محفوظة في المتصفح");
  expect(state.writes).toEqual(["save:arabic"]);
});

test("every premature direct URL is guarded without starting work", async ({
  page,
}) => {
  test.setTimeout(60000);
  const state = await workflow(page);
  const slugs = ["preparer", "corriger", "traduire", "exporter"];
  for (const [stage, current] of Object.entries({
    upload: 0,
    preparing: 0,
    transcribing: 0,
    cleaning: 0,
    arabic: 1,
    translating: 2,
    review: 2,
    ready: 3,
  })) {
    state.project.stage = stage;
    for (let next = current + 1; next < slugs.length; next++) {
      await page.goto(`/projets/fixture/${slugs[next]}`);
      await expect(page).toHaveURL(new RegExp(`/${slugs[current]}$`));
      for (let i = 0; i < slugs.length; i++) {
        if (i <= current) await expect(step(page, i + 1)).toBeEnabled();
        else await expect(step(page, i + 1)).toBeDisabled();
      }
      await expect(
        page.getByRole("button", { name: "Créer la vidéo", exact: true }),
      ).toHaveCount(0);
      if (current === 0 || stage === "translating") {
        await expect(arabic(page)).toHaveCount(0);
        await expect(french(page)).toHaveCount(0);
      }
    }
  }
  expect(state.writes).toEqual([]);
});
