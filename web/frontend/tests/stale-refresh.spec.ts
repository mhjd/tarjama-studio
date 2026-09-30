import { test, expect } from "@playwright/test";

test("a delayed poll cannot undo an acknowledged save before advancing", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Compte test alice" }).click();
  const response = await page.request.get("/api/projects/fixture");
  const fixture = await response.json();
  let project = { ...fixture.project, stage: "arabic", version: 100, translation_source: 0 };
  let holdNext = false;
  let release!: () => void;
  let held!: () => void;
  let delivered!: () => void;
  const readHeld = new Promise<void>((resolve) => { held = resolve; });
  const readReleased = new Promise<void>((resolve) => { release = resolve; });
  const readDelivered = new Promise<void>((resolve) => { delivered = resolve; });
  await page.route("**/api/projects/fixture", async (route) => {
    const snapshot = structuredClone(project);
    if (holdNext) {
      holdNext = false;
      held();
      await readReleased;
      await route.fulfill({ json: { project: snapshot, jobs: [] } });
      delivered();
    } else await route.fulfill({ json: { project: snapshot, jobs: [] } });
  });
  await page.route("**/api/projects/fixture/segments/one", async (route) => {
    const { text } = route.request().postDataJSON();
    project = { ...project, version: 101, segments: project.segments.map((s: {id: string}) => s.id === "one" ? { ...s, arabic: text } : s) };
    await route.fulfill({ json: project });
  });
  let submittedVersion = 0;
  await page.route("**/api/projects/fixture/advance", async (route) => {
    submittedVersion = route.request().postDataJSON().version;
    project = { ...project, stage: "translating" };
    await route.fulfill({ json: project });
  });
  await page.getByRole("button", { name: /Cours d’arabe/ }).click();
  const arabic = page.getByRole("textbox", { name: "Arabe one", exact: true });
  await expect(arabic).toBeVisible();
  holdNext = true;
  await readHeld;
  await arabic.fill("نص محفوظ جديد");
  await arabic.blur();
  await expect(page.getByRole("status")).toContainText("Enregistré");
  release();
  await readDelivered;
  // Let the delivered fetch continuation reach React before the action.
  await page.waitForTimeout(100);
  await expect(arabic).toHaveValue("نص محفوظ جديد");
  await page.getByRole("button", { name: "Valider et traduire", exact: true }).click();
  await expect.poll(() => submittedVersion).toBe(101);
});
