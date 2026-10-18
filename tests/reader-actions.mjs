// Follow the visible staging split-button UI; older/public readers retain Paste.
export async function pasteOnly(page){await pasteAction(page,'#paste');}
export async function pasteAction(page,selector){
 if(selector==='#paste'&&await page.locator('#paste-options').count()&&await page.locator('#paste').isHidden())await page.locator('#paste-options').click();
 await page.locator(selector).click();
}
