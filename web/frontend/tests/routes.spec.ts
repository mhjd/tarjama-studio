import { test, expect, type Page } from "@playwright/test";

async function session(page: Page, path = "/projets") {
  await page.goto(path);
  await page.getByRole("button", { name: "Compte test alice" }).click();
}
async function fixtureStage(page: Page, getStage: () => string) {
  await page.route("**/api/projects/fixture", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const data = await response.json();
    data.project.stage = getStage();
    data.jobs = [];
    await route.fulfill({ response, json: data });
  });
}

test("project deep links reload, preserve login destination, and support back/forward", async ({
  page,
}) => {
  await fixtureStage(page, () => "arabic");
  await session(page, "/projets/fixture/corriger");
  await expect(
    page.getByRole("textbox", { name: "Arabe one", exact: true }),
  ).toBeEditable();
  await page.reload();
  await expect(page).toHaveURL(/\/projets\/fixture\/corriger$/);
  await expect(
    page.getByRole("textbox", { name: "Arabe one", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "← Mes projets", exact: true })
    .click();
  await expect(page).toHaveURL(/\/projets$/);
  await page.getByRole("button", { name: /Cours d’arabe/ }).click();
  await expect(page).toHaveURL(/\/projets\/fixture\/corriger$/);
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Mes projets", exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("textbox", { name: "Arabe one", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mes clés", exact: true }).click();
  await expect(page).toHaveURL(/\/compte\/cles$/);
  await page.getByRole("button", { name: "← Retour", exact: true }).click();
  await expect(page).toHaveURL(/\/projets\/fixture\/corriger$/);
});

test("URL edits cannot skip preparation, correction or review; polling updates canonical route", async ({
  page,
}) => {
  let stage = "cleaning";
  await fixtureStage(page, () => stage);
  let advances = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/advance") || r.url().endsWith("/exports"))
      advances++;
  });
  await session(page, "/projets/fixture/exporter");
  await expect(page).toHaveURL(/\/projets\/fixture\/preparer$/);
  await expect(page.getByRole("textbox", { name: /Arabe/ })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Créer la vidéo", exact: true }),
  ).toHaveCount(0);
  stage = "arabic";
  await expect(page).toHaveURL(/\/projets\/fixture\/corriger$/);
  await page.goto("/projets/fixture/exporter");
  await expect(page).toHaveURL(/\/projets\/fixture\/corriger$/);
  await expect(
    page.getByRole("button", { name: "Créer la vidéo", exact: true }),
  ).toHaveCount(0);
  stage = "review";
  await expect(page).toHaveURL(/\/projets\/fixture\/traduire$/);
  await page.goto("/projets/fixture/exporter");
  await expect(page).toHaveURL(/\/projets\/fixture\/traduire$/);
  stage = "ready";
  await expect(page).toHaveURL(/\/projets\/fixture\/exporter$/);
  expect(advances).toBe(0);
});

test("browser back refuses to lose an unsaved draft", async ({ page }) => {
  await fixtureStage(page, () => "arabic");
  await session(page);
  await page.getByRole("button", { name: /Cours d’arabe/ }).click();
  const field = page.getByRole("textbox", { name: "Arabe one", exact: true });
  await page.route("**/segments/one", (route) => route.abort());
  await field.fill("مسودة لا تضيع");
  await page.goBack();
  await expect(page).toHaveURL(/\/projets\/fixture\/corriger$/);
  await expect(field).toHaveValue("مسودة لا تضيع");
  await expect(page.getByRole("alert").first()).toBeVisible();
});

test("foreign and missing project routes do not reveal a project", async ({
  page,
  browser,
}) => {
  const context = await browser.newContext();
  const other = await context.newPage();
  await other.goto("/projets/fixture/exporter");
  await other.getByRole("button", { name: "Compte test bob" }).click();
  await expect(
    other.getByRole("heading", { name: "Page indisponible" }),
  ).toBeVisible();
  await expect(
    other.getByRole("textbox", { name: "Titre du projet" }),
  ).toHaveCount(0);
  await context.close();
  await session(page, "/projets/does-not-exist/corriger");
  await expect(
    page.getByRole("heading", { name: "Page indisponible" }),
  ).toBeVisible();
});

test("browser back saves a title even without a blur", async ({ page }) => {
  await fixtureStage(page, () => "arabic");
  await session(page);
  await page.getByRole("button", { name: /Cours d’arabe/ }).click();
  const title = page.getByRole("textbox", { name: "Titre du projet" });
  await title.fill("Titre sauvegardé avant navigation");
  await page.goBack();
  await expect(page).toHaveURL(/\/projets$/);
  await expect(
    page.getByRole("button", { name: /Titre sauvegardé avant navigation/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Titre sauvegardé avant navigation/ })
    .click();
  await title.fill("Cours d’arabe");
  await title.blur();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/projects/fixture")).json()).project
          .title,
    )
    .toBe("Cours d’arabe");
});
