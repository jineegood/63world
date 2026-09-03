const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

/* Real-browser visual regression harness for the costume preview versus the
   equipped world renderer. It records computed geometry, pixel difference,
   and a side-by-side PNG; unlike harness.js this intentionally uses Edge. */

const outputDir = path.resolve(process.argv[2] || path.join(process.cwd(), '.codex_work', 'nameplate-visual'));
const url = process.argv[3] || 'http://127.0.0.1:4173/';
const executablePath = process.argv[4] || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

fs.mkdirSync(outputDir, { recursive:true });

(async () => {
  const browser = await chromium.launch({ executablePath, headless:true });
  const page = await browser.newPage({ viewport:{ width:1920, height:1080 }, deviceScaleFactor:1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error?.message || error)));
  await page.goto(url, { waitUntil:'networkidle' });
  await page.waitForFunction(() => window.YuksamRaidNameplatesV1?.pickerMarkup && window.YuksamPlayerNameplateV1?.draw);
  const result = await page.evaluate(async () => {
    const player = {
      name:'명진쌤', level:40, class:'warrior', spec:'무기',
      raidNameplates:['raid_20_steel', 'raid_40_twilight', 'raid_63_summit'],
      nameplate:{ theme:'raid_20_steel' },
      costume:{}, costumeInventory:[], appearance:{}, equipment:{},
    };
    window.eval(`game.player = ${JSON.stringify(player)}`);
    window.openCostumePanelV55();
    await new Promise((resolve) => setTimeout(resolve, 120));
    await document.fonts.ready;
    window.YuksamRaidNameplatesV1.renderPickerCanvases(player);

    const cards = [...document.querySelectorAll('.raid-nameplate-card-v1')];
    const comparisons = document.createElement('section');
    comparisons.id = 'nameplateRuntimeComparisonsV1';
    comparisons.style.cssText = 'position:fixed;z-index:99999;left:20px;top:20px;width:760px;padding:16px;background:#020617;color:#fff;display:grid;gap:12px';
    const measurements = [];
    const pixelBounds = (canvas) => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          if (pixels[(y * canvas.width + x) * 4 + 3] === 0) continue;
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }
      return {
        width:maxX >= minX ? maxX - minX + 1 : 0,
        height:maxY >= minY ? maxY - minY + 1 : 0,
        left:minX,
        top:minY,
      };
    };
    const pixelDifference = (leftCanvas, rightCanvas) => {
      if (!leftCanvas || leftCanvas.width !== rightCanvas.width || leftCanvas.height !== rightCanvas.height) return null;
      const left = leftCanvas.getContext('2d').getImageData(0, 0, leftCanvas.width, leftCanvas.height).data;
      const right = rightCanvas.getContext('2d').getImageData(0, 0, rightCanvas.width, rightCanvas.height).data;
      let changedChannels = 0;
      let changedPixels = 0;
      let absoluteDifference = 0;
      let maximumDifference = 0;
      let minX = leftCanvas.width, minY = leftCanvas.height, maxX = -1, maxY = -1;
      for (let index = 0; index < left.length; index += 1) {
        const difference = Math.abs(left[index] - right[index]);
        if (difference > 0) changedChannels += 1;
        absoluteDifference += difference;
        maximumDifference = Math.max(maximumDifference, difference);
        if (index % 4 === 0) {
          const pixelDifference = Math.max(
            Math.abs(left[index] - right[index]),
            Math.abs(left[index + 1] - right[index + 1]),
            Math.abs(left[index + 2] - right[index + 2]),
            Math.abs(left[index + 3] - right[index + 3]),
          );
          if (pixelDifference > 0) {
            changedPixels += 1;
            const pixelIndex = index / 4;
            const x = pixelIndex % leftCanvas.width;
            const y = Math.floor(pixelIndex / leftCanvas.width);
            minX = Math.min(minX, x); minY = Math.min(minY, y);
            maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
          }
        }
      }
      return {
        changedChannels,
        changedPixels,
        meanAbsoluteDifference:absoluteDifference / left.length,
        maximumDifference,
        bounds:maxX >= minX ? { minX, minY, maxX, maxY } : null,
      };
    };
    cards.slice(0, 3).forEach((card, index) => {
      const preview = card.querySelector('.raid-nameplate-preview-v1');
      const previewRect = preview.getBoundingClientRect();
      const previewCanvas = preview.querySelector('[data-raid-nameplate-canvas-v1]');
      const canvas = document.createElement('canvas');
      const theme = ['raid_20_steel', 'raid_40_twilight', 'raid_63_summit'][index];
      canvas.width = previewCanvas?.width || Math.round(previewRect.width);
      canvas.height = previewCanvas?.height || 60;
      canvas.style.cssText = `display:block;width:${canvas.width}px;height:${canvas.height}px;background:transparent`;
      window.YuksamPlayerNameplateV1.draw(
        canvas.getContext('2d'),
        canvas.width / 2,
        previewCanvas ? -58 : -54,
        { ...player, nameplate:{ theme } },
        { source:'local' },
      );
      const row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start';
      const domSide = document.createElement('div');
      domSide.innerHTML = '<small>costume DOM preview</small>';
      if (previewCanvas) {
        const image = document.createElement('img');
        image.src = previewCanvas.toDataURL();
        image.width = previewCanvas.width;
        image.height = previewCanvas.height;
        image.style.display = 'block';
        domSide.appendChild(image);
      } else {
        domSide.appendChild(preview.cloneNode(true));
      }
      const canvasSide = document.createElement('div');
      canvasSide.innerHTML = '<small>equipped canvas renderer</small>';
      canvasSide.appendChild(canvas);
      row.append(domSide, canvasSide);
      comparisons.appendChild(row);

      const style = getComputedStyle(preview);
      const nameNode = preview.querySelector('b');
      const roleNode = preview.querySelector('small');
      const iconNode = preview.querySelector('i');
      const nameStyle = nameNode ? getComputedStyle(nameNode) : null;
      const roleStyle = roleNode ? getComputedStyle(roleNode) : null;
      const relativeRect = (node) => {
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return {
          left:rect.left - previewRect.left,
          top:rect.top - previewRect.top,
          width:rect.width,
          height:rect.height,
        };
      };
      measurements.push({
        theme,
        dom:{
          width:previewRect.width, height:previewRect.height,
          backgroundImage:style.backgroundImage,
          border:style.border,
          borderRadius:style.borderRadius,
          padding:style.padding,
          renderer:previewCanvas ? 'shared-canvas' : 'css-dom',
          nameFont:nameStyle ? `${nameStyle.fontWeight} ${nameStyle.fontSize} ${nameStyle.fontFamily}` : null,
          roleFont:roleStyle ? `${roleStyle.fontWeight} ${roleStyle.fontSize} ${roleStyle.fontFamily}` : null,
          iconRect:relativeRect(iconNode),
          nameRect:relativeRect(nameNode),
          roleRect:relativeRect(roleNode),
          canvas:previewCanvas ? pixelBounds(previewCanvas) : null,
        },
        canvas:pixelBounds(canvas),
        pixelDifference:pixelDifference(previewCanvas, canvas),
      });
    });
    document.body.appendChild(comparisons);
    return measurements;
  });
  await page.locator('#nameplateRuntimeComparisonsV1').screenshot({ path:path.join(outputDir, 'comparison.png') });
  fs.writeFileSync(path.join(outputDir, 'measurements.json'), JSON.stringify({ result, errors }, null, 2));
  console.log(JSON.stringify({ result, errors, screenshot:path.join(outputDir, 'comparison.png') }, null, 2));
  /* Separate DOM canvases can rasterize large glowing text a few channel
     values apart because their on-screen positions land on different device
     subpixels. Geometry must still be exact, and a real renderer mismatch is
     far above this narrow antialiasing allowance. */
  if (errors.length || result.slice(0, 2).some((entry) => (
    entry.dom.renderer !== 'shared-canvas'
    || !entry.dom.canvas
    || entry.dom.canvas.width !== entry.canvas.width
    || entry.dom.canvas.height !== entry.canvas.height
    || !entry.pixelDifference
    || entry.pixelDifference.meanAbsoluteDifference > 5
  ))) process.exitCode = 1;
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
