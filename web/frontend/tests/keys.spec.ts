import { test, expect } from "@playwright/test";

test("personal keys expose DeepSeek/OpenRouter and Groq only", async ({
  page,
}) => {
  await page.goto("/compte/cles");
  await page.getByRole("button", { name: "Compte test alice" }).click();
  await expect(
    page.getByRole("heading", { name: "OpenRouter · DeepSeek" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Groq · transcription" }),
  ).toBeVisible();
  await expect(page.getByText(/Gemini|Google AI Studio/)).toHaveCount(0);
  const section = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "OpenRouter · DeepSeek" }),
    })
    .last();
  await section
    .getByLabel("Clé personnelle", { exact: true })
    .fill("synthetic-openrouter-test-key");
  await section.getByRole("button", { name: "Utiliser cette clé" }).click();
  await expect(section.getByText("Clé personnelle configurée")).toBeVisible();
  await page.reload();
  await expect(section.getByText("Clé personnelle configurée")).toBeVisible();
  await expect(
    section.getByLabel("Clé personnelle", { exact: true }),
  ).toHaveValue("");
  await section.getByRole("button", { name: "Supprimer ma clé" }).click();
  await expect(
    section.getByText("Service partagé", { exact: true }),
  ).toBeVisible();
});
