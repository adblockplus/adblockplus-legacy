/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

function init()
{
  generateLinkText(E("changeDescription"));

  for each (let subscription in FilterStorage.subscriptions)
  {
    if (subscription instanceof DownloadableSubscription && subscription.url != Prefs.subscriptions_exceptionsurl && !subscription.disabled)
    {
      E("listName").textContent = subscription.title;

      let link = E("listHomepage");
      link.setAttribute("href", subscription.homepage);
      link.setAttribute("title", subscription.homepage);

      E("listNameContainer").removeAttribute("hidden");
      E("listNone").setAttribute("hidden", "true");
      break;
    }
  }

  if (FilterStorage.subscriptions.some(function(s) s.url == Prefs.subscriptions_exceptionsurl))
    E("acceptableAds").removeAttribute("hidden");
}

function generateLinkText(element)
{
  let template = element.getAttribute("_textTemplate");

  let [, beforeLink, linkText, afterLink] = /(.*)\[link\](.*)\[\/link\](.*)/.exec(template) || [null, "", template, ""];
  while (element.firstChild && element.firstChild.nodeType != Node.ELEMENT_NODE)
    element.removeChild(element.firstChild);
  while (element.lastChild && element.lastChild.nodeType != Node.ELEMENT_NODE)
    element.removeChild(element.lastChild);
  if (!element.firstChild)
    return;

  element.firstChild.textContent = linkText;
  element.insertBefore(document.createTextNode(beforeLink), element.firstChild);
  element.appendChild(document.createTextNode(afterLink));
}

function openFilters()
{
  if (Utils.isFennec)
  {
    let topWnd = window.QueryInterface(Ci.nsIInterfaceRequestor)
                       .getInterface(Ci.nsIWebNavigation)
                       .QueryInterface(Ci.nsIDocShellTreeItem)
                       .rootTreeItem
                       .QueryInterface(Ci.nsIInterfaceRequestor)
                       .getInterface(Ci.nsIDOMWindow);
    if (topWnd.wrappedJSObject)
      topWnd = topWnd.wrappedJSObject;

    // window.close() closes the entire window (bug 642604), make sure to close
    // only a single tab instead.
    if ("BrowserUI" in topWnd)
    {
      topWnd.BrowserUI.showPanel("addons-container");
      function showOptions()
      {
        if (!topWnd.ExtensionsView.getElementForAddon(Utils.addonID))
          Utils.runAsync(showOptions);
        else
          topWnd.ExtensionsView.showOptions(Utils.addonID);
      }
      showOptions();
    }
  }
  else
    UI.openFiltersDialog();
}
