'use strict';
const assert = require('node:assert/strict'); const path = require('node:path'); const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let mutations = 0; page.on('request', request => { if (request.method() === 'POST' && request.postDataJSON()?.type === 'action') mutations++; });
  try {
    await page.goto('http://127.0.0.1:4177/demo.html');
    await page.getByText('Demonstração · dados fictícios').waitFor();
    assert.equal(await page.locator('.aap-player').count(), 8);
    assert.equal(await page.locator('.aap-card button:enabled').count(), 0);
    await page.getByRole('button', { name: /Viajante 042/ }).click();
    const teleport = page.locator('.aap-card').filter({ has: page.getByRole('heading', { name: 'Ir até jogador', exact: true }) });
    await teleport.getByRole('button').click();
    await page.getByRole('button', { name: 'Confirmar ação' }).click();
    assert.equal(mutations, 0);
    await page.getByLabel('Motivo da ação').fill('Atendimento de teste da interface');
    await page.getByRole('button', { name: 'Confirmar ação' }).dblclick();
    await page.getByRole('status').filter({ hasText: 'Localização atualizada' }).waitFor();
    assert.equal(mutations, 1);
    console.log('PASS target, required reason and double-click produce one operation');
    await page.getByRole('tab', { name: 'Auditoria', exact: true }).click();
    await page.locator('tbody tr').first().waitFor();
    await page.getByRole('button', { name: 'Detalhes', exact: true }).first().click();
    await page.getByText('Atendimento de teste da interface', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert(await page.locator('#aetherius-admin').isVisible());
    console.log('PASS audit details and Escape return to panel');
    await page.getByRole('tab', { name: 'RP / Ferramentas', exact: true }).click();
    assert.equal(await page.locator('.aap-card button:enabled').count(), 0);
    console.log('PASS unavailable tools cannot be executed');
    await page.getByRole('tab', { name: 'Administração', exact: true }).click();
    for (const [width, height] of [[1280, 720], [1920, 1080], [2560, 1080]]) {
      await page.setViewportSize({ width, height });
      assert(await page.locator('#aetherius-admin').evaluate(el => el.scrollWidth <= el.clientWidth));
      assert(await page.locator('.aap-content').evaluate(el => el.scrollWidth <= el.clientWidth));
      assert(await page.locator('.aap-nav').evaluate(el => el.scrollWidth <= el.clientWidth));
    }
    console.log('PASS layout at 720p, 1080p and ultrawide');
    await page.setViewportSize({ width: 1920, height: 1080 });
    const images = path.resolve(__dirname, '../docs/images'); fs.mkdirSync(images, { recursive: true });
    await page.screenshot({ path: path.join(images, 'administracao.png') });
    await page.getByRole('tab', { name: 'Auditoria', exact: true }).click();
    await page.locator('tbody tr').first().waitFor();
    await page.screenshot({ path: path.join(images, 'auditoria.png') });
    // A response that arrives after closing must not reopen the view or retain a revealed name.
    let release; const gate = new Promise(resolve => { release = resolve; }); let delayed;
    await page.route('**/demo/request', async route => {
      if (route.request().postDataJSON().type !== 'action') return route.continue();
      const result = await route.fetch(); delayed = true; await gate; await route.fulfill({ response: result });
    });
    await page.getByRole('tab', { name: 'Administração', exact: true }).click();
    await page.locator('.aap-card').filter({ has: page.getByRole('heading', { name: 'Revelar identidade' }) }).getByRole('button').click();
    await page.getByLabel('Motivo da ação').fill('Conferência de identidade em teste');
    await page.getByRole('button', { name: 'Confirmar ação' }).click();
    for (let tries = 0; !delayed && tries < 50; tries++) await new Promise(resolve => setTimeout(resolve, 20));
    assert(delayed); await page.evaluate(() => window.AetheriusAdmin.close()); release();
    await page.waitForResponse(response => response.url().endsWith('/demo/request'));
    assert(await page.locator('#aetherius-admin').isHidden());
    await page.evaluate(() => window.AetheriusAdmin.toggle());
    await page.getByRole('tab', { name: 'Moderação', exact: true }).waitFor();
    assert(!(await page.locator('#aetherius-admin').innerText()).includes('Personagem demonstrativo'));
    console.log('PASS late sensitive response is discarded after closing');
    assert.deepEqual(errors, []);
    await page.goto('http://127.0.0.1:4177/index.html');
    await page.getByText('Interface de jogo. Abra demo.html para uma prévia com dados fictícios.').waitFor();
    assert.equal(await page.locator('.aap-player').count(), 0);
    console.log('PASS production entry has no mock session or players');
    console.log('6 browser scenarios passed, no JavaScript errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
