import { expect, test } from './electron.fixture';

async function enterPracticeMode(page: import('@playwright/test').Page): Promise<void> {
  await page
    .locator('#workshop-mode-selector')
    .getByRole('button', { name: /연습 모드/ })
    .click();
  await expect(page.locator('#palette')).toBeVisible();
}

test('palette categories and equipment can be operated with the keyboard', async ({ harness }) => {
  const { page } = harness;
  await enterPracticeMode(page);

  const category = page.locator('#palette h3[data-cat="power"]');
  const firstPowerDevice = page.locator('#palette .pal[data-cat="power"]').first();

  await category.focus();
  await expect(category).toBeFocused();
  await expect(category).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Space');
  await expect(category).toHaveClass(/collapsed/);
  await expect(firstPowerDevice).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(category).not.toHaveClass(/collapsed/);
  await expect(firstPowerDevice).toBeVisible();

  const equipment = page.locator('#palette .pal[data-type="MCCB"]');
  await equipment.focus();
  await expect(equipment).toBeFocused();
  await expect(page.locator('#counter')).toHaveText('0');
  await page.keyboard.press('Enter');
  await expect(page.locator('#counter')).toHaveText('1');
});

test('searching does not reopen a keyboard-collapsed palette category', async ({ harness }) => {
  const { page } = harness;
  await enterPracticeMode(page);

  const powerCategory = page.locator('#palette h3[data-cat="power"]');
  const firstPowerDevice = page.locator('#palette .pal[data-cat="power"]').first();
  const search = page.locator('#palette input[type="text"]');

  await powerCategory.focus();
  await page.keyboard.press('Space');
  await expect(powerCategory).toHaveAttribute('aria-expanded', 'false');
  await expect(firstPowerDevice).toBeHidden();

  await search.fill('MCCB');
  await search.fill('');
  await expect(powerCategory).toHaveAttribute('aria-expanded', 'false');
  await expect(firstPowerDevice).toBeHidden();

  await powerCategory.focus();
  await page.keyboard.press('Enter');
  await expect(powerCategory).toHaveAttribute('aria-expanded', 'true');
  await search.fill('MCCB');
  await expect(firstPowerDevice).toBeVisible();
});

test('moves focus to a visible palette control when filtering or collapsing hides the focused item', async ({ harness }) => {
  const { page } = harness;
  await enterPracticeMode(page);

  const powerCategory = page.locator('#palette h3[data-cat="power"]');
  const powerDevice = page.locator('#palette .pal[data-cat="power"]').first();
  const search = page.locator('#palette input[type="text"]');

  await powerDevice.focus();
  await expect(powerDevice).toBeFocused();
  // A palette rebuild/toggle can be triggered without the category heading
  // receiving focus first; the hidden item must not retain focus.
  await powerCategory.evaluate((heading) => heading.click());
  await expect(powerDevice).toBeHidden();
  await expect(powerCategory).toBeFocused();

  await powerCategory.evaluate((heading) => heading.click());
  await expect(powerDevice).toBeVisible();
  await powerDevice.focus();
  await expect(powerDevice).toBeFocused();
  // Model a search update from an assistive/control path that does not itself
  // focus the input, then require a visible focus destination.
  await search.evaluate((input) => {
    input.value = 'no matching palette equipment';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(powerDevice).toBeHidden();
  await expect(search).toBeFocused();
});
